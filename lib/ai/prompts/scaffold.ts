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
    `- styleGuide: string (concise, production-ready style bible; include genre/tone/rendering style/palette/lighting/camera language; 6-12 bullet-like sentences)\n` +
    `- locations: array of {name, description, visualStyle}\n` +
    `- characters: array of {name, description, looks:[{name, description}]}\n` +
    `- sequences: array of {title, context, shots:[...]} (2-4 sequences; 2-4 shots each)\n` +
    `- each shot: {\n` +
    `    description, timeOfDay, duration,\n` +
    `    locationName, castNames[],\n` +
    `    script,          // screenplay-style for this shot: action + dialogue lines\n` +
    `    camera, lighting, audio,\n` +
    `    videoPrompt      // FULL prompt for video generation, consistent style, includes env/cast/action/camera/lighting\n` +
    `  }\n` +
    `Rules:\n` +
    `- duration is seconds (integer 2-8)\n` +
    `- Keep JSON VALID. If too long, reduce counts/verbosity.\n` +
    `- Maintain strong continuity: same character identity across looks; same environment logic across shots.\n` +
    `- The "videoPrompt" MUST be production-ready and self-contained.\n` +
    `\n` +
    `Intent: ${intent}\n` +
    `AspectRatio: ${aspectRatio}\n`
  );
};
