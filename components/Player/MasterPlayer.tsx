
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Story, Shot } from '../../types';
import { X, Play, Pause, Maximize2, SkipForward, Volume2, AlertCircle } from 'lucide-react';
import { openLightbox } from '../../lib/ui/lightboxStore';

interface MasterPlayerProps {
  story: Story;
  onClose: () => void;
}

export const MasterPlayer: React.FC<MasterPlayerProps> = ({ story, onClose }) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentShotIndex, setCurrentShotIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [imgError, setImgError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Flatten shots from all sequences to create a linear timeline
  const allShots = story.sequences.flatMap(s => s.shots);
  const currentShot = allShots[currentShotIndex];
  const currentVideoUrl = useMemo(() => {
    if (!currentShot) return '';
    const variants = Array.isArray((currentShot as any)?.production?.variants)
      ? ((currentShot as any).production.variants as any[])
      : [];
    const activeId = String((currentShot as any)?.production?.activeVariantId || '').trim();
    const active = variants.find((v: any) => String(v?.id || '') === activeId) || variants[variants.length - 1];
    return String(active?.videoUrl || (currentShot as any)?.production?.videoUrl || '').trim();
  }, [currentShot]);
  
  // Reset error state when shot changes
  useEffect(() => {
    setImgError(false);
    setProgress(0);
  }, [currentShotIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && currentShot && !currentVideoUrl) {
      interval = setInterval(() => {
        setProgress(p => {
            if (p >= 100) {
                if (currentShotIndex < allShots.length - 1) {
                    setCurrentShotIndex(i => i + 1);
                    return 0;
                } else {
                    setIsPlaying(false);
                    return 100;
                }
            }
            // Simulate duration: increment progress based on shot duration (approx 10 ticks per sec)
            const step = 100 / (currentShot.duration * 10); 
            return p + step;
        });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentShotIndex, currentShot?.duration, allShots.length, currentVideoUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !currentVideoUrl) return;
    if (isPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, currentVideoUrl, currentShotIndex]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-300 font-sans">
      {/* Viewport */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {/* Blurred Ambient Background */}
        <div className="absolute inset-0 opacity-30 blur-3xl scale-110 pointer-events-none">
            {!imgError && currentShot && <img src={currentShot.thumbnailUrl} className="w-full h-full object-cover" alt="ambient" />}
        </div>
        
        {/* Main Content Frame */}
        <div className="relative z-10 max-h-full max-w-full aspect-video shadow-2xl bg-black flex items-center justify-center">
             {!currentShot ? (
                 <div className="flex flex-col items-center justify-center text-zinc-500 gap-3 p-10 text-center">
                     <AlertCircle className="w-12 h-12 opacity-60" />
                     <div className="text-xs uppercase font-bold tracking-wider">No Shots Available</div>
                     <div className="text-sm text-zinc-500 max-w-md leading-relaxed">
                       This project has no shots to play yet. Create shots in a sequence, then come back to Screen Master.
                     </div>
                 </div>
             ) : imgError ? (
                 <div className="flex flex-col items-center justify-center text-zinc-600 gap-2">
                     <AlertCircle className="w-12 h-12 opacity-50" />
                     <span className="text-xs uppercase font-bold tracking-wider">Visual Source Unavailable</span>
                 </div>
             ) : currentVideoUrl ? (
                 <video
                   ref={videoRef}
                   src={currentVideoUrl}
                   className="w-full h-full object-contain bg-black"
                   playsInline
                   autoPlay
                   onTimeUpdate={(e) => {
                     const el = e.currentTarget;
                     const d = Number(el.duration || 0);
                     const t = Number(el.currentTime || 0);
                     if (d > 0) setProgress(Math.max(0, Math.min(100, (t / d) * 100)));
                   }}
                   onEnded={() => {
                     if (currentShotIndex < allShots.length - 1) {
                       setCurrentShotIndex((i) => i + 1);
                     } else {
                       setIsPlaying(false);
                       setProgress(100);
                     }
                   }}
                   onError={() => setImgError(true)}
                 />
             ) : (
                 <img 
                    src={currentShot.thumbnailUrl} 
                    className="w-full h-full object-contain cursor-zoom-in" 
                    alt="Current Shot" 
                    onError={() => setImgError(true)}
                    onClick={() => currentShot?.thumbnailUrl && openLightbox({ url: currentShot.thumbnailUrl, title: `Shot #${currentShot.sequence}` })}
                 />
             )}
             
             {/* Cinematic Subtitles / Context Overlay */}
             {currentShot && (
               <div className="absolute bottom-12 left-0 right-0 text-center pb-12 pt-24 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                    <h3 className="text-white text-xl font-bold drop-shadow-md mb-2 tracking-wide px-20">{currentShot.description}</h3>
                    <div className="flex items-center justify-center gap-2 text-white/60 text-xs font-mono uppercase tracking-widest">
                          <span>Shot {currentShot.sequence}</span>
                          <span>•</span>
                          <span>{story.sequences.find(s => s.shots.some(shot => shot.id === currentShot.id))?.title}</span>
                    </div>
               </div>
             )}
        </div>

        {/* Top Controls (Always visible to guarantee exit) */}
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-start bg-gradient-to-b from-black/70 to-transparent opacity-100 z-20">
            <div className="text-white">
                <h1 className="font-bold text-lg tracking-tight">{story.title}</h1>
                <p className="text-xs text-white/50 font-medium uppercase tracking-wider">Director's Master Cut</p>
            </div>
            <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors backdrop-blur-md">
                <X className="w-6 h-6" />
            </button>
        </div>
      </div>

      {/* Control Bar */}
      <div className="h-24 bg-zinc-950 border-t border-zinc-800 px-8 flex flex-col justify-center gap-4 shrink-0">
           {/* Timeline Scrubber */}
           <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden flex cursor-pointer group">
               {allShots.map((shot, idx) => (
                   <div key={shot.id} className="h-full flex-1 border-r border-zinc-900 last:border-0 bg-zinc-800 relative transition-all hover:bg-zinc-700">
                       {idx < currentShotIndex && <div className="absolute inset-0 bg-[#ee4d2d]"></div>}
                       {idx === currentShotIndex && <div className="absolute inset-0 bg-[#ee4d2d]" style={{ width: `${progress}%` }}></div>}
                   </div>
               ))}
           </div>

           <div className="flex items-center justify-between text-white">
               <div className="flex items-center gap-6">
                   <button
                     disabled={!currentShot}
                     onClick={() => {
                       setIsPlaying((prev) => !prev);
                     }}
                     className="hover:text-[#ee4d2d] transition-colors hover:scale-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                   >
                       {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
                   </button>
                   <button
                     disabled={!currentShot}
                     onClick={() => {
                       setCurrentShotIndex(Math.min(allShots.length - 1, currentShotIndex + 1));
                       setProgress(0);
                     }}
                     className="hover:text-[#ee4d2d] transition-colors hover:scale-110 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                   >
                       <SkipForward className="w-6 h-6 fill-current" />
                   </button>
                   <div className="text-xs font-mono text-zinc-400 tabular-nums">
                       {allShots.length === 0 ? (
                         <span>0 / 0</span>
                       ) : (
                         <>
                           {currentShotIndex + 1} / {allShots.length}{' '}
                           <span className="text-zinc-600 mx-1">|</span>{' '}
                           {Math.floor((currentShotIndex / allShots.length) * 100)}%
                         </>
                       )}
                   </div>
               </div>
               
               <div className="flex items-center gap-4 opacity-50 hover:opacity-100 transition-opacity">
                   <Volume2 className="w-5 h-5 text-zinc-400" />
                   <div className="w-24 h-1 bg-zinc-700 rounded-full">
                       <div className="w-2/3 h-full bg-zinc-400 rounded-full"></div>
                   </div>
               </div>
           </div>
      </div>
    </div>
  );
};
