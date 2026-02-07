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
    `4) Editor (sequence & shot breakdown)\n` +
    `5) Environment Director (locations/sets)\n` +
    `6) Camera & Art (camera/lighting + FINAL video generation prompt)\n` +
    `\n` +
    `Return ONLY a single valid JSON object (no markdown, no commentary).\n` +
    `Required top-level keys: "title","logline","styleGuide","locations","characters","sequences".\n` +
    `\n` +
    `Schema:\n` +
    `- styleGuide: string (DIRECTOR-created art core; assume user didn't specify style and you must decide it; include: rendering medium/style (e.g., live-action photoreal / anime / ink wash / oil painting), genre+tone, color palette, lighting mood, composition rules, camera language, negative constraints; 8-14 bullet-like sentences)\n` +
    `- locations: array of {name, description, visualStyle}\n` +
    `- characters: array of {name, description, looks:[{name, description}]}\n` +
    `- sequences: array of {title, context, shots:[...]} (agent decides appropriate count)\n` +
    `- each shot: {\n` +
    `    description, timeOfDay, duration,\n` +
    `    locationName, castNames[],\n` +
    `    script,          // screenplay-style for this shot: action + dialogue lines\n` +
    `    camera, lighting, audio,\n` +
    `    videoPrompt      // FULL prompt for video generation, consistent style, includes env/cast/action/camera/lighting\n` +
    `  }\n` +
    `Rules:\n` +
    `- duration must be one of: 4, 6, 8 (seconds)\n` +
    `- Plan by runtime budget, not fixed counts: default target total runtime is ~60 seconds.\n` +
    `- If user explicitly requests a runtime/length, obey user requirement over default.\n` +
    `- Choose sequence/shot counts that best fit the target runtime and story rhythm.\n` +
    `- Keep JSON VALID. If too long, reduce counts/verbosity.\n` +
    `- If the Intent includes a "Reference Assignments" section, treat it as hard constraints and preserve those mappings through Director -> Casting/Environment decisions.\n` +
    `- For character-assigned references, ensure corresponding character entries/looks are created or updated to match those references.\n` +
    `- For location-assigned references, ensure corresponding location entries/style reflect those references.\n` +
    `- Maintain strong continuity: same character identity across looks; same environment logic across shots.\n` +
    `- LOOKS: Only create a character look when it is a meaningful visual state change (wardrobe/hair/makeup/accessories and/or facial/physical state). Do NOT create looks just because location/time changes.\n` +
    `- The "videoPrompt" MUST be production-ready and self-contained.\n` +
    `\n` +
    `Intent: ${intent}\n` +
    `AspectRatio: ${aspectRatio}\n`
  );
};
