import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const INITIAL_NATIVE_FETCH = globalThis.fetch;
const DEFAULT_MAX_RESPONSE_BYTES = 262144;

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

function isPrivateIpv4Parts(parts: number[]): boolean {
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

function expandIpv6Hextets(rawIpv6: string): number[] | null {
  let clean = rawIpv6.toLowerCase();
  const lastColon = clean.lastIndexOf(':');
  const tail = clean.slice(lastColon + 1);
  if (tail.includes('.')) {
    const ipv4Parts = tail.split('.').map(Number);
    if (
      ipv4Parts.length !== 4 ||
      ipv4Parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return null;
    }
    const h1 = ((ipv4Parts[0] << 8) | ipv4Parts[1]).toString(16);
    const h2 = ((ipv4Parts[2] << 8) | ipv4Parts[3]).toString(16);
    clean = `${clean.slice(0, lastColon + 1)}${h1}:${h2}`;
  }

  const halves = clean.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;

  const fullParts = [
    ...left,
    ...Array.from({ length: Math.max(0, missing) }, () => '0'),
    ...right
  ];
  if (fullParts.length !== 8) return null;

  const hextets = fullParts.map((part) => (/^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : NaN));
  if (hextets.some((val) => Number.isNaN(val))) return null;
  return hextets;
}

export function isPrivateOrReservedIp(rawIp: string): boolean {
  const cleanIp = stripIpBrackets(rawIp).split('%')[0];
  const version = net.isIP(cleanIp);
  if (version === 0) {
    return false;
  }

  if (version === 6) {
    const hextets = expandIpv6Hextets(cleanIp);
    if (!hextets) {
      return true;
    }
    const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets;

    const allZeroPrefix = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
    if (allZeroPrefix && h5 === 0) {
      if (h6 === 0 && (h7 === 0 || h7 === 1)) {
        return true;
      }
      return true;
    }
    if (allZeroPrefix && h5 === 0xffff) {
      return isPrivateIpv4Parts([
        (h6 >> 8) & 0xff,
        h6 & 0xff,
        (h7 >> 8) & 0xff,
        h7 & 0xff
      ]);
    }
    if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0xffff && h5 === 0) {
      return isPrivateIpv4Parts([
        (h6 >> 8) & 0xff,
        h6 & 0xff,
        (h7 >> 8) & 0xff,
        h7 & 0xff
      ]);
    }
    if (h0 === 0x0064 && h1 === 0xff9b && (h2 === 0 || h2 === 0x0001)) {
      return true;
    }
    if (h0 === 0x2002) {
      return true;
    }
    if (h0 === 0x2001 && (h1 === 0x0000 || h1 === 0x0db8)) {
      return true;
    }
    if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) {
      return true;
    }
    if ((h0 & 0xfe00) === 0xfc00) return true;
    if ((h0 & 0xffc0) === 0xfe80) return true;
    if ((h0 & 0xff00) === 0xff00) return true;
    return false;
  }

  return isPrivateIpv4Parts(cleanIp.split('.').map(Number));
}

export function isSimulatedLocalHostname(hostname: string): boolean {
  const lower = stripIpBrackets(hostname);
  return lower.endsWith('.local') || SIMULATED_LOCAL_DOMAINS.has(lower);
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

export async function resolveAndPinExternalUrl(
  rawUrl: string,
  options: { allowSimulatedLocal?: boolean; skipDnsResolution?: boolean } = {}
): Promise<{ url: URL; pinnedAddress: string | null; family: 4 | 6 | null }> {
  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`Protocolo no permitido: ${parsedUrl.protocol}`);
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Las credenciales en la URL no están permitidas por seguridad SSRF.');
  }
  const cleanHost = stripIpBrackets(parsedUrl.hostname);
  if (isBlockedHostnameOrIp(cleanHost, options.allowSimulatedLocal)) {
    throw new Error(`Host bloqueado por política de seguridad SSRF: ${parsedUrl.hostname}`);
  }
  if (
    options.allowSimulatedLocal &&
    (cleanHost.endsWith('.local') || cleanHost === 'example.com')
  ) {
    return { url: parsedUrl, pinnedAddress: null, family: null };
  }

  const literalVersion = net.isIP(cleanHost);
  if (literalVersion !== 0) {
    return {
      url: parsedUrl,
      pinnedAddress: cleanHost,
      family: literalVersion === 6 ? 6 : 4
    };
  }

  if (options.skipDnsResolution) {
    return { url: parsedUrl, pinnedAddress: null, family: null };
  }

  const resolved = await dns.lookup(cleanHost, { all: true });
  if (!resolved || resolved.length === 0) {
    throw new Error(`No se pudo resolver DNS externo seguro para: ${parsedUrl.hostname}`);
  }
  for (const record of resolved) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error(
        `Host bloqueado por resolución DNS hacia IP privada SSRF: ${parsedUrl.hostname}`
      );
    }
  }
  return {
    url: parsedUrl,
    pinnedAddress: resolved[0].address,
    family: resolved[0].family === 6 ? 6 : 4
  };
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options: { allowSimulatedLocal?: boolean } = {}
): Promise<URL> {
  const resolved = await resolveAndPinExternalUrl(rawUrl, options);
  return resolved.url;
}

export async function pinnedSafeFetch(
  rawUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    maxBytes?: number;
  }
): Promise<{ status: number; ok: boolean; headers: Record<string, string>; text: string }> {
  const isMockedFetch = globalThis.fetch !== INITIAL_NATIVE_FETCH;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  if (isMockedFetch) {
    const validated = await resolveAndPinExternalUrl(rawUrl, { skipDnsResolution: true });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(validated.url.toString(), {
        method: options.method ?? 'GET',
        headers: options.headers,
        redirect: 'manual',
        body: options.body,
        signal: controller.signal
      });
      const text = (await response.text()).slice(0, maxBytes);
      return {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        text
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const { url, pinnedAddress, family } = await resolveAndPinExternalUrl(rawUrl);
  if (!pinnedAddress || !family) {
    throw new Error(`No se pudo fijar IP externa segura para: ${url.hostname}`);
  }

  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const req = transport.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        timeout: options.timeoutMs,
        servername: isHttps ? url.hostname : undefined,
        lookup: (_hostname, lookupOpts, callback) => {
          if (typeof lookupOpts === 'object' && lookupOpts?.all) {
            callback(null, [{ address: pinnedAddress, family }]);
            return;
          }
          callback(null, pinnedAddress, family);
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let truncated = false;

        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          const remaining = maxBytes - total;
          if (remaining <= 0) {
            truncated = true;
            res.destroy();
            return;
          }
          if (chunk.byteLength > remaining) {
            chunks.push(chunk.subarray(0, remaining));
            total += remaining;
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
          total += chunk.byteLength;
        });

        const finalize = () => {
          const status = res.statusCode ?? 500;
          const normalizedHeaders: Record<string, string> = {};
          for (const [key, val] of Object.entries(res.headers)) {
            if (typeof val === 'string') {
              normalizedHeaders[key.toLowerCase()] = val;
            } else if (Array.isArray(val)) {
              normalizedHeaders[key.toLowerCase()] = val.join(', ');
            }
          }
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: normalizedHeaders,
            text: Buffer.concat(chunks).toString('utf8')
          });
        };

        res.on('end', finalize);
        res.on('close', () => {
          if (truncated) {
            finalize();
          }
        });
        res.on('error', reject);
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('HTTP request timeout'));
    });
    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
