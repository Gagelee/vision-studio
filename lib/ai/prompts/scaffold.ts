import type { AspectRatio } from '../../../types';

export const buildScaffoldPrompt = (args: { intent: string; aspectRatio: AspectRatio | string }) => {
  const intent = String(args.intent || '').trim();
  const aspectRatio = String(args.aspectRatio || '16:9');

  return (
    `You are a multi-agent production team for a video project.\n` +
    `Internally coordinate as:\n` +
    `1) Director (overall vision + constraints)\n` +
    `2) Script Writer (screenplay-format beats + dialogue)\n` +
    `3) Casting Director (character breakdown + consistent looks)\n` +
    `4) Editor (narrative-part & shot breakdown)\n` +
    `5) Environment Director (locations/sets)\n` +
    `6) Camera & Art (camera/lighting + FINAL video generation prompt)\n` +
    `\n` +
    `Return ONLY a single valid JSON object (no markdown, no commentary).\n` +
    `Required top-level keys: "title","logline","styleGuide","locations","characters","sequences".\n` +
    `\n` +
    `Schema:\n` +
    `- styleGuide: string (DIRECTOR-created art core; assume user didn't specify style and you must decide it; include: rendering medium/style (e.g., ink wash / anime cel / watercolor / oil painting / documentary live-action), genre+tone, color palette, lighting mood, composition rules, camera language, negative constraints; 8-14 bullet-like sentences)\n` +
    `- locations: array of {name, description, visualStyle}\n` +
    `- characters: array of {name, description, looks:[{name, description}]}\n` +
    `- sequences: array of {title, context, sceneDecision, scenes:[...]} where each sequence is a narrative unit/story part (agent decides appropriate count)\n` +
    `- sceneDecision: { split: boolean, sceneCount: number, rationale: string, criteria?: string[] }\n` +
    `  - split: whether to split this story part into multiple scenes\n` +
    `  - sceneCount: how many scenes in this story part (use 1 if not splitting)\n` +
    `  - rationale: concise reason for split/not-split\n` +
    `  - criteria: optional keywords (e.g., "time jump", "location change", "beat boundary", "intercut")\n` +
    `- each scene: { title, summary?, shots:[...] }\n` +
    `- each shot: {\n` +
    `    description, timeOfDay, duration,\n` +
    `    locationName, castNames[],\n` +
    `    script,          // screenplay-style for this shot: action + dialogue lines\n` +
    `    camera, lighting, audio,\n` +
    `    videoPrompt,     // FULL prompt for video generation, consistent style, includes env/cast/action/camera/lighting\n` +
    `    keyframePlan?    // optional: { panelCount?: 4|9, panelGuidance?: string[] } for contact-sheet keyframe\n` +
    `  }\n` +
    `Rules:\n` +
    `- If intent explicitly specifies rendering medium/style, treat it as HARD CONSTRAINT and keep it verbatim.\n` +
    `- Never replace explicit user style with a conflicting medium.\n` +
    `- Translate abstract style asks into concrete generation terms (camera language, composition scale, lighting behavior, texture/material cues).\n` +
    `- Example mapping: cinematic -> filmic framing/contrast/depth; epic -> monumental scale/wide establishing/high-impact silhouettes.\n` +
    `- duration must be one of: 4, 6, 8 (seconds)\n` +
    `- Plan by runtime budget, not fixed counts: default target total runtime is ~60 seconds.\n` +
    `- If user explicitly requests a runtime/length, obey user requirement over default.\n` +
    `- Choose sequence/scene/shot counts that best fit the target runtime and story rhythm.\n` +
    `- IMPORTANT: sequence boundaries are narrative/dramatic boundaries (goal/turn/reveal), NOT a simple grouping by location/environment.\n` +
    `- A sequence can include multiple locations, and locations can intercut inside one sequence when story logic requires it.\n` +
    `- Scene split is OPTIONAL, but you MUST make a decision for each sequence via sceneDecision.\n` +
    `  - If split=false, you must still output exactly 1 scene, and sceneDecision.sceneCount must be 1.\n` +
    `  - If split=true, choose 2-5 scenes; ensure each scene has at least 1 shot.\n` +
    `- Keep JSON VALID. If too long, reduce counts/verbosity.\n` +
    `- If the Intent includes a "Reference Assignments" section, treat it as hard constraints and preserve those mappings through Director -> Casting/Environment decisions.\n` +
    `- For character-assigned references, ensure corresponding character entries/looks are created or updated to match those references.\n` +
    `- For location-assigned references, ensure corresponding location entries/style reflect those references.\n` +
    `- Location/environment assets are set-reference plates: avoid hero people in frame (background extras only when necessary).\n` +
    `- Maintain strong continuity: same character identity across looks; same environment logic across shots.\n` +
    `- LOOKS: Only create a character look when it is a meaningful visual state change (wardrobe/hair/makeup/accessories and/or facial/physical state). Do NOT create looks just because location/time changes.\n` +
    `- The "videoPrompt" MUST be production-ready and self-contained.\n` +
    `- For keyframe planning, choose panelCount by shot duration: 8s -> 9 panels (3x3), 4/6s -> 4 panels (2x2).\n` +
    `- If a shot has important micro-actions, add keyframePlan.panelGuidance with concise beat lines; if not, omit it.\n` +
    `- Do NOT default to glossy CG/3D-render language unless user explicitly asks for that medium.\n` +
    `\n` +
    `Intent: ${intent}\n` +
    `AspectRatio: ${aspectRatio}\n`
  );
};
