import React, { useMemo, useState } from 'react';
import { X, Sparkles, Save } from 'lucide-react';
import { AiSettings, ModelProvider, ModelRuntimeSettings } from '../../types';

interface AiSettingsModalProps {
  settings: AiSettings;
  onSave: (next: AiSettings) => void;
  onClose: () => void;
}

const providerLabel: Record<ModelProvider, string> = {
  gemini: 'Gemini (Primary)',
  openai: 'OpenAI (Fallback)',
  deepseek: 'DeepSeek (Fallback)',
  mock: 'Mock (No API)',
};

const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const updateProfile = (
  settings: AiSettings,
  key: 'scaffoldPlanner' | 'scaffoldWorker' | 'direct' | 'image',
  patch: Partial<ModelRuntimeSettings>
): AiSettings => {
  return {
    ...settings,
    [key]: {
      ...settings[key],
      ...patch,
      debug: {
        enabled: settings[key].debug?.enabled ?? true,
        logPrompts: settings[key].debug?.logPrompts ?? false,
        logRawResponses: settings[key].debug?.logRawResponses ?? false,
        ...(patch.debug || {}),
      },
    },
  };
};

const ProfileEditor: React.FC<{
  title: string;
  value: ModelRuntimeSettings;
  onChange: (patch: Partial<ModelRuntimeSettings>) => void;
  showFunctionCalling?: boolean;
}> = ({ title, value, onChange, showFunctionCalling }) => {
  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/20">
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{title}</div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Provider</div>
            <select
              value={value.provider}
              onChange={(e) => onChange({ provider: e.target.value as ModelProvider })}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm"
            >
              {Object.keys(providerLabel).map((k) => (
                <option key={k} value={k}>
                  {providerLabel[k as ModelProvider]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Model</div>
            <input
              value={value.model}
              onChange={(e) => onChange({ model: e.target.value })}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono"
              placeholder="e.g. gemini-3-pro-preview"
            />
          </label>

          <label className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Temperature</div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={1.2}
                step={0.05}
                value={value.temperature}
                onChange={(e) => onChange({ temperature: clampNumber(Number(e.target.value), 0, 1.2) })}
                className="w-full"
              />
              <input
                type="number"
                min={0}
                max={1.2}
                step={0.05}
                value={value.temperature}
                onChange={(e) => onChange({ temperature: clampNumber(Number(e.target.value), 0, 1.2) })}
                className="w-24 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono"
              />
            </div>
          </label>

          <label className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Agent Base URL</div>
            <input
              value={value.baseUrl || ''}
              onChange={(e) => onChange({ baseUrl: e.target.value })}
              className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono"
              placeholder="(optional) e.g. http://localhost:8787"
            />
          </label>
        </div>

        <div className="flex items-center gap-6 pt-2">
          {Boolean(showFunctionCalling) && (
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={Boolean((value as any).useFunctionCalling)}
                onChange={(e) => onChange({ useFunctionCalling: e.target.checked } as any)}
              />
              Function calling (strict actions)
            </label>
          )}
          {Boolean(showFunctionCalling) && (
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={Boolean((value as any).useStreaming)}
                onChange={(e) => onChange({ useStreaming: e.target.checked } as any)}
              />
              Stream responses (SSE)
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={value.debug?.enabled ?? true}
              onChange={(e) => onChange({ debug: { ...value.debug, enabled: e.target.checked } })}
            />
            Debug
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={value.debug?.logPrompts ?? false}
              onChange={(e) => onChange({ debug: { ...value.debug, logPrompts: e.target.checked } })}
            />
            Log prompts
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={value.debug?.logRawResponses ?? false}
              onChange={(e) => onChange({ debug: { ...value.debug, logRawResponses: e.target.checked } })}
            />
            Log raw responses
          </label>
        </div>
      </div>
    </div>
  );
};

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [draft, setDraft] = useState<AiSettings>(settings);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

  return (
    <div className="fixed inset-0 z-[3000] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
      <div className="w-full max-w-5xl rounded-[32px] border border-white/10 bg-white dark:bg-[#050505] shadow-2xl overflow-hidden">
        <div className="h-16 px-6 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#ee4d2d] text-white flex items-center justify-center shadow-sm shadow-orange-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400">AI Runtime</div>
              <div className="text-sm font-bold tracking-tight">Model & Agent Settings</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSave(draft)}
              disabled={!dirty}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 text-white dark:bg-white dark:text-black font-black uppercase tracking-widest text-[11px] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title={dirty ? 'Save' : 'No changes'}
            >
              <Save className="w-4 h-4" />
              Save
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-zinc-600 dark:text-zinc-300" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40 p-4 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
            默认以 Gemini 为主（推荐 Planner/Director 用 thinking；Worker 可按质量/速度/成本切换）。需要对比效果时可切换到 OpenAI / DeepSeek。图片生成默认模型名为 nano-banana-pro（目前生成端为占位实现，后续可替换为真实图片生成 API）。若暂时没有可用 key，可将 Provider 设为 Mock 以保证本地流程可跑。
          </div>

          <ProfileEditor
            title="Scaffold Planner (Thinking)"
            value={draft.scaffoldPlanner}
            onChange={(patch) => setDraft((prev) => updateProfile(prev, 'scaffoldPlanner', patch as any))}
          />

          <ProfileEditor
            title="Scaffold Worker (Flash)"
            value={draft.scaffoldWorker}
            onChange={(patch) => setDraft((prev) => updateProfile(prev, 'scaffoldWorker', patch as any))}
          />

          <ProfileEditor
            title="Director Console (Follow-up directives)"
            value={draft.direct}
            onChange={(patch) => setDraft((prev) => updateProfile(prev, 'direct', patch))}
            showFunctionCalling
          />

          <ProfileEditor
            title="Image Generation (Assets)"
            value={draft.image}
            onChange={(patch) => setDraft((prev) => updateProfile(prev, 'image', patch as any))}
          />
        </div>
      </div>
    </div>
  );
};
