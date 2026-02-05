
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { Sidebar } from './components/Layout/Sidebar';
import { ScriptEditorModal } from './components/Stage/ScriptEditorModal';
import { DirectorConsole } from './components/Console/DirectorConsole';
import { InspectorPanel } from './components/Inspector/InspectorPanel';
import { MasterPlayer } from './components/Player/MasterPlayer';
import { CharacterEditor } from './components/Stage/CharacterEditor';
import { LocationEditor } from './components/Stage/LocationEditor';
import { ProjectCreationWizard } from './components/Stage/ProjectCreationWizard';
import { ProjectDashboard } from './components/Stage/ProjectDashboard';
import { ProjectLibrary } from './components/Stage/ProjectLibrary';
import { ShotEditor } from './components/Stage/ShotEditor';
import { StageView } from './components/Stage/StageView';
import { AiSettingsModal } from './components/Settings/AiSettingsModal';
import { StartProductionModal } from './components/Production/StartProductionModal';
import { DebugPanel } from './components/Debug/DebugPanel';
import { ImageLightbox } from './components/Overlay/ImageLightbox';
import { createDemoProject, loadWorkspace, saveWorkspace } from './lib/workspaceStorage';
import { loadAiSettings, saveAiSettings } from './lib/ai/aiSettingsStorage';
import { runDirectorCommand, runDirectorCommandStream, type DirectorCommandResponse, type DirectorStreamEvent } from './lib/ai/agent/direct';
import { isAgentApiError } from './lib/ai/agent/apiError';
import { addDebugEvent } from './lib/debug/eventLog';
import { buildCharacterAvatarPrompt, buildCharacterLookPrompt, buildLocationPreviewPrompt } from './lib/ai/prompts';
import { applyAssetBlocked, applyAssetError, applyAssetResult, applyAssetStart, buildAssetJobs, executeAssetJobs, type AssetJob } from './lib/ai/assetExecutor';
import { IMAGES } from './constants';
import {
  AgentAction,
  AgentLogEntry,
  AgentPlan,
  AiSettings,
  Character,
  DialogueLine,
  ElementType,
  Location,
  SelectionState,
  Sequence,
  Shot,
  Story,
  WorkspaceState,
} from './types';

type Screen = 'library' | 'creation' | 'project';

const cloneStory = (story: Story): Story => JSON.parse(JSON.stringify(story)) as Story;

function renumberShots(shots: Shot[]): Shot[] {
  return shots.map((s, idx) => ({ ...s, sequence: idx + 1 }));
}

function createBlankShot(
  story: Story,
  seq: Sequence,
  init?: Partial<Pick<Shot, 'locationId' | 'timeOfDay' | 'description' | 'duration'>>,
): Shot {
  const now = Date.now();
  const fallbackLocationId = story.locations[0]?.id || '';
  const shotNumber = seq.shots.length + 1;
  const thumb = IMAGES.SHOT_WIDE;

  return {
    id: `shot-${now}-${Math.random().toString(16).slice(2, 8)}`,
    sequence: shotNumber,
    locationId: init?.locationId || fallbackLocationId,
    timeOfDay: init?.timeOfDay || 'Day',
    description: init?.description || 'New shot',
    duration: typeof init?.duration === 'number' && Number.isFinite(init.duration) ? Math.max(1, Math.round(init.duration)) : 4,
    thumbnailUrl: thumb,
    activeVersionId: 'v1',
    versions: [{ id: 'v1', imageUrl: thumb, createdAt: now, type: 'placeholder' }],
    elements: {
      [ElementType.SCRIPT]: { type: ElementType.SCRIPT, prompt: '', status: 'auto' },
      [ElementType.CASTING]: { type: ElementType.CASTING, prompt: '', status: 'manual', metadata: { characters: [] } },
      [ElementType.CAMERA]: { type: ElementType.CAMERA, prompt: 'Cinematic shot', status: 'auto' },
      [ElementType.LIGHTING]: { type: ElementType.LIGHTING, prompt: 'Natural cinematic lighting', status: 'auto' },
      [ElementType.AUDIO]: { type: ElementType.AUDIO, prompt: 'Ambient sound', status: 'auto' },
    },
    aiState: 'idle',
    production: { status: 'idle' },
  };
}

