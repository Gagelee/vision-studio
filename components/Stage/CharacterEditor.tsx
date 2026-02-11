
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Clock, Edit3, Film, Image as ImageIcon, Info, Lock, Plus, Save, Shirt, Sparkles, Trash2, Unlock, User, Wand2, ZoomIn, Upload, Loader2 } from 'lucide-react';
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
  const persistDraftIfDirty = (nextDraft?: Character) => {
    const current = nextDraft || draftRef.current;
    if (JSON.stringify(current) === JSON.stringify(normalizedCharacter)) return;
    onSave(current);
  };
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

  const mergeRuntimeAssetFields = (baseDraft: Character, source: Character): Character => {
    if (String(baseDraft.id || '') !== String(source.id || '')) return normalizeDraft(source);
    const baseByLookId = new Map((baseDraft.looks || []).map((lk) => [String(lk.id), lk]));
    // Runtime source is authoritative: remove looks that no longer exist upstream.
    const mergedLooks = (source.looks || []).map((src) => {
      const lk = baseByLookId.get(String(src.id));
      if (!lk) return src;
      return {
        ...lk,
        ...src,
        previewUrl: src.previewUrl,
        previewVersions: (src as any).previewVersions,
        activePreviewVersionId: (src as any).activePreviewVersionId,
        assetState: (src as any).assetState,
      } as any;
    });
    return normalizeDraft({
      ...baseDraft,
      avatarUrl: source.avatarUrl,
      assetState: source.assetState,
      looks: mergedLooks,
      ...(Array.isArray((source as any).avatarVersions) ? { avatarVersions: (source as any).avatarVersions } : {}),
      ...((source as any).activeAvatarVersionId ? { activeAvatarVersionId: (source as any).activeAvatarVersionId } : {}),
    } as any);
  };

  const normalizedCharacter = useMemo(() => normalizeDraft(character), [character]);
  const [draft, setDraft] = useState<Character>(() => normalizedCharacter);
  const draftRef = useRef<Character>(draft);
  const lastCharacterIdRef = useRef<string>(String(character.id || ''));
  const [editingLook, setEditingLook] = useState<CharacterLook | null>(null);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generatingLookIds, setGeneratingLookIds] = useState<Record<string, boolean>>({});
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [pendingAvatarVariantId, setPendingAvatarVariantId] = useState<string | null>(null);
  const prevActiveAvatarVersionIdRef = useRef<string>('');
  const referenceInputRef = useRef<HTMLInputElement | null>(null);
  
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const nextId = String(character.id || '');
    const prevId = String(lastCharacterIdRef.current || '');
    const changedCharacter = nextId !== prevId;
    lastCharacterIdRef.current = nextId;
    if (changedCharacter) {
      setDraft(normalizedCharacter);
      prevActiveAvatarVersionIdRef.current = String((normalizedCharacter as any)?.activeAvatarVersionId || '').trim();
      return;
    }
    const dirty = JSON.stringify(draftRef.current) !== JSON.stringify(normalizedCharacter);
    if (!dirty) setDraft(normalizedCharacter);
  }, [character, normalizedCharacter]);

  useEffect(() => {
    setDraft((prev) => {
      const next = mergeRuntimeAssetFields(prev, character);
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [
    character.id,
    character.assetState?.status,
    (character as any)?.activeAvatarVersionId,
    (character as any)?.avatarUrl,
    (character as any)?.avatarVersions,
    character.looks,
  ]);

  useEffect(() => {
    // If runtime state already settled, clear any stale local busy flags.
    setGeneratingLookIds((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const lk of character.looks || []) {
        const st = String((lk as any)?.assetState?.status || '').toLowerCase();
        if ((st === 'done' || st === 'error' || st === 'blocked') && next[lk.id]) {
          next[lk.id] = false;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [character.looks]);

  const isLookBoundToAvatar = (look: CharacterLook, avatarVersionId: string) => {
    const activeId = String((look as any)?.activePreviewVersionId || '').trim();
    if (!activeId || !avatarVersionId) return false;
    const versions = Array.isArray((look as any)?.previewVersions) ? (look as any).previewVersions : [];
    const active = versions.find((v: any) => String(v?.id || '') === activeId);
    return String(active?.metadata?.sourceAvatarVersionId || '').trim() === String(avatarVersionId || '').trim();
  };

  useEffect(() => {
    const currentAvatarVersionId = String((draft as any)?.activeAvatarVersionId || '').trim();
    const prevAvatarVersionId = String(prevActiveAvatarVersionIdRef.current || '').trim();
    if (!prevAvatarVersionId) {
      prevActiveAvatarVersionIdRef.current = currentAvatarVersionId;
      return;
    }
    if (!currentAvatarVersionId || currentAvatarVersionId === prevAvatarVersionId) return;
    const looks = Array.isArray(draft.looks) ? draft.looks : [];
    const hasUnboundLooks = looks.length > 0 && looks.some((lk) => !isLookBoundToAvatar(lk, currentAvatarVersionId));
    if (hasUnboundLooks) setPendingAvatarVariantId(currentAvatarVersionId);
    prevActiveAvatarVersionIdRef.current = currentAvatarVersionId;
  }, [draft.activeAvatarVersionId, draft.looks]);

  const isDirty = JSON.stringify(draft) !== JSON.stringify(normalizedCharacter);
  const isLocked = draft.status === 'locked';
  const canGenerate = Boolean(imageSettings && imageSettings.provider !== 'mock');
  const avatarStatus = character.assetState?.status || draft.assetState?.status;
  const isAvatarBusy = isGeneratingAvatar || avatarStatus === 'running' || avatarStatus === 'queued';
  const referenceImages = Array.isArray((draft as any).referenceImages) ? (draft as any).referenceImages : [];
  const maxReferenceImages = 4;
  const normalizeImageUrl = (u: any) => String(u || '').trim().split('#')[0].split('?')[0].replace(/\/$/, '');
  const useReferenceImages = (draft as any).referenceMode !== 'off';

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
    if (!imageSettings || imageSettings.provider === 'mock' || isLocked || isAvatarBusy) return;
    setGenerationError(null);
    setIsGeneratingAvatar(true);
    try {
      const references = useReferenceImages
        ? referenceImages
            .slice(0, maxReferenceImages)
            .map((r: any) => ({ url: String(r?.url || ''), label: r?.name ? String(r.name) : 'character reference' }))
            .filter((r: any) => r.url)
        : [];
      const out = await generateImageFromPrompt({
        prompt: buildCharacterAvatarPrompt(draft, styleGuide),
        settings: imageSettings,
        aspectRatio: '1:1',
        references,
        requireAllReferences: false,
        strict: true,
      });
      const now = Date.now();
      const seeded = seedAvatarVersions(draft);
      const baseVersions =
        Array.isArray((draft as any).avatarVersions) && (draft as any).avatarVersions.length ? (draft as any).avatarVersions : seeded.versions;
      const cleanedBase = (baseVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
      const existingHit = (cleanedBase || []).find((v: any) => normalizeImageUrl(v?.imageUrl) === normalizeImageUrl(out.imageUrl));
      const newId = existingHit ? String(existingHit.id || '') : `av-${now}-${Math.random().toString(16).slice(2, 8)}`;
      const nextAvatarVersions = existingHit
        ? (cleanedBase || []).map((v: any) =>
            String(v?.id || '') === String(existingHit.id || '')
              ? {
                  ...v,
                  createdAt: now,
                  metadata: {
                    ...((v as any)?.metadata || {}),
                    prompt: String(out?.debug?.promptUsed || out?.debug?.promptUsedPreview || buildCharacterAvatarPrompt(draft, styleGuide) || '').slice(
                      0,
                      4000,
                    ),
                    references,
                    settings: {
                      provider: imageSettings.provider,
                      model: imageSettings.model,
                      temperature: imageSettings.temperature,
                    },
                    aspectRatio: '1:1',
                  },
                }
              : v,
          )
        : [
            ...cleanedBase,
            {
              id: newId,
              imageUrl: out.imageUrl,
              createdAt: now,
              type: cleanedBase.length ? 'variation' : 'base',
              metadata: {
                prompt: String(out?.debug?.promptUsed || out?.debug?.promptUsedPreview || buildCharacterAvatarPrompt(draft, styleGuide) || '').slice(
                  0,
                  4000,
                ),
                references,
                settings: {
                  provider: imageSettings.provider,
                  model: imageSettings.model,
                  temperature: imageSettings.temperature,
                },
                aspectRatio: '1:1',
              },
            },
          ];
      const next: Character = {
        ...draft,
        avatarUrl: out.imageUrl,
        avatarVersions: nextAvatarVersions as any,
        activeAvatarVersionId: newId as any,
        assetState: {
          status: 'done',
          lastError: '',
          lastAttemptAt: now,
          attempts: (draft.assetState?.attempts || 0) + 1,
        },
      };
      const selected = buildAvatarSelection(next, next.avatarVersions || [], newId) || next;
      setDraft(selected);
      onSave(selected);
      if (next.looks && next.looks.length) setPendingAvatarVariantId(newId);
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
      const failed: Character = {
        ...draft,
        assetState: {
          ...(draft as any).assetState,
          status: 'error',
          lastError: e instanceof Error ? e.message : String(e),
          lastAttemptAt: Date.now(),
        },
      };
      setDraft(failed);
      onSave(failed);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const avatarVersions = (draft as any).avatarVersions || seedAvatarVersions(draft).versions;
  const nonPlaceholderAvatarVersions = (avatarVersions || []).filter((v: any) => String(v?.type || '') !== 'placeholder');
  const displayAvatarVersions = nonPlaceholderAvatarVersions.length ? nonPlaceholderAvatarVersions : avatarVersions;
  const activeAvatarVersionId = (draft as any).activeAvatarVersionId || displayAvatarVersions[displayAvatarVersions.length - 1]?.id || '';

  const buildAvatarSelection = (base: Character, nextVersions: any[], nextActiveId: string) => {
    const active = nextVersions.find((x: any) => String(x?.id || '') === String(nextActiveId)) || nextVersions[nextVersions.length - 1];
    if (!active?.imageUrl) return;
    const nextLooks = (base.looks || []).map((look) => {
      const seeded = seedLookPreviewVersions(look);
      const versions = (look as any).previewVersions || seeded.versions;
      const match = (versions || []).find((ver: any) => String(ver?.metadata?.sourceAvatarVersionId || '') === String(active.id));
      if (!match) {
        return {
          ...look,
          previewUrl: '',
          previewVersions: versions,
          activePreviewVersionId: '' as any,
          assetState: {
            ...((look as any).assetState || {}),
            status: 'blocked',
            lastError: 'Look is not bound to the selected avatar. Regenerate look for this avatar.',
            lastAttemptAt: Date.now(),
          },
        };
      }
      return { ...look, previewUrl: String(match.imageUrl), previewVersions: versions, activePreviewVersionId: String(match.id) as any };
    });
    return {
      ...base,
      avatarUrl: String(active.imageUrl),
      avatarVersions: nextVersions,
      activeAvatarVersionId: String(active.id) as any,
      looks: nextLooks,
    };
  };

  const applyAvatarSelection = (nextVersions: any[], nextActiveId: string, base?: Character) => {
    const next = buildAvatarSelection(base || draft, nextVersions, nextActiveId);
    if (!next) return;
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

  const handleGenerateLook = async (look: CharacterLook, characterOverride?: Character): Promise<Character | null> => {
    if (!imageSettings || imageSettings.provider === 'mock' || isLocked) return;
    setGenerationError(null);
    setGeneratingLookIds((m) => ({ ...m, [look.id]: true }));
    try {
      const baseCharacter = characterOverride || draftRef.current;
      const running: Character = {
        ...baseCharacter,
        looks: (baseCharacter.looks || []).map((l) =>
          l.id === look.id
            ? {
                ...l,
                assetState: {
                  ...(l.assetState || {}),
                  status: 'running',
                  lastAttemptAt: Date.now(),
                },
              }
            : l,
        ),
      };
      setDraft(running);
      onSave(running);
      const avatarUrl = getCharacterActiveAvatarUrl(baseCharacter, { activeOnly: true });
      if (!avatarUrl || isLikelyPlaceholderImageUrl(avatarUrl)) {
        throw new Error('Blocked: Base character avatar not generated yet. Please generate the avatar first.');
      }
      const refs = [{ url: avatarUrl, label: 'character base avatar' }];
      const out = await generateImageFromPrompt({
        prompt: buildCharacterLookPrompt(baseCharacter, look, styleGuide),
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
      const existingHit = (cleanedBase || []).find((v: any) => normalizeImageUrl(v?.imageUrl) === normalizeImageUrl(out.imageUrl));
      const newId = existingHit ? String(existingHit.id || '') : `lv-${now}-${Math.random().toString(16).slice(2, 8)}`;
      const activeAvatarId = String((baseCharacter as any)?.activeAvatarVersionId || activeAvatarVersionId || '').trim();
      const next: Character = {
        ...baseCharacter,
        looks: (baseCharacter.looks || []).map((l) =>
          l.id === look.id
            ? {
                ...l,
                previewUrl: out.imageUrl,
                previewVersions: (
                  existingHit
                    ? (cleanedBase || []).map((v: any) =>
                        String(v?.id || '') === String(existingHit.id || '')
                          ? {
                              ...v,
                              createdAt: now,
                              metadata: {
                                ...((v as any)?.metadata || {}),
                                prompt: String(
                                  out?.debug?.promptUsed ||
                                    out?.debug?.promptUsedPreview ||
                                    buildCharacterLookPrompt(baseCharacter, look, styleGuide) ||
                                    '',
                                ).slice(0, 4000),
                                references: refs,
                                settings: {
                                  provider: imageSettings.provider,
                                  model: imageSettings.model,
                                  temperature: imageSettings.temperature,
                                },
                                aspectRatio: '1:1',
                                ...(activeAvatarId ? { sourceAvatarVersionId: activeAvatarId } : {}),
                              },
                            }
                          : v,
                      )
                    : [
                        ...cleanedBase,
                        {
                          id: newId,
                          imageUrl: out.imageUrl,
                          createdAt: now,
                          type: cleanedBase.length ? 'variation' : 'base',
                          metadata: {
                            prompt: String(
                              out?.debug?.promptUsed ||
                                out?.debug?.promptUsedPreview ||
                                buildCharacterLookPrompt(baseCharacter, look, styleGuide) ||
                                '',
                            ).slice(0, 4000),
                            references: refs,
                            settings: {
                              provider: imageSettings.provider,
                              model: imageSettings.model,
                              temperature: imageSettings.temperature,
                            },
                            aspectRatio: '1:1',
                            ...(activeAvatarId ? { sourceAvatarVersionId: activeAvatarId } : {}),
                          },
                        },
                      ]
                ) as any,
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
      return next;
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
      const failed: Character = {
        ...draft,
        looks: (draft.looks || []).map((l) =>
          l.id === look.id
            ? {
                ...l,
                assetState: {
                  ...(l.assetState || {}),
                  status: 'error',
                  lastError: e instanceof Error ? e.message : String(e),
                  lastAttemptAt: Date.now(),
                },
              }
            : l,
        ),
      };
      setDraft(failed);
      onSave(failed);
      return null;
    } finally {
      setGeneratingLookIds((m) => ({ ...m, [look.id]: false }));
    }
  };

  const handleGenerateLooksForAvatar = async (avatarVersionId: string) => {
    setPendingAvatarVariantId(null);
    const base = draftRef.current;
    const next: Character = {
      ...base,
      activeAvatarVersionId: avatarVersionId as any,
      looks: (base.looks || []).map((l) => ({
        ...l,
        assetState: {
          ...(l.assetState || {}),
          status: 'queued',
        },
      })),
    };
    const selected = buildAvatarSelection(next, (next as any).avatarVersions || [], String(avatarVersionId)) || next;
    setDraft(selected);
    onSave(selected);
    let current = selected;
    for (const look of current.looks || []) {
      const updated = await handleGenerateLook(look, current);
      if (updated) current = updated;
      else current = draftRef.current;
    }
  };

  const handleDeleteLookVariant = (lookId: string, versionId: string) => {
    const lk = (draft.looks || []).find((l) => l.id === lookId);
    if (!lk) return;
    const versions = Array.isArray((lk as any).previewVersions) ? (lk as any).previewVersions : [];
    const nextVersions = versions.filter((v: any) => String(v?.id || '') !== String(versionId));
    if (!nextVersions.length) return;
    const activeId =
      String((lk as any).activePreviewVersionId || '') === String(versionId)
        ? String(nextVersions[nextVersions.length - 1]?.id || '')
        : String((lk as any).activePreviewVersionId || '');
    const active = nextVersions.find((v: any) => String(v?.id || '') === String(activeId)) || nextVersions[nextVersions.length - 1];
    const next: Character = {
      ...draft,
      looks: (draft.looks || []).map((l) =>
        l.id === lookId
          ? {
              ...l,
              previewVersions: nextVersions as any,
              activePreviewVersionId: active?.id as any,
              previewUrl: String(active?.imageUrl || ''),
            }
          : l,
      ),
    };
    setDraft(next);
    onSave(next);
  };

  const handleAddReferenceImages = async (files: FileList | null) => {
    if (!files || isLocked) return;
    const remaining = maxReferenceImages - referenceImages.length;
    if (remaining <= 0) {
      setGenerationError(`Reference images limit reached (${maxReferenceImages}).`);
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
          reader.onload = () => {
            resolve({
              id: `ref-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              url: String(reader.result || ''),
              name: file.name,
              createdAt: Date.now(),
            });
          };
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
    if (errors.length) setGenerationError(errors[0]?.reason?.message || 'Failed to add reference images.');
    if (!success.length) return;
    const next = {
      ...draft,
      referenceImages: [...referenceImages, ...success].slice(0, maxReferenceImages),
      referenceMode: (draft as any).referenceMode || 'auto',
    } as Character;
    setDraft(next);
    onSave(next);
    if (referenceInputRef.current) referenceInputRef.current.value = '';
  };

  const handleRemoveReferenceImage = (id: string) => {
    const next = { ...draft, referenceImages: referenceImages.filter((r: any) => String(r?.id || '') !== String(id)) } as Character;
    setDraft(next);
    onSave(next);
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
                            <span
                              title="Workflow: Generate the base avatar first, then generate each Look so identity stays consistent."
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/5 text-zinc-400 hover:text-white border border-white/10"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </span>
                        </div>
                        <button
                          onClick={handleGenerateAvatar}
                          disabled={!canGenerate || isLocked || isAvatarBusy}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            !canGenerate || isLocked
                              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                          title={!canGenerate ? 'Image provider is Mock' : 'Generate base avatar'}
                        >
                          <Sparkles className={`w-4 h-4 ${isAvatarBusy ? 'animate-pulse' : ''}`} />
                          {isAvatarBusy ? 'Generating...' : draft.avatarUrl ? 'Generate Variant' : 'Generate Avatar'}
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
                            {pendingAvatarVariantId && (
                              <div className="absolute inset-x-4 bottom-4 bg-black/70 border border-white/10 rounded-2xl p-4 backdrop-blur-md flex items-center justify-between gap-3">
                                <div className="text-xs text-zinc-200">
                                  New avatar variant ready. Generate looks for it?
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-emerald-500 text-black"
                                    onClick={() => handleGenerateLooksForAvatar(pendingAvatarVariantId)}
                                  >
                                    Generate new looks
                                  </button>
                                  <button
                                    type="button"
                                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-zinc-800 text-zinc-200"
                                    onClick={() => {
                                      handleDeleteAvatarVariant(pendingAvatarVariantId);
                                      setPendingAvatarVariantId(null);
                                    }}
                                  >
                                    Discard variant
                                  </button>
                                </div>
                              </div>
                            )}
	                      </div>
                      <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 space-y-5">
                        {isLocked && (
                          <div className="flex items-center justify-between gap-2 text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3">
                            <span>Character is locked. Unlock to edit base identity.</span>
                            <button
                              type="button"
                              className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-amber-400 text-black"
                              onClick={() => {
                                const next = { ...draft, status: 'draft' as const };
                                setDraft(next);
                                onSave(next);
                              }}
                            >
                              Unlock now
                            </button>
                          </div>
                        )}
                        <div>
                          <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-2">
                            <Wand2 className="w-4 h-4" /> Identity Constitution
                          </label>
                          <textarea
                            disabled={isLocked}
                            value={draft.description}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                            onBlur={() => persistDraftIfDirty()}
                            className="w-full h-28 bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-sm text-zinc-200 leading-relaxed focus:outline-none focus:border-indigo-500/50 resize-none transition-all disabled:opacity-50"
                            placeholder="Describe permanent facial features, body type, and aura..."
                          />
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">Reference Images (1-4)</div>
                            <label className="flex items-center gap-2 text-[10px] text-zinc-400">
                              <input
                                type="checkbox"
                                checked={useReferenceImages}
                                onChange={(e) => {
                                  const next = { ...draft, referenceMode: e.target.checked ? 'auto' : 'off' } as Character;
                                  setDraft(next);
                                  onSave(next);
                                }}
                                disabled={isLocked}
                              />
                              Use for avatar generation
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
                              <div key={String(img.id)} className="relative w-16 h-16 rounded-xl overflow-hidden border border-white/10 bg-black/30">
                                <img
                                  src={String(img.url)}
                                  className="w-full h-full object-cover cursor-zoom-in"
                                  onClick={() => openLightbox({ url: String(img.url), title: img.name ? `Reference: ${img.name}` : 'Reference' })}
                                />
                                {!isLocked && (
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
                                )}
                              </div>
                            ))}
                            {!isLocked && referenceImages.length < maxReferenceImages && (
                              <button
                                type="button"
                                className="w-16 h-16 rounded-xl border border-dashed border-zinc-700 text-zinc-500 hover:text-indigo-300 hover:border-indigo-500/50 flex flex-col items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wide"
                                onClick={() => referenceInputRef.current?.click()}
                                title="Upload reference images"
                              >
                                <Upload className="w-4 h-4" />
                                Add
                              </button>
                            )}
                          </div>
                        </div>
                        {!draft.avatarUrl && (
                          <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-2xl p-3">
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
                            <span
                              title="Workflow: Looks should be generated after the base avatar to keep identity consistent."
                              className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/5 text-zinc-400 hover:text-white border border-white/10"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </span>
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
                        const liveLook = character.looks?.find((lk) => lk.id === look.id);
                        const draftStatus = (look as any).assetState?.status;
                        const liveStatus = (liveLook as any)?.assetState?.status;
                        // Prefer live runtime status from the parent story state to avoid stale local "running".
                        const lookStatus = liveStatus || draftStatus;
                        const isLookBusy = Boolean(generatingLookIds[look.id]) && lookStatus !== 'done' && lookStatus !== 'error';
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
                            <div className="flex-1 min-w-0 flex flex-col">
                              <div className="flex justify-between items-start mb-1 gap-2">
                                <div className="min-w-0">
                                  <h4 className="font-bold text-white break-words">{look.name}</h4>
                                  <div className="mt-1 h-4">
                                    {lookStatus === 'running' && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                                        <Loader2 className="w-3 h-3 animate-spin" /> Generating
                                      </span>
                                    )}
                                    {lookStatus === 'queued' && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                                        <Clock className="w-3 h-3" /> Queued
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => handleGenerateLook(look)}
                                    disabled={!canGenerate || isLocked || isLookBusy}
                                    className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border transition-all ${
                                      !canGenerate || isLocked
                                        ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                                        : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20'
                                    }`}
                                    title={!draft.avatarUrl ? 'Generate avatar first for best identity consistency' : 'Generate look variant'}
                                  >
                                    {isLookBusy ? 'Gen…' : look.previewUrl ? 'Variant' : 'Generate'}
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
                              <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3 break-words overflow-hidden">{look.description}</p>

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
	                                        <button
	                                          type="button"
	                                          className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity"
	                                          title="Delete variant"
	                                          onClick={(e) => {
	                                            e.stopPropagation();
	                                            handleDeleteLookVariant(look.id, String(v.id));
	                                          }}
	                                        >
	                                          ✕
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
                        onBlur={() => persistDraftIfDirty()}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white font-bold"
                    />
                </div>
                
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 block">Approval Status</label>
                    <button 
                        onClick={() => {
                          const next = { ...draft, status: (isLocked ? 'draft' : 'locked') as any };
                          setDraft(next);
                          onSave(next);
                        }}
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
