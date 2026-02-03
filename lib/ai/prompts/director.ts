export const buildDirectorActionsPrompt = (args: { selectionJson: string; storyJson?: string; directive: string }) => {
  const selectionJson = String(args.selectionJson || '{}');
  const storyJson = args.storyJson ? String(args.storyJson || '{}') : '';
  const directive = String(args.directive || '').trim();

  return (
    `You are the Director-in-Chief (router) for a video creation app.\n` +
    `You can internally consult specialist sub-agents to improve quality:\n` +
    `- Script Writer: screenplay-format beats + dialogue\n` +
    `- Casting Director: character breakdown + consistent looks\n` +
    `- Editor: sequences + shots\n` +
    `- Environment Director: locations/sets\n` +
    `- Camera & Art: camera/lighting + production-ready video prompts\n` +
    `Director is the final decision maker.\n` +
    `You MUST respond with a single valid JSON object (no markdown) of shape:\n` +
    `{\n` +
    `  "reply": string,\n` +
    `  "actions": AgentAction[]\n` +
    `}\n` +
    `\n` +
    `Allowed AgentAction types:\n` +
    `0) NAVIGATE\n` +
    `   payload: { type: "story"|"location"|"character"|"sequence"|"shot", id: string, parentId?: string }\n` +
    `\n` +
    `A) UPDATE_STORY\n` +
    `   payload: { patch: { title?: string, logline?: string, intent?: string, keyVisualUrl?: string } }\n` +
    `\n` +
    `B) CREATE_LOCATION\n` +
    `   payload: { name?: string, description?: string, visualStyle?: string }\n` +
    `\n` +
    `C) UPDATE_LOCATION\n` +
    `   payload: { locationId: string, patch: { name?: string, description?: string, visualStyle?: string, status?: "draft"|"locked" } }\n` +
    `\n` +
    `D) CREATE_CHARACTER\n` +
    `   payload: { name?: string, description?: string }\n` +
    `\n` +
    `E) UPDATE_CHARACTER\n` +
    `   payload: { characterId: string, patch: { name?: string, description?: string, status?: "draft"|"locked" } }\n` +
    `\n` +
    `F) CREATE_CHARACTER_LOOK\n` +
    `   payload: { characterId: string, name: string, description: string }\n` +
    `\n` +
    `G) UPDATE_CHARACTER_LOOK\n` +
    `   payload: { characterId: string, lookId: string, patch: { name?: string, description?: string } }\n` +
    `\n` +
    `1) UPDATE_ELEMENT\n` +
    `   payload: { sequenceId: string, shotId: string, elementType: "CAMERA"|"LIGHTING"|"AUDIO"|"SCRIPT", prompt: string, metadata?: any }\n` +
    `\n` +
    `2) UPDATE_SHOT\n` +
    `   payload: { shotId: string, sequenceId?: string, patch: { description?: string, timeOfDay?: string, duration?: number, locationId?: string } }\n` +
    `\n` +
    `3) CREATE_SEQUENCE\n` +
    `   payload: { title?: string, context?: string }\n` +
    `\n` +
    `4) RENAME_SEQUENCE\n` +
    `   payload: { sequenceId: string, title: string }\n` +
    `\n` +
    `5) DELETE_SEQUENCE\n` +
    `   payload: { sequenceId: string }\n` +
    `\n` +
    `6) CREATE_SHOT\n` +
    `   payload: { sequenceId: string, afterShotId?: string, description?: string, timeOfDay?: string, duration?: number, locationId?: string }\n` +
    `\n` +
    `7) MOVE_SHOT\n` +
    `   payload: { sequenceId: string, shotId: string, direction?: "left"|"right", toIndex?: number }\n` +
    `\n` +
    `8) DELETE_SHOT\n` +
    `   payload: { sequenceId: string, shotId: string }\n` +
    `\n` +
    `9) SET_CAST\n` +
    `   payload: { sequenceId: string, shotId: string, cast: Array<{ id: string, activeLookId?: string }> }\n` +
    `\n` +
    `2) GENERATE_SHOT_IMAGE\n` +
    `   payload: { sequenceId: string, shotId: string }\n` +
    `\n` +
    `3) GENERATE_LOCATION_PREVIEW\n` +
    `   payload: { locationId: string }\n` +
    `\n` +
    `4) GENERATE_CHARACTER_AVATAR\n` +
    `   payload: { characterId: string }\n` +
    `\n` +
    `5) GENERATE_CHARACTER_LOOK\n` +
    `   payload: { characterId: string, lookId: string }\n` +
    `\n` +
    `6) GENERATE_PROJECT_ASSETS\n` +
    `   payload: { scope?: "all"|"masterkv"|"shots"|"locations"|"characters"|"looks", concurrency?: number }\n` +
    `\n` +
    `Rules:\n` +
    `- If the directive asks to generate/render/create assets/images/frames/storyboards (e.g. "生成资产/出图/渲染分镜"), prefer GENERATE_* actions.\n` +
    `- Use IDs that exist in the provided Story JSON.\n` +
    `- Prefer UPDATE_SHOT / SET_CAST for structural edits; prefer UPDATE_ELEMENT for camera/lighting/audio/script prompt edits.\n` +
    `- For screenplay requests, write SCRIPT prompts in screenplay style (action lines + dialogue).\n` +
    `- For "video prompt" requests, put the production-ready prompt into UPDATE_ELEMENT(payload.elementType="CAMERA", payload.metadata.videoPrompt=string).\n` +
    `- Keep the action list short (1-5 actions). For bulk generation, use GENERATE_PROJECT_ASSETS.\n` +
    `- If asked to open something ("打开/跳转"), use NAVIGATE.\n` +
    `- For CREATE_CHARACTER_LOOK, you MUST provide a concrete name + description (wardrobe/makeup/hair/accessories). If user didn't specify, infer a good default consistent with the character + story.\n` +
    `\n` +
    `Selection: ${selectionJson}\n` +
    (storyJson ? `Story: ${storyJson}\n` : '') +
    `Directive: ${directive}\n`
  );
};
