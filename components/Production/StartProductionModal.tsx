import React from 'react';
import { X } from 'lucide-react';

interface StartProductionModalProps {
  target?: { label: string; detail?: string };
  onConfirm: () => void;
  onClose: () => void;
}

export const StartProductionModal: React.FC<StartProductionModalProps> = ({ target, onConfirm, onClose }) => {
  return (
    <div className="fixed inset-0 z-[3500] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-[32px] border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
        <div className="h-16 px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 min-w-10 min-h-10 aspect-square shrink-0 rounded-full border border-zinc-300/80 dark:border-white/45 bg-white/90 dark:bg-white/15 shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_20px_rgba(255,255,255,0.45)]">
              <div className="pointer-events-none absolute -inset-[4px] rounded-full bg-white/35 dark:bg-white/45 blur-[6px] opacity-70 animate-[pulse_2.8s_ease-in-out_infinite]"></div>
              <div className="absolute inset-[8px] rounded-full bg-zinc-900/90 dark:bg-white/90"></div>
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400">Video Generation</div>
              <div className="text-sm font-bold tracking-tight">Confirm Start Production</div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
          </button>
        </div>

        <div className="p-6">
          {target && (
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 mb-4">
              <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Target</div>
              <div className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-100">{target.label}</div>
              {target.detail && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">{target.detail}</div>}
            </div>
          )}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed space-y-2">
            <div>将使用 Gemini Veo 3.1 将当前镜头关键帧生成视频。</div>
            <div className="text-xs text-zinc-500">时长会自动使用该 Shot 当前设置（仅 4/6/8s），分辨率固定 720p。</div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors text-sm font-bold"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="px-5 py-2.5 rounded-xl bg-[#E50914] hover:bg-[#B20710] text-white transition-colors text-sm font-black uppercase tracking-widest"
            >
              Start
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
