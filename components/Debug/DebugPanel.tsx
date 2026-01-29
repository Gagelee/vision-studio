import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Trash2, X, Bug } from 'lucide-react';
import { AiSettings, Story } from '../../types';
import { DebugEvent, clearDebugEvents, getDebugEvents, subscribeDebugEvents } from '../../lib/debug/eventLog';

interface DebugPanelProps {
  aiSettings: AiSettings;
  activeStory: Story | null;
  agentHistory: any[];
  onClose: () => void;
}

const formatTs = (ts: number) => new Date(ts).toLocaleString();

const levelStyle: Record<string, string> = {
  info: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  warn: 'bg-amber-200 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  error: 'bg-rose-200 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200',
};

export const DebugPanel: React.FC<DebugPanelProps> = ({ aiSettings, activeStory, agentHistory, onClose }) => {
  const [events, setEvents] = useState<DebugEvent[]>(() => getDebugEvents());
  const [filter, setFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [copyMessage, setCopyMessage] = useState<string>('');

  useEffect(() => {
    return subscribeDebugEvents(() => setEvents(getDebugEvents()));
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.level === filter);
  }, [events, filter]);

  const diagnostics = useMemo(() => {
    return {
      ts: Date.now(),
      userAgent: navigator.userAgent,
      aiSettings,
      activeProject: activeStory
        ? {
            id: activeStory.id,
            title: activeStory.title,
            aspectRatio: activeStory.aspectRatio,
            locations: activeStory.locations?.length || 0,
            characters: activeStory.characters?.length || 0,
            sequences: activeStory.sequences?.length || 0,
            shots: activeStory.sequences?.reduce((acc, s) => acc + (s.shots?.length || 0), 0) || 0,
          }
        : null,
      agentHistory: (agentHistory || []).slice(-60),
      debugEvents: events,
    };
  }, [aiSettings, activeStory, agentHistory, events]);

  const copyDiagnostics = async () => {
    const text = JSON.stringify(diagnostics, null, 2);
    setCopyStatus('idle');
    setCopyMessage('');

    // Prefer modern clipboard API, but fall back to execCommand for browsers/contexts
    // that don't allow clipboard writes (e.g., some HTTP environments).
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        setCopyStatus('ok');
        setCopyMessage('Copied diagnostics JSON to clipboard.');
        return;
      }
    } catch {
      // Continue to fallback
    }

    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', 'true');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (!ok) throw new Error('execCommand returned false');
      setCopyStatus('ok');
      setCopyMessage('Copied diagnostics JSON to clipboard (fallback).');
    } catch (e) {
      setCopyStatus('err');
      setCopyMessage(`Copy failed. Please select and copy manually. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const copyEvent = async (ev: DebugEvent) => {
    const text = JSON.stringify(ev, null, 2);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        setCopyStatus('ok');
        setCopyMessage('Copied selected event to clipboard.');
        return;
      }
    } catch {
      // ignore
    }

    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', 'true');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (!ok) throw new Error('execCommand returned false');
      setCopyStatus('ok');
      setCopyMessage('Copied selected event to clipboard (fallback).');
    } catch (e) {
      setCopyStatus('err');
      setCopyMessage(`Copy failed. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-[4000] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
      <div className="w-full max-w-6xl rounded-[32px] border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
        <div className="h-16 px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-black flex items-center justify-center">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400">Debug</div>
              <div className="text-sm font-bold tracking-tight">Diagnostics & Event Log</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyDiagnostics}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-black font-black uppercase tracking-widest text-[11px] hover:opacity-90 transition-all"
              title="Copy diagnostics JSON"
            >
              <Copy className="w-4 h-4" />
              Copy Logs
            </button>
            <button
              onClick={() => clearDebugEvents()}
              className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              title="Clear event log"
            >
              <Trash2 className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
            </button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-6 max-h-[80vh] overflow-hidden">
          {/* Left: quick state */}
          <div className="xl:col-span-1 space-y-6 overflow-y-auto custom-scrollbar pr-1">
            {copyStatus !== 'idle' && (
              <div
                className={`rounded-2xl border p-4 text-sm leading-relaxed ${
                  copyStatus === 'ok'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                }`}
              >
                {copyMessage}
              </div>
            )}

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">AI Settings</div>
              </div>
              <div className="p-5 text-sm text-zinc-700 dark:text-zinc-200 space-y-3">
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Scaffold Planner</div>
                <div className="font-mono text-[12px] break-words">
                  {aiSettings.scaffoldPlanner.provider} / {aiSettings.scaffoldPlanner.model} / t={aiSettings.scaffoldPlanner.temperature}
                </div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Scaffold Worker</div>
                <div className="font-mono text-[12px] break-words">
                  {aiSettings.scaffoldWorker.provider} / {aiSettings.scaffoldWorker.model} / t={aiSettings.scaffoldWorker.temperature}
                </div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Direct</div>
                <div className="font-mono text-[12px] break-words">
                  {aiSettings.direct.provider} / {aiSettings.direct.model} / t={aiSettings.direct.temperature}
                </div>
                <div className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Image</div>
                <div className="font-mono text-[12px] break-words">
                  {aiSettings.image.provider} / {aiSettings.image.model} / t={aiSettings.image.temperature}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Active Project</div>
              </div>
              <div className="p-5 text-sm text-zinc-700 dark:text-zinc-200 space-y-2">
                {activeStory ? (
                  <>
                    <div className="font-bold">{activeStory.title}</div>
                    <div className="font-mono text-[12px] text-zinc-500">{activeStory.id}</div>
                    <div className="text-zinc-500 text-sm">
                      {activeStory.sequences?.length || 0} seq / {activeStory.sequences?.reduce((acc, s) => acc + (s.shots?.length || 0), 0) || 0} shots
                    </div>
                  </>
                ) : (
                  <div className="text-zinc-500">No active project</div>
                )}
              </div>
            </div>
          </div>

          {/* Right: event log */}
          <div className="xl:col-span-2 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden flex flex-col min-h-0">
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20 flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Event Log</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                    filter === 'all'
                      ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white'
                      : 'bg-transparent text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('warn')}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                    filter === 'warn'
                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/30'
                      : 'bg-transparent text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  Warn
                </button>
                <button
                  onClick={() => setFilter('error')}
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                    filter === 'error'
                      ? 'bg-rose-500/20 text-rose-200 border-rose-500/30'
                      : 'bg-transparent text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  Error
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 min-h-0">
              {filtered.length === 0 ? (
                <div className="text-zinc-500 text-sm italic mt-6 text-center">No events captured yet.</div>
              ) : (
                filtered
                  .slice()
                  .reverse()
                  .map((e) => (
                    <div key={e.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${levelStyle[e.level]}`}>
                              {e.level}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{e.scope}</span>
                            <span className="text-[10px] font-mono text-zinc-400">{formatTs(e.ts)}</span>
                          </div>
                          <div className="mt-1 text-sm text-zinc-800 dark:text-zinc-200 break-words">{e.message}</div>
                        </div>
                        <button
                          onClick={() => copyEvent(e)}
                          className="shrink-0 p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                          title="Copy this event JSON"
                        >
                          <Copy className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
                        </button>
                      </div>
                      {typeof e.data !== 'undefined' && (
                        <pre className="border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black/30 p-4 text-[11px] text-zinc-700 dark:text-zinc-300 overflow-x-auto">
                          {JSON.stringify(e.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
