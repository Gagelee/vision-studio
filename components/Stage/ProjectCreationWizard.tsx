
import React, { useState } from 'react';
import { Sparkles, ArrowRight, Smartphone, Tv, Instagram, Clapperboard, Loader2, X } from 'lucide-react';
import { AspectRatio } from '../../types';

interface ProjectCreationWizardProps {
  onComplete: (intent: string, ratio: AspectRatio) => void;
  onCancel: () => void;
}

export const ProjectCreationWizard: React.FC<ProjectCreationWizardProps> = ({ onComplete, onCancel }) => {
  const [intent, setIntent] = useState('');
  const [ratio, setRatio] = useState<AspectRatio>('16:9');
  const [isProcessing, setIsProcessing] = useState(false);

  const formats: { label: string; ratio: AspectRatio; icon: any }[] = [
    { label: 'Cinema', ratio: '16:9', icon: Tv },
    { label: 'Social', ratio: '9:16', icon: Smartphone },
    { label: 'Square', ratio: '1:1', icon: Instagram },
    { label: 'Portrait', ratio: '4:5', icon: Clapperboard },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;
    setIsProcessing(true);
    onComplete(intent, ratio);
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-[#050505] flex items-center justify-center p-8 overflow-hidden">
        {/* Cinematic Background */}
        <div className="absolute inset-0 z-0">
             <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-[#ee4d2d]/10"></div>
             <div className="absolute inset-0 opacity-20 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
        </div>

        <button onClick={onCancel} className="absolute top-10 right-10 text-white/40 hover:text-white transition-colors">
            <X className="w-8 h-8" />
        </button>

        <div className="relative z-10 w-full max-w-4xl text-center">
            {isProcessing ? (
                <div className="space-y-12 animate-in zoom-in-95 duration-500">
                    <div className="relative w-24 h-24 mx-auto">
                        <div className="absolute inset-0 rounded-full border-2 border-white/5 animate-[ping_2s_infinite]"></div>
                        <div className="absolute inset-0 rounded-full border-t-2 border-[#ee4d2d] animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-10 h-10 text-[#ee4d2d] animate-pulse" />
                        </div>
                    </div>
                    <div>
                        <h2 className="text-4xl font-black text-white tracking-tighter mb-4">Director AI is Thinking...</h2>
                        <p className="text-white/40 font-medium text-lg max-w-md mx-auto">
                            Scaffolding story architecture, casting performers, and置景 (Sets) for your masterwork.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2 max-w-xs mx-auto">
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-[#ee4d2d] animate-[progress_4s_ease-in-out]"></div>
                        </div>
                        <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            <span>Analysis</span>
                            <span>Scaffolding</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-16 animate-in slide-in-from-bottom-20 duration-1000">
                    <div className="space-y-4">
                        <div className="flex items-center justify-center gap-3 text-[#ee4d2d] mb-4">
                            <div className="w-12 h-px bg-[#ee4d2d]/30"></div>
                            <Sparkles className="w-6 h-6" />
                            <span className="text-xs font-black uppercase tracking-[0.4em]">Initialize Narrative</span>
                            <div className="w-12 h-px bg-[#ee4d2d]/30"></div>
                        </div>
                        <h1 className="text-8xl font-black text-white tracking-tighter leading-[0.85]">
                            What is your <span className="text-[#ee4d2d]">Masterpiece</span>?
                        </h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-12">
                        <div className="relative group">
                            <input 
                                autoFocus
                                className="w-full bg-transparent border-b-2 border-white/10 focus:border-[#ee4d2d] transition-all py-8 text-4xl font-bold text-white text-center placeholder-white/10 focus:outline-none"
                                placeholder="A neon noir chase through rainy Tokyo..."
                                value={intent}
                                onChange={(e) => setIntent(e.target.value)}
                            />
                            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-focus-within:w-full bg-[#ee4d2d] transition-all duration-700"></div>
                        </div>

                        <div className="flex items-center justify-center gap-6">
                            {formats.map(f => (
                                <button 
                                    key={f.ratio}
                                    type="button"
                                    onClick={() => setRatio(f.ratio)}
                                    className={`flex flex-col items-center gap-3 p-6 rounded-3xl transition-all border-2 ${
                                        ratio === f.ratio 
                                        ? 'bg-white text-black border-white shadow-[0_0_50px_rgba(255,255,255,0.1)]' 
                                        : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10'
                                    }`}
                                >
                                    <f.icon className="w-6 h-6" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{f.label}</span>
                                </button>
                            ))}
                        </div>

                        <button 
                            type="submit"
                            disabled={!intent.trim()}
                            className="group flex items-center gap-4 px-12 py-6 bg-white text-black rounded-full text-xl font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-20"
                        >
                            Start Production
                            <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                        </button>
                    </form>
                </div>
            )}
        </div>
    </div>
  );
};
