import {
  FlowDto,
  FlowEdge,
  FlowNode,
  FlowVersionDto,
  QuestionValidationType
} from '@bothub/shared';
import { safeRegexTest } from '../../lib/safe-regex.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NATIONAL_ID_REGEX = /^\d{6,12}$/;
const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const SLASH_DATE_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const NUMERIC_PREFIX_REGEX = /^\d+[.)\-\s]+/;

function isValidCalendarDate(raw: string): boolean {
  let year = 0;
  let month = 0;
  let day = 0;
  const isoMatch = raw.match(ISO_DATE_REGEX);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const slashMatch = raw.match(SLASH_DATE_REGEX);
    if (!slashMatch) {
      return false;
    }
    day = Number(slashMatch[1]);
    month = Number(slashMatch[2]);
    year = Number(slashMatch[3]);
  }
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const constructed = new Date(Date.UTC(year, month - 1, day));
  return (
    constructed.getUTCFullYear() === year &&
    constructed.getUTCMonth() === month - 1 &&
    constructed.getUTCDate() === day
  );
}

export function resolveActiveFlowGraph(flow: FlowDto): FlowVersionDto {
  return flow.publishedVersion ?? flow.draftVersion;
}

export function interpolateFlowVariables(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, varName: string) => {
    const value = variables[varName];
    return typeof value === 'string' && value.length > 0 ? value : `{{${varName}}}`;
  });
}

export function validateQuestionAnswer(
  rawInput: string,
  validationType: QuestionValidationType
): { valid: boolean; normalizedValue: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, normalizedValue: '' };
  }

  switch (validationType) {
    case 'NUMBER': {
      const parsed = Number(trimmed.replace(/,/g, '.'));
      return {
        valid: Number.isFinite(parsed),
        normalizedValue: Number.isFinite(parsed) ? String(parsed) : trimmed
      };
    }
    case 'EMAIL':
      return {
        valid: EMAIL_REGEX.test(trimmed),
        normalizedValue: trimmed.toLowerCase()
      };
    case 'NATIONAL_ID': {
      const digitsOnly = trimmed.replace(/[\s.-]/g, '');
      return {
        valid: NATIONAL_ID_REGEX.test(digitsOnly),
        normalizedValue: digitsOnly
      };
    }
    case 'DATE':
      return {
        valid: isValidCalendarDate(trimmed),
        normalizedValue: trimmed
      };
    case 'TEXT':
    default:
      return {
        valid: trimmed.length >= 1,
        normalizedValue: trimmed
      };
  }
}

export function inferFlowMediaType(url: string): 'image' | 'audio' | 'document' {
  const cleanPath = url.split('?')[0].toLowerCase();
  if (/\.(mp3|ogg|wav|m4a|opus)$/.test(cleanPath)) {
    return 'audio';
  }
  if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|txt|zip)$/.test(cleanPath)) {
    return 'document';
  }
  return 'image';
}

export function evaluateConditionNode(
  node: FlowNode,
  variables: Record<string, string>,
  latestInput: string
): boolean {
  const rawVariableName = String(node.data.variableName ?? '').trim();
  const variableName = rawVariableName || 'ultimo_mensaje';
  const operator = String(node.data.operator ?? 'CONTAINS').toUpperCase();
  const compareValue = String(node.data.compareValue ?? '').trim().toLowerCase();
  const candidateRaw = (
    variableName === 'ultimo_mensaje'
      ? (variables[variableName] ?? latestInput ?? '')
      : (variables[variableName] ?? '')
  ).trim();
  const candidateLower = candidateRaw.toLowerCase();

  switch (operator) {
    case 'EQUALS':
      return candidateLower === compareValue;
    case 'NOT_EQUALS':
      return candidateLower !== compareValue;
    case 'NOT_EMPTY':
      return candidateRaw.length > 0;
    case 'GREATER_THAN': {
      const left = Number(candidateRaw);
      const right = Number(compareValue);
      return Number.isFinite(left) && Number.isFinite(right) && left > right;
    }
    case 'LESS_THAN': {
      const left = Number(candidateRaw);
      const right = Number(compareValue);
      return Number.isFinite(left) && Number.isFinite(right) && left < right;
    }
    case 'REGEX':
      return safeRegexTest(String(node.data.compareValue ?? ''), candidateRaw);
    case 'CONTAINS':
    default:
      return candidateLower.includes(compareValue);
  }
}

