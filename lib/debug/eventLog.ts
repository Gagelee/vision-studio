export type DebugEventLevel = 'info' | 'warn' | 'error';

export interface DebugEvent {
  id: string;
  ts: number;
  level: DebugEventLevel;
  scope: string;
  message: string;
  data?: any;
}

const MAX_EVENTS = 1200;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_STRING_LENGTH = 1200;

let events: DebugEvent[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  for (const fn of listeners) fn();
};

const trimString = (raw: string, limit = MAX_STRING_LENGTH) => {
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)} ...<truncated ${raw.length - limit} chars>`;
};

const summarizeStory = (story: any) => {
  if (!story || typeof story !== 'object') return story;
  const sequences = Array.isArray(story.sequences) ? story.sequences : [];
  const locations = Array.isArray(story.locations) ? story.locations : [];
  const characters = Array.isArray(story.characters) ? story.characters : [];
  const shots = sequences.reduce((acc: number, s: any) => acc + (Array.isArray(s?.shots) ? s.shots.length : 0), 0);
  return {
    _summary: 'story',
    id: story.id,
    title: story.title,
    aspectRatio: story.aspectRatio,
    status: story.status,
    updatedAt: story.updatedAt,
    counts: {
      sequences: sequences.length,
      shots,
      locations: locations.length,
      characters: characters.length,
    },
  };
};

const summarizeTeamTrace = (trace: any[]) =>
  trace.slice(0, MAX_ARRAY_ITEMS).map((t) => ({
    agent: t?.agent,
    promptId: t?.promptId,
    promptVersion: t?.promptVersion,
    ok: Boolean(t?.ok),
    ms: typeof t?.ms === 'number' ? t.ms : undefined,
    error: t?.error ? trimString(String(t.error), 240) : undefined,
  }));

const summarizeTeamMessages = (messages: any[]) =>
  messages.slice(0, 8).map((m) => ({
    agent: m?.agent,
    promptId: m?.promptId,
    promptVersion: m?.promptVersion,
    ok: Boolean(m?.ok),
    ms: typeof m?.ms === 'number' ? m.ms : undefined,
    promptPreview: trimString(String(m?.promptPreview || ''), 360),
    responsePreview: trimString(String(m?.responsePreview || ''), 360),
    error: m?.error ? trimString(String(m.error), 240) : undefined,
  }));

export const compactDebugValue = (value: any, depth = 0, seen = new WeakSet<object>()): any => {
  if (value == null) return value;
  const valueType = typeof value;
  if (valueType === 'string') return trimString(value);
  if (valueType === 'number' || valueType === 'boolean') return value;
  if (valueType === 'bigint') return String(value);
  if (valueType === 'function' || valueType === 'symbol') return `[${valueType}]`;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return `[max-depth:${MAX_DEPTH}]`;

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY_ITEMS).map((v) => compactDebugValue(v, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) out.push(`[... +${value.length - MAX_ARRAY_ITEMS} items]`);
    return out;
  }

  if (valueType === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);

    const obj = value as Record<string, any>;
    const keys = Object.keys(obj);
    const out: Record<string, any> = {};
    const max = Math.min(keys.length, MAX_OBJECT_KEYS);
    for (let i = 0; i < max; i += 1) {
      const k = keys[i];
      const v = obj[k];
      if (k === 'teamTrace' && Array.isArray(v)) {
        out[k] = summarizeTeamTrace(v);
        continue;
      }
      if (k === 'teamMessages' && Array.isArray(v)) {
        out[k] = summarizeTeamMessages(v);
        continue;
      }
      if (k === 'story' && v && typeof v === 'object') {
        out[k] = summarizeStory(v);
        continue;
      }
      out[k] = compactDebugValue(v, depth + 1, seen);
    }
    if (keys.length > MAX_OBJECT_KEYS) out.__truncatedKeys = keys.length - MAX_OBJECT_KEYS;
    return out;
  }

  return String(value);
};

export const getDebugEvents = () => events;

export const subscribeDebugEvents = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const clearDebugEvents = () => {
  events = [];
  notify();
};

export const addDebugEvent = (e: Omit<DebugEvent, 'id' | 'ts'> & { ts?: number }) => {
  const ts = e.ts ?? Date.now();
  const id = `${ts}-${Math.random().toString(16).slice(2, 10)}`;
  events = [...events, { id, ts, level: e.level, scope: e.scope, message: e.message, data: compactDebugValue(e.data) }].slice(-MAX_EVENTS);
  notify();
};
