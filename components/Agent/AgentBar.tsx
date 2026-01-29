
import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowUp, Zap, Clapperboard, Film, Plus, Wand2, RefreshCw } from 'lucide-react';

interface AgentBarProps {
  context: {
    type: 'story' | 'scene' | 'shot';
    label: string;
    id: string;
  };
}

export const AgentBar: React.FC<AgentBarProps> = ({ context }) => {
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);

  // Clear input when context changes to avoid confusion
  useEffect(() => {
    setInput('');
  }, [context.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    setIsThinking(true);
    // Simulate processing
    setTimeout(() => {
      setIsThinking(false);
      setInput('');
    }, 1500);
  };

  const handleChipClick = (text: string) => {
    setInput(text);
    // Optional: auto-submit or focus input
  };

  // Dynamic configuration based on context
  const getConfig = () => {
    switch (context.type) {
      case 'shot':
        return {
          icon: <Film className="w-4 h-4 text-indigo-400" />,
          placeholder: "Refine this shot (e.g., 'Zoom in', 'Make it darker')...",
          chips: ['Change camera angle', 'Make lighting warmer', 'Add camera shake', 'Regenerate variation'],
          borderColor: 'border-indigo-500/30',
          badgeColor: 'bg-indigo-500/10 text-indigo-400'
        };
      case 'scene':
        return {
          icon: <Clapperboard className="w-4 h-4 text-emerald-400" />,
          placeholder: "Direct the scene (e.g., 'Add a new shot', 'Change mood')...",
          chips: ['Add new shot', 'Change scene mood', 'Reorder shots', 'Generate storyboard'],
          borderColor: 'border-emerald-500/30',
          badgeColor: 'bg-emerald-500/10 text-emerald-400'
        };
      default:
        return {
          icon: <Wand2 className="w-4 h-4 text-zinc-400" />,
          placeholder: "Direct the story...",
          chips: [],
          borderColor: 'border-zinc-700',
          badgeColor: 'bg-zinc-800 text-zinc-400'
        };
    }
  };

  const config = getConfig();

  return (
    <div className="bg-zinc-950 border-t border-zinc-800 flex flex-col z-30 shadow-2xl">
      {/* Context Awareness & Suggestions */}
      <div className="px-6 pt-3 flex items-center justify-between">
         <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
            {/* Scope Badge */}
            <div className={`flex-shrink-0 flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-800 text-xs font-semibold uppercase tracking-wider ${config.badgeColor}`}>
                {config.icon}
                <span>Scope: {context.label}</span>
            </div>
            
            {/* Quick Actions / Chips */}
            <div className="h-4 w-px bg-zinc-800 mx-1 hidden md:block"></div>
            <div className="flex items-center gap-2">
                {config.chips.map((chip) => (
                    <button 
                        key={chip}
                        onClick={() => handleChipClick(chip)}
                        className="whitespace-nowrap px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                    >
                        {chip}
                    </button>
                ))}
            </div>
         </div>
         
         <div className="hidden md:flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
            <div className={`w-2 h-2 rounded-full ${isThinking ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
            {isThinking ? 'PROCESSING' : 'DIRECTOR ONLINE'}
         </div>
      </div>

      {/* Input Area */}
      <div className="p-4 px-6 flex items-center gap-4">
        <div className={`flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 shadow-inner ${isThinking ? 'animate-pulse text-amber-500' : 'text-zinc-500'}`}>
            {isThinking ? <Zap className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 relative group">
          <input 
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={config.placeholder}
            className={`w-full bg-zinc-900/50 border ${config.borderColor} text-zinc-200 rounded-xl pl-4 pr-12 py-3.5 text-sm focus:outline-none focus:bg-zinc-900 focus:border-opacity-100 focus:ring-1 focus:ring-opacity-20 transition-all shadow-inner`}
          />
          <button 
            type="submit"
            disabled={!input || isThinking}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-all disabled:opacity-0 disabled:translate-x-2"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
