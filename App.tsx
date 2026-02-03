
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Info } from 'lucide-react';
import { Sidebar } from './components/Layout/Sidebar';
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
import { createDemoProject, loadWorkspace, saveWorkspace } from './lib/workspaceStorage';
import { loadAiSettings, saveAiSettings } from './lib/ai/aiSettingsStorage';
import { runDirectorCommand } from './lib/ai/agent/direct';
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
    id: `shot-${now}`,
    sequence: shotNumber,
    locationId: init?.locationId || fallbackLocationId,
    timeOfDay: init?.timeOfDay || 'Day',
    description: init?.description || 'New shot',
    duration: typeof init?.duration === 'number' && Number.isFinite(init.duration) ? Math.max(1, Math.round(init.duration)) : 4,
    thumbnailUrl: thumb,
    activeVersionId: 'v1',
    versions: [{ id: 'v1', imageUrl: thumb, createdAt: now, type: 'base' }],
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
            previewUrl: c.avatarUrl || '',
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

  const handleCreationComplete = (project: Story, plan: AgentPlan, debug?: any) => {
    setWorkspace((prev) => ({ ...prev, projects: [project, ...prev.projects], activeProjectId: project.id }));
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

  const handleDeleteLocation = (id: string) => {
    updateActiveStory((prev) => ({ ...prev, locations: prev.locations.filter((l) => l.id !== id) }));
    if (activeStory) setSelection({ type: 'story', id: activeStory.id });
    addToast('Environment removed', 'info');
  };

  const handleDeleteCharacter = (id: string) => {
    updateActiveStory((prev) => ({ ...prev, characters: prev.characters.filter((c) => c.id !== id) }));
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

  // ----- Director Console -----

	  const handleDirectorMessage = async (msg: string) => {
	    if (!activeStory || !workspace.activeProjectId) return;
      const projectId = workspace.activeProjectId;

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

	    const res = await runDirectorCommand({
	      message: msg,
	      selection,
	      story: activeStory,
	      settings: aiSettings.direct,
	    });

    const agentEntry: AgentLogEntry = {
      id: `a-${Date.now()}`,
      role: 'agent',
      content: res.reply,
      timestamp: Date.now(),
      actionDetails: { type: 'DIRECTOR_COMMAND', actions: res.actions, planId: res.plan.id },
      debug: res.debug,
    };

	    setAgentHistoryByProject((prev) => ({
	      ...prev,
	      [projectId]: [...(prev[projectId] || []), agentEntry],
	    }));

	    if (res.debug?.error && aiSettings.direct.provider !== 'mock') {
	      addToast('Director command fell back to rule-based output. Open Debug (Ctrl/Cmd+Shift+D) for details.', 'info');
		    }
	
		    if (res.actions.length > 0) {
		      const navigateActions = res.actions.filter((a) => a.type === 'NAVIGATE');
		      const mutationActions = res.actions.filter((a) => !a.type.startsWith('GENERATE_') && a.type !== 'NAVIGATE');
		      const generateActions = res.actions.filter((a) => a.type.startsWith('GENERATE_'));
	
		      if (mutationActions.length) {
		        updateStoryById(projectId, (prev) => applyActionsToStory(prev, mutationActions));
		        addToast('Director AI applied edits', 'success');
		      }
	
		      if (navigateActions.length) {
		        const last = navigateActions[navigateActions.length - 1];
		        const nextSel = last?.payload as SelectionState | undefined;
		        if (nextSel?.type && nextSel?.id) setSelection(nextSel);
		      }
	
		      if (generateActions.length) {
		        const storyAfterUpdates = mutationActions.length ? applyActionsToStory(activeStory, mutationActions) : activeStory;
	
		        const deduped = new Map<string, AssetJob>();
		        const addJob = (key: string, job: AssetJob) => {
		          if (!deduped.has(key)) deduped.set(key, job);
	        };

	        let concurrency = 2;
	        let scopeLabel = 'director';

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
	            if (ch && lk) addJob(`look:${characterId}:${lookId}`, { kind: 'look', characterId, lookId, prompt: buildCharacterLookPrompt(ch, lk) });
	            continue;
	          }
	        }

	        const jobs = Array.from(deduped.values());
	        if (jobs.length && aiSettings.image.provider !== 'mock') {
	          addToast(`Queued asset generation (${jobs.length})…`, 'info');
	          addDebugEvent({ level: 'info', scope: 'asset.exec', message: 'Queue asset generation', data: { projectId, scope: scopeLabel, jobs: jobs.length, concurrency } });
	          setTimeout(() => {
              let storyRef = storyAfterUpdates;
	            executeAssetJobs({
	              jobs,
	              settings: aiSettings.image,
	              aspectRatio: storyAfterUpdates.aspectRatio,
	              concurrency,
	                getStoryForRefs: () => storyRef,
                maxAttempts: 3,
                stopAfterMasterKvFailure: true,
	              onEvent: (ev) => {
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
	                }
	                if (ev.type === 'blocked') {
                    storyRef = applyAssetBlocked(storyRef, ev.job, ev.reason);
                    updateStoryById(projectId, (prev) => applyAssetBlocked(prev, ev.job, ev.reason));
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
	                    data: { done: ev.done, total: ev.total, job: ev.job, error: ev.error, attempt: (ev as any).attempt, attempts: (ev as any).attempts },
	                  });
	                }
	                if (ev.done === ev.total) addToast('Assets generated (director).', 'success');
	              },
	            }).catch(() => {
	              addToast('Asset generation had errors. Check Debug.', 'info');
	            });
	          }, 0);
	        } else if (jobs.length) {
	          addToast('Asset generation requested, but Image Provider is Mock.', 'info');
	        }
	      }
	    } else {
	      addToast('No changes applied', 'info');
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

      {isDebugOpen && (
        <DebugPanel
          aiSettings={aiSettings}
          activeStory={activeStory}
          agentHistory={agentHistory}
          onClose={() => setIsDebugOpen(false)}
        />
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
