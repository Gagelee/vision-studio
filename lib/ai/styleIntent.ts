export const buildStylePromptTranslation = (args: {
  texts: Array<string | undefined | null>;
  maxItems?: number;
}): string => {
  const raw = (args.texts || []).map((t) => String(t || '').trim()).filter(Boolean).join('\n').toLowerCase();
  if (!raw) return '';

  const has = (re: RegExp) => re.test(raw);
  const hints: string[] = [];
  const push = (items: string[]) => {
    for (const it of items) {
      if (!hints.includes(it)) hints.push(it);
    }
  };

  if (has(/(\bfilm\b|\bcinema\b|\bcinematic\b|电影|院线|trailer|movie)/i)) {
    push([
      'cinematic framing with clear foreground/mid/background separation',
      'filmic contrast and disciplined highlight rolloff',
      'story-first staging over static posed composition',
    ]);
  }

  if (has(/(\bepic\b|史诗|宏大|grand|monumental)/i)) {
    push([
      'epic scale with monumental environment-to-subject ratio',
      'wide establishing composition before medium-detail emphasis',
      'high-impact visual rhythm with strong silhouette readability',
    ]);
  }

  if (has(/(\bnoir\b|黑色|neo-noir)/i)) {
    push([
      'low-key noir lighting with decisive shadow shapes',
      'selective practical highlights and restrained color accents',
    ]);
  }

  if (has(/(\bdocumentary\b|纪实|纪录片|realism|写实|写实电影|live-action)/i)) {
    push([
      'documentary naturalism with believable texture and micro-imperfections',
      'available-light logic and physically plausible exposure balance',
    ]);
  }

  if (has(/(\banime\b|二次元|动画|cel)/i)) {
    push([
      'anime-cel edge clarity with intentional shape language',
      'controlled stylization with stable character identity',
    ]);
  }

  if (has(/(\boil painting\b|油画)/i)) {
    push([
      'oil-paint surface texture and brushstroke hierarchy',
      'painterly color transitions over photographic micro-detail',
    ]);
  }

  if (has(/(\bwatercolor\b|水彩)/i)) {
    push([
      'watercolor diffusion and pigment bloom control',
      'soft edge hierarchy with paper-like tonal lift',
    ]);
  }

  if (has(/(\bink wash\b|水墨|sumie|sumi-e)/i)) {
    push([
      'ink-wash value hierarchy with brush-energy strokes',
      'minimal palette and negative-space composition discipline',
    ]);
  }

  const limited = hints.slice(0, Math.max(1, Math.min(8, Number(args.maxItems ?? 6))));
  return limited.join('; ');
};

