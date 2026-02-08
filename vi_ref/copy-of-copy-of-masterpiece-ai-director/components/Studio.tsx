
import React, { useState } from 'react';
import { Story, Shot } from '../types';
import ShotDetail from './ShotDetail';

interface StudioProps {
  story: Story;
  onBack: () => void;
}

export const Studio: React.FC<StudioProps> = ({ story: initialStory, onBack }) => {
  const [story, setStory] = useState(initialStory);
  const [activeSeqId, setActiveSeqId] = useState<string>(story.sequences[0]?.id || '');
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);

  const handleUpdateShot = (updatedShot: Shot) => {
    const newStory = {
        ...story,
        sequences: story.sequences.map(seq => ({
            ...seq,
            shots: seq.shots.map(s => s.id === updatedShot.id ? updatedShot : s)
        }))
    };
    setStory(newStory);
    setSelectedShot(updatedShot);
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-[#050505] animate-in fade-in duration-1000">
      {/* Pro Header */}
      <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-[#0a0a0a]">
        <div className="flex items-center gap-6">
            <button onClick={onBack} className="text-white/40 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7 7-7" /></svg>
            </button>
            <div className="h-6 w-px bg-white/10"></div>
            <div>
                <h1 className="text-sm font-bold text-white tracking-wide">{story.title}</h1>
                <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Edited {new Date().toLocaleDateString()}</div>
            </div>
        </div>
        <div className="flex gap-4">
             <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/5 border border-white/5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                <span className="text-[10px] font-bold text-white/60 tracking-widest uppercase">Saved</span>
             </div>
             <button className="px-4 py-1.5 bg-white text-black text-[10px] font-bold uppercase tracking-widest rounded hover:bg-white/90">
                Export
             </button>
        </div>
      </header>

      {/* Timeline / Canvas Area */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden flex items-center px-10 gap-10 snap-x snap-mandatory">
         {story.sequences.map((seq, i) => (
             <div 
                key={seq.id} 
                className="snap-center flex-shrink-0 w-[420px] h-[75vh] flex flex-col gap-4 group"
                onClick={() => setActiveSeqId(seq.id)}
             >
                <div className="flex justify-between items-end px-2 opacity-50 group-hover:opacity-100 transition-opacity">
                    <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/50">Seq 0{i+1}</span>
                    <span className="text-sm font-medium text-white">{seq.title}</span>
                </div>

                <div className="flex-1 bg-[#0f0f0f] border border-white/5 rounded-3xl p-3 flex flex-col gap-3 overflow-y-auto custom-scrollbar relative">
                    {/* Scene Context */}
                    <div className="p-4 rounded-xl bg-white/5 border border-white/5 mb-2">
                        <p className="text-xs text-white/60 font-serif italic leading-relaxed">"{seq.context}"</p>
                    </div>

                    {seq.shots.map((shot, idx) => (
                        <div 
                            key={shot.id}
                            onClick={(e) => { e.stopPropagation(); setSelectedShot(shot); }}
                            className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/10 hover:border-white/40 cursor-pointer transition-all hover:scale-[1.02] shadow-lg"
                        >
                            {shot.thumbnailUrl ? (
                                <img src={shot.thumbnailUrl} className="w-full h-full object-cover" />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center bg-white/5">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-white/20">Pending</span>
                                </div>
                            )}
                            <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 backdrop-blur rounded text-[9px] font-mono text-white/70 border border-white/10">
                                {idx + 1}
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/90 to-transparent">
                                <p className="text-[11px] text-white/90 line-clamp-1">{shot.description}</p>
                            </div>
                        </div>
                    ))}
                    
                    {/* Add Shot Ghost */}
                    <button className="w-full h-16 border border-dashed border-white/10 rounded-xl flex items-center justify-center text-white/20 hover:text-white/50 hover:bg-white/5 transition-all">
                        <span className="text-xl font-thin">+</span>
                    </button>
                </div>
             </div>
         ))}
         
         {/* Add Sequence */}
         <div className="snap-center flex-shrink-0 w-[100px] h-[75vh] flex items-center justify-center border-l border-white/5">
            <button className="w-12 h-12 rounded-full border border-white/10 text-white/20 hover:text-white hover:border-white transition-all flex items-center justify-center">
                +
            </button>
         </div>
      </main>

      {selectedShot && (
        <ShotDetail 
            shot={selectedShot}
            styleGuide={story.styleGuide}
            aspectRatio={story.aspectRatio}
            onClose={() => setSelectedShot(null)}
            onUpdate={handleUpdateShot}
        />
      )}
    </div>
  );
};
