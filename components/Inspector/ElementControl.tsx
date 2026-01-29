
import React from 'react';
import { DirectorElement } from '../../types';
import { RefreshCw, Lock, Unlock, Link, AlertCircle } from 'lucide-react';

interface ElementControlProps {
  label: string;
  icon: React.ReactNode;
  element: DirectorElement;
  onChange: (prompt: string) => void;
  contextHint?: string;
  className?: string;
  colorTheme?: 'indigo' | 'sky' | 'amber' | 'rose' | 'emerald' | 'zinc';
}

export const ElementControl: React.FC<ElementControlProps> = ({ 
    label, 
    icon, 
    element, 
    onChange, 
    contextHint, 
    className = '',
    colorTheme = 'zinc'
}) => {
  
  const themeStyles: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20 focus-within:border-indigo-500',
    sky: 'bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20 focus-within:border-sky-500',
    amber: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 focus-within:border-amber-500',
    rose: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20 focus-within:border-rose-500',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 focus-within:border-emerald-500',
    zinc: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700 focus-within:border-zinc-500',
  };

  const activeTheme = themeStyles[colorTheme] || themeStyles.zinc;

  return (
    <div className={`bg-white dark:bg-zinc-900/50 rounded-xl p-1 border border-zinc-200 dark:border-zinc-800 transition-all group relative shadow-sm ${className}`}>
      {/* Header */}
      <div className={`flex items-center justify-between p-2 rounded-lg mb-1`}>
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-md ${activeTheme.split(' ')[0]} ${activeTheme.split(' ')[1]}`}>
            {icon}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">{label}</span>
        </div>
        <div className="flex items-center gap-2">
           {/* Auto/Manual Indicator */}
           {element.status === 'auto' && (
             <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded border border-indigo-100 dark:border-indigo-800">
                <RefreshCw className="w-2.5 h-2.5" />
                AI Auto
             </div>
           )}
           {element.status === 'locked' ? (
             <span title="Locked">
               <Lock className="w-3 h-3 text-emerald-500" />
             </span>
           ) : (
             <span title="Editable">
               <Unlock className="w-3 h-3 text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-500 dark:group-hover:text-zinc-400 transition-colors" />
             </span>
           )}
        </div>
      </div>
      
      {/* Input Area */}
      <div className="relative">
        <textarea 
          className={`w-full bg-zinc-50 dark:bg-black/20 border-t border-b border-transparent rounded-b-lg p-3 text-sm text-zinc-800 dark:text-zinc-200 resize-none focus:outline-none focus:bg-white dark:focus:bg-zinc-900 transition-all h-24 leading-relaxed placeholder-zinc-400 dark:placeholder-zinc-600 font-medium ${element.status !== 'locked' ? 'hover:bg-zinc-100 dark:hover:bg-zinc-800' : 'opacity-70 cursor-not-allowed'}`}
          value={element.prompt}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Describe the ${label.toLowerCase()}...`}
          disabled={element.status === 'locked'}
        />
        {/* Dirty State Indicator (Simulated) */}
        {element.status === 'manual' && (
            <div className="absolute bottom-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-500 shadow-sm" title="Manual Override"></div>
        )}
      </div>

      {/* Context / Inheritance Footer */}
      {contextHint && (
        <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500 bg-zinc-50/50 dark:bg-white/5 rounded-b-lg">
            <Link className="w-3 h-3 opacity-50" />
            <span className="truncate opacity-80">Inherits: <span className="font-medium text-zinc-600 dark:text-zinc-300">{contextHint}</span></span>
        </div>
      )}
    </div>
  );
};
