import { AiSettings, ModelRuntimeSettings } from '../../types';

const AI_SETTINGS_STORAGE_KEY = 'vision-studio.ai.settings.v1';

const normalizeGeminiModel = (model: string): string => {
  const m = String(model || '').trim();
  if (!m) return 'gemini-3-flash-preview';
  // Gemini 1.5 (including gemini-1.5-flash / -pro) was shut down on 2025-09-29.
  if (m.startsWith('gemini-1.5-')) return 'gemini-3-pro-preview';
  // Older internal names we used during prototyping.
  if (m === 'gemini-2.0-flash-thinking') return 'gemini-3-flash-preview';
  return m;
};

const isSimulatedGeminiModel = (model: string): boolean => /^mock[-_]?sim/i.test(String(model || '').trim());

const getDefaultModelSettings = (): ModelRuntimeSettings => ({
  provider: 'gemini',
  model: 'gemini-3-flash-preview',
  temperature: 0.6,
  maxOutputTokens: 4096,
  baseUrl: '',
  debug: {
    enabled: true,
    logPrompts: false,
    logRawResponses: false,
  },
});

export const getDefaultAiSettings = (): AiSettings => ({
  version: 2,
  scaffoldPlanner: {
    ...getDefaultModelSettings(),
    model: 'gemini-3-flash-preview',
    temperature: 0.4,
    maxOutputTokens: 8192,
  },
  scaffoldWorker: {
    ...getDefaultModelSettings(),
    model: 'gemini-3-flash-preview',
    temperature: 0.6,
    maxOutputTokens: 8192,
  },
  direct: {
    ...getDefaultModelSettings(),
    model: 'gemini-3-flash-preview',
    temperature: 0.5,
    workflowMode: 'auto',
    useFunctionCalling: true,
    useStreaming: true,
  },
  image: {
    ...getDefaultModelSettings(),
    // Kept as a free-form string; the dev proxy will fall back to mock if unsupported.
    model: 'nano-banana-pro',
    temperature: 0.4,
  },
});

export const loadAiSettings = (): AiSettings => {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return getDefaultAiSettings();
    const parsed = JSON.parse(raw) as any;

    // v1 -> v2 migration
    if (parsed && parsed.version === 1) {
      const base = getDefaultAiSettings();
      const scaffold = parsed.scaffold || {};
      const direct = parsed.direct || {};
      const migrated: AiSettings = {
        ...base,
        scaffoldPlanner: { ...base.scaffoldPlanner, ...scaffold },
        scaffoldWorker: { ...base.scaffoldWorker, ...scaffold },
        direct: { ...base.direct, ...direct },
      };
      return migrated;
    }

    if (!parsed || parsed.version !== 2) return getDefaultAiSettings();
    const loaded: AiSettings = {
      ...getDefaultAiSettings(),
      ...parsed,
      scaffoldPlanner: { ...getDefaultAiSettings().scaffoldPlanner, ...(parsed.scaffoldPlanner || {}) },
      scaffoldWorker: { ...getDefaultAiSettings().scaffoldWorker, ...(parsed.scaffoldWorker || {}) },
      direct: { ...getDefaultAiSettings().direct, ...(parsed.direct || {}) },
      image: { ...getDefaultAiSettings().image, ...(parsed.image || {}) },
    };

    // Normalize known-bad Gemini model names so users don't get stuck with 404s.
    const normalize = (s: ModelRuntimeSettings): ModelRuntimeSettings =>
      s.provider === 'gemini' ? { ...s, model: normalizeGeminiModel(s.model) } : s;

    const preferFlash = (s: ModelRuntimeSettings): ModelRuntimeSettings => {
      if (s.provider !== 'gemini') return s;
      if (String(s.model || '').trim() !== 'gemini-3-pro-preview') return s;
      return { ...s, model: 'gemini-3-flash-preview' };
    };

    const bumpScaffoldTokens = (s: ModelRuntimeSettings): ModelRuntimeSettings => {
      if (s.provider !== 'gemini') return s;
      const cur = Number(s.maxOutputTokens || 0);
      if (!cur || cur < 4096) return { ...s, maxOutputTokens: 4096 };
      return s;
    };

    const forceSimulatedGeminiModel = (s: ModelRuntimeSettings, fallbackModel = 'mock-sim'): ModelRuntimeSettings => {
      if (s.provider !== 'gemini') return s;
      if (isSimulatedGeminiModel(String(s.model || ''))) return s;
      return { ...s, model: fallbackModel };
    };

    return {
      ...loaded,
      scaffoldPlanner: forceSimulatedGeminiModel(
        bumpScaffoldTokens(preferFlash(normalize(loaded.scaffoldPlanner))),
        'mock-sim-scaffold-planner',
      ),
      scaffoldWorker: forceSimulatedGeminiModel(
        bumpScaffoldTokens(preferFlash(normalize(loaded.scaffoldWorker))),
        'mock-sim-scaffold-worker',
      ),
      direct: preferFlash(normalize(loaded.direct)),
      image: forceSimulatedGeminiModel(normalize(loaded.image), 'mock-sim-image'),
    };
  } catch {
    return getDefaultAiSettings();
  }
};

export const saveAiSettings = (settings: AiSettings) => {
  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};
