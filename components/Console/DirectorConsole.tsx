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
  variant?: 'default' | 'floating';
}

export const DirectorConsole: React.FC<DirectorConsoleProps> = ({ context, history, onSendMessage, variant = 'default' }) => {
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
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
    
    setIsThinking(true);
    onSendMessage(input);
    setInput('');
    setShowHistory(true); // Auto-open history on send
    
    // Simulate thinking end (in real app, this is controlled by parent state)
    setTimeout(() => setIsThinking(false), 1500);
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
                                  </div>
                              )}
                              {entry.debug && (
                                  <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-mono text-zinc-500 break-words">
                                      Debug: {entry.debug.transport || 'n/a'} / {entry.debug.provider || 'n/a'} / {entry.debug.model || 'n/a'}
                                      {entry.debug.error ? ` | ${entry.debug.error}` : ''}
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
        </div>
      </div>
    </div>
  );
};
