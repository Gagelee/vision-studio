
import React, { useEffect, useState } from 'react';
import { AlertCircle, Edit3, Film, Image as ImageIcon, Lock, Plus, Save, Shirt, Sparkles, Trash2, Unlock, User, Wand2, ZoomIn } from 'lucide-react';
import { Character, CharacterLook, ModelRuntimeSettings, Sequence, Shot } from '../../types';
import { generateImageFromPrompt } from '../../lib/ai/image/generate';
import { buildCharacterAvatarPrompt, buildCharacterLookPrompt } from '../../lib/ai/prompts';
import { openLightbox } from '../../lib/ui/lightboxStore';
import { getCharacterActiveAvatarUrl, getLookActivePreviewUrl, isLikelyPlaceholderImageUrl } from '../../lib/ai/assetRefs';

interface CharacterEditorProps {
  character: Character;
  sequences?: Sequence[];
  onSave: (character: Character) => void;
  onPropagate: (characterId: string) => void;
  onSelectShot?: (shotId: string, seqId: string) => void;
  imageSettings?: ModelRuntimeSettings;
  keyVisualUrl?: string;
  styleGuide?: string;
}

export const CharacterEditor: React.FC<CharacterEditorProps> = ({
  character,
  sequences = [],
  onSave,
  onPropagate,
  onSelectShot,
  imageSettings,
  keyVisualUrl,
  styleGuide,
}) => {
  const seedAvatarVersions = (c: Character) => {
    const existing = Array.isArray((c as any).avatarVersions) ? (c as any).avatarVersions : [];
    if (existing.length) return { versions: existing, activeId: (c as any).activeAvatarVersionId || existing[existing.length - 1]?.id || '' };
    const url = String(c.avatarUrl || '').trim();
    if (!url) return { versions: [], activeId: '' };
    const id = 'av-1';
    const isDone = (c as any)?.assetState?.status === 'done';
    return { versions: [{ id, imageUrl: url, createdAt: Date.now(), type: isDone ? 'base' : 'placeholder' }], activeId: id };
  };

  const seedLookPreviewVersions = (look: CharacterLook) => {
    const existing = Array.isArray((look as any).previewVersions) ? (look as any).previewVersions : [];
    if (existing.length) return { versions: existing, activeId: (look as any).activePreviewVersionId || existing[existing.length - 1]?.id || '' };
    const url = String(look.previewUrl || '').trim();
    if (!url) return { versions: [], activeId: '' };
    const id = 'lv-1';
    const isDone = (look as any)?.assetState?.status === 'done';
    return { versions: [{ id, imageUrl: url, createdAt: Date.now(), type: isDone ? 'base' : 'placeholder' }], activeId: id };
  };

  const normalizeDraft = (c: Character): Character => {
    const seededAvatar = seedAvatarVersions(c);
    const nextLooks = (c.looks || []).map((lk) => {
      const existing = Array.isArray((lk as any).previewVersions) ? (lk as any).previewVersions : [];
      if (existing.length) return lk;
      const seeded = seedLookPreviewVersions(lk);
      if (!seeded.versions.length) return lk;
      return { ...lk, previewVersions: seeded.versions, activePreviewVersionId: seeded.activeId } as any;
    });

    const hasAvatarVersions = Array.isArray((c as any).avatarVersions) && (c as any).avatarVersions.length;
    const avatarPatch = hasAvatarVersions || !seededAvatar.versions.length ? {} : { avatarVersions: seededAvatar.versions, activeAvatarVersionId: seededAvatar.activeId };
    return { ...c, ...avatarPatch, looks: nextLooks } as any;
  };

  const [draft, setDraft] = useState<Character>(() => normalizeDraft(character));
  const [editingLook, setEditingLook] = useState<CharacterLook | null>(null);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generatingLookIds, setGeneratingLookIds] = useState<Record<string, boolean>>({});
  const [generationError, setGenerationError] = useState<string | null>(null);
  
  useEffect(() => {
    setDraft(normalizeDraft(character));
  }, [character.id]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(character);
  const isLocked = draft.status === 'locked';
  const canGenerate = Boolean(imageSettings && imageSettings.provider !== 'mock');

  const handleAddLook = () => {
    const newLook: CharacterLook = {
      id: `look-${Date.now()}`,
      name: 'New Style',
      description: 'Describe wardrobe and makeup...',
      previewUrl: draft.avatarUrl || ''
    };
    const next = { ...draft, looks: [...draft.looks, newLook] };
    setDraft(next);
    onSave(next);
  };

  const handleRemoveLook = (id: string) => {
    const target = draft.looks.find((l) => l.id === id);
    const label = target?.name ? `"${target.name}"` : 'this look';
    if (!window.confirm(`Delete ${label}?`)) return;
    const next = { ...draft, looks: draft.looks.filter(l => l.id !== id) };
    setDraft(next);
    onSave(next);
  };

  const handleUpdateLook = (look: CharacterLook) => {
    const next = { ...draft, looks: draft.looks.map(l => l.id === look.id ? look : l) };
    setDraft(next);
    onSave(next);
    setEditingLook(null);
  };

  const usedInShots: { shot: Shot; seqId: string }[] = [];
  sequences.forEach(seq => {
      seq.shots.forEach(shot => {
          if (shot.elements.CASTING.metadata?.characters?.some((c: any) => c.id === character.id)) {
              usedInShots.push({ shot, seqId: seq.id });
          }
      });
  });

  const handleGenerateAvatar = async () => {
    if (!imageSettings || imageSettings.provider === 'mock' || isLocked || isGeneratingAvatar) return;
    setGenerationError(null);
    setIsGeneratingAvatar(true);
    try {
      const out = await generateImageFromPrompt({
        prompt: buildCharacterAvatarPrompt(draft, styleGuide),
        settings: imageSettings,
        aspectRatio: '1:1',
        strict: true,
      });
      const now = Date.now();
      const seeded = seedAvatarVersions(draft);
      const baseVersions =
        Array.isArray((draft as any).avatarVersions) && (draft as any).avatarVersions.length ? (draft as any).avatarVersions : seeded.versions;
      const cleanedBase = (baseVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
      const newId = `av-${now}-${Math.random().toString(16).slice(2, 8)}`;
      const next: Character = {
        ...draft,
        avatarUrl: out.imageUrl,
        avatarVersions: [
          ...cleanedBase,
          { id: newId, imageUrl: out.imageUrl, createdAt: now, type: cleanedBase.length ? 'variation' : 'base' },
        ] as any,
        activeAvatarVersionId: newId as any,
        assetState: {
          status: 'done',
          lastError: '',
          lastAttemptAt: now,
          attempts: (draft.assetState?.attempts || 0) + 1,
        },
      };
      setDraft(next);
      onSave(next);
      if (next.looks && next.looks.length) {
        const ok = window.confirm('Generate look variants for this new avatar?');
        if (ok) {
          for (const look of next.looks) {
            await handleGenerateLook(look, next);
          }
        }
      }
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const avatarVersions = (draft as any).avatarVersions || seedAvatarVersions(draft).versions;
  const nonPlaceholderAvatarVersions = (avatarVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
  const displayAvatarVersions = nonPlaceholderAvatarVersions.length ? nonPlaceholderAvatarVersions : avatarVersions;
  const activeAvatarVersionId = (draft as any).activeAvatarVersionId || displayAvatarVersions[displayAvatarVersions.length - 1]?.id || '';

  const applyAvatarSelection = (nextVersions: any[], nextActiveId: string) => {
    const active = nextVersions.find((x: any) => String(x?.id || '') === String(nextActiveId)) || nextVersions[nextVersions.length - 1];
    if (!active?.imageUrl) return;
    const nextLooks = (draft.looks || []).map((look) => {
      const seeded = seedLookPreviewVersions(look);
      const versions = (look as any).previewVersions || seeded.versions;
      const match = (versions || []).find((ver: any) => String(ver?.metadata?.sourceAvatarVersionId || '') === String(active.id));
      if (!match) {
        return { ...look, previewUrl: '', previewVersions: versions, activePreviewVersionId: '' as any };
      }
      return { ...look, previewUrl: String(match.imageUrl), previewVersions: versions, activePreviewVersionId: String(match.id) as any };
    });
    const next: Character = {
      ...draft,
      avatarUrl: String(active.imageUrl),
      avatarVersions: nextVersions,
      activeAvatarVersionId: String(active.id) as any,
      looks: nextLooks,
    };
    setDraft(next);
    onSave(next);
  };

  const handleSelectAvatarVariant = (versionId: string) => {
    const v = (avatarVersions || []).find((x: any) => String(x?.id || '') === String(versionId));
    if (!v?.imageUrl) return;
    applyAvatarSelection(avatarVersions, String(versionId));
  };

  const handleDeleteAvatarVariant = (versionId: string) => {
    if (!window.confirm('Delete this avatar variant?')) return;
    const versions = (avatarVersions || []).filter((v: any) => String(v?.id || '') !== String(versionId));
    if (versions.length === 0) return;
    const nextActiveId =
      String(activeAvatarVersionId || '') === String(versionId)
        ? String(versions[versions.length - 1]?.id || '')
        : String(activeAvatarVersionId || '');
    applyAvatarSelection(versions, nextActiveId);
  };

  const handleGenerateLook = async (look: CharacterLook, characterOverride?: Character) => {
    if (!imageSettings || imageSettings.provider === 'mock' || isLocked) return;
    setGenerationError(null);
    setGeneratingLookIds((m) => ({ ...m, [look.id]: true }));
    try {
      const baseCharacter = characterOverride || draft;
      const avatarUrl = getCharacterActiveAvatarUrl(baseCharacter, { activeOnly: true });
      if (!avatarUrl || isLikelyPlaceholderImageUrl(avatarUrl)) {
        throw new Error('Blocked: Base character avatar not generated yet. Please generate the avatar first.');
      }
      const refs = [{ url: avatarUrl, label: 'character base avatar' }];
      const out = await generateImageFromPrompt({
        prompt:
          buildCharacterLookPrompt(baseCharacter, look, styleGuide) +
          `\n\nKeep the exact same character identity as the reference avatar (same person, same face). Only change wardrobe/makeup/style described for this look.`,
        settings: imageSettings,
        aspectRatio: '1:1',
        references: refs,
        strict: true,
        requireAllReferences: true,
      });
      const now = Date.now();
      const seededLook = seedLookPreviewVersions(look);
      const baseVersions =
        Array.isArray((look as any).previewVersions) && (look as any).previewVersions.length ? (look as any).previewVersions : seededLook.versions;
      const cleanedBase = (baseVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
      const newId = `lv-${now}-${Math.random().toString(16).slice(2, 8)}`;
      const activeAvatarId = String(activeAvatarVersionId || '').trim();
      const next: Character = {
        ...baseCharacter,
        looks: (baseCharacter.looks || []).map((l) =>
          l.id === look.id
            ? {
                ...l,
                previewUrl: out.imageUrl,
                previewVersions: [
                  ...cleanedBase,
                  {
                    id: newId,
                    imageUrl: out.imageUrl,
                    createdAt: now,
                    type: cleanedBase.length ? 'variation' : 'base',
                    metadata: activeAvatarId ? { sourceAvatarVersionId: activeAvatarId } : undefined,
                  },
                ] as any,
                activePreviewVersionId: newId as any,
                assetState: {
                  status: 'done',
                  lastError: '',
                  lastAttemptAt: now,
                  attempts: (l.assetState?.attempts || 0) + 1,
                },
              }
            : l,
        ),
      };
      setDraft(next);
      onSave(next);
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingLookIds((m) => ({ ...m, [look.id]: false }));
    }
  };

  const handleSelectLookVariant = (lookId: string, versionId: string) => {
    const lk = (draft.looks || []).find((l) => l.id === lookId);
    if (!lk) return;
    const seeded = seedLookPreviewVersions(lk);
    const versions = (lk as any).previewVersions || seeded.versions;
    const v = (versions || []).find((x: any) => String(x?.id || '') === String(versionId));
    if (!v?.imageUrl) return;
    const avatarVersionId = String(activeAvatarVersionId || '').trim();
    const nextVersions = (versions || []).map((ver: any) => {
      if (String(ver?.id || '') !== String(versionId)) return ver;
      if (!avatarVersionId) return ver;
      if (String(ver?.metadata?.sourceAvatarVersionId || '') === avatarVersionId) return ver;
      return { ...ver, metadata: { ...(ver?.metadata || {}), sourceAvatarVersionId: avatarVersionId } };
    });
    const next: Character = {
      ...draft,
      looks: (draft.looks || []).map((l) =>
        l.id === lookId
          ? { ...l, previewUrl: String(v.imageUrl), previewVersions: nextVersions, activePreviewVersionId: String(versionId) as any }
          : l,
      ),
    };
    setDraft(next);
    onSave(next);
  };

  return (
    <div className="flex-1 h-full bg-zinc-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-16 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between px-8">
        <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-500 border border-indigo-500/20">
                <User className="w-5 h-5" />
            </div>
            <div>
                <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white tracking-tight">Character Profile: {draft.name}</h2>
                    {isDirty && <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 font-mono">Unsaved Changes</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span className="uppercase tracking-wider font-semibold">Casting Asset</span>
                    <span>•</span>
                    <span className={isLocked ? 'text-indigo-400 flex items-center gap-1' : 'text-zinc-400'}>
                        {isLocked ? <><Lock className="w-3 h-3"/> Approved</> : 'Status: Draft'}
                    </span>
                    <span>•</span>
                    <span>In {usedInShots.length} Beats</span>
                </div>
            </div>
        </div>
        <button 
          onClick={() => onSave(draft)}
          disabled={!isDirty}
          className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-bold transition-all ${isDirty ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}
        >
          <Save className="w-4 h-4" /> Save Master
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
         {/* Main Workspace */}
         <div className="flex-1 p-8 bg-black/20 overflow-y-auto custom-scrollbar">
             <div className="max-w-4xl mx-auto space-y-12 pb-20">
                
                {/* Base Identity (Avatar) */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <ImageIcon className="w-5 h-5 text-indigo-500" />
                            <h3 className="text-lg font-bold text-white">Base Character Identity</h3>
                        </div>
                        <button
                          onClick={handleGenerateAvatar}
                          disabled={!canGenerate || isLocked || isGeneratingAvatar}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            !canGenerate || isLocked
                              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                          title={!canGenerate ? 'Image provider is Mock' : 'Generate base avatar'}
                        >
                          <Sparkles className={`w-4 h-4 ${isGeneratingAvatar ? 'animate-pulse' : ''}`} />
                          {isGeneratingAvatar ? 'Generating...' : draft.avatarUrl ? 'Generate Variant' : 'Generate Avatar'}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
	                      <div className="relative w-full max-w-md aspect-square bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl">
	                          <img
	                            src={draft.avatarUrl}
	                            className="w-full h-full object-cover cursor-zoom-in"
	                            onClick={() => draft.avatarUrl && openLightbox({ url: draft.avatarUrl, title: `Character: ${draft.name}` })}
	                          />
	                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-70"></div>
	                      </div>
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-3">Workflow</div>
                        <div className="text-sm text-zinc-200 font-bold">1) Generate Avatar</div>
                        <div className="text-sm text-zinc-400 mt-1 leading-relaxed">
                          This is the “identity anchor”. Generate it first, then generate each Look using this avatar as a reference.
                        </div>
                        {!draft.avatarUrl && (
                          <div className="mt-4 text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3">
                            Avatar URL is empty. Generate an avatar before generating Looks for best consistency.
                          </div>
                        )}
                      </div>
                    </div>

                    {displayAvatarVersions.length > 1 && (
                      <div className="mt-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Avatar Variants</div>
                          <div className="text-[10px] text-zinc-500 font-mono">{displayAvatarVersions.length}</div>
                        </div>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar">
	                          {displayAvatarVersions.slice().reverse().map((v: any) => {
	                            const isActive = String(v.id) === String(activeAvatarVersionId);
	                            return (
	                              <button
	                                key={String(v.id)}
	                                onClick={() => handleSelectAvatarVariant(String(v.id))}
	                                className={`relative group w-20 aspect-square rounded-xl overflow-hidden border-2 shrink-0 transition-all ${
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
	                                    openLightbox({ url: String(v.imageUrl), title: `Avatar variant: ${draft.name}` });
	                                  }}
	                                >
	                                  <ZoomIn className="w-3.5 h-3.5" />
	                                </button>
                                  {displayAvatarVersions.length > 1 && (
                                    <button
                                      type="button"
                                      className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity"
                                      title="Delete variant"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteAvatarVariant(String(v.id));
                                      }}
                                    >
                                      ✕
                                    </button>
                                  )}
	                              </button>
		                            );
		                          })}
	                        </div>
	                      </div>
	                    )}
                    {generationError && (
                      <div className="mt-4 text-xs text-rose-300/90 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-3">
                        Generate failed: {generationError}
                      </div>
                    )}
                </section>

                {/* Look Management Section */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <Shirt className="w-5 h-5 text-indigo-500" />
                            <h3 className="text-lg font-bold text-white">Visual Looks & Wardrobe</h3>
                        </div>
                        {!isLocked && (
                          <button onClick={handleAddLook} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all">
                              <Plus className="w-4 h-4" /> Add New Look
                          </button>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
	                    {draft.looks.map((look) => {
                        const seeded = seedLookPreviewVersions(look);
                        const lookVersions = (look as any).previewVersions || seeded.versions;
                        const nonPlaceholderLookVersions = (lookVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
                        const displayLookVersions = nonPlaceholderLookVersions.length ? nonPlaceholderLookVersions : lookVersions;
                        const activeLookVersionId = String((look as any).activePreviewVersionId || '').trim();
                        const activeLookUrl = getLookActivePreviewUrl(look, { activeOnly: true });
                        const boundLookVersions = activeAvatarVersionId
                          ? displayLookVersions.filter((v: any) => String(v?.metadata?.sourceAvatarVersionId || '') === String(activeAvatarVersionId))
                          : [];
                        const showLookVariants = boundLookVersions.length > 1;
                        return (
                          <div
                            key={look.id}
                            className="group relative bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex gap-4 hover:border-indigo-500/50 transition-all shadow-xl"
                          >
                            <div className="w-32 h-40 rounded-xl bg-zinc-800 overflow-hidden shrink-0 border border-white/5 flex items-center justify-center">
                              {activeLookUrl ? (
                                <img
                                  src={activeLookUrl}
                                  className="w-full h-full object-cover cursor-zoom-in"
                                  onClick={() => openLightbox({ url: activeLookUrl, title: `Look: ${draft.name} / ${look.name}` })}
                                />
                              ) : (
                                <div className="flex flex-col items-center justify-center text-zinc-500 text-xs">
                                  <ImageIcon className="w-5 h-5 mb-1" />
                                  No look image
                                </div>
                              )}
                            </div>
                            <div className="flex-1 flex flex-col">
                              <div className="flex justify-between items-start mb-1">
                                <h4 className="font-bold text-white">{look.name}</h4>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleGenerateLook(look)}
                                    disabled={!canGenerate || isLocked || Boolean(generatingLookIds[look.id])}
                                    className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border transition-all ${
                                      !canGenerate || isLocked
                                        ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                                        : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20'
                                    }`}
                                    title={!draft.avatarUrl ? 'Generate avatar first for best identity consistency' : 'Generate look variant'}
                                  >
                                    {generatingLookIds[look.id] ? 'Gen…' : look.previewUrl ? 'Variant' : 'Generate'}
                                  </button>
                                  <button
                                    onClick={() => setEditingLook(look)}
                                    className="p-1.5 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-md"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleRemoveLook(look.id)}
                                    className="p-1.5 text-zinc-400 hover:text-rose-500 bg-white/5 hover:bg-white/10 rounded-md"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">{look.description}</p>

		                              {showLookVariants && (
		                                <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
		                                  {boundLookVersions.slice().reverse().map((v: any) => {
		                                    const isActive = String(v.id) === String(activeLookVersionId);
		                                    return (
	                                      <button
	                                        key={String(v.id)}
	                                        onClick={() => handleSelectLookVariant(look.id, String(v.id))}
	                                        className={`relative w-16 aspect-square rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
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
	                                            openLightbox({ url: String(v.imageUrl), title: `Look variant: ${draft.name} / ${look.name}` });
	                                          }}
	                                        >
	                                          <ZoomIn className="w-3.5 h-3.5" />
	                                        </button>
	                                      </button>
	                                    );
	                                  })}
	                                </div>
	                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                </section>

                {/* Appearance Prompt */}
                <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
                    <div>
                        <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">
                            <Wand2 className="w-4 h-4" /> Identity Constitution
                        </label>
                        <textarea 
                            disabled={isLocked}
                            value={draft.description}
                            onChange={(e) => setDraft({...draft, description: e.target.value})}
                            className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-2xl p-6 text-sm text-zinc-200 leading-relaxed focus:outline-none focus:border-indigo-500/50 resize-none transition-all disabled:opacity-50"
                            placeholder="Describe permanent facial features, body type, and aura..."
                        />
                    </div>
                </section>
             </div>
         </div>

         {/* Sidebar Controls */}
         <div className="w-80 border-l border-zinc-800 bg-zinc-950 p-6">
            <div className="space-y-6">
                <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Casting Name</label>
                    <input 
                        disabled={isLocked}
                        value={draft.name}
                        onChange={(e) => setDraft({...draft, name: e.target.value})}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white font-bold"
                    />
                </div>
                
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">Approval Status</label>
                    <button 
                        onClick={() => setDraft({...draft, status: isLocked ? 'draft' : 'locked'})}
                        className={`w-full py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all ${isLocked ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}
                    >
                        {isLocked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                        {isLocked ? 'Unlock Asset' : 'Approve for Production'}
                    </button>
                </div>
            </div>
         </div>
      </div>

      {/* Edit Look Modal */}
      {editingLook && (
          <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-zinc-900 border border-zinc-800 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95">
                  <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                      <h3 className="text-lg font-bold text-white">Edit Look: {editingLook.name}</h3>
                      <button onClick={() => setEditingLook(null)} className="text-zinc-500 hover:text-white transition-colors">
                          <X className="w-6 h-6" />
                      </button>
                  </div>
                  <div className="p-6 space-y-4">
                      <div>
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Look Label</label>
                          <input 
                            value={editingLook.name}
                            onChange={(e) => setEditingLook({...editingLook, name: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white"
                          />
                      </div>
                      <div>
                          <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Description (Wardrobe/Makeup)</label>
                          <textarea 
                            value={editingLook.description}
                            onChange={(e) => setEditingLook({...editingLook, description: e.target.value})}
                            className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-zinc-300 resize-none"
                          />
                      </div>
                  </div>
                  <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex justify-end gap-3">
                      <button onClick={() => setEditingLook(null)} className="px-4 py-2 text-zinc-500 font-bold hover:text-white transition-colors">Cancel</button>
                      <button onClick={() => handleUpdateLook(editingLook)} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/20">Apply Look</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

const X = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
);
