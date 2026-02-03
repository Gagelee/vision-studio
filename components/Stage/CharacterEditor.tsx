
import React, { useEffect, useState } from 'react';
import { AlertCircle, Edit3, Film, Image as ImageIcon, Lock, Plus, Save, Shirt, Sparkles, Trash2, Unlock, User, Wand2 } from 'lucide-react';
import { Character, CharacterLook, ModelRuntimeSettings, Sequence, Shot } from '../../types';
import { generateImageFromPrompt } from '../../lib/ai/image/generate';
import { buildCharacterAvatarPrompt, buildCharacterLookPrompt } from '../../lib/ai/prompts';

interface CharacterEditorProps {
  character: Character;
  sequences?: Sequence[];
  onSave: (character: Character) => void;
  onPropagate: (characterId: string) => void;
  onSelectShot?: (shotId: string, seqId: string) => void;
  imageSettings?: ModelRuntimeSettings;
  keyVisualUrl?: string;
}

export const CharacterEditor: React.FC<CharacterEditorProps> = ({
  character,
  sequences = [],
  onSave,
  onPropagate,
  onSelectShot,
  imageSettings,
  keyVisualUrl,
}) => {
  const [draft, setDraft] = useState<Character>(character);
  const [editingLook, setEditingLook] = useState<CharacterLook | null>(null);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [generatingLookIds, setGeneratingLookIds] = useState<Record<string, boolean>>({});
  const [generationError, setGenerationError] = useState<string | null>(null);
  
  useEffect(() => {
    setDraft(character);
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
    setDraft({ ...draft, looks: [...draft.looks, newLook] });
  };

  const handleRemoveLook = (id: string) => {
    setDraft({ ...draft, looks: draft.looks.filter(l => l.id !== id) });
  };

  const handleUpdateLook = (look: CharacterLook) => {
    setDraft({ ...draft, looks: draft.looks.map(l => l.id === look.id ? look : l) });
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
        prompt: buildCharacterAvatarPrompt(draft),
        settings: imageSettings,
        aspectRatio: '1:1',
        references: keyVisualUrl ? [{ url: keyVisualUrl, label: 'master kv' }] : [],
        strict: true,
      });
      setDraft((prev) => ({ ...prev, avatarUrl: out.imageUrl }));
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handleGenerateLook = async (look: CharacterLook) => {
    if (!imageSettings || imageSettings.provider === 'mock' || isLocked) return;
    setGenerationError(null);
    setGeneratingLookIds((m) => ({ ...m, [look.id]: true }));
    try {
      const refs = [
        ...(keyVisualUrl ? [{ url: keyVisualUrl, label: 'master kv' }] : []),
        ...(draft.avatarUrl ? [{ url: draft.avatarUrl, label: 'character base avatar' }] : []),
      ];
      const out = await generateImageFromPrompt({
        prompt:
          buildCharacterLookPrompt(draft, look) +
          `\n\nKeep the exact same character identity as the reference avatar. Only change wardrobe/makeup/style described for this look.`,
        settings: imageSettings,
        aspectRatio: '1:1',
        references: refs,
        strict: true,
      });
      setDraft((prev) => ({
        ...prev,
        looks: prev.looks.map((l) => (l.id === look.id ? { ...l, previewUrl: out.imageUrl } : l)),
      }));
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingLookIds((m) => ({ ...m, [look.id]: false }));
    }
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
                          {isGeneratingAvatar ? 'Generating...' : 'Generate Avatar'}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                      <div className="relative w-full max-w-sm aspect-square bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl">
                          <img src={draft.avatarUrl} className="w-full h-full object-cover" />
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
	                        {draft.looks.map(look => (
	                            <div key={look.id} className="group relative bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex gap-4 hover:border-indigo-500/50 transition-all shadow-xl">
	                                <div className="w-32 h-40 rounded-xl bg-zinc-800 overflow-hidden shrink-0 border border-white/5">
	                                    <img src={look.previewUrl} className="w-full h-full object-cover" />
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
	                                              title={!draft.avatarUrl ? 'Generate avatar first for best identity consistency' : 'Generate look image'}
	                                            >
	                                              {generatingLookIds[look.id] ? 'Gen…' : 'Generate'}
	                                            </button>
	                                            <button onClick={() => setEditingLook(look)} className="p-1.5 text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-md">
	                                                <Edit3 className="w-3.5 h-3.5" />
	                                            </button>
	                                            <button onClick={() => handleRemoveLook(look.id)} className="p-1.5 text-zinc-400 hover:text-rose-500 bg-white/5 hover:bg-white/10 rounded-md">
	                                                <Trash2 className="w-3.5 h-3.5" />
	                                            </button>
	                                        </div>
                                    </div>
                                    <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">{look.description}</p>
                                </div>
                            </div>
                        ))}
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
