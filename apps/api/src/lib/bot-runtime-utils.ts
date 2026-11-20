import { BotDto, QuickReplyInput } from '@bothub/shared';
import { safeRegexTest } from './safe-regex.js';

const DEDUP_TTL_MS = 10 * 60 * 1000;
const DEDUP_MAX_ENTRIES = 5000;
const RATE_WINDOW_MS = 60 * 1000;
const CHATWOOT_MEDIA_PACING_MS = 2500;
const CHATWOOT_TEXT_PACING_MS = 550;
const DIRECT_MEDIA_PACING_MS = 900;
const DIRECT_TEXT_PACING_MS = 350;

const processedMessageIds = new Map<string, number>();
const inboundRateCounters = new Map<string, { count: number; windowStart: number }>();
const contactTurnLocks = new Map<string, Promise<void>>();

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function isDuplicateInboundMessage(externalId: string | undefined): boolean {
  if (!externalId) {
    return false;
  }
  const now = Date.now();
  if (processedMessageIds.size > DEDUP_MAX_ENTRIES) {
    for (const [key, expiresAt] of processedMessageIds.entries()) {
      if (expiresAt <= now) {
        processedMessageIds.delete(key);
      }
    }
  }
  const existingExpiry = processedMessageIds.get(externalId);
  if (existingExpiry && existingExpiry > now) {
    return true;
  }
  processedMessageIds.set(externalId, now + DEDUP_TTL_MS);
  return false;
}

export function isBotContactRateLimited(
  botId: string,
  contactPhone: string,
  limitPerMinute: number
): boolean {
  const safeLimit = Math.max(1, limitPerMinute || 30);
  const key = `${botId}:${contactPhone}`;
  const now = Date.now();
  if (inboundRateCounters.size > DEDUP_MAX_ENTRIES) {
    for (const [entryKey, entryVal] of inboundRateCounters.entries()) {
      if (now - entryVal.windowStart >= RATE_WINDOW_MS) {
        inboundRateCounters.delete(entryKey);
      }
    }
  }
  const current = inboundRateCounters.get(key);
  if (!current || now - current.windowStart >= RATE_WINDOW_MS) {
    inboundRateCounters.set(key, { count: 1, windowStart: now });
    return false;
  }
  current.count += 1;
  inboundRateCounters.set(key, current);
  return current.count > safeLimit;
}

export function isWithinBotBusinessHours(bot: BotDto, now = new Date()): boolean {
  if (!bot.businessHoursEnabled || !Array.isArray(bot.businessHours) || bot.businessHours.length === 0) {
    return true;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: bot.timezone || 'America/Bogota',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
    const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '12';
    const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const dayOfWeek = WEEKDAY_MAP[weekdayStr] ?? now.getDay();
    const currentMinutes = Number(hourStr) * 60 + Number(minuteStr);

    const schedule = bot.businessHours.find((d) => d.dayOfWeek === dayOfWeek);
    if (!schedule) {
      return true;
    }
    if (!schedule.isOpen) {
      return false;
    }
    const [openH, openM] = schedule.openTime.split(':').map(Number);
    const [closeH, closeM] = schedule.closeTime.split(':').map(Number);
    const safeOpenH = Number.isInteger(openH) && openH >= 0 && openH <= 23 ? openH : 0;
    const safeOpenM = Number.isInteger(openM) && openM >= 0 && openM <= 59 ? openM : 0;
    const safeCloseH = Number.isInteger(closeH) && closeH >= 0 && closeH <= 23 ? closeH : 23;
    const safeCloseM = Number.isInteger(closeM) && closeM >= 0 && closeM <= 59 ? closeM : 59;
    const openMinutes = safeOpenH * 60 + safeOpenM;
    const closeMinutes = safeCloseH * 60 + safeCloseM;
    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  } catch {
    return true;
  }
}

export function matchBotQuickReply(
  bot: BotDto,
  content: string
): Required<QuickReplyInput> | undefined {
  const trimmed = content.trim();
  const lowerInput = trimmed.toLowerCase();
  return bot.quickReplies.find((qr) => {
    if (!qr.isActive) return false;
    return qr.keywords.some((kw) => {
      const lowerKw = kw.toLowerCase().trim();
      if (!lowerKw) return false;
      if (qr.matchMode === 'EXACT') {
        return lowerInput === lowerKw;
      }
      if (qr.matchMode === 'REGEX') {
        return safeRegexTest(kw, trimmed);
      }
      return lowerInput.includes(lowerKw);
    });
  });
}

export function resolveInterReplyWaitMs(params: {
  previousHadMedia: boolean;
  nextDelayMs?: number;
  viaChatwoot: boolean;
}): number {
  const minPacing = params.viaChatwoot
    ? params.previousHadMedia
      ? CHATWOOT_MEDIA_PACING_MS
      : CHATWOOT_TEXT_PACING_MS
    : params.previousHadMedia
      ? DIRECT_MEDIA_PACING_MS
      : DIRECT_TEXT_PACING_MS;
  const requestedDelay =
    typeof params.nextDelayMs === 'number' && Number.isFinite(params.nextDelayMs)
      ? Math.max(0, params.nextDelayMs)
      : 0;
  return Math.max(minPacing, requestedDelay);
}

export async function waitOutgoingPacingMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withContactTurnLock<T>(
  lockKey: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = contactTurnLocks.get(lockKey) ?? Promise.resolve();
  let releaseCurrent: () => void = () => {};
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => currentGate);
  contactTurnLocks.set(lockKey, chained);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (contactTurnLocks.get(lockKey) === chained) {
      contactTurnLocks.delete(lockKey);
    }
  }
}
