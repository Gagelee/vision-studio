
import React, { useEffect, useMemo, useState } from 'react';
import { ElementType, Sequence, Shot, Location, AspectRatio } from '../../types';
import { ShotCard } from './ShotCard';
import { Clock, Plus, Maximize2, Minimize2, Play, LayoutGrid, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trash2, List, ScrollText, Copy, Check, Pencil } from 'lucide-react';
import { getShotPreviewImageUrl } from '../../lib/ai/assetRefs';

interface StageViewProps {
  sequence: Sequence;
  allLocations?: Location[];
  aspectRatio?: AspectRatio;
  isImmersive: boolean;
  onToggleImmersive: () => void;
  onSelectShot: (id: string) => void;
  onUpdateShot: (shot: Shot) => void;
  onDeleteShot: (id: string) => void;
  onMoveShot: (id: string, direction: 'left' | 'right') => void;
  onMoveShotToScene?: (shotId: string, toSceneId: string) => void;
  onAddShot: (opts?: { sceneId?: string; afterShotId?: string; locationId?: string; timeOfDay?: string }) => void;
  onRenameSequence?: (title: string) => void;
  onRenameScene?: (sceneId: string, title: string) => void;
  onPlayScene?: (sceneId: string) => void;
  onBackToSequence: () => void;
  onEditLocation: () => void;
}

