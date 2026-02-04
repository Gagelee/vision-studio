
import React, { useState, useEffect } from 'react';
import { Location, ModelRuntimeSettings, Sequence, Shot } from '../../types';
import { MapPin, Image as ImageIcon, Wand2, Save, Film, AlertCircle, Lock, Unlock, Sparkles, ZoomIn } from 'lucide-react';
import { generateImageFromPrompt } from '../../lib/ai/image/generate';
import { buildLocationPreviewPrompt } from '../../lib/ai/prompts';
import { openLightbox } from '../../lib/ui/lightboxStore';

interface LocationEditorProps {
  location: Location;
  sequences?: Sequence[];
  onSave: (location: Location) => void;
  onPropagate: (locationId: string) => void;
  onSelectShot?: (shotId: string, seqId: string) => void;
  imageSettings?: ModelRuntimeSettings;
  keyVisualUrl?: string;
  styleGuide?: string;
  aspectRatio?: string;
}

export const LocationEditor: React.FC<LocationEditorProps> = ({
  location,
  sequences = [],
  onSave,
  onPropagate,
  onSelectShot,
  imageSettings,
  keyVisualUrl,
  styleGuide,
  aspectRatio,
}) => {
  const seedPreviewVersions = (l: Location) => {
    const existing = Array.isArray((l as any).previewVersions) ? (l as any).previewVersions : [];
    if (existing.length) return { versions: existing, activeId: (l as any).activePreviewVersionId || existing[existing.length - 1]?.id || '' };
    const url = String(l.previewUrl || '').trim();
    if (!url) return { versions: [], activeId: '' };
    const id = 'pv-1';
    const isDone = (l as any)?.assetState?.status === 'done';
    return { versions: [{ id, imageUrl: url, createdAt: Date.now(), type: isDone ? 'base' : 'placeholder' }], activeId: id };
  };

  const normalizeDraft = (l: Location): Location => {
    const existing = Array.isArray((l as any).previewVersions) ? (l as any).previewVersions : [];
    if (existing.length) return l;
    const seeded = seedPreviewVersions(l);
    if (!seeded.versions.length) return l;
    return { ...l, previewVersions: seeded.versions, activePreviewVersionId: seeded.activeId } as any;
  };

  const [draft, setDraft] = useState<Location>(() => normalizeDraft(location));
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  
  useEffect(() => {
    setDraft(normalizeDraft(location));
  }, [location.id]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(location);
  const isLocked = draft.status === 'locked';
  const canGenerate = Boolean(imageSettings && imageSettings.provider !== 'mock');
  
  // Find all shots using this location
  const usedInShots: { shot: Shot; seqId: string }[] = [];
  sequences.forEach(seq => {
      seq.shots.forEach(shot => {
          if (shot.locationId === location.id) {
              usedInShots.push({ shot, seqId: seq.id });
          }
      });
  });

  const handleSave = () => {
    onSave(draft);
  };

  const handleGeneratePreview = async () => {
    if (!imageSettings || imageSettings.provider === 'mock' || isLocked || isGeneratingPreview) return;
    setGenerationError(null);
    setIsGeneratingPreview(true);
    try {
      const out = await generateImageFromPrompt({
        prompt: buildLocationPreviewPrompt(draft, styleGuide),
        settings: imageSettings,
        aspectRatio: aspectRatio || '16:9',
        strict: true,
      });
      const now = Date.now();
      const seeded = seedPreviewVersions(draft);
      const baseVersions =
        Array.isArray((draft as any).previewVersions) && (draft as any).previewVersions.length ? (draft as any).previewVersions : seeded.versions;
      const cleanedBase = (baseVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
      const newId = `pv-${now}-${Math.random().toString(16).slice(2, 8)}`;
      const next: Location = {
        ...draft,
        previewUrl: out.imageUrl,
        previewVersions: [
          ...cleanedBase,
          { id: newId, imageUrl: out.imageUrl, createdAt: now, type: cleanedBase.length ? 'variation' : 'base' },
        ] as any,
        activePreviewVersionId: newId as any,
        assetState: {
          status: 'done',
          lastError: '',
          lastAttemptAt: now,
          attempts: (draft.assetState?.attempts || 0) + 1,
        },
      };
      setDraft(next);
      // Auto-persist generated assets so they don't disappear on navigation/refresh.
      onSave(next);
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  const previewVersions = (draft as any).previewVersions || seedPreviewVersions(draft).versions;
  const nonPlaceholderPreviewVersions = (previewVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
  const displayPreviewVersions = nonPlaceholderPreviewVersions.length ? nonPlaceholderPreviewVersions : previewVersions;
  const activePreviewVersionId = (draft as any).activePreviewVersionId || displayPreviewVersions[displayPreviewVersions.length - 1]?.id || '';

  const handleSelectPreviewVariant = (versionId: string) => {
    const v = (previewVersions || []).find((x: any) => String(x?.id || '') === String(versionId));
    if (!v?.imageUrl) return;
    const next: Location = {
      ...draft,
      previewUrl: String(v.imageUrl),
      previewVersions,
      activePreviewVersionId: String(versionId) as any,
    };
    setDraft(next);
    onSave(next);
  };

  return (
    <div className="flex-1 h-full bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-16 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between px-8">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500 border border-emerald-500/20">
                <MapPin className="w-5 h-5" />
            </div>
            <div>
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white tracking-tight">Set Design: {draft.name}</h2>
                    {isDirty && <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-mono">Unsaved Changes</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="uppercase tracking-wider font-semibold">Environment Asset</span>
                    <span>•</span>
                    <span className={draft.status === 'locked' ? 'text-emerald-400 flex items-center gap-1' : 'text-zinc-400'}>
                        {draft.status === 'locked' ? <><Lock className="w-3 h-3"/> Approved (Locked)</> : 'Status: Draft'}
                    </span>
                    <span>•</span>
                    <span>Used in {usedInShots.length} Shots</span>
                </div>
            </div>
        </div>
        <div className="flex gap-3">
             <button 
                onClick={handleGeneratePreview}
                disabled={!canGenerate || isLocked || isGeneratingPreview}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg ${
                    !canGenerate || isLocked
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/10'
                }`}
                title={!canGenerate ? 'Image provider is Mock' : 'Generate a new variant'}
             >
                <Sparkles className={`w-4 h-4 ${isGeneratingPreview ? 'animate-pulse' : ''}`} />
                {isGeneratingPreview ? 'Generating...' : 'Generate Variant'}
             </button>
             <button 
                onClick={handleSave}
                disabled={!isDirty}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg ${
                    isDirty
                    ? 'bg-zinc-100 text-black hover:bg-white shadow-white/5'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                }`}
             >
                <Save className="w-4 h-4" /> 
                {isDirty ? 'Save Changes' : 'Saved'}
             </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
         {/* Left: Visualization (Master Shot & Usage) */}
         <div className="flex-1 p-8 bg-black/20 overflow-y-auto custom-scrollbar">
             <div className="flex flex-col gap-6 max-w-5xl mx-auto">
                {/* Master Reference */}
	                <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden shadow-2xl border border-zinc-800 group">
	                    <img 
	                        src={draft.previewUrl} 
	                        className="w-full h-full object-cover cursor-zoom-in" 
	                        onClick={() => draft.previewUrl && openLightbox({ url: draft.previewUrl, title: `Environment: ${draft.name}` })}
	                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>
                    
                    <div className="absolute bottom-6 left-6 right-6">
                        <div className="bg-black/60 backdrop-blur-md border border-white/10 p-4 rounded-xl">
                            <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Master Shot Reference</h3>
                            <p className="text-sm text-white font-medium">Controls the lighting, architecture, and mood for all shots in this set.</p>
                        </div>
                    </div>
                </div>

                {displayPreviewVersions.length > 1 && (
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Variants</div>
                            <div className="text-[10px] text-zinc-500 font-mono">{displayPreviewVersions.length}</div>
                        </div>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar">
	                            {displayPreviewVersions.slice().reverse().map((v: any) => {
	                                const isActive = String(v.id) === String(activePreviewVersionId);
	                                return (
	                                    <button
	                                        key={String(v.id)}
	                                        onClick={() => handleSelectPreviewVariant(String(v.id))}
	                                        className={`relative w-28 aspect-video rounded-xl overflow-hidden border-2 shrink-0 transition-all ${
	                                            isActive ? 'border-emerald-500' : 'border-zinc-800 hover:border-zinc-600'
	                                        }`}
	                                        title={isActive ? 'Active' : 'Set active'}
	                                    >
		                                        <img src={String(v.imageUrl)} className="w-full h-full object-cover" />
	                                        <button
	                                          type="button"
	                                          className="absolute top-1 right-1 p-1 rounded-md bg-black/60 text-white hover:bg-black/80 border border-white/10"
	                                          title="View large"
	                                          onClick={(e) => {
	                                            e.stopPropagation();
	                                            openLightbox({ url: String(v.imageUrl), title: `Environment variant: ${draft.name}` });
	                                          }}
	                                        >
	                                          <ZoomIn className="w-3.5 h-3.5" />
	                                        </button>
	                                    </button>
	                                );
	                            })}
	                        </div>
		                    </div>
		                )}

                {generationError && (
                    <div className="text-xs text-rose-300/90 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-3">
                        Generate failed: {generationError}
                    </div>
                )}
                
                {/* Used In Gallery */}
                <div>
                     <div className="flex items-center gap-2 mb-4 text-zinc-400 text-sm font-bold uppercase tracking-wider">
                         <Film className="w-4 h-4" />
                         Timeline Appearances ({usedInShots.length})
                     </div>
                     
                     <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {usedInShots.map(({ shot, seqId }) => (
                            <div 
                                key={shot.id} 
                                onClick={() => onSelectShot && onSelectShot(shot.id, seqId)}
                                className="group relative aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-indigo-500 cursor-pointer transition-all"
                            >
	                                <img
	                                  src={shot.thumbnailUrl}
	                                  className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity cursor-zoom-in"
	                                  onClick={(e) => {
	                                    e.stopPropagation();
	                                    openLightbox({ url: shot.thumbnailUrl, title: `Shot #${shot.sequence}` });
	                                  }}
	                                />
                                <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-[10px] text-white backdrop-blur">
                                    #{shot.sequence}
                                </div>
                            </div>
                        ))}
                        {usedInShots.length === 0 && (
                            <div className="col-span-full py-8 text-center text-zinc-600 text-xs border border-dashed border-zinc-800 rounded-lg">
                                This set is currently unused in the script.
                            </div>
                        )}
                     </div>
                </div>
             </div>
         </div>

         {/* Right: Controls */}
         <div className="w-96 border-l border-zinc-800 bg-zinc-950 p-6 overflow-y-auto">
            <div className="space-y-6">
                
                {/* Status Dropdown */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
                    <label className="text-[10px] text-zinc-500 font-bold uppercase mb-2 block">Asset Status</label>
                    <div className="flex gap-2">
                        {isLocked ? (
                            <button 
                                onClick={() => setDraft({...draft, status: 'draft'})}
                                className="w-full py-2 flex items-center justify-center gap-2 text-xs font-medium rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                            >
                                <Unlock className="w-3 h-3" />
                                Unlock to Edit
                            </button>
                        ) : (
                            <div className="flex w-full bg-zinc-950 rounded border border-zinc-800 p-1">
                                <button 
                                    onClick={() => setDraft({...draft, status: 'draft'})}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-all ${draft.status === 'draft' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    Draft
                                </button>
                                <button 
                                    onClick={() => setDraft({...draft, status: 'locked'})}
                                    className={`flex-1 py-1.5 text-xs font-medium rounded transition-all ${draft.status === 'locked' ? 'bg-emerald-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    Approve
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Locked Banner */}
                {isLocked && (
                    <div className="flex items-center gap-2 p-3 bg-zinc-900/80 border border-zinc-800 rounded-lg text-zinc-500 text-xs">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Fields are read-only while approved.</span>
                    </div>
                )}

                <div>
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
                        <MapPin className="w-3.5 h-3.5" />
                        Location Name
                    </label>
                    <input 
                        type="text"
                        disabled={isLocked}
                        value={draft.name}
                        onChange={(e) => setDraft({...draft, name: e.target.value})}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 transition-all font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                </div>

                <div>
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
                        <Wand2 className="w-3.5 h-3.5" />
                        Visual Prompt (Environment)
                    </label>
                    <textarea 
                        disabled={isLocked}
                        value={draft.description}
                        onChange={(e) => setDraft({...draft, description: e.target.value})}
                        className="w-full h-40 bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-300 leading-relaxed focus:outline-none focus:border-emerald-500/50 resize-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        placeholder="Detailed environment description..."
                    />
                </div>

                <div>
                    <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">
                        <ImageIcon className="w-3.5 h-3.5" />
                        Style & Atmosphere
                    </label>
                    <textarea 
                        disabled={isLocked}
                        value={draft.visualStyle}
                        onChange={(e) => setDraft({...draft, visualStyle: e.target.value})}
                        className="w-full h-24 bg-zinc-900 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-300 leading-relaxed focus:outline-none focus:border-emerald-500/50 resize-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        placeholder="Cinematography style, film stock, lighting mood..."
                    />
                </div>
                
                {isDirty && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg text-amber-500/80 text-xs mt-4">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>You have unsaved changes. Save to commit them to the library.</span>
                    </div>
                )}
            </div>
         </div>
      </div>
    </div>
  );
};
