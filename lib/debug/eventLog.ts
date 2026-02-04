export type DebugEventLevel = 'info' | 'warn' | 'error';

export interface DebugEvent {
  id: string;
  ts: number;
  level: DebugEventLevel;
  scope: string;
  message: string;
  data?: any;
}

// Multi-agent traces + image generation logs can get large quickly. Keep more history so
// initialization traces (scaffold) don't disappear after a few rounds of director chat.
const MAX_EVENTS = 2000;

let events: DebugEvent[] = [];
const listeners = new Set<() => void>();

const notify = () => {
  for (const fn of listeners) fn();
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
  events = [...events, { id, ts, level: e.level, scope: e.scope, message: e.message, data: e.data }].slice(-MAX_EVENTS);
  notify();
};
