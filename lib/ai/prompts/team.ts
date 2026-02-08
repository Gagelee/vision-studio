import type { AspectRatio } from '../../../types';

type TeamAgent =
  | 'director'
  | 'script_writer'
  | 'casting_director'
  | 'editor'
  | 'environment_director'
  | 'camera_art';

const jsonOnly = () =>
  `Return ONLY a single valid JSON object (no markdown, no commentary). Keep JSON VALID.`;

export const buildTeamScaffoldDirectorBriefPrompt = (args: { intent: string; aspectRatio: AspectRatio | string }) => {
  const intent = String(args.intent || '').trim();
  const aspectRatio = String(args.aspectRatio || '16:9');
  return (
    `You are the DIRECTOR agent for a story-to-storyboard production system.\n` +
    `${jsonOnly()}\n` +
    `Output schema:\n` +
    `{\n` +
    `  "title": string,\n` +
    `  "logline": string,\n` +
    `  "styleBible": {\n` +
    `     "genre": string,\n` +
    `     "tone": string,\n` +
    `     "visualKeywords": string[],\n` +
    `     "cameraLanguage": string,\n` +
    `     "constraints": string[]\n` +
    `  },\n` +
    `  "characters": Array<{ "name": string, "role": string, "oneLine": string }>,\n` +
    `  "locations": Array<{ "name": string, "purpose": string }>,\n` +
    `  "sequenceOutline": Array<{ "title": string, "goal": string }>\n` +
    `}\n` +
    `Rules:\n` +
    `- Keep it compact but concrete. Prefer 3-6 characters, 2-5 locations, 2-4 sequences.\n` +
    `- Characters MUST be distinct and reusable across shots.\n` +
    `- If user intent explicitly specifies rendering medium/style, treat it as a HARD CONSTRAINT and repeat it verbatim in styleBible.\n` +
    `- Never replace an explicit user medium with a different one (e.g., realistic film -> oil painting).\n` +
    `- Infer abstract style goals into concrete prompt vocabulary. Example: cinematic -> filmic framing/contrast/depth; epic -> monumental scale/wide establishing/strong silhouettes.\n` +
    `- Encode that translation in styleBible.visualKeywords + styleBible.cameraLanguage so downstream agents can execute it.\n` +
    `- If user didn't specify art style, YOU must decide a clear artistic core.\n` +
    `- styleBible.visualKeywords MUST include rendering style/medium (e.g., ink wash, anime cel, watercolor, oil painting, live-action), palette and texture cues.\n` +
    `- Do not default to glossy CG/3D-render wording unless the user explicitly requests that medium.\n` +
    `Intent: ${intent}\n` +
    `AspectRatio: ${aspectRatio}\n`
  );
};

export const buildTeamScaffoldScriptWriterPrompt = (args: {
  directorBriefJson: string;
  targetShotsPerSequence?: number;
}) => {
  const brief = String(args.directorBriefJson || '{}');
  const n = Math.max(2, Math.min(6, Number(args.targetShotsPerSequence ?? 3)));
  return (
    `You are the SCRIPT WRITER agent.\n` +
    `${jsonOnly()}\n` +
    `Write screenplay-like content (action lines + dialogue lines) for each shot.\n` +
    `Output schema:\n` +
    `{\n` +
    `  "sequences": Array<{\n` +
    `    "title": string,\n` +
    `    "shots": Array<{\n` +
    `      "beat": string,\n` +
    `      "script": string,\n` +
    `      "castNames": string[]\n` +
    `    }>\n` +
    `  }>\n` +
    `}\n` +
    `Rules:\n` +
    `- 2-4 sequences; each sequence around ${n} shots.\n` +
    `- "script" must be in screenplay style (short action + optional dialogue lines with CHARACTER:).\n` +
    `- Use ONLY character names from director brief.\n` +
    `DirectorBrief: ${brief}\n`
  );
};

