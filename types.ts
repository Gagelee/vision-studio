
export enum ElementType {
  SCRIPT = 'SCRIPT',
  CASTING = 'CASTING',
  CAMERA = 'CAMERA',
  LIGHTING = 'LIGHTING',
  AUDIO = 'AUDIO'
}

export enum ShotType {
  WIDE = 'Wide Shot',
  MEDIUM = 'Medium Shot',
  CLOSE_UP = 'Close Up',
  EXTREME_CLOSE_UP = 'Extreme Close Up',
  POV = 'POV'
}

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type ModelProvider = 'gemini' | 'openai' | 'deepseek' | 'mock';

export interface ModelRuntimeSettings {
  provider: ModelProvider;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  baseUrl?: string;
  workflowMode?: 'auto' | 'interaction';
  // Opt-in for agents that can use structured tool/function calling (more reliable than raw JSON).
  useFunctionCalling?: boolean;
  // Opt-in for streaming director responses (SSE progress).
  useStreaming?: boolean;
  debug?: {
    enabled: boolean;
    logPrompts: boolean;
    logRawResponses: boolean;
  };
}

export interface AiSettings {
  version: 2;
  // One-sentence production: let planner use a "thinking" model, then worker uses a faster model.
  scaffoldPlanner: ModelRuntimeSettings;
  scaffoldWorker: ModelRuntimeSettings;
  // Follow-up directives from the Director Console.
  direct: ModelRuntimeSettings;
  // Asset generation (images, etc.)
  image: ModelRuntimeSettings;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  visualStyle: string;
  previewUrl: string;
  previewVersions?: AssetImageVersion[];
  activePreviewVersionId?: string;
  status: 'draft' | 'locked';
  assetState?: AssetGenerationState;
  referenceImages?: ReferenceImage[];
  referenceMode?: 'auto' | 'off';
}

export interface AssetImageVersion {
  id: string;
  imageUrl: string;
  createdAt: number;
  type: string;
  metadata?: Record<string, any>;
}

export interface CharacterLook {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  previewVersions?: AssetImageVersion[];
  activePreviewVersionId?: string;
  assetState?: AssetGenerationState;
}

export interface ReferenceImage {
  id: string;
  url: string;
  name?: string;
  createdAt?: number;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  voiceProfile?: string;
  avatarUrl?: string;
  avatarVersions?: AssetImageVersion[];
  activeAvatarVersionId?: string;
  status?: 'draft' | 'locked';
  looks: CharacterLook[];
  assetState?: AssetGenerationState;
  referenceImages?: ReferenceImage[];
  referenceMode?: 'auto' | 'off';
}

export interface AssetGenerationState {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error' | 'blocked';
  lastError?: string;
  lastAttemptAt?: number;
  attempts?: number;
}

export interface DirectorElement {
  type: ElementType;
  prompt: string;
  status: 'locked' | 'auto' | 'manual';
  metadata?: any;
}

export interface ShotVersion {
  id: string;
  imageUrl: string;
  createdAt: number;
  type: string;
  metadata?: {
    prompt?: string;
    references?: Array<{ url: string; label?: string }>;
    settings?: {
      provider?: string;
      model?: string;
      temperature?: number;
    };
    aspectRatio?: string;
  };
}

export interface ShotProductionVariant {
  id: string;
  videoUrl: string;
  createdAt: number;
  durationSeconds?: 4 | 6 | 8;
  resolution?: '720p';
  operationName?: string;
  metadata?: {
    prompt?: string;
    sourceImageUrl?: string;
    sourceShotVersionId?: string;
  };
}

export interface DialogueLine {
  id: string;
  characterId: string;
  text: string;
}

export interface Shot {
  id: string;
  sequence: number;
  locationId: string;
  timeOfDay: string;
  description: string;
  duration: number;
  thumbnailUrl: string;
  activeVersionId: string;
  versions: ShotVersion[];
  elements: { [key in ElementType]: DirectorElement };
  // Optional storyboard-contact-sheet planning hints for keyframe generation.
  keyframePlan?: {
    panelCount?: 4 | 9;
    panelGuidance?: string[];
  };
  aiState?: 'idle' | 'thinking' | 'rendering';
  aiPrompt?: string;
  assetState?: AssetGenerationState;
  production?: {
    status: 'idle' | 'queued' | 'running' | 'done' | 'error';
    lastStartedAt?: number;
    lastCompletedAt?: number;
    lastError?: string;
    operationName?: string;
    durationSeconds?: 4 | 6 | 8;
    resolution?: '720p';
    videoUrl?: string;
    variants?: ShotProductionVariant[];
    activeVariantId?: string;
  };
}

