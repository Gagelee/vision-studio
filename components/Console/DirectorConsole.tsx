import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowUp, Zap, Terminal, ChevronUp, ChevronDown, Cpu, MessageSquare, Mic, X, Hash } from 'lucide-react';
import { AgentLogEntry } from '../../types';

interface DirectorConsoleProps {
  context: {
    type: 'story' | 'sequence' | 'shot';
    label: string;
    id: string;
  };
  history: AgentLogEntry[];
  onSendMessage: (message: string) => void;
  isThinking?: boolean;
  stream?: {
    status?: string;
    reply?: string;
    steps: Array<{ agent: string; ok?: boolean; ms?: number; error?: string; status?: string }>;
  };
  variant?: 'default' | 'floating';
}

export const DirectorConsole: React.FC<DirectorConsoleProps> = ({ context, history, onSendMessage, isThinking = false, stream, variant = 'default' }) => {
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (showHistory && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, showHistory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    onSendMessage(input);
    setInput('');
    setShowHistory(true); // Auto-open history on send
  };

  const handleChipClick = (text: string) => {
    setInput(text);
  };

  // Dynamic config
  const getConfig = () => {
    switch (context.type) {
      case 'shot':
        return {
          placeholder: "Adjust camera, lighting, or action...",
          accent: "text-indigo-500",
          borderAccent: "focus-within:border-indigo-500/50",
          chips: ["Close up", "Warmer light", "Cyberpunk style", "Slow motion"]
        };
      case 'sequence':
        return {
          placeholder: "Direct the scene's flow or mood...",
          accent: "text-emerald-500",
          borderAccent: "focus-within:border-emerald-500/50",
          chips: ["Add establishing shot", "Dark & gritty", "Add tension", "Reorder shots"]
        };
      default:
        return {
          placeholder: "What's the next beat of the story?",
          accent: "text-zinc-500",
          borderAccent: "focus-within:border-zinc-500",
          chips: ["Create sequence", "Generate character", "Plot twist"]
        };
    }
  };
  const config = getConfig();

  // FLOATING VARIANT (Immersive Mode)
  if (variant === 'floating') {
      return (
        <div className="w-[600px] max-w-[90vw] bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
           {/* Simple Input for Floating */}
           <form onSubmit={handleSubmit} className="relative flex items-center p-2">
                <div className={`p-3 ${isThinking ? 'animate-pulse text-amber-500' : 'text-white/50'}`}>
                    <Sparkles className="w-5 h-5" />
                </div>
                <input 
                    autoFocus
                    className="flex-1 bg-transparent text-white placeholder-white/30 text-lg font-medium focus:outline-none px-2"
                    placeholder={config.placeholder}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                />
                <button type="submit" disabled={!input} className="p-2 bg-white text-black rounded-xl hover:opacity-90 disabled:opacity-0 transition-opacity">
                    <ArrowUp className="w-5 h-5" />
                </button>
           </form>
        </div>
      );
  }

  // DEFAULT VARIANT
  return (
    <div className={`bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800 flex flex-col z-30 transition-all duration-300 ${showHistory ? 'h-[400px]' : 'h-auto'}`}>
      
      {/* History Panel (Collapsible) */}
      {showHistory && (
          <div className="flex-1 overflow-hidden relative flex flex-col">
              <div className="h-8 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Director Log</span>
                  <button onClick={() => setShowHistory(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                      <ChevronDown className="w-3.5 h-3.5" />
                  </button>
              </div>
              {stream && (
                  <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-900/40">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Live Progress</div>
                      {stream.status && <div className="text-xs text-zinc-600 dark:text-zinc-300">{stream.status}</div>}
                      {stream.reply && (
                          <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
                              {stream.reply}
                          </div>
                      )}
                      {stream.steps?.length > 0 && (
                          <details className="mt-2 text-[11px] font-mono text-zinc-500">
                              <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200">
                                  Agents ({stream.steps.length})
                              </summary>
                              <div className="mt-2 space-y-1">
                                  {stream.steps.map((s, idx) => (
                                      <div key={`stream-${idx}`} className="flex items-center justify-between">
                                          <span>{s.agent}</span>
                                          <span className={s.status === 'error' ? 'text-rose-500' : s.status === 'done' ? 'text-emerald-500' : 'text-amber-500'}>
                                              {s.status || 'running'}
                                          </span>
                                      </div>
                                  ))}
                              </div>
                          </details>
                      )}
                  </div>
              )}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50/50 dark:bg-black/20">
                  {history.length === 0 && (
                      <div className="text-center text-zinc-400 text-sm mt-10 italic">No directives logged yet.</div>
                  )}
                  {history.map((entry) => (
                      <div key={entry.id} className={`flex gap-3 max-w-3xl ${entry.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${entry.role === 'agent' ? 'bg-indigo-600 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>
                              {entry.role === 'agent' ? <Sparkles className="w-4 h-4" /> : <div className="text-xs font-bold">ME</div>}
                          </div>
                          <div className={`p-3 rounded-2xl text-sm leading-relaxed ${
                              entry.role === 'agent' 
                              ? 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 shadow-sm' 
                              : 'bg-indigo-600 text-white shadow-md'
                          }`}>
                              {entry.content}
                              {entry.actionDetails && (
                                  <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs font-mono text-zinc-500">
                                      Executed: {entry.actionDetails.type}
                                      {typeof entry.actionDetails.applied === 'number' && typeof entry.actionDetails.dropped === 'number' && (
                                        <div className="mt-1">
                                          Applied: {entry.actionDetails.applied} · Dropped: {entry.actionDetails.dropped}
                                        </div>
                                      )}
                                      {entry.actionDetails.droppedActions?.length ? (
                                        <details className="mt-1">
                                          <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200">
                                            Dropped actions ({entry.actionDetails.droppedActions.length})
                                          </summary>
                                          <pre className="mt-1 text-[11px] whitespace-pre-wrap break-words">
                                            {JSON.stringify(entry.actionDetails.droppedActions, null, 2)}
                                          </pre>
                                        </details>
                                      ) : null}
                                  </div>
                              )}
                              {(entry as any)?.debug?.teamMessages?.length > 0 && (
                                  <details className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-mono text-zinc-500">
                                      <summary className="cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-200">
                                          Agent Discussion ({(entry as any).debug.teamMessages.length})
                                      </summary>
                                      <div className="mt-2 space-y-2">
                                          {(entry as any).debug.teamMessages.map((m: any, idx: number) => (
                                              <div key={`${entry.id}-m-${idx}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-2">
                                                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-400">
                                                      <span>{m.agent || 'agent'}</span>
                                                      <span className={m.ok ? 'text-emerald-500' : 'text-rose-500'}>
                                                          {m.ok ? 'ok' : 'error'}
                                                      </span>
                                                  </div>
                                                  {m.promptPreview && (
                                                      <div className="mt-1 text-[11px] text-zinc-500 whitespace-pre-wrap">
                                                          <span className="text-zinc-400">Prompt:</span> {String(m.promptPreview)}
                                                      </div>
                                                  )}
                                                  {m.responsePreview && (
                                                      <div className="mt-1 text-[11px] text-zinc-500 whitespace-pre-wrap">
                                                          <span className="text-zinc-400">Response:</span> {String(m.responsePreview)}
                                                      </div>
                                                  )}
                                                  {m.error && (
                                                      <div className="mt-1 text-[11px] text-rose-500 whitespace-pre-wrap">
                                                          Error: {String(m.error)}
                                                      </div>
                                                  )}
                                              </div>
                                          ))}
                                      </div>
                                  </details>
                              )}
                              {entry.debug && (
                                  <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-mono text-zinc-500 break-words">
                                      Debug: {entry.debug.transport || 'n/a'} / {entry.debug.provider || 'n/a'} / {entry.debug.model || 'n/a'}
                                      {entry.debug.error ? ` | ${entry.debug.error}` : ''}
                                      {(entry as any)?.debug?.taskCheck && (
                                        <div className="mt-1 text-[11px] text-amber-600 whitespace-pre-wrap">
                                          Task Check: {JSON.stringify((entry as any).debug.taskCheck)}
                                        </div>
                                      )}
                                  </div>
                              )}
                          </div>
                      </div>
                  ))}
              </div>
          </div>
      )}

      {/* Input Area */}
      <div className="relative p-4 bg-white dark:bg-zinc-950 shadow-[0_-1px_20px_rgba(0,0,0,0.05)]">
        
        {/* Context Status Bar */}
        <div className="absolute top-0 left-0 right-0 -mt-3 flex justify-center pointer-events-none">
            <div className="bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-300 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-zinc-700 shadow-sm flex items-center gap-2 pointer-events-auto">
                <span className={config.accent}>{context.type} Context</span>
                <span className="opacity-50">|</span>
                <span className="max-w-[150px] truncate">{context.label}</span>
                {!showHistory && history.length > 0 && (
                    <button onClick={() => setShowHistory(true)} className="ml-2 hover:text-white text-zinc-400 transition-colors">
                        <ChevronUp className="w-3 h-3" />
                    </button>
                )}
            </div>
        </div>

        <div className={`max-w-4xl mx-auto relative rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 transition-all ${config.borderAccent}`}>
            {isThinking && (
                <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden rounded-t-2xl">
                    <div className="h-full w-full animate-pulse bg-gradient-to-r from-indigo-500 via-emerald-400 to-indigo-500" />
                </div>
            )}
            <div className="flex items-center px-2">
                <div className={`p-3 ${isThinking ? 'animate-pulse text-amber-500' : 'text-zinc-400'}`}>
                    {isThinking ? <Cpu className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                </div>
                <form onSubmit={handleSubmit} className="flex-1">
                    <input 
                        className="w-full bg-transparent py-4 text-sm font-medium text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none"
                        placeholder={config.placeholder}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                    />
                </form>
                <div className="flex items-center gap-2 pr-2">
                     {!input && (
                        <div className="hidden md:flex items-center gap-1.5">
                            {config.chips.map(chip => (
                                <button 
                                    key={chip}
                                    onClick={() => handleChipClick(chip)}
                                    className="px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md text-[10px] text-zinc-500 hover:text-indigo-500 hover:border-indigo-200 transition-all whitespace-nowrap"
                                >
                                    {chip}
                                </button>
                            ))}
                        </div>
                     )}
                     <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-800 mx-1"></div>
                     <button 
                        disabled={!input || isThinking}
                        onClick={handleSubmit}
                        className="p-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-lg hover:opacity-90 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                     >
                        <ArrowUp className="w-4 h-4" />
                     </button>
                </div>
            </div>
            {isThinking && stream?.status && !showHistory && (
                <div className="px-4 pb-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {stream.status}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
