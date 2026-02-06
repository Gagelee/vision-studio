
import React, { useMemo, useState } from 'react';
import { ModelRuntimeSettings, Story, SelectionState } from '../../types';
import { 
  Play, 
  ChevronRight,
  TrendingUp,
  Layout,
  Anchor,
  Clock,
  Sparkles,
  Clapperboard,
  Maximize,
  AlertTriangle,
  Image as ImageIcon
} from 'lucide-react';
import { generateImageFromPrompt } from '../../lib/ai/image/generate';
import { buildMasterKeyVisualPrompt } from '../../lib/ai/prompts';
import { openLightbox } from '../../lib/ui/lightboxStore';
import { isLikelyPlaceholderImageUrl } from '../../lib/ai/assetRefs';

interface ProjectDashboardProps {
  story: Story;
  onSelect: (sel: SelectionState) => void;
  onPlayCinema: () => void;
  imageSettings?: ModelRuntimeSettings;
  onUpdateStory: (updater: (prev: Story) => Story) => void;
  onToast?: (message: string, type?: 'success' | 'info') => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  story,
  onSelect,
  onPlayCinema,
  imageSettings,
  onUpdateStory,
  onToast,
}) => {
  const totalShots = story.sequences.reduce((acc, seq) => acc + seq.shots.length, 0);
  const totalDuration = story.sequences.reduce((acc, seq) => acc + seq.shots.reduce((sAcc, shot) => sAcc + shot.duration, 0), 0);
  const firstSeqId = story.sequences[0]?.id;

  const canGenerate = Boolean(imageSettings && imageSettings.provider !== 'mock');
  const [isGeneratingKv, setIsGeneratingKv] = useState(false);
  const [kvError, setKvError] = useState<string | null>(null);
  const kvStatus = (story as any)?.masterKvState?.status;
  const isKvBatchGenerating = kvStatus === 'running' || kvStatus === 'queued';
  const isKvBusy = isGeneratingKv || isKvBatchGenerating;

  const kvVersions = useMemo(() => {
    const existing = Array.isArray((story as any).keyVisualVersions) ? (story as any).keyVisualVersions : [];
    if (existing.length) return existing;
    const url = String(story.keyVisualUrl || '').trim();
    if (!url) return [];
    const createdAt = (story as any).masterKvState?.lastAttemptAt || story.createdAt || Date.now();
    const isDone = (story as any)?.masterKvState?.status === 'done';
    return [{ id: 'kv-1', imageUrl: url, createdAt, type: isDone ? 'base' : 'placeholder' }];
  }, [story]);

  const nonPlaceholderKvVersions = useMemo(() => {
    return (kvVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
  }, [kvVersions]);

  const displayKvVersions = nonPlaceholderKvVersions.length ? nonPlaceholderKvVersions : kvVersions;

  const activeKvId = useMemo(() => {
    const id = String((story as any).activeKeyVisualVersionId || '').trim();
    if (id) return id;
    return String(displayKvVersions[displayKvVersions.length - 1]?.id || '');
  }, [displayKvVersions, story]);

  const handleSelectKvVariant = (versionId: string) => {
    const v = (kvVersions || []).find((x: any) => String(x?.id || '') === String(versionId));
    if (!v?.imageUrl) return;
    const isPlaceholder = String(v?.type || '') === 'placeholder' || isLikelyPlaceholderImageUrl(String(v.imageUrl));
    onUpdateStory((prev) => ({
      ...prev,
      keyVisualUrl: String(v.imageUrl),
      keyVisualVersions: kvVersions as any,
      activeKeyVisualVersionId: String(versionId) as any,
      masterKvState: {
        ...(prev as any).masterKvState,
        status: isPlaceholder ? ((prev as any).masterKvState?.status || 'idle') : 'done',
        lastError: isPlaceholder ? 'Active KV is a placeholder; generate a real Master KV.' : '',
      },
    }));
    onToast?.(isPlaceholder ? 'Placeholder KV selected (won’t unblock assets)' : 'Master KV set active', 'info');
  };

  const handleGenerateKvVariant = async () => {
    if (!canGenerate || isKvBusy) return;
    setKvError(null);
    setIsGeneratingKv(true);
    const now = Date.now();
    onUpdateStory((prev) => ({
      ...prev,
      masterKvState: {
        ...(prev as any).masterKvState,
        status: 'running',
        lastAttemptAt: now,
        attempts: ((prev as any).masterKvState?.attempts || 0) + 1,
      },
    }));

    try {
      const baseExisting = Array.isArray((story as any).keyVisualVersions) ? (story as any).keyVisualVersions : [];
      const baseSeed =
        !baseExisting.length && story.keyVisualUrl
          ? [{ id: `kv-seed-${now}`, imageUrl: String(story.keyVisualUrl), createdAt: now, type: 'placeholder' }]
          : [];
      const baseVersions = baseExisting.length ? baseExisting : baseSeed;
      const cleanedBase = (baseVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');

      const refs = story.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'current master kv' }] : [];
      const out = await generateImageFromPrompt({
        prompt: buildMasterKeyVisualPrompt({ intent: story.intent, logline: story.logline, styleGuide: (story as any).styleGuide } as any),
        settings: imageSettings!,
        aspectRatio: story.aspectRatio,
        references: refs,
        strict: true,
        requireAllReferences: refs.length > 0,
      });

      const id = `kv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const createdAt = Date.now();
      const nextVersions = [
        ...cleanedBase,
        { id, imageUrl: out.imageUrl, createdAt, type: cleanedBase.length ? 'variation' : 'base' },
      ];

      onUpdateStory((prev) => ({
        ...prev,
        keyVisualUrl: out.imageUrl,
        keyVisualVersions: nextVersions as any,
        activeKeyVisualVersionId: id as any,
        masterKvState: {
          ...(prev as any).masterKvState,
          status: 'done',
          lastError: '',
          lastAttemptAt: createdAt,
        },
      }));
      onToast?.('Master KV generated', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setKvError(msg);
      onUpdateStory((prev) => ({
        ...prev,
        masterKvState: {
          ...(prev as any).masterKvState,
          status: 'error',
          lastError: msg,
          lastAttemptAt: Date.now(),
        },
      }));
      onToast?.('Master KV generation failed', 'info');
    } finally {
      setIsGeneratingKv(false);
    }
  };

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
            onClick={() => story.keyVisualUrl && openLightbox({ url: story.keyVisualUrl, title: 'Master KV' })}
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

        {/* Master KV */}
        <section className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-[40px] overflow-hidden shadow-sm">
          <div className="p-10 flex items-start justify-between gap-8 border-b border-zinc-100 dark:border-zinc-800/50">
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 flex items-center gap-3">
                <Anchor className="w-5 h-5 text-[#ee4d2d]" />
                Master Key Visual
              </div>
              <div className="mt-3 text-zinc-700 dark:text-zinc-200 font-medium max-w-2xl leading-relaxed">
                This is the global style anchor. All environments, casting, and storyboard keyframes should reference the active Master KV variant.
              </div>
              {(story as any).masterKvState?.status === 'error' && (
                <div className="mt-4 text-xs text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-3 flex items-start gap-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="break-words">
                    <div className="font-bold mb-0.5">KV generation failed</div>
                    <div className="opacity-80">{String((story as any).masterKvState?.lastError || kvError || '')}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 flex flex-col items-end gap-3">
              <button
                onClick={handleGenerateKvVariant}
                disabled={!canGenerate || isKvBusy}
                className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${
                  !canGenerate
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-200 dark:border-zinc-700'
                    : 'bg-[#ee4d2d] hover:bg-[#f05d40] text-white'
                }`}
                title={!canGenerate ? 'Image provider is Mock' : story.keyVisualUrl ? 'Generate KV variant' : 'Generate Master KV'}
              >
                <Sparkles className={`w-4 h-4 ${isKvBusy ? 'animate-pulse' : ''}`} />
                {kvStatus === 'queued' ? 'Queued…' : isKvBusy ? 'Generating…' : story.keyVisualUrl ? 'Generate Variant' : 'Generate KV'}
              </button>
              <div className="text-[10px] font-mono text-zinc-400">
                Status: {(story as any).masterKvState?.status || 'idle'}
              </div>
            </div>
          </div>

          <div className="p-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div className="relative aspect-video rounded-3xl overflow-hidden bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-2xl">
              {story.keyVisualUrl ? (
                <img
                  src={story.keyVisualUrl}
                  className="w-full h-full object-cover cursor-zoom-in"
                  alt="Master KV"
                  onClick={() => story.keyVisualUrl && openLightbox({ url: story.keyVisualUrl, title: 'Master KV' })}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400">
                  <ImageIcon className="w-8 h-8" />
                  <div className="mt-3 text-xs font-bold uppercase tracking-widest">No Master KV</div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Variants</div>
              {displayKvVersions.length <= 1 ? (
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  Generate more variants to audition different global art directions, then click one to set active.
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto no-scrollbar">
                  {displayKvVersions.slice().reverse().map((v: any) => {
                    const isActive = String(v.id) === String(activeKvId);
                    return (
                      <button
                        key={String(v.id)}
                        onClick={() => handleSelectKvVariant(String(v.id))}
                        className={`relative w-40 aspect-video rounded-2xl overflow-hidden border-2 shrink-0 transition-all ${
                          isActive ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600'
                        }`}
                        title={isActive ? 'Active' : 'Set active'}
                      >
                        <img
                          src={String(v.imageUrl)}
                          className="w-full h-full object-cover"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLightbox({ url: String(v.imageUrl), title: `Master KV Variant` });
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
        
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
                                            <img
                                              src={s.thumbnailUrl}
                                              className="w-full h-full object-cover cursor-zoom-in"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (s.thumbnailUrl) openLightbox({ url: s.thumbnailUrl, title: `Shot #${s.sequence}` });
                                              }}
                                            />
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