const applyActionsToStory = (story: Story, actions: AgentAction[]): Story => {
  return actions.reduce<Story>((acc, action) => {
    if (action.type === 'UPDATE_STORY') {
      const patch = action.payload?.patch || action.payload || {};
      return {
        ...acc,
        title: typeof patch.title === 'string' ? patch.title : acc.title,
        logline: typeof patch.logline === 'string' ? patch.logline : acc.logline,
        intent: typeof patch.intent === 'string' ? patch.intent : acc.intent,
        keyVisualUrl: typeof patch.keyVisualUrl === 'string' ? patch.keyVisualUrl : acc.keyVisualUrl,
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_SEQUENCE') {
      const now = Date.now();
      const title = typeof action.payload?.title === 'string' ? action.payload.title : 'New Sequence';
      const context = typeof action.payload?.context === 'string' ? action.payload.context : 'Describe the narrative beat...';
      const newSeq: Sequence = { id: `seq-${now}-${Math.random().toString(16).slice(2, 8)}`, title, context, shots: [] };
      return { ...acc, sequences: [...acc.sequences, newSeq], updatedAt: Date.now() };
    }

    if (action.type === 'RENAME_SEQUENCE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const title = action.payload?.title;
      if (!sequenceId || typeof title !== 'string') return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((s) => (s.id === sequenceId ? { ...s, title } : s)),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'DELETE_SEQUENCE') {
      const sequenceId = String(action.payload?.sequenceId || '');
      if (!sequenceId) return acc;
      return { ...acc, sequences: acc.sequences.filter((s) => s.id !== sequenceId), updatedAt: Date.now() };
    }

    if (action.type === 'CREATE_SHOT') {
      const sequenceId = String(action.payload?.sequenceId || '');
      if (!sequenceId) return acc;
      const afterShotId = action.payload?.afterShotId ? String(action.payload.afterShotId) : undefined;
      const init = {
        locationId: action.payload?.locationId ? String(action.payload.locationId) : undefined,
        timeOfDay: action.payload?.timeOfDay ? String(action.payload.timeOfDay) : undefined,
        description: action.payload?.description ? String(action.payload.description) : undefined,
        duration: typeof action.payload?.duration === 'number' ? action.payload.duration : undefined,
      };
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const newShot = createBlankShot(acc, seq, init);
          const patchPrompt = (el: ElementType, promptKey: string) => {
            const val = action.payload?.[promptKey];
            if (typeof val !== 'string') return;
            const nextPrompt = String(val).trim();
            if (!nextPrompt) return;
            (newShot.elements as any)[el] = { ...(newShot.elements as any)[el], prompt: nextPrompt, status: 'manual' };
          };
          patchPrompt(ElementType.SCRIPT, 'script');
          patchPrompt(ElementType.CAMERA, 'camera');
          patchPrompt(ElementType.LIGHTING, 'lighting');
          patchPrompt(ElementType.AUDIO, 'audio');
          if (typeof action.payload?.videoPrompt === 'string') {
            const v = String(action.payload.videoPrompt || '').trim();
            if (v) {
              (newShot.elements as any)[ElementType.CAMERA] = {
                ...(newShot.elements as any)[ElementType.CAMERA],
                metadata: { ...((newShot.elements as any)[ElementType.CAMERA]?.metadata || {}), videoPrompt: v },
                status: 'manual',
              };
            }
          }
          if (Array.isArray(action.payload?.cast)) {
            const cast = action.payload.cast
              .map((c: any) => ({ id: String(c?.id || ''), activeLookId: c?.activeLookId ? String(c.activeLookId) : '' }))
              .filter((c: any) => c.id);
            (newShot.elements as any)[ElementType.CASTING] = {
              ...(newShot.elements as any)[ElementType.CASTING],
              status: 'manual',
              metadata: { ...((newShot.elements as any)[ElementType.CASTING]?.metadata || {}), characters: cast },
            };
          }
          const shots = seq.shots.slice();
          let insertAt = shots.length;
          if (afterShotId) {
            const idx = shots.findIndex((s) => s.id === afterShotId);
            if (idx >= 0) insertAt = idx + 1;
          }
          shots.splice(insertAt, 0, newShot);
          return { ...seq, shots: renumberShots(shots) };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'DELETE_SHOT') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const shotId = String(action.payload?.shotId || '');
      if (!sequenceId || !shotId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          return { ...seq, shots: renumberShots(seq.shots.filter((s) => s.id !== shotId)) };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'MOVE_SHOT') {
      const sequenceId = String(action.payload?.sequenceId || '');
      const shotId = String(action.payload?.shotId || '');
      if (!sequenceId || !shotId) return acc;
      const direction = action.payload?.direction === 'left' || action.payload?.direction === 'right' ? action.payload.direction : null;
      const toIndex = typeof action.payload?.toIndex === 'number' ? Math.floor(action.payload.toIndex) : null;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          const idx = seq.shots.findIndex((s) => s.id === shotId);
          if (idx < 0) return seq;
          const next = seq.shots.slice();
          const [item] = next.splice(idx, 1);
          if (!item) return seq;
          let insertAt = idx;
          if (direction) insertAt = direction === 'left' ? Math.max(0, idx - 1) : Math.min(next.length, idx + 1);
          if (toIndex !== null) insertAt = Math.min(Math.max(0, toIndex), next.length);
          next.splice(insertAt, 0, item);
          return { ...seq, shots: renumberShots(next) };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_SHOT') {
      const shotId = String(action.payload?.shotId || '');
      const sequenceId = action.payload?.sequenceId ? String(action.payload.sequenceId) : null;
      const patch = action.payload?.patch || {};
      if (!shotId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (sequenceId && seq.id !== sequenceId) return seq;
          if (!seq.shots.some((s) => s.id === shotId)) return seq;
          return {
            ...seq,
            shots: seq.shots.map((s) => {
              if (s.id !== shotId) return s;
              return {
                ...s,
                description: typeof patch.description === 'string' ? patch.description : s.description,
                timeOfDay: typeof patch.timeOfDay === 'string' ? patch.timeOfDay : s.timeOfDay,
                locationId: typeof patch.locationId === 'string' ? patch.locationId : s.locationId,
                duration:
                  typeof patch.duration === 'number' && Number.isFinite(patch.duration)
                    ? Math.max(1, Math.round(patch.duration))
                    : s.duration,
              };
            }),
          };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'SET_CAST') {
      const shotId = String(action.payload?.shotId || '');
      const sequenceId = String(action.payload?.sequenceId || '');
      const cast = Array.isArray(action.payload?.cast) ? action.payload.cast : [];
      if (!shotId || !sequenceId) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          return {
            ...seq,
            shots: seq.shots.map((shot) => {
              if (shot.id !== shotId) return shot;
              return {
                ...shot,
                elements: {
                  ...shot.elements,
                  [ElementType.CASTING]: {
                    ...shot.elements[ElementType.CASTING],
                    metadata: { ...(shot.elements[ElementType.CASTING].metadata || {}), characters: cast },
                    status: 'manual' as const,
                  },
                },
              };
            }),
          };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_LOCATION') {
      const now = Date.now();
      const name = typeof action.payload?.name === 'string' ? action.payload.name : 'New Environment';
      const description = typeof action.payload?.description === 'string' ? action.payload.description : 'Describe the atmospheric details...';
      const visualStyle = typeof action.payload?.visualStyle === 'string' ? action.payload.visualStyle : 'Cinematic style details...';
      const newLoc: Location = {
        id: `loc-${now}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        description,
        visualStyle,
        previewUrl: acc.keyVisualUrl || IMAGES.SKYBRIDGE,
        status: 'draft',
      };
      return { ...acc, locations: [...acc.locations, newLoc], updatedAt: Date.now() };
    }

    if (action.type === 'DELETE_LOCATION') {
      const locationId = String(action.payload?.locationId || '');
      if (!locationId) return acc;
      return {
        ...acc,
        locations: acc.locations.filter((l) => l.id !== locationId),
        sequences: acc.sequences.map((seq) => ({
          ...seq,
          shots: seq.shots.map((shot) => (shot.locationId === locationId ? { ...shot, locationId: '' } : shot)),
        })),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_LOCATION') {
      const locationId = String(action.payload?.locationId || '');
      const patch = action.payload?.patch || {};
      if (!locationId) return acc;
      return {
        ...acc,
        locations: acc.locations.map((l) =>
          l.id === locationId
            ? {
                ...l,
                name: typeof patch.name === 'string' ? patch.name : l.name,
                description: typeof patch.description === 'string' ? patch.description : l.description,
                visualStyle: typeof patch.visualStyle === 'string' ? patch.visualStyle : l.visualStyle,
                status: patch.status === 'draft' || patch.status === 'locked' ? patch.status : l.status,
              }
            : l,
        ),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_CHARACTER') {
      const now = Date.now();
      const name = typeof action.payload?.name === 'string' ? action.payload.name : 'New Character';
      const description = typeof action.payload?.description === 'string' ? action.payload.description : 'Describe physical traits and personality...';
      const newChar: Character = {
        id: `char-${now}-${Math.random().toString(16).slice(2, 8)}`,
        name,
        description,
        avatarUrl: acc.keyVisualUrl || IMAGES.SILAS,
        status: 'draft',
        looks: [],
      };
      return { ...acc, characters: [...acc.characters, newChar], updatedAt: Date.now() };
    }

    if (action.type === 'DELETE_CHARACTER') {
      const characterId = String(action.payload?.characterId || '');
      if (!characterId) return acc;
      return {
        ...acc,
        characters: acc.characters.filter((c) => c.id !== characterId),
        sequences: acc.sequences.map((seq) => ({
          ...seq,
          shots: seq.shots.map((shot) => {
            const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
            const castArr = Array.isArray(cast) ? cast : [];
            const nextCast = castArr.filter((c: any) => String(c?.id || '') !== characterId);
            return {
              ...shot,
              elements: {
                ...shot.elements,
                [ElementType.CASTING]: {
                  ...shot.elements[ElementType.CASTING],
                  metadata: { ...(shot.elements[ElementType.CASTING].metadata || {}), characters: nextCast },
                  status: 'manual' as const,
                },
              },
            };
          }),
        })),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_CHARACTER') {
      const characterId = String(action.payload?.characterId || '');
      const patch = action.payload?.patch || {};
      if (!characterId) return acc;
      return {
        ...acc,
        characters: acc.characters.map((c) =>
          c.id === characterId
            ? {
                ...c,
                name: typeof patch.name === 'string' ? patch.name : c.name,
                description: typeof patch.description === 'string' ? patch.description : c.description,
                status: patch.status === 'draft' || patch.status === 'locked' ? patch.status : c.status,
              }
            : c,
        ),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'CREATE_CHARACTER_LOOK') {
      const characterId = String(action.payload?.characterId || '');
      if (!characterId) return acc;
      const now = Date.now();
      const rawName = typeof action.payload?.name === 'string' ? action.payload.name : '';
      const rawDesc = typeof action.payload?.description === 'string' ? action.payload.description : '';
      const name = rawName.trim() ? rawName.trim() : 'New Look';
      const description = rawDesc.trim() ? rawDesc.trim() : 'Describe wardrobe and makeup...';
      return {
        ...acc,
        characters: acc.characters.map((c) => {
          if (c.id !== characterId) return c;
          const look = {
            id: `look-${now}-${Math.random().toString(16).slice(2, 8)}`,
            name,
            description,
            previewUrl: '',
            assetState: { status: 'idle', attempts: 0 },
          };
          return { ...c, looks: [...(c.looks || []), look] };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_CHARACTER_LOOK') {
      const characterId = String(action.payload?.characterId || '');
      const lookId = String(action.payload?.lookId || '');
      const patch = action.payload?.patch || {};
      if (!characterId || !lookId) return acc;
      return {
        ...acc,
        characters: acc.characters.map((c) => {
          if (c.id !== characterId) return c;
          return {
            ...c,
            looks: (c.looks || []).map((l: any) =>
              l.id === lookId
                ? {
                    ...l,
                    name: typeof patch.name === 'string' ? patch.name : l.name,
                    description: typeof patch.description === 'string' ? patch.description : l.description,
                  }
                : l,
            ),
          };
        }),
        updatedAt: Date.now(),
      };
    }

    if (action.type === 'UPDATE_ELEMENT') {
      const { shotId, sequenceId, elementType, prompt, metadata } = action.payload || {};
      if (!shotId || !sequenceId || !elementType) return acc;
      return {
        ...acc,
        sequences: acc.sequences.map((seq) => {
          if (seq.id !== sequenceId) return seq;
          return {
            ...seq,
            shots: seq.shots.map((shot) => {
              if (shot.id !== shotId) return shot;
              const prev = shot.elements[elementType as ElementType] || null;
              const nextMetadata =
                metadata && typeof metadata === 'object' && !Array.isArray(metadata)
                  ? { ...(prev?.metadata || {}), ...metadata }
                  : prev?.metadata;
              return {
                ...shot,
                elements: {
                  ...shot.elements,
                  [elementType]: {
                    ...prev,
                    prompt: typeof prompt === 'string' ? prompt : shot.elements[elementType as ElementType]?.prompt,
                    status: 'manual' as const,
                    metadata: nextMetadata,
                  },
                },
              };
            }),
          };
        }),
      };
    }

    return acc;
  }, story);
};

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isCinemaMode, setIsCinemaMode] = useState(false);
  const [isPlayingMaster, setIsPlayingMaster] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'info' }>>([]);
  const [pendingDirectorFallback, setPendingDirectorFallback] = useState<null | { projectId: string; res: DirectorCommandResponse }>(null);
  const [pendingDirectorFallbackArmed, setPendingDirectorFallbackArmed] = useState(false);
  const [pendingDirectorMultiAgentFailure, setPendingDirectorMultiAgentFailure] = useState<
    null | { projectId: string; message: string; selection: SelectionState; error: string; details?: any }
  >(null);
  const [pendingDirectorSingleFallbackArmed, setPendingDirectorSingleFallbackArmed] = useState(false);

  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace());
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => loadAiSettings());
  const [screen, setScreen] = useState<Screen>(() => (loadWorkspace().activeProjectId ? 'project' : 'library'));

  const [selection, setSelection] = useState<SelectionState>(() => ({
    type: 'story',
    id: loadWorkspace().activeProjectId || '',
  }));

  const [agentHistoryByProject, setAgentHistoryByProject] = useState<Record<string, AgentLogEntry[]>>({});
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [productionTarget, setProductionTarget] = useState<{ sequenceId: string; shotId: string } | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isScriptEditorOpen, setIsScriptEditorOpen] = useState(false);
  const [isDirectorThinking, setIsDirectorThinking] = useState(false);
  const [directorStream, setDirectorStream] = useState<null | {
    status?: string;
    reply?: string;
    steps: Array<{ agent: string; ok?: boolean; ms?: number; error?: string; status?: string }>;
  }>(null);

  const activeStory = useMemo<Story | null>(() => {
    if (!workspace.activeProjectId) return null;
    return workspace.projects.find((p) => p.id === workspace.activeProjectId) || null;
  }, [workspace]);

  const agentHistory = useMemo<AgentLogEntry[]>(() => {
    if (!workspace.activeProjectId) return [];
    return agentHistoryByProject[workspace.activeProjectId] || [];
  }, [agentHistoryByProject, workspace.activeProjectId]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isToggle = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd');
      if (isToggle) {
        e.preventDefault();
        setIsDebugOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  useEffect(() => {
    saveAiSettings(aiSettings);
  }, [aiSettings]);

  useEffect(() => {
    if (screen === 'project' && !workspace.activeProjectId) setScreen('library');
  }, [screen, workspace.activeProjectId]);

  useEffect(() => {
    if (!workspace.activeProjectId) return;
    setSelection({ type: 'story', id: workspace.activeProjectId });
  }, [workspace.activeProjectId]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const addToast = (message: string, type: 'success' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };

  const updateStoryById = (projectId: string, updater: (prev: Story) => Story) => {
    setWorkspace((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === projectId);
      if (idx < 0) return prev;
      const now = Date.now();
      const projects = prev.projects.slice();
      projects[idx] = { ...updater(projects[idx]), updatedAt: now };
      return { ...prev, projects };
    });
  };

  const updateActiveStory = (updater: (prev: Story) => Story) => {
    setWorkspace((prev) => {
      const projectId = prev.activeProjectId;
      if (!projectId) return prev;
      const idx = prev.projects.findIndex((p) => p.id === projectId);
      if (idx < 0) return prev;

      const now = Date.now();
      const current = prev.projects[idx];
      const updated = updater(current);
      const projects = prev.projects.slice();
      projects[idx] = { ...updated, updatedAt: now };
      return { ...prev, projects };
    });
  };

  // ----- Workspace / Project Library -----

  const openProject = (projectId: string) => {
    setWorkspace((prev) => {
      const now = Date.now();
      return {
        ...prev,
        activeProjectId: projectId,
        projects: prev.projects.map((p) => (p.id === projectId ? { ...p, lastOpenedAt: now } : p)),
      };
    });
    setSelection({ type: 'story', id: projectId });
    setScreen('project');
  };

  const handleRenameProject = (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    const title = window.prompt('Project title', existing.title)?.trim();
    if (!title) return;
    setWorkspace((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => (p.id === projectId ? { ...p, title, updatedAt: Date.now() } : p)),
    }));
    addToast('Project renamed', 'success');
  };

  const handleDeleteProject = (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    if (!window.confirm(`Delete project "${existing.title}"? This cannot be undone.`)) return;

    setWorkspace((prev) => {
      const nextProjects = prev.projects.filter((p) => p.id !== projectId);
      const activeProjectId = prev.activeProjectId === projectId ? undefined : prev.activeProjectId;
      return { ...prev, projects: nextProjects, activeProjectId };
    });

    if (workspace.activeProjectId === projectId) setScreen('library');
    addToast('Project deleted', 'info');
  };

  const handleDuplicateProject = (projectId: string) => {
    const existing = workspace.projects.find((p) => p.id === projectId);
    if (!existing) return;
    const now = Date.now();
    const dup = cloneStory(existing);
    dup.id = `proj-${now}`;
    dup.title = `${existing.title} (Copy)`;
    dup.createdAt = now;
    dup.updatedAt = now;
    dup.lastOpenedAt = now;

    setWorkspace((prev) => ({ ...prev, projects: [dup, ...prev.projects] }));
    addToast('Project duplicated', 'success');
  };

  const handleCreateDemoProject = () => {
    const demo = createDemoProject();
    setWorkspace((prev) => ({
      ...prev,
      projects: [demo, ...prev.projects],
      activeProjectId: demo.id,
    }));
    setSelection({ type: 'story', id: demo.id });
    setScreen('project');
    addToast('Demo project created', 'success');
  };

  const upsertWorkspaceProject = (project: Story) => {
    setWorkspace((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === project.id);
      if (idx < 0) return { ...prev, projects: [project, ...prev.projects] };
      const projects = prev.projects.slice();
      projects[idx] = project;
      return { ...prev, projects };
    });
  };

  const handleCreationComplete = (project: Story, plan: AgentPlan, debug?: any) => {
    setWorkspace((prev) => {
      const idx = prev.projects.findIndex((p) => p.id === project.id);
      const projects = prev.projects.slice();
      if (idx < 0) projects.unshift(project);
      else projects[idx] = project;
      return { ...prev, projects, activeProjectId: project.id };
    });
    setSelection({ type: 'story', id: project.id });
    setScreen('project');

    const systemEntry: AgentLogEntry = {
      id: `sys-${Date.now()}`,
      role: 'system',
      content: `Scaffold complete: ${plan.summary}${plan.steps?.length ? `\n- ${plan.steps.map(s => s.title).join('\n- ')}` : ''}`,
      timestamp: Date.now(),
      actionDetails: { type: 'SCAFFOLD_PROJECT', actions: plan.actions, planId: plan.id },
      debug,
    };

    setAgentHistoryByProject((prev) => ({
      ...prev,
      [project.id]: [...(prev[project.id] || []), systemEntry],
    }));

    const fellBack = Boolean(debug?.error);
    if (fellBack && aiSettings.scaffoldWorker.provider !== 'mock') {
      addToast('Scaffold fell back to mock/rules. Open Debug (Ctrl/Cmd+Shift+D) for details.', 'info');
    } else {
      addToast('Project scaffolded by Director AI', 'success');
    }

  };

  const startShotProduction = (sequenceId: string, shotId: string) => {
    updateActiveStory((prev) => ({
      ...prev,
      sequences: prev.sequences.map((seq) => {
        if (seq.id !== sequenceId) return seq;
        return {
          ...seq,
          shots: seq.shots.map((s) =>
            s.id === shotId ? { ...s, production: { status: 'queued', lastStartedAt: Date.now() } } : s,
          ),
        };
      }),
    }));
    addToast('Shot production queued (placeholder)', 'success');
  };

  // ----- Render Helpers -----

  const getActiveItem = () => {
    if (!activeStory) return null;
    switch (selection.type) {
      case 'sequence':
        return activeStory.sequences.find((s) => s.id === selection.id);
      case 'shot': {
        for (const seq of activeStory.sequences) {
          const shot = seq.shots.find((s) => s.id === selection.id);
          if (shot) return shot;
        }
        return null;
      }
      case 'location':
        return activeStory.locations.find((l) => l.id === selection.id);
      case 'character':
        return activeStory.characters.find((c) => c.id === selection.id);
      default:
        return activeStory;
    }
  };

  const activeItem = getActiveItem();

  const getContextLocation = () => {
    if (selection.type === 'shot' && activeStory && activeItem) {
      const shot = activeItem as Shot;
      return activeStory.locations.find((l) => l.id === shot.locationId);
    }
    return undefined;
  };

  const consoleContextType: 'story' | 'sequence' | 'shot' =
    selection.type === 'shot' ? 'shot' : selection.type === 'sequence' ? 'sequence' : 'story';

  // ----- Project Editing Handlers -----

  const handleSelect = (sel: SelectionState) => setSelection(sel);

  const handleCreateSequence = () => {
    if (!activeStory) return;
    const now = Date.now();
    const newId = `seq-${now}`;
    const newSeq: Sequence = {
      id: newId,
      title: 'New Sequence',
      context: 'Describe the narrative beat...',
      shots: [],
    };
    updateActiveStory((prev) => ({ ...prev, sequences: [...prev.sequences, newSeq] }));
    setSelection({ type: 'sequence', id: newId });
    addToast('New sequence added', 'success');
  };

  const handleAddShot = (
    seqId: string,
    opts?: { afterShotId?: string; locationId?: string; timeOfDay?: string },
  ) => {
    if (!activeStory) return;
    updateActiveStory((prev) => {
      const seq = prev.sequences.find((s) => s.id === seqId);
      if (!seq) return prev;
      const newShot = createBlankShot(prev, seq, { locationId: opts?.locationId, timeOfDay: opts?.timeOfDay });

      const shots = seq.shots.slice();
      let insertAt = shots.length;
      if (opts?.afterShotId) {
        const idx = shots.findIndex((s) => s.id === opts.afterShotId);
        if (idx >= 0) insertAt = idx + 1;
      }

      shots.splice(insertAt, 0, newShot);
      const nextShots = renumberShots(shots);
      return {
        ...prev,
        sequences: prev.sequences.map((s) => (s.id === seqId ? { ...s, shots: nextShots } : s)),
      };
    });
    addToast('New shot added to sequence', 'success');
  };

  const handleDeleteShot = (seqId: string, shotId: string) => {
    updateActiveStory((prev) => {
      return {
        ...prev,
        sequences: prev.sequences.map((s) => {
          if (s.id !== seqId) return s;
          const nextShots = renumberShots(s.shots.filter((sh) => sh.id !== shotId));
          return { ...s, shots: nextShots };
        }),
      };
    });
    if (selection.type === 'shot' && selection.id === shotId) setSelection({ type: 'sequence', id: seqId });
    addToast('Shot removed', 'info');
  };

  const handleMoveShot = (seqId: string, shotId: string, direction: 'left' | 'right') => {
    updateActiveStory((prev) => {
      const seq = prev.sequences.find((s) => s.id === seqId);
      if (!seq) return prev;
      const idx = seq.shots.findIndex((s) => s.id === shotId);
      if (idx < 0) return prev;
      const nextIdx = direction === 'left' ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= seq.shots.length) return prev;

      const nextShots = seq.shots.slice();
      const tmp = nextShots[idx];
      nextShots[idx] = nextShots[nextIdx];
      nextShots[nextIdx] = tmp;

      return {
        ...prev,
        sequences: prev.sequences.map((s) => (s.id === seqId ? { ...s, shots: renumberShots(nextShots) } : s)),
      };
    });
  };

  const handleSequenceUpdate = (updatedSeq: Sequence) => {
    updateActiveStory((prev) => ({
      ...prev,
      sequences: prev.sequences.map((s) => (s.id === updatedSeq.id ? updatedSeq : s)),
    }));
  };

  const handleShotUpdate = (updatedShot: Shot) => {
    updateActiveStory((prev) => ({
      ...prev,
      sequences: prev.sequences.map((seq) => {
        if (seq.shots.some((s) => s.id === updatedShot.id)) {
          return { ...seq, shots: seq.shots.map((s) => (s.id === updatedShot.id ? updatedShot : s)) };
        }
        return seq;
      }),
    }));
  };

  const handleCreateLocation = () => {
    const newId = `loc-${Date.now()}`;
    const newLoc: Location = {
      id: newId,
      name: 'New Environment',
      description: 'Describe the atmospheric details...',
      visualStyle: 'Cinematic style details...',
      previewUrl: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?q=80&w=2148&auto=format&fit=crop',
      status: 'draft',
    };
    updateActiveStory((prev) => ({ ...prev, locations: [...prev.locations, newLoc] }));
    setSelection({ type: 'location', id: newId });
    addToast('New environment added to library', 'success');
  };

  const handleCreateCharacter = () => {
    const newId = `char-${Date.now()}`;
    const newChar: Character = {
      id: newId,
      name: 'New Character',
      description: 'Describe physical traits and personality...',
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1287&auto=format&fit=crop',
      status: 'draft',
      looks: [],
    };
    updateActiveStory((prev) => ({ ...prev, characters: [...prev.characters, newChar] }));
    setSelection({ type: 'character', id: newId });
    addToast('New character casted', 'success');
  };

  const handleUpdateLocation = (loc: Location) => {
    updateActiveStory((prev) => ({ ...prev, locations: prev.locations.map((l) => (l.id === loc.id ? loc : l)) }));
    addToast('Environment updated', 'info');
  };

  const handleUpdateCharacter = (char: Character) => {
    updateActiveStory((prev) => ({ ...prev, characters: prev.characters.map((c) => (c.id === char.id ? char : c)) }));
    addToast('Character profile updated', 'info');
  };

  const handleDeleteSequence = (id: string) => {
    updateActiveStory((prev) => ({ ...prev, sequences: prev.sequences.filter((s) => s.id !== id) }));
    if ((selection.type === 'sequence' && selection.id === id) || (selection.type === 'shot' && selection.parentId === id)) {
      if (activeStory) setSelection({ type: 'story', id: activeStory.id });
    }
    addToast('Sequence removed', 'info');
  };

  const handleDeleteLocation = (id: string) => {
    updateActiveStory((prev) => ({
      ...prev,
      locations: prev.locations.filter((l) => l.id !== id),
      sequences: prev.sequences.map((seq) => ({
        ...seq,
        shots: seq.shots.map((shot) => (shot.locationId === id ? { ...shot, locationId: '' } : shot)),
      })),
    }));
    if (activeStory) setSelection({ type: 'story', id: activeStory.id });
    addToast('Environment removed', 'info');
  };

  const handleDeleteCharacter = (id: string) => {
    updateActiveStory((prev) => ({
      ...prev,
      characters: prev.characters.filter((c) => c.id !== id),
      sequences: prev.sequences.map((seq) => ({
        ...seq,
        shots: seq.shots.map((shot) => {
          const cast = (shot.elements as any)?.[ElementType.CASTING]?.metadata?.characters;
          const castArr = Array.isArray(cast) ? cast : [];
          const nextCast = castArr.filter((c: any) => String(c?.id || '') !== id);
          return {
            ...shot,
            elements: {
              ...shot.elements,
              [ElementType.CASTING]: {
                ...shot.elements[ElementType.CASTING],
                metadata: { ...(shot.elements[ElementType.CASTING].metadata || {}), characters: nextCast },
                status: 'manual' as const,
              },
            },
          };
        }),
      })),
    }));
    if (selection.type === 'character' && selection.id === id && activeStory) setSelection({ type: 'story', id: activeStory.id });
    addToast('Character removed from casting', 'info');
  };

  const handleCastingUpdate = (shotId: string, seqId: string, newCharacters: Character[]) => {
    updateActiveStory((prev) => {
      const updatedSequences = prev.sequences.map((seq) => {
        if (seq.id !== seqId) return seq;
        return {
          ...seq,
          shots: seq.shots.map((shot) => {
            if (shot.id !== shotId) return shot;
            return {
              ...shot,
              elements: {
                ...shot.elements,
                [ElementType.CASTING]: {
                  ...shot.elements[ElementType.CASTING],
                  metadata: {
                    ...shot.elements[ElementType.CASTING].metadata,
                    characters: newCharacters,
                  },
                  status: 'manual' as const,
                },
              },
            };
          }),
        };
      });
      return { ...prev, sequences: updatedSequences };
    });
  };

  const handleCharacterPromptChange = (_shotId: string, _seqId: string, _charId: string, _prompt: string) => {
    // TODO: per-shot visual overrides (future consistency engine).
  };

  const handleScriptUpdate = (_shotId: string, _seqId: string, _dialogue: DialogueLine[]) => {
    // TODO: structured dialogue lines (future).
  };

  const applyDirectorActions = (projectId: string, story: Story, actions: AgentAction[]) => {
    if (!actions.length) {
      addToast('No changes applied', 'info');
      return { applied: 0, dropped: 0, droppedActions: [] as AgentAction[] };
    }

    const validateAction = (a: AgentAction): { ok: boolean; reason?: string } => {
      const t = a.type;
      const p: any = a.payload || {};
      if (t === 'UPDATE_STORY') {
        const patch = p.patch || p;
        const hasAny = ['title', 'logline', 'intent', 'keyVisualUrl'].some((k) => typeof patch?.[k] === 'string');
        return hasAny ? { ok: true } : { ok: false, reason: 'UPDATE_STORY missing patch' };
      }
      if (t === 'NAVIGATE') {
        return p?.type && p?.id ? { ok: true } : { ok: false, reason: 'NAVIGATE missing payload' };
      }
      if (t === 'CREATE_LOCATION') {
        return { ok: true };
      }
      if (t === 'DELETE_LOCATION') {
        return p?.locationId ? { ok: true } : { ok: false, reason: 'DELETE_LOCATION missing id' };
      }
      if (t === 'UPDATE_LOCATION') {
        return p?.locationId ? { ok: true } : { ok: false, reason: 'UPDATE_LOCATION missing id' };
      }
      if (t === 'CREATE_CHARACTER') {
        return { ok: true };
      }
      if (t === 'DELETE_CHARACTER') {
        return p?.characterId ? { ok: true } : { ok: false, reason: 'DELETE_CHARACTER missing id' };
      }
      if (t === 'UPDATE_CHARACTER') {
        return p?.characterId ? { ok: true } : { ok: false, reason: 'UPDATE_CHARACTER missing id' };
      }
      if (t === 'CREATE_SHOT') {
        return p?.sequenceId ? { ok: true } : { ok: false, reason: 'CREATE_SHOT missing sequenceId' };
      }
      if (t === 'DELETE_SHOT') {
        return p?.sequenceId && p?.shotId ? { ok: true } : { ok: false, reason: 'DELETE_SHOT missing ids' };
      }
      if (t === 'MOVE_SHOT') {
        return p?.sequenceId && p?.shotId ? { ok: true } : { ok: false, reason: 'MOVE_SHOT missing ids' };
      }
      if (t === 'UPDATE_SHOT') {
        return p?.shotId ? { ok: true } : { ok: false, reason: 'UPDATE_SHOT missing shotId' };
      }
      if (t === 'UPDATE_ELEMENT') {
        return p?.shotId && p?.sequenceId && p?.elementType ? { ok: true } : { ok: false, reason: 'UPDATE_ELEMENT missing ids' };
      }
      if (t === 'SET_CAST') {
        return p?.shotId && p?.sequenceId ? { ok: true } : { ok: false, reason: 'SET_CAST missing ids' };
      }
      if (t === 'CREATE_CHARACTER_LOOK') {
        return p?.characterId && p?.name && p?.description ? { ok: true } : { ok: false, reason: 'CREATE_CHARACTER_LOOK missing fields' };
      }
      if (t === 'UPDATE_CHARACTER_LOOK') {
        return p?.characterId && p?.lookId ? { ok: true } : { ok: false, reason: 'UPDATE_CHARACTER_LOOK missing ids' };
      }
      if (t === 'GENERATE_SHOT_IMAGE') {
        return p?.sequenceId && p?.shotId ? { ok: true } : { ok: false, reason: 'GENERATE_SHOT_IMAGE missing ids' };
      }
      if (t === 'GENERATE_LOCATION_PREVIEW') {
        return p?.locationId ? { ok: true } : { ok: false, reason: 'GENERATE_LOCATION_PREVIEW missing id' };
      }
      if (t === 'GENERATE_CHARACTER_AVATAR') {
        return p?.characterId ? { ok: true } : { ok: false, reason: 'GENERATE_CHARACTER_AVATAR missing id' };
      }
      if (t === 'GENERATE_CHARACTER_LOOK') {
        return p?.characterId && p?.lookId ? { ok: true } : { ok: false, reason: 'GENERATE_CHARACTER_LOOK missing ids' };
      }
      if (t === 'GENERATE_PROJECT_ASSETS') {
        return { ok: true };
      }
      return { ok: true };
    };

    const invalid: AgentAction[] = [];
    const validActions = actions.filter((a) => {
      const v = validateAction(a);
      if (!v.ok) invalid.push(a);
      return v.ok;
    });

    if (!validActions.length) {
      addToast('Director actions were invalid (missing payload).', 'info');
      addDebugEvent({ level: 'warn', scope: 'agent.direct', message: 'Dropped invalid actions', data: { actions } });
      return { applied: 0, dropped: invalid.length, droppedActions: invalid };
    }

    if (invalid.length) {
      addDebugEvent({ level: 'warn', scope: 'agent.direct', message: 'Some actions dropped', data: { invalid } });
    }

    const navigateActions = validActions.filter((a) => a.type === 'NAVIGATE');
    const mutationActions = validActions.filter((a) => !a.type.startsWith('GENERATE_') && a.type !== 'NAVIGATE');
    const generateActions = validActions.filter((a) => a.type.startsWith('GENERATE_'));

    if (mutationActions.length) {
      updateStoryById(projectId, (prev) => applyActionsToStory(prev, mutationActions));
      addToast('Director applied edits', 'success');
    }

    if (navigateActions.length) {
      const last = navigateActions[navigateActions.length - 1];
      const nextSel = last?.payload as SelectionState | undefined;
      if (nextSel?.type && nextSel?.id) setSelection(nextSel);
    }

    const storyAfterUpdates = mutationActions.length ? applyActionsToStory(story, mutationActions) : story;

    const deduped = new Map<string, AssetJob>();
    const addJob = (key: string, job: AssetJob) => {
      if (!deduped.has(key)) deduped.set(key, job);
    };

    let concurrency = 2;
    let scopeLabel = 'director';

    // Auto-generate look images for newly created looks (director-created) to avoid avatar fallback.
    if (mutationActions.some((a) => a.type === 'CREATE_CHARACTER_LOOK')) {
      const beforeMap = new Map<string, Set<string>>();
      for (const ch of story.characters || []) {
        beforeMap.set(
          ch.id,
          new Set((ch.looks || []).map((lk) => String(lk.id)))
        );
      }
      const styleGuide = (storyAfterUpdates as any)?.styleGuide;
      for (const ch of storyAfterUpdates.characters || []) {
        const prev = beforeMap.get(ch.id) || new Set<string>();
        for (const lk of ch.looks || []) {
          const lookId = String(lk.id || '');
          if (!lookId || prev.has(lookId)) continue;
          addJob(`look:${ch.id}:${lookId}`, {
            kind: 'look',
            characterId: ch.id,
            lookId,
            prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
          });
        }
      }
    }

    // Auto-generate storyboard images when director updates shot description/time/location.
    const updatedShotIds: Array<{ sequenceId?: string; shotId: string }> = [];
    for (const a of mutationActions) {
      if (a.type !== 'UPDATE_SHOT') continue;
      const payload = (a as any).payload || {};
      const patch = payload?.patch || {};
      const hasVisualChange =
        typeof patch.description === 'string' ||
        typeof patch.timeOfDay === 'string' ||
        typeof patch.locationId === 'string' ||
        typeof patch.duration === 'number';
      if (!hasVisualChange) continue;
      const shotId = String(payload.shotId || '');
      if (!shotId) continue;
      const sequenceId = payload.sequenceId ? String(payload.sequenceId) : undefined;
      updatedShotIds.push({ sequenceId, shotId });
    }
    if (updatedShotIds.length) {
      for (const { sequenceId, shotId } of updatedShotIds) {
        let seq = sequenceId ? storyAfterUpdates.sequences.find((s) => s.id === sequenceId) : undefined;
        if (!seq) seq = storyAfterUpdates.sequences.find((s) => s.shots.some((sh) => sh.id === shotId));
        const shot = seq?.shots.find((s) => s.id === shotId);
        if (seq && shot) addJob(`shot:${seq.id}:${shotId}`, { kind: 'shot', sequenceId: seq.id, shot });
      }
    }

    // Auto-generate look images when look descriptions are updated.
    const updatedLooks: Array<{ characterId: string; lookId: string }> = [];
    for (const a of mutationActions) {
      if (a.type !== 'UPDATE_CHARACTER_LOOK') continue;
      const payload = (a as any).payload || {};
      const characterId = String(payload.characterId || '').trim();
      const lookId = String(payload.lookId || '').trim();
      const patch = payload.patch || {};
      const hasVisualChange = typeof patch.description === 'string' || typeof patch.name === 'string';
      if (characterId && lookId && hasVisualChange) updatedLooks.push({ characterId, lookId });
    }
    if (updatedLooks.length) {
      const styleGuide = (storyAfterUpdates as any)?.styleGuide;
      for (const { characterId, lookId } of updatedLooks) {
        const ch = storyAfterUpdates.characters.find((c) => c.id === characterId);
        const lk = ch?.looks?.find((x) => x.id === lookId);
        if (ch && lk) addJob(`look:${characterId}:${lookId}`, { kind: 'look', characterId, lookId, prompt: buildCharacterLookPrompt(ch, lk, styleGuide) });
      }
    }

    if (!generateActions.length && deduped.size === 0) {
      return { applied: validActions.length, dropped: invalid.length, droppedActions: invalid };
    }

    for (const a of generateActions) {
      const payload = (a as any).payload || {};
      if (a.type === 'GENERATE_PROJECT_ASSETS') {
        const scope = String(payload.scope || 'all') as any;
        if (typeof payload.concurrency === 'number' && payload.concurrency > 0 && payload.concurrency <= 6) {
          concurrency = Math.floor(payload.concurrency);
        }
        scopeLabel = `director:${scope}`;
        const jobs = buildAssetJobs(storyAfterUpdates, scope);
        for (const j of jobs) {
          if (j.kind === 'masterkv') addJob(`masterkv`, j);
          if (j.kind === 'shot') addJob(`shot:${j.sequenceId}:${j.shot.id}`, j);
          if (j.kind === 'location') addJob(`location:${j.locationId}`, j);
          if (j.kind === 'character') addJob(`character:${j.characterId}`, j);
          if (j.kind === 'look') addJob(`look:${j.characterId}:${j.lookId}`, j);
        }
        continue;
      }

      if (a.type === 'GENERATE_SHOT_IMAGE') {
        const sequenceId = String(payload.sequenceId || '');
        const shotId = String(payload.shotId || '');
        const seq = storyAfterUpdates.sequences.find((s) => s.id === sequenceId);
        const shot = seq?.shots.find((s) => s.id === shotId);
        if (shot && sequenceId) addJob(`shot:${sequenceId}:${shotId}`, { kind: 'shot', sequenceId, shot });
        continue;
      }

      if (a.type === 'GENERATE_LOCATION_PREVIEW') {
        const locationId = String(payload.locationId || '');
        const loc = storyAfterUpdates.locations.find((l) => l.id === locationId);
        if (loc) addJob(`location:${locationId}`, { kind: 'location', locationId, prompt: buildLocationPreviewPrompt(loc) });
        continue;
      }

      if (a.type === 'GENERATE_CHARACTER_AVATAR') {
        const characterId = String(payload.characterId || '');
        const ch = storyAfterUpdates.characters.find((c) => c.id === characterId);
        if (ch) addJob(`character:${characterId}`, { kind: 'character', characterId, prompt: buildCharacterAvatarPrompt(ch) });
        continue;
      }

      if (a.type === 'GENERATE_CHARACTER_LOOK') {
        const characterId = String(payload.characterId || '');
        const lookId = String(payload.lookId || '');
        const ch = storyAfterUpdates.characters.find((c) => c.id === characterId);
        const lk = ch?.looks?.find((x) => x.id === lookId);
        if (ch && lk) addJob(`look:${characterId}:${lookId}`, { kind: 'look', characterId, lookId, prompt: buildCharacterLookPrompt(ch, lk, (storyAfterUpdates as any)?.styleGuide) });
        continue;
      }
    }

    const jobs = Array.from(deduped.values());
    if (jobs.length && aiSettings.image.provider !== 'mock') {
      addToast(`Queued asset generation (${jobs.length})…`, 'info');
      addDebugEvent({ level: 'info', scope: 'asset.exec', message: 'Queue asset generation', data: { projectId, scope: scopeLabel, jobs: jobs.length, concurrency } });
      setTimeout(() => {
        let storyRef = storyAfterUpdates;
        const handleAssetEvent = (ev: any) => {
            if (ev.type === 'start') {
              storyRef = applyAssetStart(storyRef, ev.job);
              updateStoryById(projectId, (prev) => applyAssetStart(prev, ev.job));
              addDebugEvent({ level: 'info', scope: 'asset.exec', message: 'Start', data: { done: ev.done, total: ev.total, job: ev.job } });
            }
            if (ev.type === 'success') {
              storyRef = applyAssetResult(storyRef, ev.job, ev.imageUrl);
              updateStoryById(projectId, (prev) => applyAssetResult(prev, ev.job, ev.imageUrl));
              addDebugEvent({
                level: 'info',
                scope: 'asset.exec',
                message: 'Success',
                data: { done: ev.done, total: ev.total, job: ev.job, imageUrl: ev.imageUrl, debug: ev.debug },
              });
              if (ev.job?.kind === 'character') {
                const characterId = String(ev.job.characterId || '');
                const ch = storyRef.characters.find((c) => c.id === characterId);
                if (ch?.looks?.length) {
                  const ok = window.confirm(`Avatar generated for ${ch.name}. Generate look variants now?`);
                  if (ok) {
                    const styleGuide = (storyRef as any)?.styleGuide;
                    const lookJobs = ch.looks.map((lk) => ({
                      kind: 'look',
                      characterId,
                      lookId: lk.id,
                      prompt: buildCharacterLookPrompt(ch, lk, styleGuide),
                    }));
                    executeAssetJobs({
                      jobs: lookJobs,
                      settings: aiSettings.image,
                      aspectRatio: storyRef.aspectRatio,
                      concurrency,
                      getStoryForRefs: () => storyRef,
                      maxAttempts: 3,
                      stopAfterMasterKvFailure: true,
                      onEvent: handleAssetEvent,
                    });
                  }
                }
              }
            }
            if (ev.type === 'blocked') {
              storyRef = applyAssetBlocked(storyRef, ev.job, ev.reason);
              updateStoryById(projectId, (prev) => applyAssetBlocked(prev, ev.job, ev.reason));
              addToast(`Blocked: ${ev.reason}`, 'info');
              addDebugEvent({
                level: 'warn',
                scope: 'asset.exec',
                message: 'Blocked',
                data: { done: ev.done, total: ev.total, job: ev.job, reason: ev.reason },
              });
            }
            if (ev.type === 'error') {
              storyRef = applyAssetError(storyRef, ev.job, ev.error);
              updateStoryById(projectId, (prev) => applyAssetError(prev, ev.job, ev.error));
              addDebugEvent({
                level: 'warn',
                scope: 'asset.exec',
                message: 'Error',
                data: { done: ev.done, total: ev.total, job: ev.job, error: ev.error },
              });
            }
            if (ev.done === ev.total) addToast('Assets generated (director).', 'success');
          };
        executeAssetJobs({
          jobs,
          settings: aiSettings.image,
          aspectRatio: storyAfterUpdates.aspectRatio,
          concurrency,
          getStoryForRefs: () => storyRef,
          maxAttempts: 3,
          stopAfterMasterKvFailure: true,
          onEvent: handleAssetEvent,
        }).catch(() => {
          addToast('Asset generation had errors. Check Debug.', 'info');
        });
      }, 0);
    } else if (jobs.length) {
      addToast('Asset generation requested, but Image Provider is Mock.', 'info');
    }
    return { applied: validActions.length, dropped: invalid.length, droppedActions: invalid };
  };

  // ----- Director Console -----

		  const handleDirectorMessage = async (msg: string) => {
		    if (!activeStory || !workspace.activeProjectId) return;
		      const projectId = workspace.activeProjectId;
        const selectionSnapshot = selection;
        setIsDirectorThinking(true);
        addDebugEvent({
          level: 'info',
          scope: 'agent.direct',
          message: 'Request',
          data: { message: msg, selection: selectionSnapshot, storyId: activeStory.id },
        });
        const useStreaming = Boolean((aiSettings.direct as any)?.useStreaming);
        if (useStreaming) {
          setDirectorStream({ status: 'Starting…', steps: [] });
        } else {
          setDirectorStream(null);
        }

	    const userEntry: AgentLogEntry = {
	      id: `u-${Date.now()}`,
	      role: 'user',
      content: msg,
      timestamp: Date.now(),
    };

	    setAgentHistoryByProject((prev) => ({
	      ...prev,
	      [projectId]: [...(prev[projectId] || []), userEntry],
	    }));

        let res: DirectorCommandResponse;
        try {
          if (useStreaming) {
            res = await runDirectorCommandStream(
              {
                message: msg,
                selection: selectionSnapshot,
                story: activeStory,
                settings: aiSettings.direct,
                allowSingleFallback: false,
                useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
              },
              (ev: DirectorStreamEvent) => {
                if (ev.event === 'status') {
                  setDirectorStream((prev) => ({ status: ev.data.message, reply: prev?.reply, steps: prev?.steps || [] }));
                }
                if (ev.event === 'agent_start') {
                  setDirectorStream((prev) => ({
                    status: `Running ${ev.data.agent}…`,
                    reply: prev?.reply,
                    steps: [...(prev?.steps || []), { agent: ev.data.agent, status: 'running' }],
                  }));
                }
                if (ev.event === 'agent_done') {
                  setDirectorStream((prev) => ({
                    status: prev?.status,
                    reply: prev?.reply,
                    steps: (prev?.steps || []).map((s) =>
                      s.agent === ev.data.agent
                        ? { ...s, ok: ev.data.ok, ms: ev.data.ms, error: ev.data.error, status: ev.data.ok ? 'done' : 'error' }
                        : s
                    ),
                  }));
                }
                if (ev.event === 'reply_delta') {
                  setDirectorStream((prev) => ({
                    status: prev?.status,
                    reply: `${prev?.reply || ''}${ev.data.delta || ''}`,
                    steps: prev?.steps || [],
                  }));
                }
                if (ev.event === 'reply_done') {
                  setDirectorStream((prev) => ({
                    status: prev?.status,
                    reply: ev.data.text || prev?.reply,
                    steps: prev?.steps || [],
                  }));
                }
              }
            );
          } else {
            res = await runDirectorCommand({
              message: msg,
              selection: selectionSnapshot,
              story: activeStory,
              settings: aiSettings.direct,
              allowSingleFallback: false,
              useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
            });
          }
          addDebugEvent({ level: 'info', scope: 'agent.direct', message: 'Response', data: res });
        } catch (e) {
          const errMsg = isAgentApiError(e)
            ? String(e.bodyJson?.multiAgentError || e.bodyJson?.message || e.message)
            : e instanceof Error
              ? e.message
              : String(e);

          const agentEntry: AgentLogEntry = {
            id: `a-${Date.now()}`,
            role: 'agent',
            content: `Director request failed: ${errMsg}`,
            timestamp: Date.now(),
            actionDetails: { type: 'DIRECTOR_ERROR' },
            debug: isAgentApiError(e) ? { ...(e.bodyJson || {}), status: e.status, url: e.url } : { error: errMsg },
          };

          setAgentHistoryByProject((prev) => ({
            ...prev,
            [projectId]: [...(prev[projectId] || []), agentEntry],
          }));

          if (isAgentApiError(e) && e.bodyJson?.errorCode === 'MULTI_AGENT_FAILED') {
            setPendingDirectorMultiAgentFailure({
              projectId,
              message: msg,
              selection: selectionSnapshot,
              error: errMsg,
              details: e.bodyJson,
            });
            setPendingDirectorSingleFallbackArmed(false);
            addToast('Director multi-agent failed. Retry or choose single-call fallback.', 'info');
          } else {
            addToast('Director request failed. Open Debug (Ctrl/Cmd+Shift+D) for details.', 'info');
          }
          setIsDirectorThinking(false);
          setDirectorStream(null);
          return;
        }

        const isFallback = res.debug?.transport === 'rule' && aiSettings.direct.provider !== 'mock';

        const agentEntryId = `a-${Date.now()}`;
        const agentEntry: AgentLogEntry = {
          id: agentEntryId,
          role: 'agent',
          content: res.reply,
          timestamp: Date.now(),
          actionDetails: { type: isFallback ? 'DIRECTOR_FALLBACK_PENDING' : 'DIRECTOR_COMMAND', actions: res.actions, planId: res.plan.id },
          debug: res.debug,
        };

		    setAgentHistoryByProject((prev) => ({
		      ...prev,
		      [projectId]: [...(prev[projectId] || []), agentEntry],
		    }));

        if (isFallback) {
          setPendingDirectorFallback({ projectId, res });
          setPendingDirectorFallbackArmed(false);
          addToast('Director returned fallback output. Confirm before applying.', 'info');
          setIsDirectorThinking(false);
          setDirectorStream(null);
          return;
        }
		
        const exec = applyDirectorActions(projectId, activeStory, res.actions);
        if (exec) {
          setAgentHistoryByProject((prev) => ({
            ...prev,
            [projectId]: (prev[projectId] || []).map((entry) =>
              entry.id === agentEntryId
                ? {
                    ...entry,
                    actionDetails: {
                      ...entry.actionDetails,
                      applied: exec.applied,
                      dropped: exec.dropped,
                      droppedActions: exec.droppedActions,
                    },
                  }
                : entry
            ),
          }));
        }
        setIsDirectorThinking(false);
        setDirectorStream(null);
		  };

      const retryDirectorAfterFailure = async (allowSingleFallback: boolean) => {
        if (!pendingDirectorMultiAgentFailure || !activeStory || !workspace.activeProjectId) return;
        if (pendingDirectorMultiAgentFailure.projectId !== activeStory.id) return;

        const projectId = pendingDirectorMultiAgentFailure.projectId;
        const msg = pendingDirectorMultiAgentFailure.message;
        const selectionSnapshot = pendingDirectorMultiAgentFailure.selection;
        setIsDirectorThinking(true);
        const useStreaming = Boolean((aiSettings.direct as any)?.useStreaming);
        if (useStreaming) {
          setDirectorStream({ status: 'Retrying…', steps: [] });
        } else {
          setDirectorStream(null);
        }

        try {
          const res = useStreaming
            ? await runDirectorCommandStream(
                {
                  message: msg,
                  selection: selectionSnapshot,
                  story: activeStory,
                  settings: aiSettings.direct,
                  allowSingleFallback,
                  useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
                },
                (ev: DirectorStreamEvent) => {
                  if (ev.event === 'status') {
                    setDirectorStream((prev) => ({ status: ev.data.message, reply: prev?.reply, steps: prev?.steps || [] }));
                  }
                  if (ev.event === 'agent_start') {
                    setDirectorStream((prev) => ({
                      status: `Running ${ev.data.agent}…`,
                      reply: prev?.reply,
                      steps: [...(prev?.steps || []), { agent: ev.data.agent, status: 'running' }],
                    }));
                  }
                  if (ev.event === 'agent_done') {
                    setDirectorStream((prev) => ({
                      status: prev?.status,
                      reply: prev?.reply,
                      steps: (prev?.steps || []).map((s) =>
                        s.agent === ev.data.agent
                          ? { ...s, ok: ev.data.ok, ms: ev.data.ms, error: ev.data.error, status: ev.data.ok ? 'done' : 'error' }
                          : s
                      ),
                    }));
                  }
                  if (ev.event === 'reply_delta') {
                    setDirectorStream((prev) => ({
                      status: prev?.status,
                      reply: `${prev?.reply || ''}${ev.data.delta || ''}`,
                      steps: prev?.steps || [],
                    }));
                  }
                  if (ev.event === 'reply_done') {
                    setDirectorStream((prev) => ({
                      status: prev?.status,
                      reply: ev.data.text || prev?.reply,
                      steps: prev?.steps || [],
                    }));
                  }
                }
              )
            : await runDirectorCommand({
                message: msg,
                selection: selectionSnapshot,
                story: activeStory,
                settings: aiSettings.direct,
                allowSingleFallback,
                useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
              });

          const agentEntryId = `sys-${Date.now()}`;
          const agentEntry: AgentLogEntry = {
            id: agentEntryId,
            role: 'system',
            content: `Director retry (${allowSingleFallback ? 'single-call fallback enabled' : 'multi-agent only'}) succeeded.`,
            timestamp: Date.now(),
            actionDetails: { type: 'DIRECTOR_RETRY', actions: res.actions, planId: res.plan.id },
            debug: res.debug,
          };
          setAgentHistoryByProject((prev) => ({
            ...prev,
            [projectId]: [...(prev[projectId] || []), agentEntry],
          }));

          const isFallback = res.debug?.transport === 'rule' && aiSettings.direct.provider !== 'mock';
          if (isFallback) {
            setPendingDirectorFallback({ projectId, res });
            setPendingDirectorFallbackArmed(false);
            setPendingDirectorMultiAgentFailure(null);
            setPendingDirectorSingleFallbackArmed(false);
            addToast('Director returned fallback output. Confirm before applying.', 'info');
            setIsDirectorThinking(false);
            setDirectorStream(null);
            return;
          }

          const exec = applyDirectorActions(projectId, activeStory, res.actions);
          if (exec) {
            setAgentHistoryByProject((prev) => ({
              ...prev,
              [projectId]: (prev[projectId] || []).map((entry) =>
                entry.id === agentEntryId
                  ? {
                      ...entry,
                      actionDetails: {
                        ...entry.actionDetails,
                        applied: exec.applied,
                        dropped: exec.dropped,
                        droppedActions: exec.droppedActions,
                      },
                    }
                  : entry
              ),
            }));
          }
          setPendingDirectorMultiAgentFailure(null);
          setPendingDirectorSingleFallbackArmed(false);
          setIsDirectorThinking(false);
          setDirectorStream(null);
        } catch (e) {
          const errMsg = isAgentApiError(e)
            ? String(e.bodyJson?.multiAgentError || e.bodyJson?.message || e.message)
            : e instanceof Error
              ? e.message
              : String(e);
          setPendingDirectorMultiAgentFailure((prev) => (prev ? { ...prev, error: errMsg, details: isAgentApiError(e) ? e.bodyJson : prev.details } : prev));
          setPendingDirectorSingleFallbackArmed(false);
          addToast('Director retry failed. Check Debug.', 'info');
          setIsDirectorThinking(false);
          setDirectorStream(null);
        }
      };

  // ----- Screens -----

  if (screen === 'library') {
    return (
      <>
        <ProjectLibrary
          projects={workspace.projects}
          theme={theme}
          toggleTheme={toggleTheme}
          onOpenProject={openProject}
          onCreateProject={() => setScreen('creation')}
          onCreateDemoProject={handleCreateDemoProject}
          onRenameProject={handleRenameProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onOpenAiSettings={() => setIsAiSettingsOpen(true)}
          onOpenDebug={() => setIsDebugOpen(true)}
        />

        {isAiSettingsOpen && (
          <AiSettingsModal
            settings={aiSettings}
            onSave={(next) => {
              setAiSettings(next);
              setIsAiSettingsOpen(false);
              addToast('AI settings saved', 'success');
            }}
            onClose={() => setIsAiSettingsOpen(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'creation') {
    return (
      <>
        <ProjectCreationWizard
          aiSettings={aiSettings}
          onComplete={handleCreationComplete}
          onDraftProject={upsertWorkspaceProject}
          onCancel={() => setScreen('library')}
        />
        {isAiSettingsOpen && (
          <AiSettingsModal settings={aiSettings} onSave={setAiSettings} onClose={() => setIsAiSettingsOpen(false)} />
        )}

        {isDebugOpen && (
          <DebugPanel
            aiSettings={aiSettings}
            activeStory={activeStory}
            agentHistory={agentHistory}
            onClose={() => setIsDebugOpen(false)}
          />
        )}
      </>
    );
  }

  if (!activeStory) {
    return <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">Loading Vision Studio...</div>;
  }

  return (
    <div
      className={`flex h-screen w-full overflow-hidden bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 font-sans transition-colors duration-300 ${
        isCinemaMode ? 'fullscreen-mode' : ''
      }`}
    >
      {/* Global Player Overlay */}
      {isPlayingMaster && <MasterPlayer story={activeStory} onClose={() => setIsPlayingMaster(false)} />}

      {/* 1. Left Sidebar */}
      {!isCinemaMode && !isPlayingMaster && (
        <Sidebar
          story={activeStory}
          selection={selection}
          theme={theme}
          toggleTheme={toggleTheme}
          onBackToLibrary={() => {
            setScreen('library');
            setIsCinemaMode(false);
            setIsPlayingMaster(false);
          }}
          onOpenAiSettings={() => setIsAiSettingsOpen(true)}
          onOpenDebug={() => setIsDebugOpen(true)}
          onOpenScript={() => setIsScriptEditorOpen(true)}
          onDeleteSequence={handleDeleteSequence}
          onDeleteLocation={handleDeleteLocation}
          onDeleteCharacter={handleDeleteCharacter}
          onSelect={handleSelect}
          onCreateLocation={handleCreateLocation}
          onCreateCharacter={handleCreateCharacter}
          onCreateSequence={handleCreateSequence}
        />
      )}

      {/* 2. Middle Stage (Main Content) */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex-1 overflow-hidden relative z-0">
          {selection.type === 'story' && (
            <ProjectDashboard
              story={activeStory}
              onSelect={handleSelect}
              imageSettings={aiSettings.image}
              onUpdateStory={updateActiveStory}
              onToast={addToast}
              onPlayCinema={() => {
                setIsPlayingMaster(true);
                addToast('Starting Master Screen...', 'success');
              }}
            />
          )}

          {selection.type === 'sequence' && activeItem && (
            <StageView
              sequence={activeItem as Sequence}
              allLocations={activeStory.locations}
              aspectRatio={activeStory.aspectRatio}
              isImmersive={isCinemaMode}
              onToggleImmersive={() => setIsCinemaMode(!isCinemaMode)}
              onSelectShot={(id) => setSelection({ type: 'shot', id, parentId: (activeItem as Sequence).id })}
              onAddShot={(opts) => handleAddShot((activeItem as Sequence).id, opts)}
              onDeleteShot={(id) => handleDeleteShot((activeItem as Sequence).id, id)}
              onMoveShot={(id, direction) => handleMoveShot((activeItem as Sequence).id, id, direction)}
              onUpdateShot={handleShotUpdate}
              onBackToSequence={() => setSelection({ type: 'story', id: activeStory.id })}
              onEditLocation={() => {}}
              onPlay={() => setIsPlayingMaster(true)}
            />
          )}

          {selection.type === 'shot' && activeItem && (
            <ShotEditor
              shot={activeItem as Shot}
              story={activeStory}
              aspectRatio={activeStory.aspectRatio}
              isImmersive={isCinemaMode}
              onToggleImmersive={() => setIsCinemaMode(!isCinemaMode)}
              onUpdateShot={handleShotUpdate}
              imageSettings={aiSettings.image}
              onStartProduction={() => {
                const seqId = selection.parentId || '';
                if (!seqId) return;
                setProductionTarget({ sequenceId: seqId, shotId: (activeItem as Shot).id });
              }}
              onBack={() =>
                setSelection({ type: 'sequence', id: selection.parentId || activeStory.sequences[0]?.id || activeStory.id })
              }
            />
          )}

          {selection.type === 'location' && activeItem && (
            <LocationEditor
              location={activeItem as Location}
              sequences={activeStory.sequences}
              onSave={handleUpdateLocation}
              onPropagate={() => addToast('Propagation coming soon', 'info')}
              onSelectShot={(shotId, seqId) => setSelection({ type: 'shot', id: shotId, parentId: seqId })}
              imageSettings={aiSettings.image}
              keyVisualUrl={activeStory.keyVisualUrl}
              styleGuide={activeStory.styleGuide}
              aspectRatio={activeStory.aspectRatio}
            />
          )}

          {selection.type === 'character' && activeItem && (
            <CharacterEditor
              character={activeItem as Character}
              sequences={activeStory.sequences}
              onSave={handleUpdateCharacter}
              onPropagate={() => addToast('Propagation coming soon', 'info')}
              onSelectShot={(shotId, seqId) => setSelection({ type: 'shot', id: shotId, parentId: seqId })}
              imageSettings={aiSettings.image}
              keyVisualUrl={activeStory.keyVisualUrl}
              styleGuide={activeStory.styleGuide}
            />
          )}
        </div>

        {/* Director Console Overlay */}
        {!isCinemaMode && !isPlayingMaster && (
          <div className="relative z-20">
            <DirectorConsole
              context={{
                type: consoleContextType,
                label: activeItem ? (activeItem as any).title || (activeItem as any).name || (activeItem as any).description : activeStory.title,
                id: selection.id,
              }}
              history={agentHistory}
              onSendMessage={handleDirectorMessage}
              isThinking={isDirectorThinking}
              stream={directorStream || undefined}
            />
          </div>
        )}

        {/* Floating Console for Cinema Mode */}
        {isCinemaMode && !isPlayingMaster && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">
            <DirectorConsole
              variant="floating"
              context={{ type: 'shot', label: 'Cinema Mode', id: 'cinema' }}
              history={agentHistory}
              onSendMessage={handleDirectorMessage}
              isThinking={isDirectorThinking}
              stream={directorStream || undefined}
            />
          </div>
        )}
      </div>

      {/* 3. Right Inspector (Contextual) - STRICTLY LIMITED TO SHOTS */}
      {!isCinemaMode && !isPlayingMaster && selection.type === 'shot' && (
        <InspectorPanel
          selection={selection}
          selectedItem={activeItem}
          type={selection.type}
          contextLocation={getContextLocation()}
          availableLocations={activeStory.locations}
          availableCharacters={activeStory.characters}
          keyVisualUrl={activeStory.keyVisualUrl}
          masterStyle={[
            activeStory.styleGuide ? String(activeStory.styleGuide) : '',
            activeStory.intent ? `Intent: ${activeStory.intent}` : '',
            activeStory.logline ? `Logline: ${activeStory.logline}` : '',
          ]
            .filter(Boolean)
            .join('\n')}
          onNavigate={handleSelect}
          onCastingUpdate={handleCastingUpdate}
          onCharacterPromptChange={handleCharacterPromptChange}
          onScriptUpdate={handleScriptUpdate}
          onSequenceUpdate={handleSequenceUpdate}
          onShotUpdate={handleShotUpdate}
        />
      )}

      {isAiSettingsOpen && (
        <AiSettingsModal
          settings={aiSettings}
          onSave={(next) => {
            setAiSettings(next);
            setIsAiSettingsOpen(false);
            addToast('AI settings saved', 'success');
          }}
          onClose={() => setIsAiSettingsOpen(false)}
        />
      )}

      {isScriptEditorOpen && (
        <ScriptEditorModal
          story={activeStory}
          onClose={() => setIsScriptEditorOpen(false)}
          onUpdateShot={handleShotUpdate}
        />
      )}

      {isDebugOpen && (
        <DebugPanel
          aiSettings={aiSettings}
          activeStory={activeStory}
          agentHistory={agentHistory}
          onClose={() => setIsDebugOpen(false)}
        />
      )}

      <ImageLightbox />

      {pendingDirectorMultiAgentFailure && pendingDirectorMultiAgentFailure.projectId === activeStory.id && !isPlayingMaster && (
        <div className="fixed inset-0 z-[4500] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
            <div className="h-14 px-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <div className="text-sm font-bold">Multi-agent failed</div>
              </div>
              <button
                onClick={() => {
                  setPendingDirectorMultiAgentFailure(null);
                  setPendingDirectorSingleFallbackArmed(false);
                }}
                className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                The Director multi-agent pipeline failed. Retry multi-agent, or explicitly opt into a single-call fallback.
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-700 dark:text-zinc-200">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Error</div>
                <div className="whitespace-pre-wrap break-words">{pendingDirectorMultiAgentFailure.error}</div>
              </div>

              {pendingDirectorMultiAgentFailure.details && (
                <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Trace</div>
                  </div>
                  <pre className="p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-200 max-h-56 overflow-y-auto custom-scrollbar">
                    {JSON.stringify(pendingDirectorMultiAgentFailure.details, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => retryDirectorAfterFailure(false)}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-black uppercase tracking-widest hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Retry Multi-agent
                </button>
                <button
                  onClick={() => {
                    if (!pendingDirectorSingleFallbackArmed) {
                      setPendingDirectorSingleFallbackArmed(true);
                      return;
                    }
                    retryDirectorAfterFailure(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest hover:opacity-90"
                >
                  {pendingDirectorSingleFallbackArmed ? 'Confirm Single-call' : 'Use Single-call'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDirectorFallback && pendingDirectorFallback.projectId === activeStory.id && !isPlayingMaster && (
        <div className="fixed inset-0 z-[4500] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
            <div className="h-14 px-5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <div className="text-sm font-bold">Fallback confirmation</div>
              </div>
              <button
                onClick={() => {
                  setPendingDirectorFallback(null);
                  setPendingDirectorFallbackArmed(false);
                }}
                className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                Director returned a <span className="font-bold">fallback</span> (rule-based) result. This is not guaranteed to match your intent.
                Confirm explicitly before applying.
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-700 dark:text-zinc-200">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Reply</div>
                <div className="whitespace-pre-wrap">{pendingDirectorFallback.res.reply}</div>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Actions ({pendingDirectorFallback.res.actions.length})
                  </div>
                </div>
                <pre className="p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap text-zinc-700 dark:text-zinc-200 max-h-56 overflow-y-auto custom-scrollbar">
                  {JSON.stringify(pendingDirectorFallback.res.actions, null, 2)}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => {
                    setPendingDirectorFallback(null);
                    setPendingDirectorFallbackArmed(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 text-[11px] font-black uppercase tracking-widest hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Discard
                </button>
                <button
                  onClick={() => {
                    if (!pendingDirectorFallbackArmed) {
                      setPendingDirectorFallbackArmed(true);
                      return;
                    }
                    applyDirectorActions(pendingDirectorFallback.projectId, activeStory, pendingDirectorFallback.res.actions);
                    setPendingDirectorFallback(null);
                    setPendingDirectorFallbackArmed(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 text-black text-[11px] font-black uppercase tracking-widest hover:opacity-90"
                >
                  {pendingDirectorFallbackArmed ? 'Confirm Apply' : 'Apply Fallback'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {productionTarget && (
        <StartProductionModal
          target={(() => {
            const seq = activeStory.sequences.find((s) => s.id === productionTarget.sequenceId);
            const shot = seq?.shots.find((s) => s.id === productionTarget.shotId);
            if (!shot) return { label: 'Shot' };
            const loc = activeStory.locations.find((l) => l.id === shot.locationId);
            return { label: `Shot #${shot.sequence}${loc?.name ? ` · ${loc.name}` : ''}`, detail: shot.description };
          })()}
          onConfirm={() => {
            startShotProduction(productionTarget.sequenceId, productionTarget.shotId);
            setProductionTarget(null);
          }}
          onClose={() => setProductionTarget(null)}
        />
      )}

      {/* Global Toast Notification */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="bg-zinc-900 text-white px-4 py-3 rounded-lg shadow-2xl border border-zinc-800 flex items-center gap-3 animate-in slide-in-from-right-10 fade-in duration-300"
          >
            {toast.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-500" />
            ) : (
              <Info className="w-4 h-4 text-blue-500" />
            )}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
