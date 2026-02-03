
import React, { useMemo, useRef, useState } from 'react';
import { Sparkles, ArrowRight, Smartphone, Tv, Instagram, Clapperboard, Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AgentPlan, AiSettings, AspectRatio, Story } from '../../types';
import { scaffoldProjectWithSettings } from '../../lib/ai/agent/scaffold';
import { applyAssetError, applyAssetResult, applyAssetStart, buildAssetJobs, executeAssetJobs, getJobLabel } from '../../lib/ai/assetExecutor';

interface ProjectCreationWizardProps {
  aiSettings: AiSettings;
  onComplete: (project: Story, plan: AgentPlan, debug?: any) => void;
  onCancel: () => void;
}

export const ProjectCreationWizard: React.FC<ProjectCreationWizardProps> = ({ aiSettings, onComplete, onCancel }) => {
  const [intent, setIntent] = useState('');
  const [ratio, setRatio] = useState<AspectRatio>('16:9');
  const [isProcessing, setIsProcessing] = useState(false);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'scaffold' | 'assets'>('scaffold');
  const [assetTotal, setAssetTotal] = useState(0);
  const [assetDone, setAssetDone] = useState(0);
  const [assetErrors, setAssetErrors] = useState(0);
  const [assetCurrent, setAssetCurrent] = useState<string>('');
  const storyRef = useRef<Story | null>(null);

  const formats: { label: string; ratio: AspectRatio; icon: any }[] = [
    { label: 'Cinema', ratio: '16:9', icon: Tv },
    { label: 'Social', ratio: '9:16', icon: Smartphone },
    { label: 'Square', ratio: '1:1', icon: Instagram },
    { label: 'Portrait', ratio: '4:5', icon: Clapperboard },
  ];

  const progressPct = useMemo(() => {
    if (!isProcessing) return 0;
    if (phase === 'scaffold') return 30;
    const denom = Math.max(1, assetTotal);
    return 30 + Math.round((assetDone / denom) * 70);
  }, [assetDone, assetTotal, isProcessing, phase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intent.trim()) return;
    setIsProcessing(true);
    setPlan(null);
    setError(null);
    setPhase('scaffold');
    setAssetTotal(0);
    setAssetDone(0);
    setAssetErrors(0);
    setAssetCurrent('');
    storyRef.current = null;

    try {
      const res = await scaffoldProjectWithSettings({ intent, aspectRatio: ratio, aiSettings });
      storyRef.current = res.story;

      setPlan(res.plan);

      // Auto-generate assets during creation so the progress UI is honest and users understand the wait.
      let total = 0;
      let done = 0;
      let errors = 0;

      if (aiSettings.image.provider !== 'mock') {
        setPhase('assets');
        const jobs = buildAssetJobs(res.story, 'all');
        total = jobs.length;
        setAssetTotal(jobs.length);

        if (jobs.length > 0) {
          await executeAssetJobs({
            jobs,
            settings: aiSettings.image,
            aspectRatio: res.story.aspectRatio,
            concurrency: 2,
            getStoryForRefs: () => storyRef.current,
            onEvent: (ev) => {
              const currentStory = storyRef.current || res.story;
              if (ev.type === 'start') {
                storyRef.current = applyAssetStart(currentStory, ev.job);
                setAssetCurrent(getJobLabel(ev.job, storyRef.current));
                return;
              }
              if (ev.type === 'success') {
                storyRef.current = applyAssetResult(currentStory, ev.job, ev.imageUrl);
                done = ev.done;
                setAssetDone(ev.done);
                setAssetCurrent(getJobLabel(ev.job, storyRef.current));
                return;
              }
              // error
              storyRef.current = applyAssetError(currentStory, ev.job);
              done = ev.done;
              errors += 1;
              setAssetDone(ev.done);
              setAssetErrors((n) => n + 1);
              setAssetCurrent(getJobLabel(ev.job, storyRef.current));
            },
          });
        }
      }

      const finalStory = storyRef.current || res.story;
      onComplete(finalStory, res.plan, {
        ...res.debug,
        assets: { total, done, errors },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsProcessing(false);
    }
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
	                            {phase === 'scaffold'
                                ? 'Scaffolding story architecture, casting performers, and 置景 (Sets) for your masterwork.'
                                : `Generating assets (${assetDone}/${Math.max(1, assetTotal)})…`}
	                        </p>
	                    </div>
                    {error && (
                        <div className="max-w-xl mx-auto p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                            <div className="text-left">
                                <div className="font-bold mb-1">Scaffolding failed</div>
                                <div className="opacity-80 break-words">{error}</div>
                                <button
                                  onClick={() => setIsProcessing(false)}
                                  className="mt-3 text-[11px] font-black uppercase tracking-widest text-rose-200 hover:underline"
                                >
                                  Back
                                </button>
                            </div>
                        </div>
                    )}
                    {plan && (
                        <div className="max-w-xl mx-auto space-y-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-white/30">Plan</div>
                            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-4 text-left space-y-2">
                                <div className="text-white/80 text-sm font-medium mb-2">{plan.summary}</div>
                                <div className="space-y-2">
                                    {plan.steps.map(step => (
                                        <div key={step.id} className="flex items-center gap-3 text-sm text-white/70">
                                            {step.status === 'done' ? (
                                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                            ) : step.status === 'error' ? (
                                                <AlertTriangle className="w-4 h-4 text-rose-400" />
                                            ) : (
                                                <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                                            )}
                                            <span>{step.title}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
	                    <div className="flex flex-col gap-2 max-w-xs mx-auto">
	                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
	                            <div
                                  className="h-full bg-[#ee4d2d] transition-all duration-500"
                                  style={{ width: `${progressPct}%` }}
                                />
	                        </div>
	                        <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
	                            <span>Analysis</span>
	                            <span>{phase === 'assets' ? `Assets ${assetDone}/${Math.max(1, assetTotal)}` : 'Scaffolding'}</span>
	                        </div>
	                          {phase === 'assets' && assetCurrent && (
	                            <div className="text-[11px] text-white/30 font-mono break-words">
	                              {assetCurrent}{assetErrors ? ` (errors: ${assetErrors})` : ''}
	                            </div>
	                          )}
                          <div className="text-[10px] text-white/20 font-mono">
                            Image: {aiSettings.image.provider}/{aiSettings.image.model}
                            {aiSettings.image.provider === 'mock' ? ' (mock — assets will NOT be generated)' : ''}
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
