
import React from 'react';
import { Story, SelectionState } from '../../types';
import { 
  Film, 
  Play, 
  ChevronRight,
  TrendingUp,
  Layout,
  Anchor,
  Clock,
  Sparkles,
  Clapperboard,
  Maximize
} from 'lucide-react';

interface ProjectDashboardProps {
  story: Story;
  onSelect: (sel: SelectionState) => void;
  onPlayCinema: () => void;
  onStartProduction?: () => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({ story, onSelect, onPlayCinema, onStartProduction }) => {
  const totalShots = story.sequences.reduce((acc, seq) => acc + seq.shots.length, 0);
  const totalDuration = story.sequences.reduce((acc, seq) => acc + seq.shots.reduce((sAcc, shot) => sAcc + shot.duration, 0), 0);
  const firstSeqId = story.sequences[0]?.id;

  return (
    <div className="flex-1 h-full overflow-y-auto custom-scrollbar bg-white dark:bg-[#050505] scroll-smooth">
      {/* Apple TV Style Hero */}
      <div className="relative h-[85vh] min-h-[600px] flex items-end p-12 overflow-hidden group">
        <div className="absolute inset-0 z-0">
          {/* Main Gradient Highlighting */}
          <div className="absolute inset-0 bg-gradient-to-t from-white dark:from-[#050505] via-transparent to-transparent z-10"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-white/40 dark:from-[#050505]/80 via-transparent to-transparent z-10"></div>
          
          <img 
            src={story.keyVisualUrl} 
            className="w-full h-full object-cover transition-transform duration-[10s] group-hover:scale-110 ease-out"
            alt="Master Preview"
          />
          
          {/* Visual Texture (Grain/Fog) */}
          <div className="absolute inset-0 bg-black/5 mix-blend-overlay dark:opacity-40"></div>
        </div>
        
        <div className="relative z-20 max-w-4xl w-full animate-in slide-in-from-bottom-12 duration-1000 ease-out">
            <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#ee4d2d] text-white shadow-2xl">
                    <Sparkles className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">Director Master Cut</span>
                </div>
                <div className="px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white text-[10px] font-bold uppercase tracking-widest">
                    Format: {story.aspectRatio}
                </div>
            </div>

            <h1 className="text-8xl font-black text-zinc-900 dark:text-white tracking-tighter mb-6 leading-[0.9] drop-shadow-2xl">
                {story.title}
            </h1>
            
            <p className="text-zinc-600 dark:text-zinc-300 text-xl max-w-2xl leading-relaxed font-medium mb-10 opacity-80">
                {story.logline}
            </p>

            <div className="flex items-center gap-4">
                <button 
                    disabled={totalShots === 0}
                    onClick={onPlayCinema}
                    className="flex items-center gap-3 px-10 py-5 bg-[#ee4d2d] hover:bg-[#f05d40] text-white rounded-2xl text-lg font-black uppercase tracking-widest transition-all shadow-[0_20px_40px_rgba(238,77,45,0.3)] hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Play className="w-6 h-6 fill-current" />
                    {totalShots === 0 ? 'No Shots' : 'Screen Master'}
                </button>
                {onStartProduction && (
                  <button 
                      onClick={onStartProduction}
                      className="flex items-center gap-3 px-8 py-5 bg-black/10 dark:bg-white/5 hover:bg-black/20 dark:hover:bg-white/10 text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/10 rounded-2xl text-lg font-bold transition-all backdrop-blur-xl"
                  >
                      <Film className="w-5 h-5" />
                      Start Production
                  </button>
                )}
                <button 
                    disabled={!firstSeqId}
                    onClick={() => firstSeqId && onSelect({ type: 'sequence', id: firstSeqId })}
                    className="flex items-center gap-3 px-8 py-5 bg-white/10 dark:bg-white/5 hover:bg-white/20 dark:hover:bg-white/10 text-zinc-900 dark:text-white border border-zinc-200 dark:border-white/10 rounded-2xl text-lg font-bold transition-all backdrop-blur-xl disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    <Maximize className="w-5 h-5" />
                    {firstSeqId ? 'Inspect Beats' : 'No Sequences'}
                </button>
            </div>
        </div>

        {/* Global Production Stats Overlay (Right) */}
        <div className="absolute bottom-12 right-12 z-20 flex flex-col gap-6 text-right animate-in slide-in-from-right-12 duration-1000 delay-200">
             <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Total Run Time</div>
                <div className="text-4xl font-black text-zinc-900 dark:text-white font-mono">{totalDuration}s</div>
             </div>
             <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Narrative Beats</div>
                <div className="text-4xl font-black text-zinc-900 dark:text-white font-mono">{story.sequences.length}</div>
             </div>
             <div className="h-px w-20 bg-zinc-200 dark:bg-white/20 ml-auto"></div>
             <div className="text-[10px] font-bold text-[#ee4d2d] uppercase tracking-[0.3em]">Scaffolding: 100%</div>
        </div>
      </div>

      {/* Production Modules */}
      <div className="p-12 max-w-7xl mx-auto space-y-20 pb-40">
        
        {/* Narrative Roadmap */}
        <section>
            <div className="flex items-center justify-between mb-10">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 flex items-center gap-3">
                    <Clapperboard className="w-5 h-5 text-[#ee4d2d]" />
                    Story Architecture
                </h3>
                <div className="h-px flex-1 mx-10 bg-zinc-100 dark:bg-zinc-800/50"></div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {story.sequences.map((seq, idx) => (
                    <div 
                        key={seq.id}
                        onClick={() => onSelect({ type: 'sequence', id: seq.id })}
                        className="group relative flex flex-col p-8 bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-[40px] hover:border-[#ee4d2d]/30 hover:bg-white dark:hover:bg-zinc-900 transition-all cursor-pointer shadow-sm hover:shadow-2xl"
                    >
                        <div className="absolute top-8 right-8 text-6xl font-black text-zinc-100 dark:text-white/5 select-none group-hover:text-[#ee4d2d]/10 transition-colors">
                            {idx + 1}
                        </div>
                        <div className="relative z-10">
                            <h4 className="font-black text-2xl text-zinc-900 dark:text-zinc-100 mb-3 tracking-tight">{seq.title}</h4>
                            <p className="text-zinc-500 dark:text-zinc-500 line-clamp-2 text-sm leading-relaxed mb-6">{seq.context}</p>
                            
                            <div className="flex items-center gap-4">
                                <div className="flex -space-x-3">
                                    {seq.shots.slice(0, 4).map(s => (
                                        <div key={s.id} className="w-10 h-10 rounded-full border-2 border-white dark:border-zinc-900 overflow-hidden bg-zinc-800 shadow-xl">
                                            <img src={s.thumbnailUrl} className="w-full h-full object-cover" />
                                        </div>
                                    ))}
                                </div>
                                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{seq.shots.length} Fragments</span>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
      </div>
    </div>
  );
};
