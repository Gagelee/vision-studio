
import React, { useState } from 'react';
import { ElementType, Shot, ShotVersion, AspectRatio, ModelRuntimeSettings, Story } from '../../types';
import { generateImageFromPrompt, type ImageReference } from '../../lib/ai/image/generate';
import { buildShotKeyframePrompt } from '../../lib/ai/prompts';
import { selectContactSheetPanelCount } from '../../lib/ai/prompts/image';
import { ChevronLeft, Play, RefreshCw, Layers, MonitorPlay, Maximize2, Minimize2, Download, ChevronDown, ChevronUp, Info, ChevronRight } from 'lucide-react';
import {
  getCharacterActiveAvatarUrl,
  getLocationActivePreviewUrl,
  getLookActivePreviewUrl,
  resolveShotActiveVideo,
} from '../../lib/ai/assetRefs';
import { openLightbox } from '../../lib/ui/lightboxStore';

interface ShotEditorProps {
  shot: Shot;
  onUpdateShot: (updatedShot: Shot) => void;
  onBack: () => void;
  onStartProduction?: () => void;
  story?: Story;
  aspectRatio?: AspectRatio;
  isImmersive?: boolean;
  onToggleImmersive?: () => void;
  imageSettings?: ModelRuntimeSettings;
}

export const ShotEditor: React.FC<ShotEditorProps> = ({
  shot,
  onUpdateShot,
  onBack,
  onStartProduction,
  story,
  aspectRatio = '16:9',
  isImmersive,
  onToggleImmersive,
  imageSettings,
}) => {
  const allVersions = Array.isArray(shot.versions) ? shot.versions.filter(Boolean) : [];
  const nonPlaceholderVersions = allVersions.filter((v) => String(v?.type || '') !== 'placeholder');
  const displayVersions = nonPlaceholderVersions.length ? nonPlaceholderVersions : allVersions;
  const activeVersion =
    displayVersions.find((v) => v.id === shot.activeVersionId) || displayVersions[displayVersions.length - 1] || null;
  const isPlaceholderActive = String(activeVersion?.type || '') === 'placeholder';
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [versionInfo, setVersionInfo] = useState<ShotVersion | null>(null);
  const assetStatus = shot.assetState?.status;
  const isBatchGenerating = assetStatus === 'running' || assetStatus === 'queued';
  const isBusyGenerating = isGenerating || isBatchGenerating;
  const productionStatus = shot.production?.status;
  const isProducingVideo = productionStatus === 'running' || productionStatus === 'queued';
  const activeVideoState = resolveShotActiveVideo(shot, { allowLegacyUnboundFallback: true });
  const scopedVideoVariants = activeVideoState.variants;
  const activeVideoVariant = activeVideoState.activeVariant;
  const activeVideoUrl = String(activeVideoVariant?.videoUrl || '').trim();
  const activeVideoIndex = scopedVideoVariants.findIndex((v) => v.id === activeVideoVariant?.id);

  const selectVideoVariant = (variantId: string) => {
    const hit = scopedVideoVariants.find((v) => v.id === variantId);
    if (!hit) return;
    onUpdateShot({
      ...shot,
      production: {
        ...shot.production,
        activeVariantId: hit.id,
        videoUrl: hit.videoUrl,
      },
    });
  };

  const shiftVideoVariant = (direction: 'prev' | 'next') => {
    if (scopedVideoVariants.length <= 1) return;
    const cur = activeVideoIndex >= 0 ? activeVideoIndex : scopedVideoVariants.length - 1;
    const next =
      direction === 'prev'
        ? (cur - 1 + scopedVideoVariants.length) % scopedVideoVariants.length
        : (cur + 1) % scopedVideoVariants.length;
    selectVideoVariant(scopedVideoVariants[next].id);
  };

  const handleVersionSelect = (versionId: string) => {
    const version = shot.versions.find(v => v.id === versionId);
    if (version) {
        onUpdateShot({
            ...shot,
            activeVersionId: versionId,
            thumbnailUrl: version.imageUrl 
        });
    }
  };

  const ratioStyles: Record<AspectRatio, string> = {
    '16:9': 'aspect-video max-w-6xl',
    '9:16': 'aspect-[9/16] max-h-[80vh]',
    '1:1': 'aspect-square max-h-[70vh]',
    '4:5': 'aspect-[4/5] max-h-[75vh]',
  };

  const handleGenerateVersion = async () => {
    if (isBusyGenerating) return;
    const startedAt = Date.now();
    onUpdateShot({
      ...shot,
      aiState: 'rendering',
      aiPrompt: 'MANUAL',
      assetState: {
        ...(shot.assetState || { status: 'idle', attempts: 0 }),
        status: 'running',
        lastError: '',
        lastAttemptAt: startedAt,
        attempts: (shot.assetState?.attempts || 0) + 1,
      },
    });
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const settings =
        imageSettings || {
          provider: 'mock',
          model: 'mock',
          temperature: 0.5,
        };

      const isDone = (st: any) => st && st.status === 'done';

      const loc = story?.locations?.find((l) => l.id === shot.locationId);
      const locUrl = loc ? getLocationActivePreviewUrl(loc) : '';
      if (!loc || !isDone((loc as any).assetState) || !locUrl) {
        throw new Error('Blocked: Environment asset not generated yet. Please generate the environment first.');
      }

      const references: ImageReference[] = [];
      references.push({ url: locUrl, label: `environment: ${loc.name}` });

      const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
      const castArr = Array.isArray(cast) ? cast : [];
      const isLookBoundToAvatar = (look: any, avatarVersionId: string) => {
        if (!look || !avatarVersionId) return false;
        const versions = Array.isArray(look.previewVersions) ? look.previewVersions : [];
        const activeId = String(look.activePreviewVersionId || '').trim();
        if (!activeId) return false;
        const hit = versions.find((v: any) => String(v?.id || '') === activeId);
        return String(hit?.metadata?.sourceAvatarVersionId || '') === String(avatarVersionId);
      };

      for (const c of castArr.slice(0, 4)) {
        const charId = String(c?.id || '');
        if (!charId) continue;
        const activeLookId = String(c?.activeLookId || '');
        const master = story?.characters?.find((x) => x.id === charId);
        const avatarUrl = master ? getCharacterActiveAvatarUrl(master, { activeOnly: true }) : '';
        if (!master || !isDone((master as any).assetState) || !avatarUrl) {
          throw new Error(`Blocked: Active avatar missing for ${master?.name || charId}. Please select/generate an active avatar variant.`);
        }
        if (activeLookId) {
          const look = master.looks?.find((lk) => lk.id === activeLookId);
          const avatarVersionId = String((master as any).activeAvatarVersionId || '').trim();
          const bound = isLookBoundToAvatar(look, avatarVersionId);
          const lookUrl = bound ? getLookActivePreviewUrl(look, { activeOnly: true }) : '';
          if (!look || !isDone((look as any).assetState) || !lookUrl) {
            if (!bound) {
              throw new Error(
                `Blocked: Look is not bound to the active avatar for ${master.name}${look?.name ? ` (${look.name})` : ''}. Generate a look variant for the current avatar.`
              );
            }
            throw new Error(
              `Blocked: Active look variant missing for ${master.name}${look?.name ? ` (${look.name})` : ''}. Please select/generate an active look variant.`
            );
          }
          if (references.length < 6) references.push({ url: lookUrl, label: `character: ${master.name} (${look.name})` });
        } else {
          if (references.length < 6) references.push({ url: avatarUrl, label: `character: ${master.name} (base)` });
        }
      }

      const styleGuide = story ? String((story as any).styleGuide || '').trim() : '';
      const panelCount = selectContactSheetPanelCount(Number(shot.duration || 0));
      const castNames = (castArr || [])
        .map((c: any) => {
          const master = story?.characters?.find((x) => x.id === String(c?.id || ''));
          if (!master) return null;
          const activeLookId = String(c?.activeLookId || '');
          const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : master.looks?.[0];
          return `${master.name}${look?.name ? ` (${look.name})` : ''}`;
        })
        .filter(Boolean) as string[];

      const fullPrompt = buildShotKeyframePrompt({
        shot,
        styleGuide,
        environmentName: loc?.name,
        environmentStyle: String(loc?.visualStyle || '').trim(),
        castNames,
      });

      const img = await generateImageFromPrompt({
        prompt: fullPrompt,
        settings,
        aspectRatio,
        references,
        promptSpec: {
          kind: 'shot',
          styleGuide,
          aspectRatio,
          keyframeMode: 'contact_sheet',
          panelCount,
          grid: panelCount === 9 ? '3x3' : '2x2',
          environment: loc ? { name: loc.name, description: loc.description, visualStyle: loc.visualStyle } : null,
          cast: castNames,
          shot: {
            id: shot.id,
            description: shot.description,
            timeOfDay: shot.timeOfDay,
            duration: shot.duration,
            script: String((shot.elements as any)?.SCRIPT?.prompt || '').trim(),
            camera: String((shot.elements as any)?.CAMERA?.prompt || '').trim(),
            lighting: String((shot.elements as any)?.LIGHTING?.prompt || '').trim(),
            audio: String((shot.elements as any)?.AUDIO?.prompt || '').trim(),
          },
        },
        composePrompt: true,
        composeSettings: { model: 'gemini-3-pro-preview', temperature: 0.2, maxOutputTokens: 512 },
        strict: true,
        requireAllReferences: references.length > 0,
      });
      const versionMeta = {
        prompt: fullPrompt,
        references,
        settings: {
          provider: settings.provider,
          model: settings.model,
          temperature: settings.temperature,
        },
        aspectRatio,
      };

      const now = Date.now();
      const existing = Array.isArray(shot.versions) ? shot.versions : [];
      const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');

      // If we only have a placeholder base, replace it so placeholders never show up as variants.
      if (existing.length === 1 && cleaned.length === 0 && existing[0]) {
        const base = existing[0];
        onUpdateShot({
          ...shot,
          versions: [{ ...base, imageUrl: img.imageUrl, createdAt: now, type: 'base', metadata: versionMeta }],
          activeVersionId: base.id,
          thumbnailUrl: img.imageUrl,
          aiState: 'idle',
          aiPrompt: '',
          assetState: {
            ...(shot.assetState || { status: 'idle' }),
            status: 'done',
            lastError: '',
            lastAttemptAt: startedAt,
          },
        });
        return;
      }

      const baseList = cleaned.length ? cleaned : existing;
      const newVersion: ShotVersion = {
        id: `v${baseList.length + 1}-${now}`,
        imageUrl: img.imageUrl,
        createdAt: now,
        type: baseList.length ? 'variation' : 'base',
        metadata: versionMeta,
      };

      onUpdateShot({
        ...shot,
        versions: [...baseList, newVersion],
        activeVersionId: newVersion.id,
        thumbnailUrl: newVersion.imageUrl,
        aiState: 'idle',
        aiPrompt: '',
        assetState: {
          ...(shot.assetState || { status: 'idle' }),
          status: 'done',
          lastError: '',
          lastAttemptAt: startedAt,
        },
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setGenerationError(err);
      onUpdateShot({
        ...shot,
        aiState: 'idle',
        aiPrompt: '',
        assetState: {
          ...(shot.assetState || { status: 'idle' }),
          status: 'error',
          lastError: err,
          lastAttemptAt: startedAt,
        },
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className={`flex flex-col bg-zinc-950 ${isImmersive ? 'fixed inset-0 z-[50] h-full' : 'flex-1 min-h-0'}`}>
      {/* Top Bar / Navigation */}
      <div className={`h-16 border-b border-white/5 flex items-center justify-between px-6 transition-all shrink-0 ${isImmersive ? 'bg-black/90 backdrop-blur-md' : 'bg-zinc-900/50'}`}>
        <div className="flex items-center gap-6">
            <button 
                onClick={onBack}
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg"
            >
                <ChevronLeft className="w-4 h-4" />
                Back
            </button>
            <div className="h-6 w-px bg-white/10"></div>
            <div>
                <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                    Shot #{shot.sequence}
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    <span className="text-zinc-500 font-normal truncate max-w-[300px]">{shot.description}</span>
                </h2>
            </div>
        </div>
        <div className="flex items-center gap-3">
            <label className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-mono flex items-center gap-1.5">
                <span className="uppercase tracking-wider">Dur</span>
                <select
                  value={[4, 6, 8].includes(Number(shot.duration)) ? shot.duration : 4}
                  onChange={(e) => onUpdateShot({ ...shot, duration: Number(e.target.value) })}
                  className="bg-transparent text-zinc-200 text-[10px] font-mono outline-none"
                >
                  <option value={4}>4s</option>
                  <option value={6}>6s</option>
                  <option value={8}>8s</option>
                </select>
            </label>
            <span className="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[10px] text-indigo-400 font-bold">
                {aspectRatio}
            </span>
            {onToggleImmersive && (
                <button 
                    onClick={onToggleImmersive} 
                    className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                    title={isImmersive ? "Exit Fullscreen" : "Fullscreen Preview"}
                >
                    {isImmersive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
            )}
            {onStartProduction && (
              <div className="relative group">
                <button
                  onClick={onStartProduction}
                  disabled={isProducingVideo}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-colors ${
                    isProducingVideo
                      ? 'bg-[#E50914] text-white shadow-lg shadow-red-900/40 animate-[pulse_1.6s_ease-in-out_infinite] cursor-not-allowed'
                      : 'bg-[#E50914] hover:bg-[#B20710] text-white shadow-lg shadow-red-900/30'
                  }`}
                  title={isProducingVideo ? 'Generating Video' : 'Generate Video'}
                >
                  <span className="relative w-4 h-4 min-w-4 min-h-4 block">
                    <span className="absolute inset-0 rounded-full border-2 border-white/85" />
                    <span className="absolute inset-[4px] rounded-full bg-white" />
                  </span>
                </button>
                {!isProducingVideo && (
                  <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 -bottom-8 px-2 py-1 rounded-md bg-black/85 border border-white/15 text-[10px] font-bold uppercase tracking-wide text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    Start Generation
                  </div>
                )}
              </div>
            )}
             <button className="flex items-center gap-2 bg-white text-black hover:bg-zinc-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-lg shadow-white/5">
                <Download className="w-3.5 h-3.5" />
                Export Frame
            </button>
        </div>
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 relative flex items-center justify-center bg-black/80 p-8 overflow-hidden min-h-0">
        <div className="relative w-full h-full flex items-center justify-center group">
            <div className={`${ratioStyles[aspectRatio]} w-full bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 overflow-hidden relative transition-all duration-500 ease-in-out`}>
                {activeVideoUrl ? (
                    <>
                      <video
                          src={activeVideoUrl}
                          className="w-full h-full object-contain bg-black"
                          controls
                          loop
                          playsInline
                          preload="metadata"
                      />
                      {scopedVideoVariants.length > 1 && (
                        <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              shiftVideoVariant('prev');
                            }}
                            className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center hover:bg-black/75"
                            title="Previous video variant"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <div className="px-2.5 py-1 rounded-full bg-black/60 border border-white/20 text-white text-[10px] font-bold uppercase tracking-wider">
                            v{activeVideoIndex + 1}/{scopedVideoVariants.length}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              shiftVideoVariant('next');
                            }}
                            className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center hover:bg-black/75"
                            title="Next video variant"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </>
                ) : activeVersion ? (
                    isPlaceholderActive ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                        <MonitorPlay className="w-14 h-14 opacity-50" />
                        <span>Placeholder</span>
                      </div>
                    ) : (
                      <img 
                          src={activeVersion.imageUrl} 
                          alt={`Shot ${shot.sequence} - Version ${activeVersion.id}`}
                          className="w-full h-full object-contain bg-black cursor-zoom-in"
                          onClick={() => activeVersion?.imageUrl && openLightbox({ url: activeVersion.imageUrl, title: `Shot #${shot.sequence}` })}
                      />
                    )
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                        <MonitorPlay className="w-12 h-12 opacity-50" />
                        <span>No generated keyframe</span>
                    </div>
                )}

                {/* Hover play hint: only when an actual video is present, never block controls. */}
                {activeVideoUrl && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-black/10 backdrop-blur-[1px]">
                      <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-[0_0_40px_rgba(255,255,255,0.2)]">
                          <Play className="w-8 h-8 fill-current ml-2" />
                      </div>
                  </div>
                )}
            </div>
        </div>
      </div>

      {/* Bottom: Version Control Timeline */}
      <div className={`border-t border-zinc-800 bg-zinc-950 flex flex-col transition-all duration-300 ease-in-out shrink-0 ${isImmersive ? 'h-0 overflow-hidden opacity-0' : (isHistoryOpen ? 'h-64' : 'h-10')}`}>
        <div 
            className="h-10 border-b border-zinc-800 flex items-center px-4 justify-between bg-zinc-900/50 cursor-pointer hover:bg-zinc-900 transition-colors"
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
        >
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wider">
                <Layers className="w-3.5 h-3.5" />
                Version History
            </div>
            <div className="flex items-center gap-3">
                <div className="text-[10px] text-zinc-600">
                    {displayVersions.length} versions generated
                </div>
                <button className="text-zinc-500 hover:text-white">
                    {isHistoryOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                </button>
            </div>
        </div>
        
        <div className={`flex-1 pt-4 px-4 pb-10 overflow-x-auto flex items-center gap-4 custom-scrollbar transition-opacity duration-300 ${isHistoryOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            {/* Generate New Button */}
            <button 
                onClick={(e) => { e.stopPropagation(); handleGenerateVersion(); }}
                disabled={isBusyGenerating}
                className="flex-shrink-0 w-48 h-32 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center gap-2 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all group disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <div className="p-3 rounded-full bg-zinc-900 group-hover:bg-indigo-500/20 transition-colors">
                    <RefreshCw className={`w-6 h-6 ${isBusyGenerating ? 'animate-spin' : 'group-hover:animate-spin'}`} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wide">
                  {assetStatus === 'queued' ? 'Queued…' : isBusyGenerating ? 'Generating...' : isPlaceholderActive ? 'Generate' : 'Generate Variant'}
                </span>
            </button>

            {/* Version List */}
            {displayVersions.slice().reverse().map((version, index) => {
                const isActive = version.id === shot.activeVersionId;
                const versionNumber = displayVersions.length - index;
                return (
                    <div 
                        key={version.id}
                        onClick={(e) => { e.stopPropagation(); handleVersionSelect(version.id); }}
                        className={`relative flex-shrink-0 w-48 h-32 rounded-xl overflow-hidden border-2 cursor-pointer transition-all group shadow-lg ${isActive ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-zinc-800 hover:border-zinc-600'}`}
                    >
                        {String(version.type || '') === 'placeholder' ? (
                          <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600">
                            <MonitorPlay className="w-8 h-8 opacity-60" />
                          </div>
                        ) : (
                          <img
                            src={version.imageUrl}
                            className="w-full h-full object-cover cursor-zoom-in"
                            loading="lazy"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLightbox({ url: version.imageUrl, title: `Shot #${shot.sequence} (${version.id})` });
                            }}
                          />
                        )}
                        
                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-white border border-white/10">
                            v{versionNumber}
                        </div>
                        {version.metadata && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setVersionInfo(version);
                            }}
                            className="absolute top-2 right-10 z-10 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-indigo-500/80 transition-colors"
                            title="View generation details"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {displayVersions.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (displayVersions.length <= 1) return;
                              if (!window.confirm('Delete this shot variant?')) return;
                              const remaining = displayVersions.filter((v) => v.id !== version.id);
                              const nextActive = isActive ? remaining[remaining.length - 1] : displayVersions.find((v) => v.id === shot.activeVersionId);
                              if (!nextActive) return;
                              onUpdateShot({
                                ...shot,
                                versions: remaining,
                                activeVersionId: nextActive.id,
                                thumbnailUrl: nextActive.imageUrl,
                              });
                            }}
                            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-rose-500/80 transition-colors opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                            title="Delete version"
                          >
                            ✕
                          </button>
                        )}
                        
                        <div className="absolute inset-0 bg-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="bg-white text-black text-[10px] font-bold px-2 py-1 rounded shadow-lg uppercase tracking-widest">Select</span>
                        </div>
                    </div>
                );
            })}
        </div>
        {generationError && !isImmersive && (
          <div className="px-4 pb-4">
            <div className="text-xs text-rose-300/90 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-3">
              Generate failed: {generationError}
            </div>
          </div>
        )}
      </div>
      {versionInfo && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={() => setVersionInfo(null)}>
          <div
            className="w-[720px] max-w-[90vw] max-h-[80vh] overflow-hidden bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/60">
              <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">Generation Details</div>
              <button
                className="px-2 py-1 text-xs font-bold text-zinc-400 hover:text-white"
                onClick={() => setVersionInfo(null)}
              >
                Close
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh] custom-scrollbar">
              <div className="text-xs text-zinc-500">
                Version: <span className="text-zinc-200">{versionInfo.id}</span>
              </div>
              {versionInfo.metadata?.settings && (
                <div className="text-xs text-zinc-400">
                  Model: <span className="text-zinc-200">{versionInfo.metadata.settings.provider}/{versionInfo.metadata.settings.model}</span>
                  {typeof versionInfo.metadata.settings.temperature === 'number' && (
                    <span className="ml-3 text-zinc-500">Temp: {versionInfo.metadata.settings.temperature}</span>
                  )}
                </div>
              )}
              {versionInfo.metadata?.references?.length ? (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">References</div>
                  <div className="flex gap-3 overflow-x-auto no-scrollbar">
                    {versionInfo.metadata.references.map((ref, i) => (
                      <div key={`${ref.url}-${i}`} className="w-24 shrink-0">
                        <div className="w-24 h-16 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
                          <img
                            src={ref.url}
                            className="w-full h-full object-cover cursor-zoom-in"
                            onClick={() => openLightbox({ url: ref.url, title: ref.label || 'Reference' })}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-500 line-clamp-2">{ref.label || ref.url}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {versionInfo.metadata?.prompt && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Prompt</div>
                  <pre className="text-[11px] text-zinc-200 whitespace-pre-wrap bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                    {versionInfo.metadata.prompt}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