export function findNextNodeId(
  edges: FlowEdge[],
  sourceNodeId: string,
  preferredHandle?: string | null,
  strictHandleMatch = false
): string | null {
  if (preferredHandle) {
    const matchedByHandle = edges.find(
      (edge) => edge.source === sourceNodeId && edge.sourceHandle === preferredHandle
    );
    if (matchedByHandle) {
      return matchedByHandle.target;
    }
    if (strictHandleMatch) {
      const neutralEdge = edges.find(
        (edge) => edge.source === sourceNodeId && !edge.sourceHandle
      );
      return neutralEdge ? neutralEdge.target : null;
    }
  }
  const defaultEdge = edges.find((edge) => edge.source === sourceNodeId);
  return defaultEdge ? defaultEdge.target : null;
}

function matchesInteractiveOption(
  optionId: string,
  optionLabel: string,
  index: number,
  normalizedInput: string
): boolean {
  const labelLower = optionLabel.trim().toLowerCase();
  const labelWithoutPrefix = labelLower.replace(NUMERIC_PREFIX_REGEX, '').trim();
  const numericIndex = String(index + 1);

  return (
    normalizedInput === optionId.trim().toLowerCase() ||
    normalizedInput === numericIndex ||
    normalizedInput === labelLower ||
    (labelWithoutPrefix.length > 0 && normalizedInput === labelWithoutPrefix) ||
    (normalizedInput.length >= 10 && labelLower.startsWith(normalizedInput))
  );
}

export function resolveInteractiveSelectionHandle(
  node: FlowNode,
  userInput: string
): { matched: boolean; handle: string | null; chosenLabel: string } {
  const normalizedInput = userInput.trim().toLowerCase();
  if (!normalizedInput) {
    return { matched: false, handle: null, chosenLabel: '' };
  }

  if (node.type === 'BUTTONS') {
    const buttons = Array.isArray(node.data.buttons)
      ? (node.data.buttons as Array<{ id: string; label: string }>)
      : [];
    for (let idx = 0; idx < buttons.length; idx += 1) {
      const btn = buttons[idx];
      if (matchesInteractiveOption(btn.id, btn.label, idx, normalizedInput)) {
        return { matched: true, handle: btn.id, chosenLabel: btn.label };
      }
    }
    return { matched: false, handle: null, chosenLabel: userInput.trim() };
  }

  if (node.type === 'LIST') {
    const items = Array.isArray(node.data.items)
      ? (node.data.items as Array<{ id: string; title: string }>)
      : [];
    for (let idx = 0; idx < items.length; idx += 1) {
      const item = items[idx];
      if (matchesInteractiveOption(item.id, item.title, idx, normalizedInput)) {
        return { matched: true, handle: item.id, chosenLabel: item.title };
      }
    }
    return { matched: false, handle: null, chosenLabel: userInput.trim() };
  }

  return { matched: false, handle: null, chosenLabel: userInput.trim() };
}

export function evaluateTriggerMatch(node: FlowNode, inputMessage: string): boolean {
  const matchMode = String(node.data.matchMode ?? 'FIRST_MESSAGE').toUpperCase();
  if (matchMode === 'FIRST_MESSAGE' || matchMode === 'MAIN_MENU' || matchMode === 'OUT_OF_HOURS') {
    return true;
  }

  const rawKeywords = String(node.data.keyword ?? '').trim();
  if (!rawKeywords) {
    return true;
  }

  const normalizedInput = inputMessage.trim().toLowerCase();
  const candidates = rawKeywords
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (candidates.length === 0) {
    return true;
  }

  switch (matchMode) {
    case 'EXACT':
      return candidates.some((kw) => normalizedInput === kw.toLowerCase());
    case 'REGEX':
      return candidates.some((pattern) => safeRegexTest(pattern, inputMessage.trim()));
    case 'CONTAINS':
    default:
      return candidates.some((kw) => normalizedInput.includes(kw.toLowerCase()));
  }
}
