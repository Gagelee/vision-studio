
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Image as ImageIcon,
  Upload
} from 'lucide-react';
import { generateImageFromPrompt } from '../../lib/ai/image/generate';
import { buildMasterKeyVisualPrompt } from '../../lib/ai/prompts';
import { openLightbox } from '../../lib/ui/lightboxStore';
import { isLikelyPlaceholderImageUrl } from '../../lib/ai/assetRefs';
import { runDirectorCommand } from '../../lib/ai/agent/direct';
import {
  buildStyleGuideSynthesisMessage,
  extractStyleGuideCandidate,
  mergeKvPromptWithReferenceHints,
} from '../../lib/ai/kvFlow';

interface ProjectDashboardProps {
  story: Story;
  onSelect: (sel: SelectionState) => void;
  onPlayCinema: () => void;
  imageSettings?: ModelRuntimeSettings;
  directSettings?: ModelRuntimeSettings;
  onUpdateStory: (updater: (prev: Story) => Story) => void;
  onAcceptProposedStyleGuide?: (args: { styleGuide: string; regenerateAssets: boolean }) => void;
  onUpdateAssets?: (activeKvVersionId: string) => void;
  kvActionRequest?: { id: number; type: 'generate' | 'accept' | 'discard' | 'regenerate' } | null;
  onKvActionHandled?: (id: number) => void;
  onToast?: (message: string, type?: 'success' | 'info') => void;
}

