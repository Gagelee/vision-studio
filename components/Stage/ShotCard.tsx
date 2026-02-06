
import React from 'react';
import { Camera, Mic, Users, Sun, MonitorPlay, Sparkles, Loader2, Clock, Info } from 'lucide-react';
import { Shot, ElementType, AspectRatio } from '../../types';
import { openLightbox } from '../../lib/ui/lightboxStore';

interface ShotCardProps {
  shot: Shot;
  isSelected: boolean;
  onSelect: () => void;
  aspectRatio?: AspectRatio;
}

export const ShotCard: React.FC<ShotCardProps> = ({ shot, isSelected, onSelect, aspectRatio = '16:9' }) => {
  const isProcessing = shot.aiState && shot.aiState !== 'idle';
  const assetStatus = shot.assetState?.status;
  const isQueued = assetStatus === 'queued';
  const isRunning = assetStatus === 'running';
  const versions = Array.isArray((shot as any).versions) ? (shot as any).versions : [];
  const activeVersion = versions.find((v: any) => String(v?.id || '') === String((shot as any).activeVersionId || '')) || versions[versions.length - 1];
  const hasGenerationDetails = Boolean((activeVersion as any)?.metadata);

  const ratioStyles: Record<AspectRatio, string> = {
    '16:9': 'aspect-video',
    '9:16': 'aspect-[9/16]',
    '1:1': 'aspect-square',
    '4:5': 'aspect-[4/5]',
  };

  return (
    <div 
      className={`relative group w-full rounded-xl overflow-hidden border-2 transition-all duration-300 cursor-pointer flex flex-col 
        bg-white dark:bg-zinc-900 
        ${isSelected 
            ? 'border-indigo-500 shadow-[0_0_30px_-5px_rgba(99,102,241,0.3)] scale-[1.02] z-10' 
            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600 hover:shadow-xl'
        }
        ${isProcessing ? 'ring-2 ring-amber-500/50 border-amber-500/50' : ''}
      `}
      onClick={onSelect}
    >
      {/* Header / Sequence */}
      <div className="absolute top-2 left-2 z-20 flex gap-2">
        <span className="bg-black/60 backdrop-blur-md text-white text-[10px] font-bold px-1.5 py-0.5 rounded border border-white/10 shadow-sm">
          #{shot.sequence}
        </span>
        {isProcessing && (
           <span className="bg-amber-500/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 animate-pulse shadow-sm">
              <Sparkles className="w-2.5 h-2.5" />
              {shot.aiState === 'thinking' ? 'AI Analyzing...' : 'Rendering...'}
           </span>
        )}
        {!isProcessing && isRunning && (
           <span className="bg-amber-500/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              Generating...
           </span>
        )}
        {!isProcessing && isQueued && (
           <span className="bg-amber-400/90 text-black text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 shadow-sm">
              <Clock className="w-2.5 h-2.5" />
              Queued
           </span>
        )}
      </div>
      
      {/* Duration Badge */}
      <div className="absolute top-2 right-2 z-20">
        <div className="flex items-center gap-1">
          {hasGenerationDetails && (
            <span
              className="bg-indigo-500/80 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 border border-indigo-300/30 shadow-sm"
              title="Has generation details in version history"
            >
              <Info className="w-3 h-3" />
            </span>
          )}
          <span className="bg-black/60 backdrop-blur-md text-zinc-300 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 border border-white/10 shadow-sm">
            <MonitorPlay className="w-3 h-3" />
            {shot.duration}s
          </span>
        </div>
      </div>

      {/* Visual Preview Container */}
      <div className={`${ratioStyles[aspectRatio]} w-full bg-zinc-100 dark:bg-zinc-950 relative overflow-hidden transition-all duration-500 ease-in-out`}>
        {/* Actual Image */}
	        <img 
	          src={shot.thumbnailUrl} 
	          alt="Shot storyboard" 
	          className={`w-full h-full object-cover transition-all duration-700 cursor-zoom-in ${isProcessing ? 'scale-110 blur-sm opacity-50' : 'opacity-90 hover:opacity-100'}`}
	          onClick={(e) => {
	            e.stopPropagation();
	            openLightbox({ url: shot.thumbnailUrl, title: `Shot #${shot.sequence}` });
	          }}
	        />

        {/* AI "Scanner" Effect Overlay */}
        {isProcessing && (
            <div className="absolute inset-0 z-10">
                <div className="absolute top-0 left-0 w-full h-1 bg-amber-400/80 shadow-[0_0_15px_rgba(251,191,36,1)] animate-[scan_2s_ease-in-out_infinite]"></div>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay"></div>
                
                <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-500">
                     <Loader2 className="w-8 h-8 animate-spin mb-2" />
                     <span className="text-xs font-mono font-bold tracking-widest uppercase text-shadow-sm">{shot.aiPrompt || 'PROCESSING'}</span>
                </div>
            </div>
        )}

        {/* Gradient Overlay for text readability if needed */}
        {!isProcessing && (
            <div className="absolute bottom-0 left-0 right-0 h-1/4 bg-gradient-to-t from-black/50 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>

      {/* Content Body */}
      <div className="p-3 flex flex-col gap-3 flex-1 relative bg-white dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800">
        <p className={`text-sm text-zinc-700 dark:text-zinc-200 font-medium line-clamp-2 leading-snug ${isProcessing ? 'opacity-50' : ''}`}>
          {shot.description}
        </p>

        {/* Elements Indicators */}
        <div className="mt-auto pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-between items-center text-zinc-500">
           <div className="flex gap-1.5">
             <IndicatorIcon active={shot.elements[ElementType.CASTING].status !== 'auto'} icon={<Users className="w-3 h-3" />} />
             <IndicatorIcon active={shot.elements[ElementType.CAMERA].status !== 'auto'} icon={<Camera className="w-3 h-3" />} />
             <IndicatorIcon active={shot.elements[ElementType.LIGHTING].status !== 'auto'} icon={<Sun className="w-3 h-3" />} />
             <IndicatorIcon active={shot.elements[ElementType.SCRIPT].status !== 'auto'} icon={<Mic className="w-3 h-3" />} />
           </div>
           <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-500 dark:text-zinc-600 bg-zinc-100 dark:bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-800">
              {shot.elements[ElementType.CAMERA].metadata?.type || 'Shot'}
           </span>
        </div>
      </div>
    </div>
  );
};

const IndicatorIcon = ({ active, icon }: { active: boolean; icon: React.ReactNode }) => (
  <div className={`p-1 rounded-full ${
      active 
      ? 'bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' 
      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600'
  }`}>
    {icon}
  </div>
);