export const buildTeamScaffoldCastingDirectorPrompt = (args: { directorBriefJson: string }) => {
  const brief = String(args.directorBriefJson || '{}');
  return (
    `You are the CASTING DIRECTOR agent.\n` +
    `${jsonOnly()}\n` +
    `Output schema:\n` +
    `{\n` +
    `  "characters": Array<{\n` +
    `     "name": string,\n` +
    `     "description": string,\n` +
    `     "identityAnchors": string[],\n` +
    `     "looks": Array<{ "name": string, "description": string }>\n` +
    `  }>\n` +
    `}\n` +
    `Rules:\n` +
    `- Keep identity anchors stable across looks (face, hair, body type, signature details).\n` +
    `- Only create a LOOK when it represents a meaningful visual state change: different wardrobe/hair/makeup/accessories and/or facial/physical state (injured, tired, beard, wet hair, etc.).\n` +
    `- Do NOT create looks just because the scene/location/time changes.\n` +
    `- Produce 1-3 looks per character when appropriate; fewer is better than redundant looks.\n` +
    `- Look descriptions must be reference-ready (wardrobe + hair + makeup + notable state), not scene staging or atmosphere.\n` +
    `- Ensure all character descriptions are compatible with director style bible (rendering style, tone).\n` +
    `DirectorBrief: ${brief}\n`
  );
};

export const buildTeamScaffoldEnvironmentDirectorPrompt = (args: { directorBriefJson: string }) => {
  const brief = String(args.directorBriefJson || '{}');
  return (
    `You are the ENVIRONMENT DIRECTOR agent.\n` +
    `${jsonOnly()}\n` +
    `Output schema:\n` +
    `{\n` +
    `  "locations": Array<{ "name": string, "description": string, "visualStyle": string }>\n` +
    `}\n` +
    `Rules:\n` +
    `- Each location description should be filmable, concrete, and consistent with the style bible.\n` +
    `- Only include locations mentioned by director (you may rename slightly for clarity).\n` +
    `DirectorBrief: ${brief}\n`
  );
};

export const buildTeamScaffoldEditorPrompt = (args: {
  directorBriefJson: string;
  scriptJson: string;
  environmentJson: string;
}) => {
  const brief = String(args.directorBriefJson || '{}');
  const script = String(args.scriptJson || '{}');
  const env = String(args.environmentJson || '{}');
  return (
    `You are the EDITOR agent.\n` +
    `${jsonOnly()}\n` +
    `Turn the script beats into sequences + shots suitable for storyboard generation.\n` +
    `Output schema:\n` +
    `{\n` +
    `  "sequences": Array<{\n` +
    `    "title": string,\n` +
    `    "context": string,\n` +
    `    "shots": Array<{\n` +
    `      "description": string,\n` +
    `      "timeOfDay": string,\n` +
    `      "duration": number,\n` +
    `      "locationName": string,\n` +
    `      "castNames": string[],\n` +
    `      "script": string\n` +
    `    }>\n` +
    `  }>\n` +
    `}\n` +
    `Rules:\n` +
    `- Keep continuity strong. Keep shot descriptions visual.\n` +
    `- Use location names that exist in environment list.\n` +
    `- Shot duration must be one of: 4, 6, 8 seconds.\n` +
    `DirectorBrief: ${brief}\n` +
    `Script: ${script}\n` +
    `Environments: ${env}\n`
  );
};

