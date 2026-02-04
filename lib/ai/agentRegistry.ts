import type { PromptId } from './promptMeta';

export type AgentId =
  | 'director'
  | 'script_writer'
  | 'casting_director'
  | 'editor'
  | 'environment_director'
  | 'camera_art'
  | 'asset_executor';

export interface AgentSpec {
  id: AgentId;
  title: string;
  description: string;
  promptIds: PromptId[];
}

export const AGENT_REGISTRY: AgentSpec[] = [
  {
    id: 'director',
    title: 'Director',
    description: 'Top-level router/decision-maker; plans, consults specialists, and merges actions.',
    promptIds: ['director.actions', 'team.direct.planner', 'team.direct.merge', 'team.scaffold.directorBrief', 'team.scaffold.directorMerge'],
  },
  {
    id: 'script_writer',
    title: 'Script Writer',
    description: 'Writes screenplay-style beats + dialogue for shots.',
    promptIds: ['team.scaffold.scriptWriter', 'team.direct.specialist'],
  },
  {
    id: 'casting_director',
    title: 'Casting Director',
    description: 'Defines character identity anchors and look variations.',
    promptIds: ['team.scaffold.castingDirector', 'team.direct.specialist'],
  },
  {
    id: 'editor',
    title: 'Editor',
    description: 'Breaks script into sequences/shots; maintains continuity.',
    promptIds: ['team.scaffold.editor', 'team.direct.specialist'],
  },
  {
    id: 'environment_director',
    title: 'Environment Director',
    description: 'Designs filmable locations/sets aligned with style bible.',
    promptIds: ['team.scaffold.environmentDirector', 'team.direct.specialist'],
  },
  {
    id: 'camera_art',
    title: 'Camera & Art',
    description: 'Produces camera/lighting/audio settings and production-ready video prompts.',
    promptIds: ['team.scaffold.cameraArt', 'team.direct.specialist'],
  },
  {
    id: 'asset_executor',
    title: 'Asset Executor',
    description: 'Generates Master KV, environments, casting, looks, and storyboard keyframes in a strict dependency order.',
    promptIds: ['asset.masterkv', 'asset.locationPreview', 'asset.characterAvatar', 'asset.characterLook', 'asset.shotImage', 'asset.image.generate'],
  },
];

