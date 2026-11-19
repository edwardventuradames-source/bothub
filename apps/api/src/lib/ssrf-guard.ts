import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data'
]);

const SIMULATED_LOCAL_DOMAINS = new Set(['example.com', 'localhost']);

function stripIpBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function parseMappedIpv4FromIpv6(ip: string): string | null {
  const normalized = ip.toLowerCase();
  const dottedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dottedMatch) {
    return dottedMatch[1];
  }
  const hexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    const a = (high >> 8) & 0xff;
    const b = high & 0xff;
    const c = (low >> 8) & 0xff;
    const d = low & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }
  return null;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const cleanIp = stripIpBrackets(rawIp).split('%')[0];
  const version = net.isIP(cleanIp);
  if (version === 0) {
    return false;
  }

  if (version === 6) {
    const mappedIpv4 = parseMappedIpv4FromIpv6(cleanIp);
    if (mappedIpv4) {
      return isPrivateOrReservedIp(mappedIpv4);
    }
    const lower = cleanIp.toLowerCase();
    if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1' || lower === '0:0:0:0:0:0:0:0') {
      return true;
    }
    const firstHextet = parseInt(lower.split(':')[0] || '0', 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true;
    if ((firstHextet & 0xffc0) === 0xfe80) return true;
    if ((firstHextet & 0xff00) === 0xff00) return true;
    return false;
  }

  const parts = cleanIp.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

export function isSimulatedLocalHostname(hostname: string): boolean {
  const lower = stripIpBrackets(hostname);
  return (
    lower.endsWith('.local') ||
    SIMULATED_LOCAL_DOMAINS.has(lower)
  );
}

export function isBlockedHostnameOrIp(
  hostname: string,
  allowSimulatedLocal = false
): boolean {
  const cleanHost = stripIpBrackets(hostname);
  if (!cleanHost) {
    return true;
  }
  if (allowSimulatedLocal && (cleanHost.endsWith('.local') || cleanHost === 'example.com')) {
    return false;
  }
  if (
    BLOCKED_HOSTNAMES.has(cleanHost) ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.internal') ||
    cleanHost.endsWith('.local') ||
    cleanHost.endsWith('.localdomain')
  ) {
    return true;
  }
  if (net.isIP(cleanHost) !== 0) {
    return isPrivateOrReservedIp(cleanHost);
  }
  if (/^\d+$/.test(cleanHost) || /^0x[0-9a-f]+$/i.test(cleanHost)) {
    return true;
  }
  return false;
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options: { allowSimulatedLocal?: boolean } = {}
): Promise<URL> {
  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Protocolo no permitido: ${parsedUrl.protocol}`);
  }
  const cleanHost = stripIpBrackets(parsedUrl.hostname);
  if (isBlockedHostnameOrIp(cleanHost, options.allowSimulatedLocal)) {
    throw new Error(`Host bloqueado por política de seguridad SSRF: ${parsedUrl.hostname}`);
  }
  if (
    options.allowSimulatedLocal &&
    (cleanHost.endsWith('.local') || cleanHost === 'example.com')
  ) {
    return parsedUrl;
  }
  if (net.isIP(cleanHost) === 0) {
    try {
      const resolved = await dns.lookup(cleanHost, { all: true });
      for (const record of resolved) {
        if (isPrivateOrReservedIp(record.address)) {
          throw new Error(
            `Host bloqueado por resolución DNS hacia IP privada SSRF: ${parsedUrl.hostname}`
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('SSRF')) {
        throw err;
      }
    }
  }
  return parsedUrl;
}