export const buildTeamScaffoldCameraArtPrompt = (args: {
  directorBriefJson: string;
  editorJson: string;
  aspectRatio: AspectRatio | string;
}) => {
  const brief = String(args.directorBriefJson || '{}');
  const edit = String(args.editorJson || '{}');
  const aspectRatio = String(args.aspectRatio || '16:9');
  return (
    `You are the CAMERA & ART DESIGN agent.\n` +
    `${jsonOnly()}\n` +
    `For each shot, propose camera, lighting, audio AND a production-ready "videoPrompt".\n` +
    `Output schema:\n` +
    `{\n` +
    `  "sequences": Array<{\n` +
    `    "title": string,\n` +
    `    "shots": Array<{\n` +
    `      "camera": string,\n` +
    `      "lighting": string,\n` +
    `      "audio": string,\n` +
    `      "videoPrompt": string\n` +
    `    }>\n` +
    `  }>\n` +
    `}\n` +
    `Rules:\n` +
    `- "videoPrompt" must be self-contained and consistent with director style bible.\n` +
    `- Treat DirectorBrief style medium as HARD LOCK; do not swap to another medium.\n` +
    `- Translate abstract user adjectives into executable visual terms (camera language, composition scale, lighting behavior, motion quality).\n` +
    `- Include environment + cast + action + lens/camera + lighting cues.\n` +
    `- Start each "videoPrompt" with a short STYLE header derived from director style bible (rendering style/medium, palette, lighting mood, camera language).\n` +
    `- No text/watermarks.\n` +
    `AspectRatio: ${aspectRatio}\n` +
    `DirectorBrief: ${brief}\n` +
    `Editor: ${edit}\n`
  );
};

export const buildTeamScaffoldDirectorMergePrompt = (args: {
  directorBriefJson: string;
  castingJson: string;
  environmentJson: string;
  editorJson: string;
  cameraArtJson: string;
}) => {
  const brief = String(args.directorBriefJson || '{}');
  const casting = String(args.castingJson || '{}');
  const env = String(args.environmentJson || '{}');
  const edit = String(args.editorJson || '{}');
  const cam = String(args.cameraArtJson || '{}');

  return (
    `You are the DIRECTOR agent. Merge specialist outputs into the final scaffold spec.\n` +
    `${jsonOnly()}\n` +
    `Return final schema with EXACT keys:\n` +
    `{\n` +
    `  "title": string,\n` +
    `  "logline": string,\n` +
    `  "styleGuide": string,\n` +
    `  "locations": Array<{ "name": string, "description": string, "visualStyle": string }>,\n` +
    `  "characters": Array<{ "name": string, "description": string, "looks": Array<{ "name": string, "description": string }> }>,\n` +
    `  "sequences": Array<{ "title": string, "context": string, "shots": Array<{\n` +
    `     "description": string, "timeOfDay": string, "duration": number,\n` +
    `     "camera": string, "lighting": string, "audio": string,\n` +
    `     "locationName": string, "castNames": string[],\n` +
    `     "script": string,\n` +
    `     "videoPrompt": string\n` +
    `  }> }>\n` +
    `}\n` +
    `Rules:\n` +
    `- Ensure sequences/shots align across editor + camera&art (same counts and order).\n` +
    `- Ensure characters/locations match names used in shots.\n` +
    `- Keep rendering medium/style consistent with DirectorBrief. If user intent specified medium explicitly, preserve it as hard lock.\n` +
    `- Ensure final styleGuide and shot-level camera/lighting/videoPrompt contain concrete, generation-ready style terms (not only abstract adjectives).\n` +
    `- "styleGuide" must be a concise, production-ready style bible derived from DirectorBrief.styleBible (rendering style, palette, lighting, camera language, constraints).\n` +
    `DirectorBrief: ${brief}\n` +
    `Casting: ${casting}\n` +
    `Environments: ${env}\n` +
    `Editor: ${edit}\n` +
    `CameraArt: ${cam}\n`
  );
};

export const buildTeamDirectPlannerPrompt = (args: { selectionJson: string; storyJson: string; directive: string }) => {
  const selectionJson = String(args.selectionJson || '{}');
  const storyJson = String(args.storyJson || '{}');
  const directive = String(args.directive || '').trim();
  return (
    `You are the DIRECTOR planner.\n` +
    `${jsonOnly()}\n` +
    `Return JSON: {"reply": string, "requestedAgents": TeamAgent[], "focus": { [key in TeamAgent]?: string }}.\n` +
    `Rules:\n` +
    `- requestedAgents is subset of ["script_writer","casting_director","editor","environment_director","camera_art"].\n` +
    `- Simple directives can use [].\n` +
    `- screenplay/dialogue -> script_writer; shot/sequence continuity -> editor; character/look -> casting_director; location/world -> environment_director; camera/light/audio/videoPrompt -> camera_art.\n` +
    `Selection: ${selectionJson}\n` +
    `Story: ${storyJson}\n` +
    `Directive: ${directive}\n`
  );
};