export const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  story,
  onSelect,
  onPlayCinema,
  imageSettings,
  directSettings,
  onUpdateStory,
  onAcceptProposedStyleGuide,
  onUpdateAssets,
  kvActionRequest,
  onKvActionHandled,
  onToast,
}) => {
  const totalShots = story.sequences.reduce((acc, seq) => acc + seq.shots.length, 0);
  const totalDuration = story.sequences.reduce((acc, seq) => acc + seq.shots.reduce((sAcc, shot) => sAcc + shot.duration, 0), 0);
  const firstSeqId = story.sequences[0]?.id;

  const canGenerate = Boolean(imageSettings && imageSettings.provider !== 'mock');
  const canUseDirector = Boolean(directSettings && directSettings.provider !== 'mock');
  const [isGeneratingKv, setIsGeneratingKv] = useState(false);
  const [kvError, setKvError] = useState<string | null>(null);
  const kvStatus = (story as any)?.masterKvState?.status;
  const isKvBatchGenerating = kvStatus === 'running' || kvStatus === 'queued';
  const isKvBusy = isGeneratingKv || isKvBatchGenerating;
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  const referenceImages = Array.isArray((story as any)?.referenceImages) ? (story as any).referenceImages : [];
  const useReferenceImages = (story as any)?.referenceMode !== 'off';
  const maxReferenceImages = 4;
  const [styleSynthesisError, setStyleSynthesisError] = useState<string | null>(null);
  const storyProposal = String((story as any)?.proposedStyleGuide || '');
  const [proposalDraft, setProposalDraft] = useState(storyProposal);

  useEffect(() => {
    setProposalDraft(storyProposal);
  }, [story.id, storyProposal]);

  useEffect(() => {
    if (!kvActionRequest?.id) return;
    let cancelled = false;
    const run = async () => {
      if (kvActionRequest.type === 'generate') {
        await handleGenerateKvVariant();
      } else if (kvActionRequest.type === 'accept') {
        handleAcceptProposedStyleGuide();
      } else if (kvActionRequest.type === 'discard') {
        handleIgnoreProposedStyleGuide();
      } else if (kvActionRequest.type === 'regenerate') {
        handleIgnoreProposedStyleGuide();
        await handleGenerateKvVariant();
      }
      if (!cancelled) onKvActionHandled?.(kvActionRequest.id);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [kvActionRequest?.id]);

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
  const syncedKvId = String((story as any)?.assetsSyncedKvVersionId || activeKvId || '').trim();
  const hasKvDrift = Boolean(activeKvId) && String(activeKvId) !== String(syncedKvId);
  const proposalSourceKvId = String((story as any)?.proposedStyleGuideSourceKvVersionId || '').trim();
  const showProposalCta =
    Boolean(proposalSourceKvId) &&
    String(proposalSourceKvId) === String(activeKvId) &&
    Boolean(String(proposalDraft || storyProposal || '').trim());
  const activeKvVersion =
    (displayKvVersions || []).find((v: any) => String(v?.id || '') === String(activeKvId || '')) ||
    (displayKvVersions || [])[displayKvVersions.length - 1];
  const activeKvPrompt = String((activeKvVersion as any)?.metadata?.prompt || '').trim();

  const handleSelectKvVariant = (versionId: string) => {
    const v = (kvVersions || []).find((x: any) => String(x?.id || '') === String(versionId));
    if (!v?.imageUrl) return;
    const isPlaceholder = String(v?.type || '') === 'placeholder' || isLikelyPlaceholderImageUrl(String(v.imageUrl));
    const variantProposal = String((v as any)?.metadata?.proposedStyleGuide || '').trim();
    onUpdateStory((prev) => ({
      ...prev,
      keyVisualUrl: String(v.imageUrl),
      keyVisualVersions: kvVersions as any,
      activeKeyVisualVersionId: String(versionId) as any,
      proposedStyleGuide: variantProposal,
      proposedStyleGuideUpdatedAt: variantProposal ? Date.now() : (prev as any).proposedStyleGuideUpdatedAt,
      proposedStyleGuideSourceKvVersionId: variantProposal ? String(versionId) : '',
      masterKvState: {
        ...(prev as any).masterKvState,
        status: isPlaceholder ? ((prev as any).masterKvState?.status || 'idle') : 'done',
        lastError: isPlaceholder ? 'Active KV is a placeholder; generate a real Master KV.' : '',
      },
    }));
    setProposalDraft(variantProposal);
    onToast?.(isPlaceholder ? 'Placeholder KV selected (won’t unblock assets)' : 'Master KV set active', 'info');
  };

  const handleDeleteKvVariant = (versionId: string) => {
    const all = Array.isArray((story as any).keyVisualVersions) ? (story as any).keyVisualVersions : kvVersions;
    const remaining = (all || []).filter((v: any) => String(v?.id || '') !== String(versionId));
    if (!remaining.length) {
      onToast?.('Cannot delete the last KV variant', 'info');
      return;
    }
    const activeBefore = String((story as any).activeKeyVisualVersionId || '');
    const deletingActive = activeBefore === String(versionId);
    const nextActive = deletingActive ? remaining[remaining.length - 1] : remaining.find((v: any) => String(v?.id || '') === activeBefore) || remaining[remaining.length - 1];
    onUpdateStory((prev) => ({
      ...prev,
      keyVisualVersions: remaining as any,
      activeKeyVisualVersionId: String(nextActive?.id || '') as any,
      keyVisualUrl: String(nextActive?.imageUrl || prev.keyVisualUrl || ''),
      assetsSyncedKvVersionId:
        String((prev as any).assetsSyncedKvVersionId || '') === String(versionId)
          ? String(nextActive?.id || '')
          : String((prev as any).assetsSyncedKvVersionId || ''),
      proposedStyleGuide:
        String((prev as any).proposedStyleGuideSourceKvVersionId || '') === String(versionId) ? '' : String((prev as any).proposedStyleGuide || ''),
      proposedStyleGuideUpdatedAt: Date.now(),
      proposedStyleGuideSourceKvVersionId:
        String((prev as any).proposedStyleGuideSourceKvVersionId || '') === String(versionId)
          ? ''
          : String((prev as any).proposedStyleGuideSourceKvVersionId || ''),
    }));
    onToast?.('KV variant deleted', 'info');
  };

  const handleUpdateAssets = () => {
    if (!onUpdateAssets || !activeKvId) return;
    onUpdateAssets(String(activeKvId));
  };

  const handleGenerateKvVariant = async () => {
    if (!canGenerate || isKvBusy) return;
    setKvError(null);
    setStyleSynthesisError(null);
    setIsGeneratingKv(true);
    const now = Date.now();
    onUpdateStory((prev) => ({
      ...prev,
      masterKvState: {
        ...(prev as any).masterKvState,
        status: 'running',
        lastAttemptAt: now,
        attempts: ((prev as any).masterKvState?.attempts || 0) + 1,
        pipelineTaskId: '',
        pipelineStatusUrl: '',
        pipelineUpdatedAt: now,
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

      const uploadedRefs = useReferenceImages
        ? referenceImages
            .slice(0, maxReferenceImages)
            .map((r: any) => ({ url: String(r?.url || ''), label: r?.name ? String(r.name) : 'master kv reference' }))
            .filter((r: any) => r.url)
        : [];
      const fallbackRefs = uploadedRefs.length === 0 && story.keyVisualUrl ? [{ url: story.keyVisualUrl, label: 'current master kv' }] : [];
      const refs = uploadedRefs.length ? uploadedRefs : fallbackRefs;

      const basePromptForKv = buildMasterKeyVisualPrompt({
        intent: story.intent,
        logline: story.logline,
        styleGuide: (story as any).styleGuide,
      } as any);
      let promptForKv = basePromptForKv;

      if (uploadedRefs.length && useReferenceImages && canUseDirector) {
        const promptRes = await runDirectorCommand({
          message:
            'Summarize current story intent + uploaded Master KV references into concise composition hints (subject/framing/mood) for a single master key visual. Return only hints text. No actions.',
          selection: { type: 'story', id: story.id },
          story,
          settings: directSettings!,
          allowSingleFallback: false,
          useFunctionCalling: Boolean((directSettings as any)?.useFunctionCalling),
        });
        const distilled = String(promptRes?.reply || '').trim();
        if (distilled) promptForKv = mergeKvPromptWithReferenceHints(basePromptForKv, distilled);
      }

      const out = await generateImageFromPrompt({
        prompt: promptForKv,
        settings: imageSettings!,
        aspectRatio: story.aspectRatio,
        references: refs,
        strict: true,
        requireAllReferences: false,
        async: true,
        onTaskAccepted: ({ taskId, statusUrl }) => {
          const nowTs = Date.now();
          onUpdateStory((prev) => ({
            ...prev,
            masterKvState: {
              ...(prev as any).masterKvState,
              status: 'queued',
              pipelineTaskId: String(taskId || '').trim(),
              pipelineStatusUrl: String(statusUrl || '').trim(),
              pipelineUpdatedAt: nowTs,
            },
          }));
        },
      });

      const refUrls = new Set(refs.map((r: any) => String(r?.url || '').trim()).filter(Boolean));
      if (refUrls.has(String(out.imageUrl || '').trim())) {
        throw new Error('Generated KV matches a reference image. Please retry with different references.');
      }

      const id = `kv-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const createdAt = Date.now();
      const promptUsed = String(out?.debug?.promptUsed || out?.debug?.promptUsedPreview || promptForKv || '').slice(0, 4000);

      let proposedStyleGuide = '';
      if (canUseDirector) {
        const storyForStyle = { ...story, keyVisualUrl: out.imageUrl } as Story;
        const styleRes = await runDirectorCommand({
          message: buildStyleGuideSynthesisMessage(promptUsed),
          selection: { type: 'story', id: story.id },
          story: storyForStyle,
          settings: directSettings!,
          allowSingleFallback: false,
          useFunctionCalling: Boolean((directSettings as any)?.useFunctionCalling),
        });
        proposedStyleGuide = extractStyleGuideCandidate({ response: styleRes, story });
        if (!proposedStyleGuide) {
          throw new Error('Style guide format invalid. Please regenerate.');
        }
      }

      const replaceExistingForReferenceRefresh = uploadedRefs.length > 0 && useReferenceImages;
      const nextEntry = {
        id,
        imageUrl: out.imageUrl,
        createdAt,
        type: replaceExistingForReferenceRefresh ? 'base' : cleanedBase.length ? 'variation' : 'base',
        metadata: {
          ...(proposedStyleGuide ? { proposedStyleGuide } : {}),
          prompt: promptUsed,
          references: refs,
          settings: {
            provider: imageSettings?.provider,
            model: imageSettings?.model,
            temperature: imageSettings?.temperature,
          },
          aspectRatio: story.aspectRatio,
        },
      };
      const normalizeImageUrl = (u: any) => String(u || '').trim().split('#')[0].split('?')[0].replace(/\/$/, '');
      const existingHit = cleanedBase.find((v: any) => normalizeImageUrl(v?.imageUrl) === normalizeImageUrl(out.imageUrl));
      const nextVersions = replaceExistingForReferenceRefresh
        ? [nextEntry]
        : existingHit
          ? cleanedBase.map((v: any) =>
              String(v?.id || '') === String(existingHit.id || '')
                ? { ...v, createdAt, metadata: { ...((v as any)?.metadata || {}), ...nextEntry.metadata } }
                : v,
            )
          : [...cleanedBase, nextEntry];
      const nextActiveId = existingHit ? String(existingHit.id || '') : id;

      onUpdateStory((prev) => ({
        ...prev,
        keyVisualUrl: out.imageUrl,
        keyVisualVersions: nextVersions as any,
        activeKeyVisualVersionId: nextActiveId as any,
        proposedStyleGuide: proposedStyleGuide || '',
        proposedStyleGuideUpdatedAt: Date.now(),
        proposedStyleGuideSourceKvVersionId: proposedStyleGuide ? nextActiveId : '',
        masterKvState: {
          ...(prev as any).masterKvState,
          status: 'done',
          lastError: '',
          lastAttemptAt: createdAt,
          pipelineTaskId: '',
          pipelineStatusUrl: '',
          pipelineUpdatedAt: createdAt,
        },
      }));
      if (proposedStyleGuide) {
        setProposalDraft(proposedStyleGuide);
        onToast?.('Master KV generated with new style-guide proposal', 'success');
      } else {
        setProposalDraft('');
        onToast?.(
          replaceExistingForReferenceRefresh ? 'Master KV regenerated from references (replaced previous variants)' : 'Master KV generated',
          'success',
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (String(msg).toLowerCase().includes('style')) setStyleSynthesisError(msg);
      else setKvError(msg);
      onUpdateStory((prev) => ({
        ...prev,
        masterKvState: {
          ...(prev as any).masterKvState,
          status: 'error',
          lastError: msg,
          lastAttemptAt: Date.now(),
          pipelineUpdatedAt: Date.now(),
        },
      }));
      onToast?.('Master KV generation failed', 'info');
    } finally {
      setIsGeneratingKv(false);
    }
  };

  const handleAddReferenceImages = async (files: FileList | null) => {
    if (!files) return;
    const remaining = maxReferenceImages - referenceImages.length;
    if (remaining <= 0) {
      setKvError(`Reference images limit reached (${maxReferenceImages}).`);
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    const reads = picked.map(
      (file) =>
        new Promise<{ id: string; url: string; name?: string; createdAt?: number }>((resolve, reject) => {
          if (!file.type.startsWith('image/')) {
            reject(new Error(`Unsupported file: ${file.name}`));
            return;
          }
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `ref-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              url: String(reader.result || ''),
              name: file.name,
              createdAt: Date.now(),
            });
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
          reader.readAsDataURL(file);
        }),
    );
    const settled = await Promise.allSettled(reads);
    const success = settled
      .filter((r): r is PromiseFulfilledResult<{ id: string; url: string; name?: string; createdAt?: number }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((r) => r.url);
    const errors = settled.filter((r) => r.status === 'rejected') as Array<PromiseRejectedResult>;
    if (errors.length) setKvError(errors[0]?.reason?.message || 'Failed to add reference images.');
    if (!success.length) return;
    const nextRefs = [...referenceImages, ...success].slice(0, maxReferenceImages);
    onUpdateStory((prev) => ({
      ...prev,
      referenceImages: nextRefs as any,
      referenceMode: ((prev as any)?.referenceMode || 'auto') as any,
    }));
    if (referenceInputRef.current) referenceInputRef.current.value = '';
  };

  const handleRemoveReferenceImage = (id: string) => {
    const nextRefs = referenceImages.filter((r: any) => String(r?.id || '') !== String(id));
    onUpdateStory((prev) => ({
      ...prev,
      referenceImages: nextRefs as any,
    }));
  };

  const handleAcceptProposedStyleGuide = () => {
    const next = String(proposalDraft || '').trim();
    if (!next) return;
    if (onAcceptProposedStyleGuide) {
      onAcceptProposedStyleGuide({ styleGuide: next, regenerateAssets: true });
    } else {
      onUpdateStory((prev) => ({
        ...prev,
        styleGuide: next,
        proposedStyleGuide: '',
        proposedStyleGuideUpdatedAt: Date.now(),
        proposedStyleGuideSourceKvVersionId: '',
        assetsSyncedKvVersionId: String((prev as any).activeKeyVisualVersionId || activeKvId || ''),
      }));
    }
    onToast?.('Style guide accepted. Regenerating assets…', 'success');
  };

  const handleIgnoreProposedStyleGuide = () => {
    onUpdateStory((prev) => {
      const sourceId = String((prev as any).proposedStyleGuideSourceKvVersionId || '').trim();
      if (!sourceId) {
        return {
          ...prev,
          proposedStyleGuide: '',
          proposedStyleGuideUpdatedAt: Date.now(),
          proposedStyleGuideSourceKvVersionId: '',
        };
      }
      const all = Array.isArray((prev as any).keyVisualVersions) ? (prev as any).keyVisualVersions : [];
      const remaining = all.filter((v: any) => String(v?.id || '') !== sourceId);
      const activeIdBefore = String((prev as any).activeKeyVisualVersionId || '').trim();
      const shouldSwitch = activeIdBefore === sourceId;
      const fallback = remaining.length ? remaining[remaining.length - 1] : null;
      return {
        ...prev,
        keyVisualVersions: remaining as any,
        activeKeyVisualVersionId: shouldSwitch ? String(fallback?.id || '') : activeIdBefore,
        keyVisualUrl: shouldSwitch ? String(fallback?.imageUrl || '') : prev.keyVisualUrl,
        proposedStyleGuide: '',
        proposedStyleGuideUpdatedAt: Date.now(),
        proposedStyleGuideSourceKvVersionId: '',
      };
    });
    setProposalDraft('');
    onToast?.('Proposal discarded and generated KV variant removed', 'info');
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
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/24 bg-white/12 text-white shadow-2xl backdrop-blur-md">
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
                    className="flex items-center gap-3 px-10 py-5 bg-zinc-900 hover:bg-black text-white dark:bg-white dark:hover:bg-zinc-100 dark:text-black rounded-2xl text-lg font-black uppercase tracking-widest transition-all shadow-[0_20px_40px_rgba(0,0,0,0.28)] hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
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
                    {firstSeqId ? 'Inspect Beats' : 'No Story Parts'}
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
             <div className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-[0.3em]">Scaffolding: 100%</div>
        </div>
      </div>

      {/* Production Modules */}
      <div className="p-12 max-w-7xl mx-auto space-y-20 pb-40">

        {/* Master KV */}
        <section className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-[40px] overflow-hidden shadow-sm">
          <div className="p-10 flex items-start justify-between gap-8 border-b border-zinc-100 dark:border-zinc-800/50">
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 flex items-center gap-3">
                <Anchor className="w-5 h-5 text-zinc-700 dark:text-zinc-200" />
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
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateKvVariant}
                  disabled={!canGenerate || isKvBusy}
                  className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all shadow-sm ${
                    !canGenerate
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-200 dark:border-zinc-700'
                      : 'bg-zinc-900 hover:bg-black text-white dark:bg-white dark:hover:bg-zinc-100 dark:text-black'
                  }`}
                  title={!canGenerate ? 'Image provider is Mock' : story.keyVisualUrl ? 'Generate KV variant' : 'Generate Master KV'}
                >
                  <Sparkles className={`w-4 h-4 ${isKvBusy ? 'animate-pulse' : ''}`} />
                  {kvStatus === 'queued' ? 'Queued…' : isKvBusy ? 'Generating…' : story.keyVisualUrl ? 'Generate Variant' : 'Generate KV'}
                </button>
                <button
                  onClick={handleUpdateAssets}
                  disabled={!onUpdateAssets || !hasKvDrift}
                  className={`px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
                    onUpdateAssets && hasKvDrift
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_25px_rgba(16,185,129,0.25)]'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-200 dark:border-zinc-700'
                  }`}
                  title={hasKvDrift ? 'Regenerate assets using current active KV' : 'Assets already synced with active KV'}
                >
                  Update Assets
                </button>
              </div>
              <div className="text-[10px] font-mono text-zinc-400">
                Status: {(story as any).masterKvState?.status || 'idle'}
              </div>
            </div>
          </div>

          <div className="p-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div className="space-y-4">
              <div className="relative aspect-video rounded-3xl overflow-hidden bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-2xl">
                {story.keyVisualUrl ? (
                  <>
                    <img
                      src={story.keyVisualUrl}
                      className="w-full h-full object-cover cursor-zoom-in"
                      alt="Master KV"
                      onClick={() => story.keyVisualUrl && openLightbox({ url: story.keyVisualUrl, title: 'Master KV' })}
                    />
                    {showProposalCta && (
                      <div className="absolute inset-x-4 bottom-4 bg-black/70 border border-white/10 rounded-2xl p-3 backdrop-blur-md flex items-center justify-between gap-3">
                        <div className="text-xs text-zinc-100">New KV + style proposal ready</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleAcceptProposedStyleGuide}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white hover:bg-emerald-500"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            onClick={handleIgnoreProposedStyleGuide}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400">
                    <ImageIcon className="w-8 h-8" />
                    <div className="mt-3 text-xs font-bold uppercase tracking-widest">No Master KV</div>
                  </div>
                )}
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Variants</div>
                  <div className="text-[10px] text-zinc-500">{displayKvVersions.length}</div>
                </div>
                {displayKvVersions.length <= 1 ? (
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    Generate more variants to audition different global art directions.
                  </div>
                ) : (
                  <div className="flex gap-3 overflow-x-auto no-scrollbar">
                    {displayKvVersions
                      .slice()
                      .reverse()
                      .map((v: any) => {
                        const isActive = String(v.id) === String(activeKvId);
                        const canDelete = displayKvVersions.length > 1;
                        return (
                          <button
                            key={String(v.id)}
                            onClick={() => handleSelectKvVariant(String(v.id))}
                            className={`relative w-40 aspect-video rounded-2xl overflow-hidden border-2 shrink-0 transition-all ${
                              isActive ? 'border-emerald-500' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600'
                            }`}
                            title={isActive ? 'Active' : 'Set active'}
                          >
                            <img src={String(v.imageUrl)} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 text-white text-[10px] flex items-center justify-center border border-white/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                openLightbox({ url: String(v.imageUrl), title: `Master KV Variant` });
                              }}
                              title="View large"
                            >
                              ⤢
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-md bg-black/60 text-white text-[10px] flex items-center justify-center border border-white/10 hover:bg-rose-600/80"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteKvVariant(String(v.id));
                                }}
                                title="Delete variant"
                              >
                                ✕
                              </button>
                            )}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Reference Images (1-4)</div>
                  <label className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={useReferenceImages}
                      onChange={(e) => {
                        const nextMode = e.target.checked ? 'auto' : 'off';
                        onUpdateStory((prev) => ({
                          ...prev,
                          referenceMode: nextMode,
                        }));
                      }}
                    />
                    Use for KV generation
                  </label>
                </div>
                <input
                  ref={referenceInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleAddReferenceImages(e.target.files)}
                />
                <div className="flex flex-wrap gap-2">
                  {referenceImages.map((img: any) => (
                    <div key={String(img.id)} className="relative w-16 h-16 rounded-xl overflow-hidden border border-zinc-200 dark:border-white/10 bg-black/30">
                      <img
                        src={String(img.url)}
                        className="w-full h-full object-cover cursor-zoom-in"
                        onClick={() => openLightbox({ url: String(img.url), title: img.name ? `Reference: ${img.name}` : 'Reference' })}
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveReferenceImage(String(img.id));
                        }}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                {referenceImages.length < maxReferenceImages && (
                    <button
                      type="button"
                      className="w-16 h-16 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-500 dark:hover:border-zinc-500 flex flex-col items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide"
                      onClick={() => referenceInputRef.current?.click()}
                      title="Upload reference images"
                    >
                      <Upload className="w-4 h-4" />
                      Add
                    </button>
                )}
                {activeKvPrompt && (
                  <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">KV Prompt</div>
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => navigator.clipboard?.writeText(activeKvPrompt)}
                      >
                        Copy
                      </button>
                    </div>
                    <pre className="text-[11px] whitespace-pre-wrap text-zinc-700 dark:text-zinc-200 max-h-40 overflow-y-auto custom-scrollbar">
                      {activeKvPrompt}
                    </pre>
                  </div>
                )}
              </div>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Style Description Proposal</div>
                  <div className="text-[10px] text-zinc-500">
                    Generated after clicking `Generate KV`.
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Current StyleGuide</div>
                    <textarea
                      value={String(story.styleGuide || '')}
                      readOnly
                      className="w-full h-32 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed resize-none"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Proposed (Editable)</div>
                    <textarea
                      value={proposalDraft}
                      onChange={(e) => setProposalDraft(e.target.value)}
                      placeholder="Click 'Generate KV' to create a new KV and proposed style guide."
                      className="w-full h-40 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 text-xs text-zinc-700 dark:text-zinc-200 leading-relaxed resize-y min-h-32"
                    />
                  </div>
                </div>

                {styleSynthesisError && <div className="text-xs text-rose-400">{styleSynthesisError}</div>}
              </div>
            </div>
          </div>
        </section>
        
        {/* Narrative Roadmap */}
        <section>
            <div className="flex items-center justify-between mb-10">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400 flex items-center gap-3">
                    <Clapperboard className="w-5 h-5 text-zinc-700 dark:text-zinc-200" />
                    Story Architecture
                </h3>
                <div className="h-px flex-1 mx-10 bg-zinc-100 dark:bg-zinc-800/50"></div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {story.sequences.map((seq, idx) => (
                    <div 
                        key={seq.id}
                        onClick={() => onSelect({ type: 'sequence', id: seq.id })}
                        className="group relative flex flex-col p-8 bg-zinc-50 dark:bg-zinc-900/30 border border-zinc-200 dark:border-zinc-800 rounded-[40px] hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-white dark:hover:bg-zinc-900 transition-all cursor-pointer shadow-sm hover:shadow-2xl"
                    >
                        <div className="absolute top-8 right-8 text-6xl font-black text-zinc-100 dark:text-white/5 select-none group-hover:text-zinc-300 dark:group-hover:text-white/20 transition-colors">
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
                                              className="w-full h-full object-cover cursor-pointer"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onSelect({ type: 'shot', id: s.id, parentId: seq.id });
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