export interface Scene {
  id: string;
  title: string;
  summary?: string;
  // Ordered shot list inside this scene.
  shots: Shot[];
}

export interface Sequence {
  id: string;
  // Narrative unit (story part), not an environment bucket.
  // A sequence may contain multiple locations, and locations may intercut within it.
  title: string;
  context: string;
  // Primary future structure.
  scenes: Scene[];
  // Flattened cache used by current UI modules; derived from scenes.
  shots: Shot[];
}

export interface Story {
  id: string;
  title: string;
  logline: string;
  // Textual style bible used to guide all asset generation (preferred over using KV image as a reference).
  styleGuide?: string;
  intent?: string;
  keyVisualUrl?: string;
  keyVisualVersions?: AssetImageVersion[];
  activeKeyVisualVersionId?: string;
  masterKvState?: AssetGenerationState;
  referenceImages?: ReferenceImage[];
  referenceMode?: 'auto' | 'off';
  proposedStyleGuide?: string;
  proposedStyleGuideUpdatedAt?: number;
  proposedStyleGuideSourceKvVersionId?: string;
  assetsSyncedKvVersionId?: string;
  aspectRatio: AspectRatio;
  status: 'scaffolding' | 'ready';
  createdAt?: number;
  updatedAt?: number;
  lastOpenedAt?: number;
  production?: {
    video?: {
      status: 'idle' | 'queued' | 'running' | 'done' | 'error';
      lastStartedAt?: number;
    };
  };
  locations: Location[];
  characters: Character[];
  sequences: Sequence[];
}

export interface WorkspaceState {
  version: 1;
  projects: Story[];
  activeProjectId?: string;
}

export interface SelectionState {
  type: 'story' | 'location' | 'character' | 'sequence' | 'shot' | 'creation';
  id: string;
  parentId?: string;
}

export type AgentActionType =
  | 'NOOP'
  | 'SCAFFOLD_PROJECT'
  | 'NAVIGATE'
  | 'UPDATE_STORY'
  | 'CREATE_LOCATION'
  | 'DELETE_LOCATION'
  | 'UPDATE_LOCATION'
  | 'CREATE_CHARACTER'
  | 'DELETE_CHARACTER'
  | 'UPDATE_CHARACTER'
  | 'CREATE_CHARACTER_LOOK'
  | 'UPDATE_CHARACTER_LOOK'
  | 'CREATE_SEQUENCE'
  | 'RENAME_SEQUENCE'
  | 'DELETE_SEQUENCE'
  | 'CREATE_SCENE'
  | 'RENAME_SCENE'
  | 'UPDATE_SCENE'
  | 'DELETE_SCENE'
  | 'CREATE_SHOT'
  | 'DELETE_SHOT'
  | 'MOVE_SHOT'
  | 'MOVE_SHOT_TO_SCENE'
  | 'UPDATE_SHOT'
  | 'UPDATE_ELEMENT'
  | 'SET_CAST'
  | 'GENERATE_PROJECT_ASSETS'
  | 'GENERATE_SHOT_IMAGE'
  | 'GENERATE_LOCATION_PREVIEW'
  | 'GENERATE_CHARACTER_AVATAR'
  | 'GENERATE_CHARACTER_LOOK'
  | 'GENERATE_MASTER_KV_PROPOSAL'
  | 'ACCEPT_KV_PROPOSAL'
  | 'DISCARD_KV_PROPOSAL';

export interface AgentAction {
  type: AgentActionType;
  payload?: any;
}

export interface AgentPlanStep {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

export interface AgentPlan {
  id: string;
  summary: string;
  steps: AgentPlanStep[];
  actions?: AgentAction[];
}

export interface AgentLogEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  actionDetails?: {
    type: string;
    actions?: AgentAction[];
    planId?: string;
    applied?: number;
    dropped?: number;
    droppedActions?: AgentAction[];
  };
  debug?: any;
}
