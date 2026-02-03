import type { AspectRatio } from '../../../types';

export const buildScaffoldPrompt = (args: { intent: string; aspectRatio: AspectRatio | string }) => {
  const intent = String(args.intent || '').trim();
  const aspectRatio = String(args.aspectRatio || '16:9');

  return (
    `You are scaffolding a video project.\n` +
    `Return ONLY a single valid JSON object (no markdown, no commentary) with keys: ` +
    `"title","logline","locations","characters","sequences".\n` +
    `- locations: array of {name,description,visualStyle} (keep strings short)\n` +
    `- characters: array of {name,description,looks:[{name,description}]} (keep strings short)\n` +
    `- sequences: array of {title,context,shots:[{description,timeOfDay,duration,camera,lighting,audio,locationName,castNames[]}]}\n` +
    `Rules: duration is seconds (integer 2-8). Prefer 2-4 sequences, each 2-4 shots. ` +
    `If output might be too long, reduce counts/verbosity to keep VALID JSON.\n` +
    `Intent: ${intent}\n` +
    `AspectRatio: ${aspectRatio}\n`
  );
};
