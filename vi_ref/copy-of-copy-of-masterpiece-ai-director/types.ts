
export type ViewState = 'landing' | 'director_setup' | 'studio';

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type AssetState = {
  status: 'idle' | 'queued' | 'running' | 'done' | 'error';
  lastError?: string;
};

export interface Attachment {
  id: string;
  url: string;
  type: string;
  data?: string; // Base64
}

export interface Message {
  role: 'user' | 'model' | 'system';
  text: string;
  attachments?: Attachment[];
  timestamp: number;
}

// --- Core Models ---

export interface Shot {
  id: string;
  sequenceId: string;
  sequenceIndex: number;
  description: string;
  thumbnailUrl?: string; // The active visual
  duration: number;
  cameraMovement?: string;
  voiceover?: string;
  assetState: AssetState;
}

export interface Sequence {
  id: string;
  title: string;
  context: string; // Narrative goal
  shots: Shot[];
}

export interface Character {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  previewUrl?: string;
}

export interface Story {
  id: string;
  title: string;
  logline: string;
  intent: string;
  styleGuide: string; // Visual description
  aspectRatio: AspectRatio;
  sequences: Sequence[];
  characters: Character[];
  locations: Location[];
  createdAt: number;
}
