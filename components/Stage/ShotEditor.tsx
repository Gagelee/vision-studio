
import React, { useState } from 'react';
import { ElementType, Shot, ShotVersion, AspectRatio, ModelRuntimeSettings, Story } from '../../types';
import { generateImageFromPrompt, type ImageReference } from '../../lib/ai/image/generate';
import { buildShotImagePrompt } from '../../lib/ai/prompts';
import { ChevronLeft, Play, RefreshCw, Layers, MonitorPlay, Maximize2, Minimize2, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { getCharacterActiveAvatarUrl, getLocationActivePreviewUrl, getLookActivePreviewUrl, getStoryActiveKvUrl } from '../../lib/ai/assetRefs';
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
  const allVersions = Array.isArray(shot.versions) ? shot.versions : [];
  const nonPlaceholderVersions = allVersions.filter((v) => String(v?.type || '') !== 'placeholder');
  const displayVersions = nonPlaceholderVersions.length ? nonPlaceholderVersions : allVersions;
  const activeVersion =
    displayVersions.find((v) => v.id === shot.activeVersionId) || displayVersions[displayVersions.length - 1] || null;
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

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
    if (isGenerating) return;
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

      const kvUrl = story ? getStoryActiveKvUrl(story) : '';
      if (!story || !isDone((story as any).masterKvState) || !kvUrl) {
        throw new Error('Blocked: Master KV not generated yet. Please generate Master KV first.');
      }

      const loc = story?.locations?.find((l) => l.id === shot.locationId);
      const locUrl = loc ? getLocationActivePreviewUrl(loc) : '';
      if (!loc || !isDone((loc as any).assetState) || !locUrl) {
        throw new Error('Blocked: Environment asset not generated yet. Please generate the environment first.');
      }

      const references: ImageReference[] = [];
      references.push({ url: kvUrl, label: 'master kv' });
      references.push({ url: locUrl, label: `environment: ${loc.name}` });

      const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
      const castArr = Array.isArray(cast) ? cast : [];
      for (const c of castArr.slice(0, 4)) {
        const charId = String(c?.id || '');
        if (!charId) continue;
        const activeLookId = String(c?.activeLookId || '');
        const master = story?.characters?.find((x) => x.id === charId);
        const avatarUrl = master ? getCharacterActiveAvatarUrl(master) : '';
        if (!master || !isDone((master as any).assetState) || !avatarUrl) {
          throw new Error('Blocked: Character avatar not generated yet. Please generate character avatar(s) first.');
        }
        if (activeLookId) {
          const look = master.looks?.find((lk) => lk.id === activeLookId);
          const lookUrl = look ? getLookActivePreviewUrl(look) : '';
          if (!look || !isDone((look as any).assetState) || !lookUrl) {
            throw new Error('Blocked: Character look not generated yet. Please generate the look first.');
          }
          references.push({ url: lookUrl, label: `character: ${master.name} (${look.name})` });
        } else {
          references.push({ url: avatarUrl, label: `character: ${master.name}` });
        }
      }

      const lines: string[] = [];
      lines.push(
        'Generate a cinematic storyboard keyframe (still image).',
        'Match the Master KV art direction: consistent palette, lighting language, lens feel, and overall rendering style.',
        'Follow reference images strictly for identity + environment consistency. Do not drift into a different art style.',
        'No text, no subtitles, no watermarks, no logos.',
        '',
        buildShotImagePrompt(shot),
      );
      if (loc) lines.push('', `Environment style: ${loc.visualStyle || ''}`.trim());

      const img = await generateImageFromPrompt({
        prompt: lines.filter(Boolean).join('\n'),
        settings,
        aspectRatio,
        references,
        strict: true,
        requireAllReferences: references.length > 0,
      });

      const now = Date.now();
      const existing = Array.isArray(shot.versions) ? shot.versions : [];
      const cleaned = existing.filter((v) => String(v?.type || '') !== 'placeholder');

      // If we only have a placeholder base, replace it so placeholders never show up as variants.
      if (existing.length === 1 && cleaned.length === 0 && existing[0]) {
        const base = existing[0];
        onUpdateShot({
          ...shot,
          versions: [{ ...base, imageUrl: img.imageUrl, createdAt: now, type: 'base' }],
          activeVersionId: base.id,
          thumbnailUrl: img.imageUrl,
        });
        return;
      }

      const baseList = cleaned.length ? cleaned : existing;
      const newVersion: ShotVersion = {
        id: `v${baseList.length + 1}-${now}`,
        imageUrl: img.imageUrl,
        createdAt: now,
        type: baseList.length ? 'variation' : 'base',
      };

      onUpdateShot({
        ...shot,
        versions: [...baseList, newVersion],
        activeVersionId: newVersion.id,
        thumbnailUrl: newVersion.imageUrl,
      });
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
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
            <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 font-mono">
                {shot.duration}s
            </span>
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
              <button
                onClick={onStartProduction}
                className="flex items-center gap-2 bg-[#ee4d2d] hover:bg-[#f05d40] text-white px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-colors shadow-lg shadow-orange-500/10"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Start Production
              </button>
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
	                {activeVersion ? (
	                    <img 
	                        src={activeVersion.imageUrl} 
	                        alt={`Shot ${shot.sequence} - Version ${activeVersion.id}`}
	                        className="w-full h-full object-contain bg-black cursor-zoom-in"
	                        onClick={() => activeVersion?.imageUrl && openLightbox({ url: activeVersion.imageUrl, title: `Shot #${shot.sequence}` })}
	                    />
	                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600 gap-2">
                        <MonitorPlay className="w-12 h-12 opacity-50" />
                        <span>No generated footage</span>
                    </div>
                )}
                
                {/* Overlay Play Button (Mock) */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all bg-black/20 backdrop-blur-[1px] cursor-pointer">
                    <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:scale-105 transition-transform shadow-[0_0_40px_rgba(255,255,255,0.2)]">
                        <Play className="w-8 h-8 fill-current ml-2" />
                    </div>
                </div>
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
                disabled={isGenerating}
                className="flex-shrink-0 w-48 h-32 border-2 border-dashed border-zinc-800 rounded-xl flex flex-col items-center justify-center gap-2 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all group disabled:opacity-40 disabled:cursor-not-allowed"
            >
                <div className="p-3 rounded-full bg-zinc-900 group-hover:bg-indigo-500/20 transition-colors">
                    <RefreshCw className={`w-6 h-6 ${isGenerating ? 'animate-spin' : 'group-hover:animate-spin'}`} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wide">{isGenerating ? 'Generating...' : 'Generate Variant'}</span>
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
	                        <img
	                          src={version.imageUrl}
	                          className="w-full h-full object-cover cursor-zoom-in"
	                          loading="lazy"
	                          onClick={(e) => {
	                            e.stopPropagation();
	                            openLightbox({ url: version.imageUrl, title: `Shot #${shot.sequence} (${version.id})` });
	                          }}
	                        />
                        
                        <div className="absolute top-2 left-2 bg-black/60 backdrop-blur px-2 py-0.5 rounded text-[10px] font-bold text-white border border-white/10">
                            v{versionNumber}
                        </div>
                        
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
    </div>
  );
};
