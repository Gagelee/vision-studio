import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Trash2, X, Bug } from 'lucide-react';
import { AiSettings, Story } from '../../types';
import { DebugEvent, clearDebugEvents, getDebugEvents, subscribeDebugEvents } from '../../lib/debug/eventLog';
import { AGENT_REGISTRY } from '../../lib/ai/agentRegistry';
import { PROMPT_REGISTRY } from '../../lib/ai/promptMeta';

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
  const [tab, setTab] = useState<'events' | 'trace' | 'registry'>('events');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [copyMessage, setCopyMessage] = useState<string>('');

  useEffect(() => {
    return subscribeDebugEvents(() => setEvents(getDebugEvents()));
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter((e) => e.level === filter);
  }, [events, filter]);

  const traceSessions = useMemo(() => {
    const sessions: Array<{
      ts: number;
      scope: string;
      endpoint?: string;
      provider?: string;
      model?: string;
      mode?: string;
      traceId?: string;
      multiAgentError?: string;
      teamTrace: any[];
      teamMessages?: any[];
    }> = [];

    for (const e of events) {
      if (e.message !== 'Response' && e.message !== 'HTTP error') continue;
      if (e.scope !== 'agent.scaffold' && e.scope !== 'agent.direct') continue;
      const json = (e as any)?.data?.json;
      const dbg = json?.debug || null;
      const tt = Array.isArray(dbg?.teamTrace) ? dbg.teamTrace : Array.isArray(json?.teamTrace) ? json.teamTrace : null;
      if (!tt || tt.length === 0) continue;
      const msgs = Array.isArray(dbg?.teamMessages) ? dbg.teamMessages : Array.isArray(json?.teamMessages) ? json.teamMessages : null;
      sessions.push({
        ts: e.ts,
        scope: e.scope,
        endpoint: String((e as any)?.data?.url || ''),
        provider: dbg?.provider ? String(dbg.provider) : json?.provider ? String(json.provider) : undefined,
        model: dbg?.model ? String(dbg.model) : json?.model ? String(json.model) : undefined,
        mode: dbg?.mode ? String(dbg.mode) : json?.mode ? String(json.mode) : undefined,
        traceId: dbg?.traceId ? String(dbg.traceId) : json?.traceId ? String(json.traceId) : undefined,
        multiAgentError: dbg?.multiAgentError ? String(dbg.multiAgentError) : json?.multiAgentError ? String(json.multiAgentError) : undefined,
        teamTrace: tt,
        teamMessages: msgs || undefined,
      });
    }

    return sessions.sort((a, b) => b.ts - a.ts);
  }, [events]);

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
            <div className="hidden md:flex items-center gap-2 mr-2">
              <button
                onClick={() => setTab('events')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                  tab === 'events'
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white'
                    : 'bg-transparent text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                Events
              </button>
              <button
                onClick={() => setTab('trace')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                  tab === 'trace'
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white'
                    : 'bg-transparent text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                Trace
              </button>
              <button
                onClick={() => setTab('registry')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                  tab === 'registry'
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-black dark:border-white'
                    : 'bg-transparent text-zinc-500 border-zinc-200 dark:text-zinc-400 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
              >
                Registry
              </button>
            </div>
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
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                {tab === 'events' ? 'Event Log' : tab === 'trace' ? 'LLM Trace' : 'Agent & Prompt Registry'}
              </div>
              {tab === 'events' && (
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
              )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 min-h-0">
              {tab === 'events' && (
                <>
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
                </>
              )}

              {tab === 'trace' && (
                <>
                  {traceSessions.length === 0 ? (
                    <div className="text-zinc-500 text-sm italic mt-6 text-center">No LLM trace captured yet.</div>
                  ) : (
                    traceSessions.map((s) => (
                      <div key={`${s.ts}-${s.scope}-${s.traceId || ''}`} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                        <div className="px-4 py-3 flex items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{s.scope}</span>
                              <span className="text-[10px] font-mono text-zinc-400">{formatTs(s.ts)}</span>
                              {s.mode && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                  {s.mode}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-zinc-800 dark:text-zinc-200 break-words">
                              {(s.provider || 'unknown') + ' / ' + (s.model || 'unknown')}
                            </div>
                            {s.endpoint && <div className="mt-1 text-[11px] font-mono text-zinc-500 break-words">{s.endpoint}</div>}
                            {s.traceId && <div className="mt-1 text-[11px] font-mono text-zinc-500">traceId: {s.traceId}</div>}
                            {s.multiAgentError && <div className="mt-2 text-[11px] text-amber-300 break-words">multiAgentError: {s.multiAgentError}</div>}
                          </div>
                          <button
                            onClick={() => copyEvent({ ...(s as any), id: `trace-${s.ts}`, level: 'info', message: 'trace', data: s } as any)}
                            className="shrink-0 p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                            title="Copy this trace JSON"
                          >
                            <Copy className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
                          </button>
                        </div>

                    <div className="p-4 overflow-x-auto">
                      <table className="w-full text-left text-[12px]">
                            <thead>
                              <tr className="text-zinc-500">
                                <th className="py-2 pr-4 font-black uppercase tracking-widest text-[10px]">Agent</th>
                                <th className="py-2 pr-4 font-black uppercase tracking-widest text-[10px]">Prompt</th>
                                <th className="py-2 pr-4 font-black uppercase tracking-widest text-[10px]">Version</th>
                                <th className="py-2 pr-4 font-black uppercase tracking-widest text-[10px]">MS</th>
                                <th className="py-2 pr-0 font-black uppercase tracking-widest text-[10px]">OK</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.teamTrace.map((t: any, idx: number) => (
                                <tr key={`${idx}-${String(t.agent)}`} className="border-t border-zinc-100 dark:border-zinc-800/60">
                                  <td className="py-2 pr-4 font-mono text-zinc-800 dark:text-zinc-200">{String(t.agent || '')}</td>
                                  <td className="py-2 pr-4 font-mono text-zinc-600 dark:text-zinc-300">{String(t.promptId || '')}</td>
                                  <td className="py-2 pr-4 font-mono text-zinc-500">{String(t.promptVersion || '')}</td>
                                  <td className="py-2 pr-4 font-mono text-zinc-500">{typeof t.ms === 'number' ? `${t.ms}` : ''}</td>
                                  <td className="py-2 pr-0 font-mono">
                                    <span className={t.ok ? 'text-emerald-400' : 'text-rose-400'}>{t.ok ? 'yes' : 'no'}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                      </table>
                    </div>

                    {Array.isArray(s.teamMessages) && s.teamMessages.length > 0 && (
                      <div className="px-4 pb-5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Discussion</div>
                        <div className="space-y-3">
                          {s.teamMessages.map((m: any, idx: number) => (
                            <div key={`${idx}-${String(m.agent || '')}`} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                              <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-[11px] font-mono text-zinc-800 dark:text-zinc-200">{String(m.agent || '')}</span>
                                  <span className="text-[10px] font-mono text-zinc-500">{String(m.promptId || '')}</span>
                                  <span className="text-[10px] font-mono text-zinc-500">{String(m.promptVersion || '')}</span>
                                </div>
                                <div className="shrink-0 text-[10px] font-mono">
                                  <span className={m.ok ? 'text-emerald-400' : 'text-rose-400'}>{m.ok ? 'ok' : 'fail'}</span>
                                  {typeof m.ms === 'number' && <span className="text-zinc-500">{` • ${m.ms}ms`}</span>}
                                </div>
                              </div>
                              <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Prompt</div>
                                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 max-h-48 overflow-auto custom-scrollbar">
                                    {String(m.promptPreview || '')}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">
                                    {m.ok ? 'Response' : 'Error'}
                                  </div>
                                  <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 max-h-48 overflow-auto custom-scrollbar">
                                    {m.ok ? String(m.responsePreview || '') : String(m.error || '')}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
                </>
              )}

              {tab === 'registry' && (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
                      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Agents</div>
                    </div>
                    <div className="p-4 space-y-3">
                      {AGENT_REGISTRY.map((a) => (
                        <div key={a.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-bold text-zinc-900 dark:text-zinc-100">{a.title}</div>
                              <div className="text-[11px] text-zinc-500 break-words">{a.description}</div>
                            </div>
                            <div className="shrink-0 text-[11px] font-mono text-zinc-500">{a.id}</div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {a.promptIds.map((pid) => (
                              <span
                                key={pid}
                                className="px-2 py-1 rounded-full text-[10px] font-mono bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200"
                              >
                                {pid}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
                      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Prompts</div>
                    </div>
                    <div className="p-4 space-y-3">
                      {PROMPT_REGISTRY.map((p) => (
                        <div key={p.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-bold text-zinc-900 dark:text-zinc-100">{p.title}</div>
                              <div className="mt-1 text-[11px] font-mono text-zinc-500 break-words">{p.id}</div>
                              <div className="mt-1 text-[11px] text-zinc-500 break-words">{p.fileHint}</div>
                            </div>
                            <div className="shrink-0 text-[11px] font-mono text-zinc-500">{p.version}</div>
                          </div>
                          {p.usedByAgents?.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {p.usedByAgents.map((x) => (
                                <span
                                  key={x}
                                  className="px-2 py-1 rounded-full text-[10px] font-mono bg-indigo-500/10 border border-indigo-500/20 text-indigo-300"
                                >
                                  {x}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
