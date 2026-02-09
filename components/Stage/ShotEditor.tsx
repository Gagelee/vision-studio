
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ElementType, Shot, ShotVersion, AspectRatio, ModelRuntimeSettings, Story } from '../../types';
import { generateImageFromPrompt, type ImageReference } from '../../lib/ai/image/generate';
import { buildShotKeyframePrompt, buildShotSingleFramePrompt } from '../../lib/ai/prompts';
import { selectContactSheetPanelCount } from '../../lib/ai/prompts/image';
import { ChevronLeft, Play, RefreshCw, Layers, MonitorPlay, Maximize2, Minimize2, Download, ChevronDown, ChevronUp, Info, ChevronRight } from 'lucide-react';
import {
  getCharacterActiveAvatarUrl,
  getLocationActivePreviewUrl,
  getLookActivePreviewUrl,
  resolveShotActiveVideo,
} from '../../lib/ai/assetRefs';
import { openLightbox } from '../../lib/ui/lightboxStore';
import { addDebugEvent } from '../../lib/debug/eventLog';
import { computeGridPanelBBoxes } from '../../lib/ui/gridSplit';

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
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  const probedVideoUrlsRef = useRef<Set<string>>(new Set());

  const [isSplittingGrid, setIsSplittingGrid] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [activePanelIndex, setActivePanelIndex] = useState(0);
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string>('');

  useEffect(() => {
    setVideoLoadFailed(false);
  }, [activeVideoUrl, activeVideoVariant?.id]);

  useEffect(() => {
    setActivePanelIndex(0);
  }, [activeVersion?.id]);

  useEffect(() => {
    // Clear multi-select when switching active version normally.
    // Keeps behavior predictable and avoids "accidentally grouping" old selections.
    setSelectedVersionIds([]);
    setSelectionAnchorId('');
  }, [shot.activeVersionId]);

  const probeVideoHead = async (url: string) => {
    const u = String(url || '').trim();
    if (!u) return;
    try {
      const resp = await fetch(u, { method: 'HEAD', cache: 'no-store' as any });
      addDebugEvent({
        level: resp.ok ? 'warn' : 'error',
        scope: 'asset.video',
        message: 'Video playback failed (HEAD probe)',
        data: {
          url: u,
          status: resp.status,
          contentType: resp.headers.get('content-type') || '',
          contentLength: resp.headers.get('content-length') || '',
          acceptRanges: resp.headers.get('accept-ranges') || '',
          cacheControl: resp.headers.get('cache-control') || '',
        },
      });
    } catch (e) {
      addDebugEvent({
        level: 'error',
        scope: 'asset.video',
        message: 'Video playback failed (HEAD probe error)',
        data: { url: u, error: e instanceof Error ? e.message : String(e) },
      });
    }
  };

  const isContactSheetGrid = useMemo(() => {
    const v: any = activeVersion as any;
    const mode = String(v?.metadata?.keyframe?.mode || '').trim();
    if (mode === 'contact_sheet') return true;
    const prompt = String(v?.metadata?.prompt || '').toLowerCase();
    if (prompt.includes('contact sheet') || prompt.includes('contact-sheet')) return true;
    return false;
  }, [activeVersion]);

  const getPanelCount = () => {
    const pc = Number((activeVersion as any)?.metadata?.keyframe?.panelCount);
    if (pc === 4 || pc === 9) return pc as 4 | 9;
    const byPlan = Number((shot as any)?.keyframePlan?.panelCount);
    if (byPlan === 4 || byPlan === 9) return byPlan as 4 | 9;
    return selectContactSheetPanelCount(Number(shot.duration || 0));
  };

  const storeImageDataUrl = async (dataUrl: string, filenameHint: string) => {
    const resp = await fetch('/api/asset/image/store', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, filenameHint }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Store image failed (HTTP ${resp.status})${text ? `: ${text}` : ''}`);
    }
    const json = (await resp.json().catch(() => null)) as any;
    const url = String(json?.imageUrl || '').trim();
    if (!url) throw new Error('Store image failed: missing imageUrl');
    return url;
  };

  const imageUrlToPngDataUrl = async (imageUrl: string, crop: { x: number; y: number; w: number; h: number }) => {
    const res = await fetch(imageUrl, { cache: 'no-store' as any });
    if (!res.ok) throw new Error(`Fetch image failed (HTTP ${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to decode image'));
        img.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(crop.w));
      canvas.height = Math.max(1, Math.floor(crop.h));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not supported');
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
      return await new Promise<string>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (!b) return reject(new Error('Canvas export failed'));
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Read blob failed'));
            reader.readAsDataURL(b);
          },
          'image/png',
          0.92,
        );
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const getActivePreviewImageUrl = () => {
    if (!activeVersion) return '';
    const group: any = (activeVersion as any)?.metadata?.panelGroup;
    const panels = Array.isArray(group?.panels) ? group.panels : [];
    if (String((activeVersion as any)?.type || '') !== 'panel_group' || !panels.length) {
      return String(activeVersion.imageUrl || '').trim();
    }
    const idx = Number.isFinite(Number(activePanelIndex)) ? Number(activePanelIndex) : 0;
    const hit = panels.find((p: any) => Number(p?.index) === idx) || panels[0];
    return String(hit?.imageUrl || activeVersion.imageUrl || '').trim();
  };

  const handleSplitGrid = async (panelCount: 4 | 9) => {
    if (isSplittingGrid || !activeVersion) return;
    if (String((activeVersion as any)?.type || '') === 'panel_group') return;
    if (!String(activeVersion.imageUrl || '').trim()) return;
    setSplitError(null);
    setIsSplittingGrid(true);
    const gridVersion = activeVersion;
    const gridLabel = panelCount === 9 ? '3x3' : '2x2';
    const startedAt = Date.now();
    try {
      const res = await fetch(String(gridVersion.imageUrl || '').trim(), { cache: 'no-store' as any });
      if (!res.ok) throw new Error(`Fetch grid image failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      let width = 0;
      let height = 0;
      try {
        const img = new Image();
        img.decoding = 'async';
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to decode grid image'));
          img.src = objectUrl;
        });
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      if (!width || !height) throw new Error('Grid image has invalid dimensions');

      const panels = computeGridPanelBBoxes({ panelCount, insetPct: 0.035 });
      const storedPanels = await Promise.all(
        panels.map(async (p) => {
          const crop = {
            x: Math.round(p.bbox.x * width),
            y: Math.round(p.bbox.y * height),
            w: Math.round(p.bbox.w * width),
            h: Math.round(p.bbox.h * height),
          };
          const dataUrl = await imageUrlToPngDataUrl(gridVersion.imageUrl, crop);
          const imageUrl = await storeImageDataUrl(dataUrl, `shot-${shot.sequence}-panel-${p.index + 1}`);
          return { index: p.index, imageUrl, bbox: p.bbox };
        }),
      );

      const now = Date.now();
      const existing = Array.isArray(shot.versions) ? shot.versions : [];
      const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');
      const baseList = cleaned.length ? cleaned : existing;
      const groupVersion: ShotVersion = {
        id: `v${baseList.length + 1}-${now}`,
        imageUrl: storedPanels[0]?.imageUrl || gridVersion.imageUrl,
        createdAt: now,
        type: 'panel_group',
        metadata: {
          ...(gridVersion.metadata || {}),
          keyframe: { mode: 'contact_sheet', panelCount, grid: gridLabel },
          source: { sourceType: 'grid_panel_group', sourceGridId: gridVersion.id },
          panelGroup: {
            kind: 'stack',
            activeIndex: 0,
            panels: storedPanels.map((p) => ({ index: p.index, imageUrl: p.imageUrl, bbox: p.bbox })),
          },
        } as any,
      };

      addDebugEvent({
        level: 'info',
        scope: 'asset.image',
        message: 'Split grid into panels',
        data: { shotId: shot.id, gridVersionId: gridVersion.id, panelCount, panels: storedPanels.length, ms: Date.now() - startedAt },
      });

      onUpdateShot({
        ...shot,
        versions: [...baseList, groupVersion],
        activeVersionId: groupVersion.id,
        thumbnailUrl: groupVersion.imageUrl,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setSplitError(err);
      addDebugEvent({ level: 'error', scope: 'asset.image', message: 'Split grid failed', data: { error: err } });
    } finally {
      setIsSplittingGrid(false);
    }
  };

  const refineFromActivePanel = async () => {
    if (isBusyGenerating || !activeVersion) return;
    const group: any = (activeVersion as any)?.metadata?.panelGroup;
    const panels = Array.isArray(group?.panels) ? group.panels : [];
    if (!panels.length) return;
    const idx = Number.isFinite(Number(activePanelIndex)) ? Number(activePanelIndex) : 0;
    const hit = panels.find((p: any) => Number(p?.index) === idx) || panels[0];
    const panelUrl = String(hit?.imageUrl || '').trim();
    if (!panelUrl) return;

    const parentRefs = Array.isArray((activeVersion as any)?.metadata?.references) ? (activeVersion as any).metadata.references : [];
    const references: ImageReference[] = [{ url: panelUrl, label: `grid panel ${idx + 1}` }, ...parentRefs].slice(0, 6);

    const settings =
      imageSettings || {
        provider: 'mock',
        model: 'mock',
        temperature: 0.5,
      };

    const loc = story?.locations?.find((l) => l.id === shot.locationId);
    const styleGuide = story ? String((story as any).styleGuide || '').trim() : '';
    const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
    const castArr = Array.isArray(cast) ? cast : [];
    const castNames = (castArr || [])
      .map((c: any) => {
        const master = story?.characters?.find((x) => x.id === String(c?.id || ''));
        if (!master) return null;
        const activeLookId = String(c?.activeLookId || '');
        const look = activeLookId ? master.looks?.find((lk) => lk.id === activeLookId) : master.looks?.[0];
        return `${master.name}${look?.name ? ` (${look.name})` : ''}`;
      })
      .filter(Boolean) as string[];

    const prompt = buildShotSingleFramePrompt({
      shot,
      styleGuide,
      environmentName: loc?.name,
      environmentStyle: String(loc?.visualStyle || '').trim(),
      castNames,
      focusBeat: `Panel ${idx + 1} of ${panels.length}`,
    });

    const startedAt = Date.now();
    setIsGenerating(true);
    setGenerationError(null);
    try {
      const img = await generateImageFromPrompt({
        prompt,
        settings,
        aspectRatio,
        references,
        promptSpec: {
          kind: 'shot',
          styleGuide,
          aspectRatio,
          keyframeMode: 'single_frame',
          source: {
            sourceType: 'grid_panel_group',
            sourceGridId: String((activeVersion as any)?.metadata?.source?.sourceGridId || ''),
            panelIndex: idx,
          },
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

      const versionMeta: any = {
        prompt,
        references,
        settings: {
          provider: settings.provider,
          model: settings.model,
          temperature: settings.temperature,
        },
        aspectRatio,
        keyframe: { mode: 'single_frame' },
        source: {
          sourceType: 'single',
          sourcePanelGroupId: activeVersion.id,
          sourceGridId: String((activeVersion as any)?.metadata?.source?.sourceGridId || ''),
          panelIndex: idx,
          panelBBox: (hit as any)?.bbox,
        },
      };

      const now = Date.now();
      const existing = Array.isArray(shot.versions) ? shot.versions : [];
      const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');
      const baseList = cleaned.length ? cleaned : existing;
      const newVersion: ShotVersion = {
        id: `v${baseList.length + 1}-${now}`,
        imageUrl: img.imageUrl,
        createdAt: now,
        type: 'variation',
        metadata: versionMeta,
      };

      addDebugEvent({
        level: 'info',
        scope: 'asset.image',
        message: 'Refine from grid panel',
        data: { ms: Date.now() - startedAt, panelIndex: idx, imageUrl: img.imageUrl },
      });

      onUpdateShot({
        ...shot,
        versions: [...baseList, newVersion],
        activeVersionId: newVersion.id,
        thumbnailUrl: newVersion.imageUrl,
        aiState: 'idle',
        aiPrompt: '',
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setGenerationError(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const extractActivePanelAsVersion = () => {
    if (!activeVersion) return;
    const group: any = (activeVersion as any)?.metadata?.panelGroup;
    const panels = Array.isArray(group?.panels) ? group.panels : [];
    if (!panels.length) return;
    const idx = Number.isFinite(Number(activePanelIndex)) ? Number(activePanelIndex) : 0;
    const hit = panels.find((p: any) => Number(p?.index) === idx) || panels[0];
    const panelUrl = String(hit?.imageUrl || '').trim();
    if (!panelUrl) return;

    const now = Date.now();
    const existing = Array.isArray(shot.versions) ? shot.versions : [];
    const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');
    const baseList = cleaned.length ? cleaned : existing;
    const newVersion: ShotVersion = {
      id: `v${baseList.length + 1}-${now}`,
      imageUrl: panelUrl,
      createdAt: now,
      type: 'grid_panel',
      metadata: {
        ...(activeVersion.metadata || {}),
        keyframe: (activeVersion as any)?.metadata?.keyframe || { mode: 'single_frame' },
        source: {
          sourceType: 'grid_panel',
          sourcePanelGroupId: activeVersion.id,
          sourceGridId: String((activeVersion as any)?.metadata?.source?.sourceGridId || ''),
          panelIndex: idx,
          panelBBox: (hit as any)?.bbox,
        },
      } as any,
    };
    onUpdateShot({
      ...shot,
      versions: [...baseList, newVersion],
      activeVersionId: newVersion.id,
      thumbnailUrl: newVersion.imageUrl,
    });
  };

	  const ungroupPanelsToVersions = () => {
	    if (!activeVersion) return;
	    const group: any = (activeVersion as any)?.metadata?.panelGroup;
	    const panels = Array.isArray(group?.panels) ? group.panels : [];
	    if (!panels.length) return;
	    if (!window.confirm(`Ungroup into ${panels.length} separate versions?`)) return;

	    const existing = Array.isArray(shot.versions) ? shot.versions : [];
	    const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');
	    const baseList = cleaned.length ? cleaned : existing;
	    // Remove the stack itself; ungroup is a destructive "split" action.
	    const baseListWithoutGroup = baseList.filter((v) => String(v?.id || '') !== String(activeVersion.id || ''));
	    const baseIndex = baseListWithoutGroup.length;
	    const now = Date.now();
	    const created = panels.map((p: any, i: number): ShotVersion => {
	      const panelUrl = String(p?.imageUrl || '').trim();
	      return {
	        id: `v${baseIndex + i + 1}-${now + i}`,
        imageUrl: panelUrl || String(activeVersion.imageUrl || '').trim(),
        createdAt: now + i,
        type: 'grid_panel',
        metadata: {
          ...(activeVersion.metadata || {}),
          keyframe: (activeVersion as any)?.metadata?.keyframe || { mode: 'single_frame' },
          source: {
            sourceType: 'grid_panel',
            sourcePanelGroupId: activeVersion.id,
            sourceGridId: String((activeVersion as any)?.metadata?.source?.sourceGridId || ''),
            panelIndex: Number(p?.index) || i,
            panelBBox: p?.bbox,
          },
        } as any,
      };
    });
	    const nextActive = created[0] || null;
	    if (!nextActive) return;
	    onUpdateShot({
	      ...shot,
	      versions: [...baseListWithoutGroup, ...created],
	      activeVersionId: nextActive.id,
	      thumbnailUrl: nextActive.imageUrl,
	    });
	  };

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

  const timelineVersions = useMemo(() => displayVersions.slice().reverse(), [displayVersions]);
  const selectedSet = useMemo(() => new Set(selectedVersionIds), [selectedVersionIds]);

  const clearSelection = () => {
    setSelectedVersionIds([]);
    setSelectionAnchorId('');
  };

  const selectRange = (toId: string) => {
    const ids = timelineVersions.map((v) => String(v?.id || '')).filter(Boolean);
    const anchor = String(selectionAnchorId || '').trim() || toId;
    const a = ids.indexOf(anchor);
    const b = ids.indexOf(toId);
    if (a < 0 || b < 0) {
      setSelectedVersionIds([toId]);
      setSelectionAnchorId(toId);
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const next = ids.slice(lo, hi + 1);
    setSelectedVersionIds(next);
    setSelectionAnchorId(anchor);
  };

  const toggleSelected = (id: string) => {
    const next = selectedSet.has(id) ? selectedVersionIds.filter((x) => x !== id) : [...selectedVersionIds, id];
    setSelectedVersionIds(next);
    if (!selectionAnchorId) setSelectionAnchorId(id);
  };

  const createStackFromSelection = () => {
    const ids = selectedVersionIds.map((x) => String(x || '').trim()).filter(Boolean);
    const byId = new Map(timelineVersions.map((v) => [String(v?.id || ''), v] as const));
    const selected = ids.map((id) => byId.get(id)).filter(Boolean) as ShotVersion[];
    const usable = selected.filter((v) => String(v?.type || '') !== 'placeholder' && String(v?.type || '') !== 'panel_group');
    if (usable.length < 2) {
      setSplitError('Select at least 2 non-stack versions to create a new stack.');
      return;
    }
    const now = Date.now();
    const existing = Array.isArray(shot.versions) ? shot.versions : [];
    const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');
    const baseList = cleaned.length ? cleaned : existing;

    const panels = usable.map((v, i) => ({ index: i, imageUrl: String(v.imageUrl || '').trim() })).filter((p) => p.imageUrl);
    if (panels.length < 2) {
      setSplitError('Selected versions are missing image URLs.');
      return;
    }

    // Merge semantics: remove selected versions from the timeline once grouped.
    const removeIds = new Set(usable.map((v) => String(v?.id || '')).filter(Boolean));
    const baseListWithoutSelected = baseList.filter((v) => !removeIds.has(String(v?.id || '')));

    const groupVersion: ShotVersion = {
      id: `v${baseListWithoutSelected.length + 1}-${now}`,
      imageUrl: panels[0].imageUrl,
      createdAt: now,
      type: 'panel_group',
      metadata: {
        keyframe: { mode: 'single_frame' },
        source: { sourceType: 'manual_group', mergedFromVersionIds: Array.from(removeIds) },
        panelGroup: { kind: 'stack', activeIndex: 0, panels },
      } as any,
    };

    onUpdateShot({
      ...shot,
      versions: [...baseListWithoutSelected, groupVersion],
      activeVersionId: groupVersion.id,
      thumbnailUrl: groupVersion.imageUrl,
    });
    setActivePanelIndex(0);
    clearSelection();
  };

  const onVersionCardClick = (e: React.MouseEvent, versionId: string) => {
    e.stopPropagation();
    const id = String(versionId || '').trim();
    if (!id) return;
    if (e.shiftKey) return selectRange(id);
    if (e.metaKey || e.ctrlKey) return toggleSelected(id);
    clearSelection();
    handleVersionSelect(id);
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
	        keyframe: { mode: 'contact_sheet' as const, panelCount, grid: panelCount === 9 ? '3x3' as const : '2x2' as const },
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
	            {activeVersion && !isPlaceholderActive && isContactSheetGrid && String((activeVersion as any)?.type || '') !== 'panel_group' && (
	              <>
	                <button
	                  type="button"
	                  onClick={() => void handleSplitGrid(4)}
	                  disabled={isSplittingGrid}
	                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-lg ${
	                    isSplittingGrid
	                      ? 'bg-white/10 text-white/50 cursor-not-allowed shadow-white/5'
	                      : 'bg-indigo-500 text-white hover:bg-indigo-400 shadow-indigo-500/20'
	                  }`}
	                  title="Split as 2x2 (4 panels)"
	                >
	                  <Layers className={`w-3.5 h-3.5 ${isSplittingGrid ? 'animate-spin' : ''}`} />
	                  Split 4
	                </button>
	                <button
	                  type="button"
	                  onClick={() => void handleSplitGrid(9)}
	                  disabled={isSplittingGrid}
	                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-lg ${
	                    isSplittingGrid
	                      ? 'bg-white/10 text-white/50 cursor-not-allowed shadow-white/5'
	                      : 'bg-indigo-500 text-white hover:bg-indigo-400 shadow-indigo-500/20'
	                  }`}
	                  title="Split as 3x3 (9 panels)"
	                >
	                  <Layers className={`w-3.5 h-3.5 ${isSplittingGrid ? 'animate-spin' : ''}`} />
	                  Split 9
	                </button>
	              </>
	            )}
	        </div>
	      </div>

      {/* Main Preview Area */}
      <div className="flex-1 relative flex items-center justify-center bg-black/80 p-8 overflow-hidden min-h-0">
        <div className="relative w-full h-full flex items-center justify-center group">
            <div className={`${ratioStyles[aspectRatio]} w-full bg-zinc-900 rounded-lg shadow-2xl border border-zinc-800 overflow-hidden relative transition-all duration-500 ease-in-out`}>
	                {activeVideoUrl && !videoLoadFailed ? (
	                    <>
	                      <video
	                          src={activeVideoUrl}
	                          className="w-full h-full object-contain bg-black"
                          controls
                          loop
	                          playsInline
	                          preload="metadata"
	                          onError={() => {
	                            setVideoLoadFailed(true);
	                            const u = String(activeVideoUrl || '').trim();
	                            if (u && !probedVideoUrlsRef.current.has(u)) {
	                              probedVideoUrlsRef.current.add(u);
	                              void probeVideoHead(u);
	                            }
	                          }}
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
	                      <>
	                        <img 
	                            src={getActivePreviewImageUrl()} 
	                            alt={`Shot ${shot.sequence} - Version ${activeVersion.id}`}
	                            className="w-full h-full object-contain bg-black cursor-zoom-in"
	                            onClick={() => {
	                              const url = getActivePreviewImageUrl();
	                              if (url) openLightbox({ url, title: `Shot #${shot.sequence}` });
	                            }}
	                        />
	                        {String((activeVersion as any)?.type || '') === 'panel_group' && (
	                          <div className="absolute top-3 left-3 z-30 flex items-center gap-2">
	                            <div className="px-2.5 py-1 rounded-full bg-black/60 border border-white/20 text-white text-[10px] font-bold uppercase tracking-wider">
	                              Stack
	                            </div>
	                            <button
	                              type="button"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                const group: any = (activeVersion as any)?.metadata?.panelGroup;
	                                const panels = Array.isArray(group?.panels) ? group.panels : [];
	                                if (!panels.length) return;
	                                setActivePanelIndex((prev) => (prev - 1 + panels.length) % panels.length);
	                              }}
	                              className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center hover:bg-black/75"
	                              title="Previous panel"
	                            >
	                              <ChevronLeft className="w-4 h-4" />
	                            </button>
	                            <button
	                              type="button"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                const group: any = (activeVersion as any)?.metadata?.panelGroup;
	                                const panels = Array.isArray(group?.panels) ? group.panels : [];
	                                if (!panels.length) return;
	                                setActivePanelIndex((prev) => (prev + 1) % panels.length);
	                              }}
	                              className="w-8 h-8 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center hover:bg-black/75"
	                              title="Next panel"
	                            >
	                              <ChevronRight className="w-4 h-4" />
	                            </button>
	                            <button
	                              type="button"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                void refineFromActivePanel();
	                              }}
	                              disabled={isBusyGenerating}
	                              className={`px-3 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest ${
	                                isBusyGenerating
	                                  ? 'bg-white/5 border-white/10 text-white/50 cursor-not-allowed'
	                                  : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
	                              }`}
	                              title="Regenerate a single-frame image from this panel"
	                            >
	                              Refine
	                            </button>
	                            <button
	                              type="button"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                extractActivePanelAsVersion();
	                              }}
	                              className="px-3 py-2 rounded-full bg-black/60 border border-white/20 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black/75"
	                              title="Create a normal version from the current panel image"
	                            >
	                              Extract
	                            </button>
	                            <button
	                              type="button"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                ungroupPanelsToVersions();
	                              }}
	                              className="px-3 py-2 rounded-full bg-black/60 border border-white/20 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black/75"
	                              title="Create separate versions for all panels"
	                            >
	                              Ungroup
	                            </button>
	                          </div>
	                        )}
	                      </>
	                    )
	                ) : (
	                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
	                        <MonitorPlay className="w-12 h-12 opacity-50" />
                        <span>No generated keyframe</span>
                    </div>
                )}

                {/* Hover play hint: only when an actual video is present, never block controls. */}
                {activeVideoUrl && !videoLoadFailed && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-black/10 backdrop-blur-[1px]">
                      <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-[0_0_40px_rgba(255,255,255,0.2)]">
                          <Play className="w-8 h-8 fill-current ml-2" />
                      </div>
                  </div>
                )}
                {activeVideoUrl && videoLoadFailed && (
                  <div className="absolute bottom-3 left-3 right-3 z-20 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px] px-3 py-2">
                    Video failed to load. Showing keyframe instead — try regenerating or switching variant.
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

	            {selectedVersionIds.length > 0 && (
	              <div className="flex-shrink-0 h-32 w-64 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 flex flex-col justify-between">
	                <div>
	                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Selection</div>
	                  <div className="mt-1 text-xs text-zinc-200 font-bold">{selectedVersionIds.length} selected</div>
	                  <div className="mt-1 text-[10px] text-zinc-500">Cmd/Ctrl click: toggle, Shift: range</div>
	                </div>
	                <div className="flex items-center gap-2">
	                  <button
	                    type="button"
	                    onClick={(e) => {
	                      e.stopPropagation();
	                      createStackFromSelection();
	                    }}
	                    disabled={selectedVersionIds.length < 2}
	                    className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
	                      selectedVersionIds.length < 2
	                        ? 'bg-white/5 border-white/10 text-white/40 cursor-not-allowed'
	                        : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-200 hover:bg-indigo-500/30'
	                    }`}
	                    title="Create a stack group from the selected versions"
	                  >
	                    Create Stack
	                  </button>
	                  <button
	                    type="button"
	                    onClick={(e) => {
	                      e.stopPropagation();
	                      clearSelection();
	                    }}
	                    className="px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
	                    title="Clear selection"
	                  >
	                    Clear
	                  </button>
	                </div>
	              </div>
	            )}

	            {/* Version List */}
	            {timelineVersions.map((version, index) => {
	                const isActive = version.id === shot.activeVersionId;
	                const isSelected = selectedSet.has(String(version.id || ''));
	                const versionNumber = displayVersions.length - index;
	                return (
	                    <div 
	                        key={version.id}
	                        onClick={(e) => onVersionCardClick(e, version.id)}
	                        className={`relative flex-shrink-0 w-48 h-32 rounded-xl overflow-hidden border-2 cursor-pointer transition-all group shadow-lg ${
	                          isActive
	                            ? 'border-indigo-500 ring-4 ring-indigo-500/10'
	                            : isSelected
	                              ? 'border-amber-400 ring-4 ring-amber-400/10'
	                              : 'border-zinc-800 hover:border-zinc-600'
	                        }`}
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
	                              if (e.shiftKey || e.metaKey || e.ctrlKey) {
	                                onVersionCardClick(e as any, version.id);
	                                return;
	                              }
	                              openLightbox({ url: version.imageUrl, title: `Shot #${shot.sequence} (${version.id})` });
	                            }}
	                          />
	                        )}
                        
		                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-white border border-white/10">
		                            v{versionNumber}
		                        </div>
		                        {isSelected && (
		                          <div className="absolute bottom-2 left-2 bg-amber-500/30 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-amber-100 border border-amber-500/30">
		                            Selected
		                          </div>
		                        )}
		                        {String((version as any)?.type || '') === 'panel_group' && Array.isArray((version as any)?.metadata?.panelGroup?.panels) && (
		                          <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-white border border-white/10">
		                            stack {((version as any).metadata.panelGroup.panels as any[]).length}
		                          </div>
		                        )}
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
	        {splitError && !isImmersive && (
	          <div className="px-4 pb-4">
	            <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3">
	              Split grid failed: {splitError}
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