export const StageView: React.FC<StageViewProps> = ({ 
    sequence, 
    allLocations = [],
    aspectRatio = '16:9',
    isImmersive,
    onToggleImmersive,
    onSelectShot, 
    onDeleteShot,
    onMoveShot,
    onMoveShotToScene,
    onAddShot,
    onRenameSequence,
    onRenameScene,
    onPlayScene,
}) => {
  const [isPromptPanelOpen, setIsPromptPanelOpen] = useState(false);
  const [isEditingSequenceTitle, setIsEditingSequenceTitle] = useState(false);
  const [sequenceTitleInput, setSequenceTitleInput] = useState(sequence.title || '');
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [sceneTitleInput, setSceneTitleInput] = useState('');

  useEffect(() => {
    setSequenceTitleInput(sequence.title || '');
    setIsEditingSequenceTitle(false);
    setEditingSceneId(null);
    setSceneTitleInput('');
  }, [sequence.id, sequence.title]);

  const groupedScenes = useMemo(() => {
    const raw = Array.isArray((sequence as any)?.scenes) ? (sequence as any).scenes : [];
    if (raw.length) return raw;
    return [{ id: `${sequence.id}-scene-1`, title: 'Scene 1', shots: sequence.shots || [] }];
  }, [sequence]);

  const shotPrompts = useMemo(() => {
    return (sequence.shots || []).map((shot) => {
      const vp = (shot.elements as any)?.[ElementType.CAMERA]?.metadata?.videoPrompt;
      const videoPrompt = typeof vp === 'string' ? vp.trim() : '';
      return { shot, videoPrompt };
    });
  }, [sequence.shots]);

  return (
    <div className={`relative flex flex-col font-sans h-full overflow-hidden transition-colors duration-300 ${isImmersive ? 'fixed inset-0 z-[50] bg-[#050505]' : 'bg-zinc-50 dark:bg-[#050505]'}`}>
      
      {/* Header Overlay */}
      <div className={`sticky top-0 left-0 right-0 z-40 px-8 py-5 flex justify-between items-start backdrop-blur-xl border-b transition-all 
        ${isImmersive 
            ? 'bg-black/80 pt-6 border-white/5' 
            : 'bg-white/80 dark:bg-zinc-950/80 border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div>
            <div className="flex items-center gap-3 mb-1">
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20 shadow-sm">
                    <LayoutGrid className="w-3 h-3" />
                    Storyboard
                </span>
                {isEditingSequenceTitle ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={sequenceTitleInput}
                      onChange={(e) => setSequenceTitleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const next = String(sequenceTitleInput || '').trim();
                          if (next) onRenameSequence?.(next);
                          setIsEditingSequenceTitle(false);
                        }
                        if (e.key === 'Escape') {
                          setSequenceTitleInput(sequence.title || '');
                          setIsEditingSequenceTitle(false);
                        }
                      }}
                      className="h-9 min-w-[260px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-lg font-bold text-zinc-900 dark:text-white"
                      autoFocus
                    />
                    <button
                      onClick={() => {
                        const next = String(sequenceTitleInput || '').trim();
                        if (next) onRenameSequence?.(next);
                        setIsEditingSequenceTitle(false);
                      }}
                      className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      title="Save story part title"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSequenceTitleInput(sequence.title || '');
                      setIsEditingSequenceTitle(true);
                    }}
                    className="group flex items-center gap-2 text-xl font-bold text-zinc-900 dark:text-white tracking-tight"
                    title="Edit story part title"
                  >
                    <span>{sequence.title}</span>
                    <Pencil className="w-4 h-4 opacity-0 group-hover:opacity-70 transition-opacity" />
                  </button>
                )}
            </div>
            {!isImmersive && (
                <p className="text-zinc-500 text-sm leading-relaxed max-w-3xl font-medium truncate">
                    {sequence.context}
                </p>
            )}
        </div>
        
        {/* Controls */}
        <div className="flex gap-2">
            <button
              onClick={() => setIsPromptPanelOpen((v) => !v)}
              className={`group flex items-center gap-2 px-4 py-2 rounded-lg border transition-all text-xs font-bold uppercase tracking-wide shadow-lg ${
                isPromptPanelOpen
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
              title="Show video generation prompts"
            >
              <ScrollText className="w-3 h-3" />
              <span>Prompts</span>
            </button>
            <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 mx-2"></div>
            <button 
                onClick={onToggleImmersive}
                className={`p-2 rounded-lg border transition-all ${
                    isImmersive 
                    ? 'bg-zinc-800 text-white border-zinc-600 hover:bg-zinc-700' 
                    : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
                title={isImmersive ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
                {isImmersive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
        </div>
      </div>

      {isPromptPanelOpen && (
        <div className="absolute top-16 bottom-0 right-0 w-[520px] max-w-[90vw] z-50 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl border-l border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
          <div className="h-12 px-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/30">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Video Prompts</div>
            <button
              onClick={() => setIsPromptPanelOpen(false)}
              className="text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            >
              Close
            </button>
          </div>
          <div className="h-full overflow-y-auto custom-scrollbar p-4 space-y-4">
            {shotPrompts.map(({ shot, videoPrompt }) => (
              <div key={shot.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="text-sm font-bold text-zinc-900 dark:text-white">Shot #{shot.sequence}</div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(videoPrompt || '')}
                    disabled={!videoPrompt}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all disabled:opacity-40 disabled:cursor-not-allowed border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    title={videoPrompt ? 'Copy' : 'No prompt'}
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>
                </div>
                <div className="p-4">
                  {videoPrompt ? (
                    <pre className="whitespace-pre-wrap text-[11px] leading-relaxed font-mono text-zinc-700 dark:text-zinc-200">{videoPrompt}</pre>
                  ) : (
                    <div className="text-xs text-zinc-500">
                      No `videoPrompt` yet. Generate/refresh scaffold or ask Director to fill Camera & Art prompts.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- BOARD CONTENT --- */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8 pb-48 w-full max-w-[1800px] mx-auto z-0">
          {groupedScenes.length === 0 ? (
            <div onClick={() => onAddShot()} className="mt-20 p-20 border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-3xl flex flex-col items-center justify-center cursor-pointer hover:bg-white dark:hover:bg-zinc-900/30 hover:border-zinc-400 dark:hover:border-zinc-700 transition-all text-zinc-400 dark:text-zinc-600 hover:text-indigo-500 dark:hover:text-indigo-400 group">
                <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-xl">
                    <Plus className="w-8 h-8" />
                </div>
                <span className="font-bold text-lg">Create First Shot</span>
                <span className="text-sm text-zinc-500 mt-2">Start your sequence here</span>
            </div>
          ) : (
            <div className="space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-500">
                {groupedScenes.map((group: any, i: number) => (
                  <div key={group.id} className="relative pl-12 border-l-2 border-zinc-200 dark:border-zinc-800/50">
                      {/* Scene Heading */}
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-900 border-2 border-zinc-400 dark:border-zinc-700"></div>
                      <div className="flex items-center gap-4 mb-6">
                          <span className="text-2xl font-black text-zinc-300 dark:text-white/20 select-none">0{i+1}</span>
                          <div className="bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 px-4 py-2 rounded-lg backdrop-blur-sm shadow-sm">
                              {editingSceneId === String(group.id || '') ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    value={sceneTitleInput}
                                    onChange={(e) => setSceneTitleInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        const next = String(sceneTitleInput || '').trim();
                                        if (next) onRenameScene?.(String(group.id || ''), next);
                                        setEditingSceneId(null);
                                        setSceneTitleInput('');
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingSceneId(null);
                                        setSceneTitleInput('');
                                      }
                                    }}
                                    className="h-8 min-w-[220px] rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-sm font-semibold text-zinc-900 dark:text-white"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => {
                                      const next = String(sceneTitleInput || '').trim();
                                      if (next) onRenameScene?.(String(group.id || ''), next);
                                      setEditingSceneId(null);
                                      setSceneTitleInput('');
                                    }}
                                    className="p-1 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                    title="Save scene title"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingSceneId(String(group.id || ''));
                                      setSceneTitleInput(String(group.title || `Scene ${i + 1}`));
                                    }}
                                    className="group flex items-center gap-2 text-zinc-800 dark:text-white font-bold text-lg tracking-tight mr-1"
                                    title="Edit scene title"
                                  >
                                    <span>{String(group.title || `Scene ${i + 1}`)}</span>
                                    <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-70 transition-opacity" />
                                  </button>
                                  <button
                                    onClick={() => onPlayScene?.(String(group.id || ''))}
                                    disabled={!Array.isArray(group.shots) || group.shots.length === 0}
                                    className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/90 dark:bg-zinc-900 text-[10px] font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
                                    title="Play this scene"
                                  >
                                    <Play className="w-3 h-3 fill-current" />
                                    <span>Play Scene</span>
                                  </button>
                                </div>
                              )}
                              {group.summary ? (
                                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{String(group.summary)}</span>
                              ) : null}
                          </div>
                      </div>

                      {/* Shots Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-start">
                          {group.shots.map(shot => (
                              <div key={shot.id} className="relative group/shot">
                                  <ShotCard shot={shot} isSelected={false} onSelect={()=>onSelectShot(shot.id)} aspectRatio={aspectRatio} />
                                  
                                  {/* Quick Actions */}
                                  <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 opacity-0 group-hover/shot:opacity-100 transition-all z-30 translate-y-2 group-hover/shot:translate-y-0">
                                      {onMoveShotToScene && i > 0 && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const prevId = String(groupedScenes[i - 1]?.id || '');
                                            if (prevId) onMoveShotToScene(shot.id, prevId);
                                          }}
                                          className="p-1.5 rounded-lg bg-zinc-900 text-white hover:bg-emerald-600 transition-colors shadow-xl"
                                          title="Move to previous scene"
                                        >
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); onMoveShot(shot.id, 'left'); }}
                                        className="p-1.5 rounded-lg bg-zinc-900 text-white hover:bg-indigo-600 transition-colors shadow-xl"
                                        title="Move Left"
                                      >
                                          <ChevronLeft className="w-3.5 h-3.5" />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); onDeleteShot(shot.id); }}
                                        className="p-1.5 rounded-lg bg-zinc-900 text-white hover:bg-rose-600 transition-colors shadow-xl"
                                        title="Delete Shot"
                                      >
                                          <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); onMoveShot(shot.id, 'right'); }}
                                        className="p-1.5 rounded-lg bg-zinc-900 text-white hover:bg-indigo-600 transition-colors shadow-xl"
                                        title="Move Right"
                                      >
                                          <ChevronRight className="w-3.5 h-3.5" />
                                      </button>
                                      {onMoveShotToScene && i < groupedScenes.length - 1 && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const nextId = String(groupedScenes[i + 1]?.id || '');
                                            if (nextId) onMoveShotToScene(shot.id, nextId);
                                          }}
                                          className="p-1.5 rounded-lg bg-zinc-900 text-white hover:bg-emerald-600 transition-colors shadow-xl"
                                          title="Move to next scene"
                                        >
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                  </div>
                              </div>
                          ))}
                          
                          {/* "Add Shot" Card inside the flow */}
                          <div 
                              onClick={() =>
                                onAddShot({
                                  sceneId: String(group.id || ''),
                                  afterShotId: group.shots[group.shots.length - 1]?.id,
                                  locationId: group.shots[group.shots.length - 1]?.locationId,
                                  timeOfDay: group.shots[group.shots.length - 1]?.timeOfDay,
                                })
                              }
                              className="aspect-video border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col gap-3 items-center justify-center text-zinc-400 dark:text-zinc-600 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-500/50 hover:bg-indigo-50 dark:hover:bg-indigo-500/5 cursor-pointer transition-all group/add"
                          >
                              <div className="w-10 h-10 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center group-hover/add:scale-110 group-hover/add:border-indigo-500 transition-all">
                                <Plus className="w-5 h-5 group-hover/add:text-indigo-500" />
                              </div>
                              <span className="text-xs font-bold uppercase tracking-wider text-center">New Narrative Beat</span>
                          </div>
                      </div>
                  </div>
                ))}
            </div>
          )}
      </div>

      {/* Mini-Map Timeline */}
      {!isImmersive && sequence.shots.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-24 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-xl border-t border-zinc-200 dark:border-zinc-800 px-8 flex items-center gap-4 z-40 overflow-x-auto no-scrollbar shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
              <div className="flex items-center gap-2 shrink-0 pr-4 border-r border-zinc-200 dark:border-zinc-800">
                  <List className="w-4 h-4 text-zinc-700 dark:text-zinc-200" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Story Part Strip</span>
              </div>
              <div className="flex items-center gap-3 py-2">
                  {sequence.shots.map((shot, idx) => (
                      <div 
                        key={shot.id} 
                        onClick={() => onSelectShot(shot.id)}
                        className="relative w-24 aspect-video rounded-lg overflow-hidden border-2 border-zinc-200 dark:border-zinc-800 cursor-pointer hover:border-zinc-500 dark:hover:border-zinc-500 group shrink-0 transition-all"
                      >
                      <img
                        src={getShotPreviewImageUrl(shot)}
                        className="w-full h-full object-cover grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectShot(shot.id);
                        }}
                      />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-transparent transition-all">
                              <span className="text-[10px] font-mono font-bold text-white drop-shadow-lg">0{idx + 1}</span>
                          </div>
                      </div>
                  ))}
                  <button 
                    onClick={() => onAddShot()}
                    className="w-12 aspect-video rounded-lg border-2 border-dashed border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-500 dark:hover:border-zinc-500 transition-all shrink-0 bg-white dark:bg-zinc-900"
                  >
                      <Plus className="w-4 h-4" />
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};
