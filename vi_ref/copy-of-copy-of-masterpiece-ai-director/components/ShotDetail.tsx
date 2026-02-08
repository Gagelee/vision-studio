
import React, { useState } from 'react';
import { Shot, AspectRatio } from '../types';
import { generateShotImage } from '../services/geminiService';

interface ShotDetailProps {
  shot: Shot;
  styleGuide: string;
  aspectRatio: AspectRatio;
  onClose: () => void;
  onUpdate: (updatedShot: Shot) => void;
}

const ShotDetail: React.FC<ShotDetailProps> = ({ shot, styleGuide, aspectRatio, onClose, onUpdate }) => {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const imageUrl = await generateShotImage(shot, styleGuide, aspectRatio);
      if (imageUrl) {
        onUpdate({
          ...shot,
          thumbnailUrl: imageUrl,
          assetState: { status: 'done' }
        });
      } else {
        onUpdate({
            ...shot,
            assetState: { status: 'error', lastError: 'Generation failed' }
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="absolute inset-0" onClick={onClose}></div>
      
      <div className="relative w-full max-w-5xl h-[85vh] glass-card rounded-[32px] overflow-hidden flex flex-col md:flex-row border border-white/10 shadow-2xl bg-[#0a0a0a]">
        
        {/* Close Button */}
        <button 
            onClick={onClose}
            className="absolute top-6 right-6 z-20 w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-white hover:text-black transition-all"
        >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        {/* Visual Stage (Left/Top) */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden group">
            {shot.thumbnailUrl ? (
                <img 
                    src={shot.thumbnailUrl} 
                    className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-105" 
                    alt="Shot Visual"
                />
            ) : (
                <div className="flex flex-col items-center gap-4 opacity-30">
                    <div className="w-20 h-20 rounded-full border border-dashed border-white flex items-center justify-center">
                        <span className="text-2xl">Visual</span>
                    </div>
                    <span className="text-xs uppercase tracking-widest">No Asset</span>
                </div>
            )}

            {/* Loading Overlay */}
            {isGenerating && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10">
                    <div className="w-12 h-12 border-2 border-white/10 border-t-orange-500 rounded-full animate-spin"></div>
                    <span className="text-xs font-bold tracking-[0.3em] uppercase text-white animate-pulse">Rendering</span>
                </div>
            )}
        </div>

        {/* Inspector Panel (Right/Bottom) */}
        <div className="w-full md:w-[400px] flex flex-col border-l border-white/5 bg-white/[0.02] backdrop-blur-xl">
            <div className="p-8 flex-1 overflow-y-auto">
                <div className="flex items-center gap-3 mb-8">
                    <span className="text-[10px] font-bold tracking-[0.2em] text-orange-500 uppercase">Shot {shot.sequenceIndex + 1}</span>
                    <span className="w-px h-3 bg-white/10"></span>
                    <span className="text-[10px] font-bold tracking-[0.2em] text-white/40 uppercase">{shot.duration} Seconds</span>
                </div>

                <h2 className="text-2xl font-light text-white leading-tight mb-6">
                    {shot.description}
                </h2>

                <div className="space-y-6">
                    <div>
                        <div className="text-[9px] font-bold tracking-[0.2em] text-white/30 uppercase mb-2">Camera Movement</div>
                        <div className="text-sm text-white/80 font-light border-l-2 border-white/10 pl-3">
                            {shot.cameraMovement || "Static / Default"}
                        </div>
                    </div>
                    <div>
                        <div className="text-[9px] font-bold tracking-[0.2em] text-white/30 uppercase mb-2">Style Context</div>
                        <div className="text-sm text-white/60 font-light line-clamp-3">
                            {styleGuide}
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="p-8 border-t border-white/5 bg-black/20">
                <button
                    onClick={handleGenerate}
                    disabled={isGenerating}
                    className="w-full h-14 bg-white text-black rounded-xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                >
                    {isGenerating ? 'Processing' : shot.thumbnailUrl ? 'Regenerate Visual' : 'Generate Visual'}
                    {!isGenerating && <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ShotDetail;