export const buildTeamDirectSpecialistPrompt = (args: {
  agent: Exclude<TeamAgent, 'director'>;
  focus: string;
  selectionJson: string;
  storyJson: string;
  directive: string;
}) => {
  const agent = String(args.agent);
  const focus = String(args.focus || '').trim();
  const selectionJson = String(args.selectionJson || '{}');
  const storyJson = String(args.storyJson || '{}');
  const directive = String(args.directive || '').trim();
  const roleLine: Record<string, string> = {
    script_writer: 'You are the SCRIPT WRITER agent.',
    casting_director: 'You are the CASTING DIRECTOR agent.',
    editor: 'You are the EDITOR agent.',
    environment_director: 'You are the ENVIRONMENT DIRECTOR agent.',
    camera_art: 'You are the CAMERA & ART DESIGN agent.',
  };
  const roleRule: Record<string, string> = {
    script_writer: 'Prioritize script/dialogue and beat edits.',
    casting_director: 'Prioritize character identity/look consistency.',
    editor: 'Prioritize sequence/shot structure and continuity.',
    environment_director: 'Prioritize location/set updates.',
    camera_art: 'For video prompt updates, use UPDATE_ELEMENT with elementType="CAMERA" and payload.metadata.videoPrompt.',
  };

  return (
    `${roleLine[agent] || 'You are a specialist agent.'}\n` +
    `${jsonOnly()}\n` +
    `Return JSON: {"notes": string, "suggestedActions": Array<{ "type": string, "payload": any }> }.\n` +
    `Rules:\n` +
    `- Only allowed app action types.\n` +
    `- Be conservative: 0-4 actions.\n` +
    `${roleRule[agent] || ''}\n` +
    `Focus: ${focus}\n` +
    `Selection: ${selectionJson}\n` +
    `Story: ${storyJson}\n` +
    `Directive: ${directive}\n`
  );
};

export const buildTeamDirectMergePrompt = (args: {
  selectionJson: string;
  storyJson: string;
  directive: string;
  plannerJson: string;
  specialistJsonByAgent: Record<string, string>;
  allowedActionsText: string;
}) => {
  const selectionJson = String(args.selectionJson || '{}');
  const storyJson = String(args.storyJson || '{}');
  const directive = String(args.directive || '').trim();
  const planner = String(args.plannerJson || '{}');
  const specialists = Object.entries(args.specialistJsonByAgent || {})
    .map(([k, v]) => `- ${k}: ${String(v || '{}')}`)
    .join('\n');
  const allowed = String(args.allowedActionsText || '').trim();

  return (
    `You are the DIRECTOR-IN-CHIEF. Produce the final user reply and final structured actions.\n` +
    `${jsonOnly()}\n` +
    `Allowed action types (exact type string): ${allowed}\n` +
    `Return JSON: {"reply": string, "actions": Array<{ "type": string, "payload"?: any }> }.\n` +
    `Rules:\n` +
    `- Use IDs that exist in the Story JSON.\n` +
    `- Keep actions 0-6.\n` +
    `- Do NOT output unknown payload fields.\n` +
    `- For CREATE_SHOT include sequenceId and concrete visual fields (description/location/time/camera/lighting/script/videoPrompt/cast when relevant).\n` +
    `- If the user asks to generate storyboard images / 出图 / 渲染, and you create or update shots, include GENERATE_PROJECT_ASSETS with payload.scope=\"shots\" (so newly-created shot IDs don't matter).\n` +
    `Selection: ${selectionJson}\n` +
    `Story: ${storyJson}\n` +
    `Directive: ${directive}\n` +
    `Planner: ${planner}\n` +
    `Specialists:\n${specialists}\n`
  );
};
