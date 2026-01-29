
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

export interface Location {
  id: string;
  name: string;
  description: string;
  visualStyle: string;
  previewUrl: string;
  status: 'draft' | 'locked';
}

export interface CharacterLook {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  voiceProfile?: string;
  avatarUrl?: string;
  status?: 'draft' | 'locked';
  looks: CharacterLook[];
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
  aiState?: 'idle' | 'thinking' | 'rendering';
  aiPrompt?: string;
}

export interface Sequence {
  id: string;
  title: string;
  context: string;
  shots: Shot[];
}

export interface Story {
  id: string;
  title: string;
  logline: string;
  intent?: string;
  keyVisualUrl?: string; 
  aspectRatio: AspectRatio;
  status: 'scaffolding' | 'ready';
  locations: Location[];
  characters: Character[];
  sequences: Sequence[];
}

export interface SelectionState {
  type: 'story' | 'location' | 'character' | 'sequence' | 'shot' | 'creation';
  id: string;
  parentId?: string;
}

export interface AgentLogEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  actionDetails?: {
    type: string;
  };
}
