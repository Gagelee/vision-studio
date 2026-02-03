
import React, { useState } from 'react';
import { Camera, Sun, Users, Music, X, Save, BookText, MapPin, Clock, Film, Anchor, Zap, Sparkles, ChevronRight, Link, MinusCircle, Plus, Loader2, Shirt } from 'lucide-react';
import { Shot, Sequence, Location, ElementType, Character, DialogueLine, DirectorElement, SelectionState, CharacterLook } from '../../types';
import { ElementControl } from './ElementControl';
import { Collapsible } from './Collapsible';

// --- Sub-component for Casting Control ---
interface CastingControlProps {
  element: DirectorElement;
  availableCharacters: Character[]; 
  onCastingUpdate: (newCharacters: Character[]) => void;
  onCharacterVisualChange: (characterId: string, newDescription: string) => void;
}

const CastingControl: React.FC<CastingControlProps> = ({ element, availableCharacters, onCastingUpdate, onCharacterVisualChange }) => {
  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const shotCharacters = element.metadata?.characters || [];
  const shotCharIds = new Set(shotCharacters.map((c: any) => c.id));

  const toggleCharacter = (char: Character) => {
      if (shotCharIds.has(char.id)) {
          onCastingUpdate(shotCharacters.filter((c: any) => c.id !== char.id));
      } else {
          // Default to first look if available
          const charWithLook = { ...char, activeLookId: char.looks[0]?.id || '' };
          onCastingUpdate([...shotCharacters, charWithLook]);
      }
  };

  const handleLookSwitch = (charId: string, lookId: string) => {
      const updatedChars = shotCharacters.map((c: any) => 
        c.id === charId ? { ...c, activeLookId: lookId } : c
      );
      onCastingUpdate(updatedChars);
  };

  return (
    <div className="bg-white dark:bg-zinc-900/50 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden mb-4 shadow-sm">
      <div className="p-3 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center bg-indigo-50/50 dark:bg-indigo-900/10">
         <div className="flex items-center gap-2">
             <div className="p-1.5 rounded-md bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                <Users className="w-3.5 h-3.5" />
             </div>
             <label className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">Casting & Performers</label>
         </div>
         <button onClick={() => setIsAdding(!isAdding)} className="text-[10px] font-bold px-2 py-1 rounded bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-indigo-500 transition-colors">
            {isAdding ? 'Done' : 'Edit Cast'}
         </button>
      </div>

      <div className="p-3 space-y-3">
         {shotCharacters.length === 0 ? (
             <div className="px-4 py-6 flex flex-col items-center justify-center text-zinc-400 italic bg-zinc-50 dark:bg-zinc-950/50 rounded border border-dashed border-zinc-200 dark:border-zinc-800 text-center gap-2">
                <span className="text-xs">No active characters in this shot.</span>
                <button onClick={() => setIsAdding(true)} className="text-[10px] text-indigo-500 font-bold hover:underline">Add Character</button>
             </div>
         ) : (
             <div className="grid grid-cols-1 gap-3">
                {shotCharacters.map((char: any) => {
                    const masterChar = availableCharacters.find(c => c.id === char.id);
                    const activeLook = masterChar?.looks.find(l => l.id === char.activeLookId) || masterChar?.looks[0];
                    
                    return (
                        <div key={char.id} className="group bg-zinc-50 dark:bg-zinc-950 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800/50">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="relative cursor-pointer shrink-0">
                                    <img src={activeLook?.previewUrl || char.avatarUrl} alt={char.name} className="w-10 h-10 rounded-lg object-cover ring-2 ring-white dark:ring-zinc-800 shadow-sm"/>
                                    {isAdding && (
                                        <div className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow-sm hover:scale-110 transition-transform" onClick={(e) => { e.stopPropagation(); toggleCharacter(char); }}>
                                            <MinusCircle className="w-2.5 h-2.5" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200 truncate">{char.name}</span>
                                        <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest bg-indigo-500/10 px-1.5 py-0.5 rounded">Active</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-zinc-500 dark:text-zinc-400 truncate leading-tight italic">
                                        Look: {activeLook?.name || 'Default'}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Look Selector Switcher */}
                            {masterChar && masterChar.looks.length > 1 && (
                                <div className="flex items-center gap-1.5 p-1 bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 rounded-lg overflow-x-auto no-scrollbar">
                                    {masterChar.looks.map(look => (
                                        <button 
                                            key={look.id}
                                            onClick={() => handleLookSwitch(char.id, look.id)}
                                            title={look.name}
                                            className={`shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-bold transition-all ${
                                                char.activeLookId === look.id 
                                                ? 'bg-indigo-600 text-white' 
                                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                                            }`}
                                        >
                                            <Shirt className="w-2.5 h-2.5" />
                                            {look.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
             </div>
         )}
         
         {isAdding && (
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 animate-in slide-in-from-top-1">
                 <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Available Cast</div>
                 <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                     {availableCharacters.map(char => {
                         const isSelected = shotCharIds.has(char.id);
                         if (isSelected) return null;
                         return (
                             <div 
                                key={char.id}
                                onClick={() => toggleCharacter(char)}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors group"
                             >
                                <img src={char.avatarUrl} className="w-6 h-6 rounded-full object-cover opacity-70 group-hover:opacity-100" />
                                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-200">{char.name}</span>
                                <Plus className="w-3 h-3 ml-auto text-zinc-400 group-hover:text-indigo-500" />
                             </div>
                         );
                     })}
                 </div>
            </div>
         )}
      </div>
    </div>
  );
};

// --- Main Inspector Component ---

interface InspectorPanelProps {
  selection: SelectionState;
  selectedItem: any;
  contextLocation?: Location;
  availableLocations: Location[];
  availableCharacters: Character[];
  keyVisualUrl?: string; 
  masterStyle?: string;
  type: 'story' | 'location' | 'character' | 'sequence' | 'shot';
  onCharacterPromptChange: (shotId: string, seqId: string, charId: string, prompt: string) => void;
  onCastingUpdate: (shotId: string, seqId: string, chars: Character[]) => void;
  onScriptUpdate: (shotId: string, seqId: string, dialogue: DialogueLine[]) => void;
  onSequenceUpdate: (seq: Sequence) => void;
  onShotUpdate: (shot: Shot) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selection,
  selectedItem,
  contextLocation,
  availableLocations,
  availableCharacters,
  keyVisualUrl,
  masterStyle,
  type,
  onCharacterPromptChange,
  onCastingUpdate,
  onSequenceUpdate,
  onShotUpdate
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  
  if (!selectedItem) {
      return (
          <div className="w-96 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 flex flex-col items-center justify-center text-zinc-400">
              <Film className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">Select an element to inspect</p>
          </div>
      );
  }

  // --- SHOT INSPECTOR ---
  if (type === 'shot') {
      const shot = selectedItem as Shot;
      const sequenceId = selection.parentId || 'seq-1';
      
      const handleElementChange = (elType: ElementType, val: string) => {
          onShotUpdate({
              ...shot,
              elements: {
                  ...shot.elements,
                  [elType]: {
                      ...shot.elements[elType],
                      prompt: val,
                      status: 'manual'
                  }
              }
          });
      };

      const handleSyncKV = () => {
          setIsSyncing(true);
          setTimeout(() => {
              handleElementChange(ElementType.LIGHTING, "Match Master KV lighting: High contrast, cinematic noir, teal and magenta highlights. Volumetric fog presence.");
              handleElementChange(ElementType.CAMERA, "Sync with Master KV constitution: Wide angle anamorphic (40mm), 2:39:1 aspect ratio emulation, slight film grain.");
              setIsSyncing(false);
          }, 1500);
      };

      return (
        <div className="w-96 flex flex-col h-full bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 transition-colors duration-300">
            {/* New KV Image + Text Section */}
            {keyVisualUrl && (
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30">
                    <div className="flex items-center gap-2 mb-3">
                        <Anchor className="w-3.5 h-3.5 text-[#ee4d2d]" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Visual Constitution</span>
                    </div>
                    <div className="flex gap-3">
                        <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-700 shadow-sm relative group bg-zinc-900">
                            <img src={keyVisualUrl} className="w-full h-full object-cover" alt="Master KV" />
                            <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors" />
                            <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-black/60 to-transparent"></div>
                        </div>
                        <div className="flex-1 flex flex-col justify-between">
                            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-3 leading-relaxed font-medium bg-white dark:bg-black/20 p-2 rounded border border-zinc-100 dark:border-zinc-800/50">
                                {masterStyle ||
                                  "Master Style: Use the project key visual as the primary constitution. Keep consistency across shots (lighting, palette, lens language)."}
                            </p>
                            <button 
                                onClick={handleSyncKV}
                                disabled={isSyncing}
                                className="self-end mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-200 dark:bg-zinc-800 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 hover:bg-[#ee4d2d] hover:text-white dark:hover:bg-[#ee4d2d] dark:hover:text-white transition-colors shadow-sm disabled:opacity-50"
                            >
                                {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                                {isSyncing ? 'Syncing...' : 'Sync Style'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded">
                        Shot {shot.sequence}
                    </span>
                    <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {shot.duration}s
                    </span>
                </div>
                <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 line-clamp-1 leading-tight">
                    {shot.description}
                </h2>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <MapPin className="w-3.5 h-3.5" />
                        <select
                            value={shot.locationId}
                            onChange={(e) => onShotUpdate({ ...shot, locationId: e.target.value })}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium"
                        >
                            {shot.locationId && !(availableLocations || []).some((l) => l.id === shot.locationId) && (
                                <option value={shot.locationId}>(Missing environment)</option>
                            )}
                            {(availableLocations || []).map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                            {!shot.locationId && <option value="">(No environment)</option>}
                        </select>
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-zinc-500">
                        <Clock className="w-3.5 h-3.5" />
                        <select
                            value={shot.timeOfDay}
                            onChange={(e) => onShotUpdate({ ...shot, timeOfDay: e.target.value })}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-700 dark:text-zinc-200 text-[11px] font-medium"
                        >
                            {shot.timeOfDay && !['Day', 'Night', 'Dawn', 'Dusk', 'Interior', 'Exterior'].includes(shot.timeOfDay) && (
                                <option value={shot.timeOfDay}>{shot.timeOfDay}</option>
                            )}
                            {['Day', 'Night', 'Dawn', 'Dusk', 'Interior', 'Exterior'].map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
                <div>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <div className="w-1 h-3 bg-sky-500 rounded-full"></div>
                        <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">Cinematography</h3>
                    </div>
                    <div className="space-y-3">
                        <ElementControl 
                            label="Camera" 
                            icon={<Camera className="w-3.5 h-3.5" />}
                            element={shot.elements[ElementType.CAMERA]}
                            onChange={(val) => handleElementChange(ElementType.CAMERA, val)}
                            colorTheme="sky"
                        />
                        <ElementControl 
                            label="Lighting" 
                            icon={<Sun className="w-3.5 h-3.5" />}
                            element={shot.elements[ElementType.LIGHTING]}
                            onChange={(val) => handleElementChange(ElementType.LIGHTING, val)}
                            contextHint={contextLocation?.visualStyle ? "Scene Ambience" : undefined}
                            colorTheme="amber"
                        />
                    </div>
                </div>

                <div>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                        <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">Performance</h3>
                    </div>
                    <CastingControl 
                        element={shot.elements[ElementType.CASTING]}
                        availableCharacters={availableCharacters}
                        onCastingUpdate={(chars) => onCastingUpdate(shot.id, sequenceId, chars)}
                        onCharacterVisualChange={(charId, prompt) => onCharacterPromptChange(shot.id, sequenceId, charId, prompt)}
                    />
                    <ElementControl 
                        label="Dialogue" 
                        icon={<BookText className="w-3.5 h-3.5" />}
                        element={shot.elements[ElementType.SCRIPT]}
                        onChange={(val) => handleElementChange(ElementType.SCRIPT, val)}
                        colorTheme="zinc"
                        className="mt-3"
                    />
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="w-96 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-8 flex flex-col items-center justify-center text-zinc-400">
        <Film className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-sm font-medium">Select a shot to inspect details</p>
    </div>
  );
};
