export type PromptDomain = 'scaffold' | 'direct' | 'asset';

export type PromptId =
  | 'scaffold.single'
  | 'director.actions'
  | 'team.scaffold.directorBrief'
  | 'team.scaffold.scriptWriter'
  | 'team.scaffold.castingDirector'
  | 'team.scaffold.environmentDirector'
  | 'team.scaffold.editor'
  | 'team.scaffold.cameraArt'
  | 'team.scaffold.directorMerge'
  | 'team.direct.planner'
  | 'team.direct.specialist'
  | 'team.direct.merge'
  | 'asset.masterkv'
  | 'asset.locationPreview'
  | 'asset.characterAvatar'
  | 'asset.characterLook'
  | 'asset.shotImage'
  | 'asset.image.generate';

export interface PromptMeta {
  id: PromptId;
  version: string;
  title: string;
  fileHint: string;
  usedByAgents: string[];
}

const v = (s: string) => s;

export const PROMPT_REGISTRY: PromptMeta[] = [
  {
    id: 'scaffold.single',
    version: v('2026-02-04.1'),
    title: 'Scaffold (single-call)',
    fileHint: 'lib/ai/prompts/scaffold.ts',
    usedByAgents: ['scaffold.single'],
  },
  {
    id: 'team.scaffold.directorBrief',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Director brief',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['director.brief'],
  },
  {
    id: 'team.scaffold.scriptWriter',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Script writer',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['script_writer'],
  },
  {
    id: 'team.scaffold.castingDirector',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Casting director',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['casting_director'],
  },
  {
    id: 'team.scaffold.environmentDirector',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Environment director',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['environment_director'],
  },
  {
    id: 'team.scaffold.editor',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Editor',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['editor'],
  },
  {
    id: 'team.scaffold.cameraArt',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Camera & art',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['camera_art'],
  },
  {
    id: 'team.scaffold.directorMerge',
    version: v('2026-02-04.1'),
    title: 'Team Scaffold: Director merge',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['director.merge'],
  },
  {
    id: 'director.actions',
    version: v('2026-02-04.1'),
    title: 'Director: Single-call action router',
    fileHint: 'lib/ai/prompts/director.ts',
    usedByAgents: ['director.actions'],
  },
  {
    id: 'team.direct.planner',
    version: v('2026-02-04.1'),
    title: 'Team Direct: Planner',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['director.plan'],
  },
  {
    id: 'team.direct.specialist',
    version: v('2026-02-04.1'),
    title: 'Team Direct: Specialist consult',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art'],
  },
  {
    id: 'team.direct.merge',
    version: v('2026-02-04.1'),
    title: 'Team Direct: Director merge actions',
    fileHint: 'lib/ai/prompts/team.ts',
    usedByAgents: ['director.merge'],
  },
  {
    id: 'asset.masterkv',
    version: v('2026-02-04.1'),
    title: 'Asset: Master KV prompt',
    fileHint: 'lib/ai/prompts/assetAuto.ts',
    usedByAgents: ['assetExecutor.masterkv'],
  },
  {
    id: 'asset.locationPreview',
    version: v('2026-02-04.1'),
    title: 'Asset: Location preview prompt',
    fileHint: 'lib/ai/prompts/assetAuto.ts',
    usedByAgents: ['assetExecutor.location'],
  },
  {
    id: 'asset.characterAvatar',
    version: v('2026-02-04.1'),
    title: 'Asset: Character avatar prompt',
    fileHint: 'lib/ai/prompts/assetAuto.ts',
    usedByAgents: ['assetExecutor.character'],
  },
  {
    id: 'asset.characterLook',
    version: v('2026-02-04.1'),
    title: 'Asset: Character look prompt',
    fileHint: 'lib/ai/prompts/assetAuto.ts',
    usedByAgents: ['assetExecutor.look'],
  },
  {
    id: 'asset.shotImage',
    version: v('2026-02-04.1'),
    title: 'Asset: Shot image prompt',
    fileHint: 'lib/ai/prompts/assetAuto.ts',
    usedByAgents: ['assetExecutor.shot'],
  },
  {
    id: 'asset.image.generate',
    version: v('2026-02-04.1'),
    title: 'Asset: Image generate endpoint',
    fileHint: 'vite.config.ts',
    usedByAgents: ['/api/asset/image/generate'],
  },
];

const byId: Record<PromptId, PromptMeta> = PROMPT_REGISTRY.reduce((acc, p) => {
  acc[p.id] = p;
  return acc;
}, {} as any);

export const getPromptMeta = (id: PromptId) => byId[id];

export const getPromptMetaForAgent = (domain: PromptDomain, agent: string): PromptMeta | null => {
  const a = String(agent || '').trim();
  if (!a) return null;

  if (domain === 'scaffold') {
    if (a === 'director.brief') return getPromptMeta('team.scaffold.directorBrief');
    if (a === 'script_writer') return getPromptMeta('team.scaffold.scriptWriter');
    if (a === 'casting_director') return getPromptMeta('team.scaffold.castingDirector');
    if (a === 'environment_director') return getPromptMeta('team.scaffold.environmentDirector');
    if (a === 'editor') return getPromptMeta('team.scaffold.editor');
    if (a === 'camera_art') return getPromptMeta('team.scaffold.cameraArt');
    if (a === 'director.merge') return getPromptMeta('team.scaffold.directorMerge');
    if (a === 'scaffold.single') return getPromptMeta('scaffold.single');
    return null;
  }

  if (domain === 'direct') {
    if (a === 'director.plan') return getPromptMeta('team.direct.planner');
    if (a === 'director.merge') return getPromptMeta('team.direct.merge');
    if (a === 'director.actions') return getPromptMeta('director.actions');
    if (['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art'].includes(a)) return getPromptMeta('team.direct.specialist');
    return null;
  }

  // asset
  if (domain === 'asset') {
    if (a === 'assetExecutor.masterkv') return getPromptMeta('asset.masterkv');
    if (a === 'assetExecutor.location') return getPromptMeta('asset.locationPreview');
    if (a === 'assetExecutor.character') return getPromptMeta('asset.characterAvatar');
    if (a === 'assetExecutor.look') return getPromptMeta('asset.characterLook');
    if (a === 'assetExecutor.shot') return getPromptMeta('asset.shotImage');
    if (a === '/api/asset/image/generate') return getPromptMeta('asset.image.generate');
    return null;
  }

  return null;
};

