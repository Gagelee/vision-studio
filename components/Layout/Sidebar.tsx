import React from 'react';
import { Film, FolderOpen, MapPin, Globe, Users, Plus, Sun, Moon, LayoutTemplate, Home, Settings, Bug, BookText, Loader2 } from 'lucide-react';
import { Story, SelectionState } from '../../types';
import { openLightbox } from '../../lib/ui/lightboxStore';

interface SidebarProps {
  story: Story;
  selection: SelectionState;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onSelect: (sel: SelectionState) => void;
  onBackToLibrary?: () => void;
  onOpenAiSettings?: () => void;
  onOpenDebug?: () => void;
  onOpenScript?: () => void;
  onDeleteSequence?: (id: string) => void;
  onDeleteLocation?: (id: string) => void;
  onDeleteCharacter?: (id: string) => void;
  onCreateSequence?: () => void;
  onCreateLocation?: () => void;
  onCreateCharacter?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ 
    story, 
    selection, 
    theme,
    toggleTheme,
    onSelect, 
    onBackToLibrary,
    onOpenAiSettings,
    onOpenDebug,
    onOpenScript,
    onDeleteSequence,
    onDeleteLocation,
    onDeleteCharacter,
    onCreateSequence,
    onCreateLocation,
    onCreateCharacter
}) => {
  return (
    <div className="w-64 bg-zinc-50 dark:bg-black border-r border-zinc-200 dark:border-zinc-800 flex flex-col h-full shrink-0 z-20 transition-colors duration-300">
      {/* App Header */}
      <div className="h-14 px-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-white dark:bg-zinc-950">
        <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#ee4d2d] rounded-md flex items-center justify-center text-white shadow-sm shadow-orange-500/20">
                <span className="font-bold text-xs italic">S</span>
            </div>
            <h1 className="font-bold text-zinc-900 dark:text-zinc-100 tracking-tight text-xs uppercase">Vision Studio</h1>
        </div>
        <div className="flex items-center gap-1">
          {onBackToLibrary && (
            <button
              onClick={onBackToLibrary}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Project Library"
            >
              <Home className="w-4 h-4" />
            </button>
          )}
          {onOpenAiSettings && (
            <button
              onClick={onOpenAiSettings}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="AI Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          {onOpenDebug && (
            <button
              onClick={onOpenDebug}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Debug (Cmd/Ctrl+Shift+D)"
            >
              <Bug className="w-4 h-4" />
            </button>
          )}
          {onOpenScript && (
            <button
              onClick={onOpenScript}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Script Editor"
            >
              <BookText className="w-4 h-4" />
            </button>
          )}
          <button 
              onClick={toggleTheme}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Toggle Theme"
          >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Project Root Card */}
        <div className="p-4 pb-2">
            <div 
              className={`p-3 rounded-xl border transition-all cursor-pointer group relative overflow-hidden ${
                selection.type === 'story'
                ? 'bg-zinc-900 dark:bg-zinc-900 text-white border-zinc-700 shadow-xl shadow-black/5'
                : 'bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-md'
              }`}
              onClick={() => onSelect({ type: 'story', id: story.id })}
            >
                 <div className="flex items-center justify-between mb-2">
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${selection.type === 'story' ? 'text-zinc-400' : 'text-zinc-400'}`}>Active Project</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${selection.type === 'story' ? 'bg-[#ee4d2d] shadow-[0_0_8px_rgba(238,77,45,0.6)]' : 'bg-zinc-300 dark:bg-zinc-700'}`}></div>
                 </div>
                 <div className="font-bold text-sm truncate flex items-center gap-2 mb-1">
                    <FolderOpen className={`w-4 h-4 ${selection.type === 'story' ? 'text-[#ee4d2d]' : 'text-zinc-400'}`} />
                    {story.title}
                 </div>
                 <div className={`text-[10px] truncate ${selection.type === 'story' ? 'text-zinc-400' : 'text-zinc-400'}`}>
                    {story.logline}
                 </div>
            </div>
        </div>

        {/* Navigation Sections */}
        <div className="py-2 space-y-6">
            
            {/* Timeline Sequences */}
            <div>
                <div className="px-4 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
                        <LayoutTemplate className="w-3 h-3" />
                        Sequences
                    </div>
                    {onCreateSequence && (
                        <button onClick={(e) => { e.stopPropagation(); onCreateSequence(); }} className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-[#ee4d2d] transition-colors" title="New Sequence">
                            <Plus className="w-3 h-3" />
                        </button>
                    )}
                </div>
                <div className="px-2 space-y-0.5">
                    {story.sequences.map(seq => {
                        const isActive = (selection.type === 'sequence' && selection.id === seq.id) || (selection.type === 'shot' && selection.parentId === seq.id);
                        const isSeqLoading = (seq.shots || []).some((s) => s.aiState === 'rendering' || s.assetState?.status === 'running');
                        return (
                             <div 
                                key={seq.id}
                                className={`group px-3 py-2 rounded-lg flex items-center gap-3 cursor-pointer transition-all border border-transparent ${
                                    isActive
                                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white font-medium border-zinc-200 dark:border-zinc-800 shadow-sm' 
                                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900'
                                }`}
                                onClick={() => onSelect({ type: 'sequence', id: seq.id })}
                             >
                                <span className={`text-[10px] font-mono w-4 flex items-center justify-center rounded ${isActive ? 'bg-orange-100 text-[#ee4d2d] dark:bg-orange-500/20 dark:text-orange-400' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}>
                                    {story.sequences.indexOf(seq) + 1}
                                </span>
                            <span className="text-sm truncate">{seq.title}</span>
                            <div className="ml-auto flex items-center gap-1">
                              {onDeleteSequence && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Delete sequence "${seq.title}"?`)) onDeleteSequence(seq.id);
                                  }}
                                  className="text-zinc-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                                  title="Delete sequence"
                                >
                                  ✕
                                </button>
                              )}
                              {isSeqLoading && (
                                <Loader2 className="w-3.5 h-3.5 text-orange-400 animate-spin" />
                              )}
                            </div>
                             </div>
                        );
                    })}
                </div>
            </div>

            {/* World Building (Sets) */}
            <div>
                 <div className="px-4 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
                        <Globe className="w-3 h-3" />
                        Environments
                    </div>
                    {onCreateLocation && (
                        <button onClick={onCreateLocation} className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-[#ee4d2d] transition-colors" title="New Set">
                            <Plus className="w-3 h-3" />
                        </button>
                    )}
                 </div>
                 <div className="px-2 space-y-0.5">
                     {story.locations.map(loc => (
                         <div 
                            key={loc.id}
                            className={`group px-3 py-1.5 rounded-lg flex items-center gap-2 cursor-pointer transition-colors ${
                                selection.type === 'location' && selection.id === loc.id 
                                ? 'bg-orange-50/50 dark:bg-orange-900/10 text-[#ee4d2d] dark:text-orange-400 border border-orange-200/50 dark:border-orange-500/20' 
                                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                            }`}
                            onClick={() => onSelect({ type: 'location', id: loc.id })}
                         >
                            <MapPin className="w-3.5 h-3.5 opacity-70" />
                            <span className="text-sm truncate">{loc.name}</span>
                            <div className="ml-auto flex items-center gap-1">
                              {onDeleteLocation && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Delete environment "${loc.name}"?`)) onDeleteLocation(loc.id);
                                  }}
                                  className="text-zinc-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                                  title="Delete environment"
                                >
                                  ✕
                                </button>
                              )}
                              {loc.assetState?.status === 'running' && (
                                <Loader2 className="w-3.5 h-3.5 text-orange-400 animate-spin" />
                              )}
                            </div>
                         </div>
                     ))}
                 </div>
            </div>

            {/* Casting (Characters) */}
            <div>
                 <div className="px-4 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
                        <Users className="w-3 h-3" />
                        Casting
                    </div>
                    {onCreateCharacter && (
                        <button onClick={onCreateCharacter} className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-indigo-500 transition-colors" title="New Character">
                            <Plus className="w-3 h-3" />
                        </button>
                    )}
                 </div>
                 <div className="px-2 space-y-0.5">
                     {story.characters.map(char => (
                         <div 
                            key={char.id}
                            className={`group px-3 py-1.5 rounded-lg flex items-center gap-2 cursor-pointer transition-colors ${
                                selection.type === 'character' && selection.id === char.id 
                                ? 'bg-indigo-50/50 dark:bg-indigo-900/10 text-indigo-700 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-500/20' 
                                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-zinc-200'
                            }`}
                            onClick={() => onSelect({ type: 'character', id: char.id })}
                         >
                            <img
                              src={char.avatarUrl}
                              className="w-4 h-4 rounded-full object-cover bg-zinc-200 cursor-zoom-in"
                              alt={char.name}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (char.avatarUrl) openLightbox({ url: char.avatarUrl, title: `Character: ${char.name}` });
                              }}
                            />
                            <span className="text-sm truncate">{char.name}</span>
                            <div className="ml-auto flex items-center gap-1">
                              {onDeleteCharacter && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Delete character "${char.name}"?`)) onDeleteCharacter(char.id);
                                  }}
                                  className="text-zinc-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                                  title="Delete character"
                                >
                                  ✕
                                </button>
                              )}
                              {char.assetState?.status === 'running' && (
                                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                              )}
                            </div>
                         </div>
                     ))}
                 </div>
            </div>
        </div>
      </div>
      
      {/* Footer */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
         <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <div className="w-1.5 h-1.5 bg-[#ee4d2d] rounded-full animate-pulse"></div>
            System Operational
         </div>
      </div>
    </div>
  );
};
