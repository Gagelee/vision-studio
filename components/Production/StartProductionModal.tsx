import React from 'react';
import { Film, X } from 'lucide-react';

interface StartProductionModalProps {
  onConfirm: () => void;
  onClose: () => void;
}

export const StartProductionModal: React.FC<StartProductionModalProps> = ({ onConfirm, onClose }) => {
  return (
    <div className="fixed inset-0 z-[3500] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-[32px] border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
        <div className="h-16 px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#ee4d2d] text-white flex items-center justify-center shadow-sm shadow-orange-500/20">
              <Film className="w-5 h-5" />
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
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
            目前视频生成不会自动触发。点击确认后将进入“开始生产”的占位流程（后续会接入真实的渲染/合成 API）。
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
              className="px-5 py-2.5 rounded-xl bg-[#ee4d2d] hover:bg-[#f05d40] text-white transition-colors text-sm font-black uppercase tracking-widest"
            >
              Start
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

