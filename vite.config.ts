import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  buildDirectorActionsPrompt,
  buildScaffoldPrompt,
  buildTeamDirectMergePrompt,
  buildTeamDirectPlannerPrompt,
  buildTeamDirectSpecialistPrompt,
  buildTeamScaffoldCameraArtPrompt,
  buildTeamScaffoldCastingDirectorPrompt,
  buildTeamScaffoldDirectorBriefPrompt,
  buildTeamScaffoldDirectorMergePrompt,
  buildTeamScaffoldEditorPrompt,
  buildTeamScaffoldEnvironmentDirectorPrompt,
  buildTeamScaffoldScriptWriterPrompt,
} from './lib/ai/prompts';
import { buildStylePromptTranslation } from './lib/ai/styleIntent';
import { getPromptMetaForAgent } from './lib/ai/promptMeta';
import { ProxyAgent } from 'undici';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const GENERATED_ASSETS_DIR = path.resolve(process.cwd(), '.vision-assets');
const VISION_USER_ID_HEADER = 'x-vision-user-id';
const USER_ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/i;

type GeminiResponseSchema = any;
const schemaString = (): GeminiResponseSchema => ({ type: 'STRING' });
const schemaInt = (): GeminiResponseSchema => ({ type: 'INTEGER' });
const schemaBool = (): GeminiResponseSchema => ({ type: 'BOOLEAN' });
const schemaArray = (items: GeminiResponseSchema): GeminiResponseSchema => ({ type: 'ARRAY', items });
const schemaFreeformObject = (): GeminiResponseSchema => ({
  type: 'OBJECT',
  // Gemini requires OBJECT.properties to be non-empty.
  properties: { _raw: schemaString() },
});
const schemaObject = (args: {
  properties: Record<string, GeminiResponseSchema>;
  required?: string[];
  propertyOrdering?: string[];
}): GeminiResponseSchema => ({
  type: 'OBJECT',
  properties: args.properties,
  ...(args.required ? { required: args.required } : {}),
  ...(args.propertyOrdering ? { propertyOrdering: args.propertyOrdering } : {}),
});

const GEMINI_SCHEMA = {
  scaffoldDirectorBrief: schemaObject({
    required: ['title', 'logline', 'styleBible', 'characters', 'locations', 'sequenceOutline'],
    propertyOrdering: ['title', 'logline', 'styleBible', 'characters', 'locations', 'sequenceOutline'],
    properties: {
      title: schemaString(),
      logline: schemaString(),
      styleBible: schemaObject({
        required: ['genre', 'tone', 'visualKeywords', 'cameraLanguage', 'constraints'],
        propertyOrdering: ['genre', 'tone', 'visualKeywords', 'cameraLanguage', 'constraints'],
        properties: {
          genre: schemaString(),
          tone: schemaString(),
          visualKeywords: schemaArray(schemaString()),
          cameraLanguage: schemaString(),
          constraints: schemaArray(schemaString()),
        },
      }),
      characters: schemaArray(
        schemaObject({
          required: ['name', 'role', 'oneLine'],
          propertyOrdering: ['name', 'role', 'oneLine'],
          properties: { name: schemaString(), role: schemaString(), oneLine: schemaString() },
        }),
      ),
      locations: schemaArray(
        schemaObject({
          required: ['name', 'purpose'],
          propertyOrdering: ['name', 'purpose'],
          properties: { name: schemaString(), purpose: schemaString() },
        }),
      ),
      sequenceOutline: schemaArray(
        schemaObject({
          required: ['title', 'goal'],
          propertyOrdering: ['title', 'goal'],
          properties: { title: schemaString(), goal: schemaString() },
        }),
      ),
    },
  }),
  scaffoldCasting: schemaObject({
    required: ['characters'],
    propertyOrdering: ['characters'],
    properties: {
      characters: schemaArray(
        schemaObject({
          required: ['name', 'description', 'identityAnchors', 'looks'],
          propertyOrdering: ['name', 'description', 'identityAnchors', 'looks'],
          properties: {
            name: schemaString(),
            description: schemaString(),
            identityAnchors: schemaArray(schemaString()),
            looks: schemaArray(
              schemaObject({
                required: ['name', 'description'],
                propertyOrdering: ['name', 'description'],
                properties: { name: schemaString(), description: schemaString() },
              }),
            ),
          },
        }),
      ),
    },
  }),
  promptCompose: schemaObject({
    required: ['prompt', 'negativePrompt'],
    propertyOrdering: ['prompt', 'negativePrompt'],
    properties: {
      prompt: schemaString(),
      negativePrompt: schemaString(),
    },
  }),
  imageDescribe: schemaObject({
    required: ['description'],
    propertyOrdering: ['description', 'keySubjects', 'environment', 'composition', 'camera', 'lighting', 'style', 'constraints'],
    properties: {
      description: schemaString(),
      keySubjects: schemaArray(schemaString()),
      environment: schemaString(),
      composition: schemaString(),
      camera: schemaString(),
      lighting: schemaString(),
      style: schemaString(),
      constraints: schemaArray(schemaString()),
    },
  }),
  scaffoldEnvironments: schemaObject({
    required: ['locations'],
    propertyOrdering: ['locations'],
    properties: {
      locations: schemaArray(
        schemaObject({
          required: ['name', 'description', 'visualStyle'],
          propertyOrdering: ['name', 'description', 'visualStyle'],
          properties: { name: schemaString(), description: schemaString(), visualStyle: schemaString() },
        }),
      ),
    },
  }),
  scaffoldScript: schemaObject({
    required: ['sequences'],
    propertyOrdering: ['sequences'],
    properties: {
      sequences: schemaArray(
        schemaObject({
          required: ['title', 'shots'],
          propertyOrdering: ['title', 'shots'],
          properties: {
            title: schemaString(),
            shots: schemaArray(
              schemaObject({
                required: ['beat', 'script', 'castNames'],
                propertyOrdering: ['beat', 'script', 'castNames'],
                properties: { beat: schemaString(), script: schemaString(), castNames: schemaArray(schemaString()) },
              }),
            ),
          },
        }),
      ),
    },
  }),
  scaffoldEditor: schemaObject({
    required: ['sequences'],
    propertyOrdering: ['sequences'],
    properties: {
      sequences: schemaArray(
        schemaObject({
          required: ['title', 'context', 'sceneDecision', 'scenes'],
          propertyOrdering: ['title', 'context', 'sceneDecision', 'scenes'],
          properties: {
            title: schemaString(),
            context: schemaString(),
            sceneDecision: schemaObject({
              required: ['split', 'sceneCount', 'rationale'],
              propertyOrdering: ['split', 'sceneCount', 'rationale', 'criteria'],
              properties: {
                split: schemaBool(),
                sceneCount: schemaInt(),
                rationale: schemaString(),
                criteria: schemaArray(schemaString()),
              },
            }),
            scenes: schemaArray(
              schemaObject({
                required: ['title', 'shots'],
                propertyOrdering: ['title', 'summary', 'shots'],
                properties: {
                  title: schemaString(),
                  summary: schemaString(),
                  shots: schemaArray(
                    schemaObject({
                      required: ['description', 'timeOfDay', 'duration', 'locationName', 'castNames', 'script'],
                      propertyOrdering: ['description', 'timeOfDay', 'duration', 'locationName', 'castNames', 'script'],
                      properties: {
                        description: schemaString(),
                        timeOfDay: schemaString(),
                        duration: schemaInt(),
                        locationName: schemaString(),
                        castNames: schemaArray(schemaString()),
                        script: schemaString(),
                      },
                    }),
                  ),
                },
              }),
            ),
          },
        }),
      ),
    },
  }),
  scaffoldCameraArt: schemaObject({
    propertyOrdering: ['shootingStyleSuggestion', 'shotGuidelines', 'equipmentChoices'],
    properties: {
      shootingStyleSuggestion: schemaString(),
      shotGuidelines: schemaArray(schemaString()),
      equipmentChoices: schemaArray(schemaString()),
    },
  }),
  scaffoldFinal: schemaObject({
    required: ['title', 'logline', 'styleGuide', 'locations', 'characters', 'sequences'],
    propertyOrdering: ['title', 'logline', 'styleGuide', 'locations', 'characters', 'sequences'],
    properties: {
      title: schemaString(),
      logline: schemaString(),
      styleGuide: schemaString(),
      locations: schemaArray(
        schemaObject({
          required: ['name', 'description', 'visualStyle'],
          propertyOrdering: ['name', 'description', 'visualStyle'],
          properties: { name: schemaString(), description: schemaString(), visualStyle: schemaString() },
        }),
      ),
      characters: schemaArray(
        schemaObject({
          required: ['name', 'description', 'looks'],
          propertyOrdering: ['name', 'description', 'looks'],
          properties: {
            name: schemaString(),
            description: schemaString(),
            looks: schemaArray(
              schemaObject({
                required: ['name', 'description'],
                propertyOrdering: ['name', 'description'],
                properties: { name: schemaString(), description: schemaString() },
              }),
            ),
          },
        }),
      ),
      sequences: schemaArray(
        schemaObject({
          required: ['title', 'context', 'sceneDecision', 'scenes'],
          propertyOrdering: ['title', 'context', 'sceneDecision', 'scenes'],
          properties: {
            title: schemaString(),
            context: schemaString(),
            sceneDecision: schemaObject({
              required: ['split', 'sceneCount', 'rationale'],
              propertyOrdering: ['split', 'sceneCount', 'rationale', 'criteria'],
              properties: {
                split: schemaBool(),
                sceneCount: schemaInt(),
                rationale: schemaString(),
                criteria: schemaArray(schemaString()),
              },
            }),
            scenes: schemaArray(
              schemaObject({
                required: [
                  'title',
                  'shots',
                ],
                propertyOrdering: [
                  'title',
                  'summary',
                  'shots',
                ],
                properties: {
                  title: schemaString(),
                  summary: schemaString(),
                  shots: schemaArray(
                    schemaObject({
                      required: [
                        'description',
                        'timeOfDay',
                        'duration',
                        'locationName',
                        'castNames',
                        'script',
                      ],
                      propertyOrdering: [
                        'description',
                        'timeOfDay',
                        'duration',
                        'locationName',
                        'castNames',
                        'script',
                        'camera',
                        'lighting',
                        'audio',
                        'videoPrompt',
                      ],
                      properties: {
                        description: schemaString(),
                        timeOfDay: schemaString(),
                        duration: schemaInt(),
                        camera: schemaString(),
                        lighting: schemaString(),
                        audio: schemaString(),
                        locationName: schemaString(),
                        castNames: schemaArray(schemaString()),
                        script: schemaString(),
                        // Optional now: video prompt is composed asynchronously at shot production stage.
                        videoPrompt: schemaString(),
                      },
                    }),
                  ),
                },
              }),
            ),
          },
        }),
      ),
    },
  }),
  directorPlan: schemaObject({
    required: ['reply', 'requestedAgents', 'focus'],
    propertyOrdering: ['reply', 'requestedAgents', 'focus'],
    properties: {
      reply: schemaString(),
      requestedAgents: schemaArray(schemaString()),
      focus: schemaObject({
        properties: {
          script_writer: schemaString(),
          casting_director: schemaString(),
          editor: schemaString(),
          environment_director: schemaString(),
          camera_art: schemaString(),
        },
      }),
    },
  }),
  directorSpecialist: schemaObject({
    required: ['notes', 'suggestedActions'],
    propertyOrdering: ['notes', 'suggestedActions'],
    properties: {
      notes: schemaString(),
      suggestedActions: schemaArray(
        schemaObject({
          required: ['type', 'payload'],
          propertyOrdering: ['type', 'payload'],
          properties: { type: schemaString(), payload: schemaFreeformObject() },
        }),
      ),
    },
  }),
  directorFinal: schemaObject({
    required: ['reply', 'actions'],
    propertyOrdering: ['reply', 'actions'],
    properties: {
      reply: schemaString(),
      actions: schemaArray(
        schemaObject({
          required: ['type'],
          propertyOrdering: ['type', 'payload'],
          properties: { type: schemaString(), payload: schemaFreeformObject() },
        }),
      ),
    },
  }),
} as const;

const getProxyDispatcher = (targetUrl: string, env: Record<string, string>) => {
  const disableProxy = String(env.VISION_DISABLE_PROXY || env.DISABLE_PROXY || '').trim().toLowerCase();
  if (disableProxy === '1' || disableProxy === 'true' || disableProxy === 'yes') return undefined;

  const proxyUrl =
    env.HTTPS_PROXY ||
    env.HTTP_PROXY ||
    env.https_proxy ||
    env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    '';
  if (!proxyUrl) return undefined;

  const noProxy =
    env.NO_PROXY || env.no_proxy || process.env.NO_PROXY || process.env.no_proxy || '';

  try {
    const u = new URL(targetUrl);
    const host = u.hostname;
    const bypass = noProxy
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((rule) => {
        if (rule === '*') return true;
        if (rule === host) return true;
        if (rule.startsWith('.')) return host.endsWith(rule);
        return host.endsWith(rule);
      });
    if (bypass) return undefined;
  } catch {
    // ignore
  }

  // Cache per proxy URL to avoid recreating agents.
  const g: any = globalThis as any;
  g.__VISION_PROXY_CACHE__ ||= {};
  if (!g.__VISION_PROXY_CACHE__[proxyUrl]) {
    g.__VISION_PROXY_CACHE__[proxyUrl] = new ProxyAgent(proxyUrl);
  }
  return g.__VISION_PROXY_CACHE__[proxyUrl];
};

const normalizeUserId = (raw: unknown): string => {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const cleaned = s.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return USER_ID_RE.test(cleaned) ? cleaned : '';
};

const getRequestUserId = (req: any): string => {
  const direct = req?.headers?.[VISION_USER_ID_HEADER];
  const lower = req?.headers?.[VISION_USER_ID_HEADER.toLowerCase()];
  return normalizeUserId(direct || lower) || 'anon';
};

const userGeneratedAssetsDir = (userId: string) => {
  const safeUserId = normalizeUserId(userId) || 'anon';
  return path.join(GENERATED_ASSETS_DIR, safeUserId);
};

const ensureGeneratedDir = (userId: string) => {
  try {
    fs.mkdirSync(userGeneratedAssetsDir(userId), { recursive: true });
  } catch {
    // ignore
  }
};

const parseGeneratedAssetRequest = (urlPathname: string): { userId?: string; filename: string } | null => {
  const decoded = decodeURIComponent(String(urlPathname || ''));
  let rel = decoded.split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!rel) return null;
  if (rel === '__generated__') return null;
  if (rel.startsWith('__generated__/')) rel = rel.slice('__generated__/'.length);
  if (!rel || rel.includes('..') || rel.includes('\\')) return null;
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 1) return { filename: parts[0] };
  if (parts.length === 2) {
    const userId = normalizeUserId(parts[0]);
    if (!userId) return null;
    return { userId, filename: parts[1] };
  }
  return null;
};

const safeGeneratedAssetPaths = (urlPathname: string, fallbackUserId?: string): string[] => {
  const parsed = parseGeneratedAssetRequest(urlPathname);
  if (!parsed?.filename || parsed.filename.includes('/')) return [];
  const out = new Set<string>();
  if (parsed.userId) {
    out.add(path.join(userGeneratedAssetsDir(parsed.userId), parsed.filename));
    return Array.from(out);
  }
  const normalizedFallback = normalizeUserId(fallbackUserId || '') || 'anon';
  out.add(path.join(userGeneratedAssetsDir(normalizedFallback), parsed.filename));
  // Legacy compatibility: historical assets without user segment lived directly under .vision-assets.
  out.add(path.join(GENERATED_ASSETS_DIR, parsed.filename));
  return Array.from(out);
};

const buildGeneratedAssetUrl = (userId: string, filename: string) => {
  const safeUserId = normalizeUserId(userId) || 'anon';
  return `/__generated__/${safeUserId}/${filename}`;
};

const mimeByExt = (ext: string) => {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
};

const readJsonBody = async (req: any): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const sendJson = (res: any, status: number, payload: JsonValue) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const formatFetchError = (e: any) => {
  const name = e?.name ? String(e.name) : '';
  const code = e?.cause?.code || e?.code ? String(e?.cause?.code || e?.code) : '';
  const msg = e?.message ? String(e.message) : String(e);
  return [name, code, msg].filter(Boolean).join(': ');
};

const isRetryableNetworkError = (e: any) => {
  const name = String(e?.name || '');
  const msg = String(e?.message || e || '');
  const code = String(e?.cause?.code || e?.code || '');

  if (e?.retryable === true) return true;
  if (name === 'AbortError') return true;

  // undici / node fetch common codes
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(code)) return true;
  if (code.startsWith('UND_ERR_')) return true;

  const m = msg.toLowerCase();
  if (m.includes('fetch failed')) return true;
  if (m.includes('socket hang up')) return true;
  if (m.includes('connect timeout')) return true;
  if (m.includes('timed out')) return true;
  if (m.includes('network') && m.includes('error')) return true;

  return false;
};

const withRetries = async <T,>(
  fn: () => Promise<T>,
  opts: { label: string; maxAttempts: number; baseDelayMs?: number; maxDelayMs?: number },
): Promise<T> => {
  const base = Math.max(50, Number(opts.baseDelayMs ?? 350));
  const max = Math.max(base, Number(opts.maxDelayMs ?? 4000));
  let lastErr: any = null;

  for (let attempt = 1; attempt <= Math.max(1, opts.maxAttempts); attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const retryable = isRetryableNetworkError(e);
      if (!retryable || attempt >= opts.maxAttempts) break;
      const exp = Math.min(max, Math.round(base * Math.pow(1.8, attempt - 1)));
      const jitter = Math.floor(Math.random() * 200);
      const wait = exp + jitter;
      console.warn(`[vision] retry ${attempt}/${opts.maxAttempts} (${opts.label}): ${formatFetchError(e)} (wait ${wait}ms)`);
      await sleep(wait);
    }
  }
  throw lastErr;
};

const parseLooseJsonObject = (raw: string): any | null => {
  const text = String(raw || '').trim();
  if (!text) return null;
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const normalizeQuotes = (s: string) =>
    s
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\uFEFF/g, '');
  const stripJsonComments = (s: string) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
  const stripTrailingCommas = (s: string) => {
    let out = s;
    for (let i = 0; i < 8; i++) {
      const next = out.replace(/,\s*([}\]])/g, '$1');
      if (next === out) return out;
      out = next;
    }
    return out;
  };
  const candidate = stripTrailingCommas(stripJsonComments(normalizeQuotes(stripped))).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

const resolveGeminiBaseUrl = (env?: Record<string, string>) => {
  const raw = String(env?.GEMINI_BASE_URL || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'https://generativelanguage.googleapis.com/v1beta';
};

const buildGeminiGenerateContentUrl = (args: { env?: Record<string, string>; model: string; baseUrl?: string }) => {
  const baseUrl = String(args.baseUrl || '').trim() || resolveGeminiBaseUrl(args.env);
  return `${baseUrl}/models/${encodeURIComponent(args.model)}:generateContent`;
};

const buildGeminiStreamContentUrl = (args: { env?: Record<string, string>; model: string; baseUrl?: string }) => {
  const baseUrl = String(args.baseUrl || '').trim() || resolveGeminiBaseUrl(args.env);
  return `${baseUrl}/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`;
};

const buildGeminiPredictLongRunningUrl = (args: { env?: Record<string, string>; model: string; baseUrl?: string }) => {
  const baseUrl = String(args.baseUrl || '').trim() || resolveGeminiBaseUrl(args.env);
  return `${baseUrl}/models/${encodeURIComponent(args.model)}:predictLongRunning`;
};

const buildGeminiOperationUrl = (args: { env?: Record<string, string>; operationName: string; baseUrl?: string }) => {
  const baseUrl = String(args.baseUrl || '').trim() || resolveGeminiBaseUrl(args.env);
  return `${baseUrl}/${String(args.operationName || '').replace(/^\/+/, '')}`;
};

const includesAnyText = (text: string, phrases: string[]) => {
  const t = String(text || '').toLowerCase();
  return phrases.some((p) => t.includes(String(p).toLowerCase()));
};

const adjustRequestedAgents = (requested: string[], selection: any, directive: string) => {
  const selectionType = String(selection?.type || '');
  const wantsScript = includesAnyText(directive, ['script', 'screenplay', 'dialogue', '台词', '对白', '剧本', '脚本']);
  const wantsShotText = includesAnyText(directive, ['shot', 'shots', '镜头', '分镜', 'shot description', '镜头描述']);
  const wantsCharacterDesign = includesAnyText(directive, ['character', '角色', '人物', 'look', '造型', '定妆', '人设']);

  const set = new Set(requested.filter(Boolean).map((a) => String(a).trim()));
  if (selectionType === 'character' && !wantsScript) set.delete('script_writer');
  if (wantsShotText && !wantsScript) {
    set.delete('script_writer');
    set.add('editor');
  }
  if (wantsCharacterDesign && !wantsScript) set.delete('script_writer');
  return Array.from(set);
};

type TokenUsage = { promptTokens?: number; outputTokens?: number; totalTokens?: number };

const extractGeminiUsage = (raw: any): TokenUsage | undefined => {
  const u = raw?.usageMetadata || raw?.usage_metadata;
  if (!u || typeof u !== 'object') return undefined;
  const promptTokens = Number(u.promptTokenCount ?? u.prompt_token_count);
  const outputTokens = Number(u.candidatesTokenCount ?? u.candidates_token_count);
  const totalTokens = Number(u.totalTokenCount ?? u.total_token_count);
  const out: TokenUsage = {};
  if (Number.isFinite(promptTokens)) out.promptTokens = promptTokens;
  if (Number.isFinite(outputTokens)) out.outputTokens = outputTokens;
  if (Number.isFinite(totalTokens)) out.totalTokens = totalTokens;
  return Object.keys(out).length ? out : undefined;
};

const mergeTokenUsage = (...items: Array<TokenUsage | null | undefined>): TokenUsage | undefined => {
  let promptTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let any = false;
  for (const u of items) {
    if (!u) continue;
    if (typeof u.promptTokens === 'number' && Number.isFinite(u.promptTokens)) {
      promptTokens += u.promptTokens;
      any = true;
    }
    if (typeof u.outputTokens === 'number' && Number.isFinite(u.outputTokens)) {
      outputTokens += u.outputTokens;
      any = true;
    }
    if (typeof u.totalTokens === 'number' && Number.isFinite(u.totalTokens)) {
      totalTokens += u.totalTokens;
      any = true;
    }
  }
  if (!any) return undefined;
  const out: TokenUsage = {};
  if (promptTokens > 0) out.promptTokens = promptTokens;
  if (outputTokens > 0) out.outputTokens = outputTokens;
  if (totalTokens > 0) out.totalTokens = totalTokens;
  if (!out.totalTokens && (out.promptTokens || out.outputTokens)) out.totalTokens = (out.promptTokens || 0) + (out.outputTokens || 0);
  return out;
};

const callGeminiJson = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  prompt: string;
  env?: Record<string, string>;
  responseSchema?: any;
  baseUrl?: string;
}): Promise<{ value: any; usage?: TokenUsage; raw?: any }> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model, baseUrl: args.baseUrl });
  const maxAttempts = Math.max(1, Math.min(8, Number(args.env?.VISION_LLM_MAX_ATTEMPTS || args.env?.GEMINI_MAX_ATTEMPTS || 5)));

  const parseJsonLenient = (raw: string) => {
    const text = String(raw || '').trim();
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const normalizeQuotes = (s: string) =>
      s
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\uFEFF/g, '');
    const stripJsonComments = (s: string) =>
      s
        // /* ... */ comments
        .replace(/\/\*[\s\S]*?\*\//g, '')
        // // ... comments
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    const stripTrailingCommas = (s: string) => {
      let out = s;
      for (let i = 0; i < 8; i++) {
        const next = out.replace(/,\s*([}\]])/g, '$1');
        if (next === out) return out;
        out = next;
      }
      return out;
    };
    const repairJsonCandidate = (s: string) => stripTrailingCommas(stripJsonComments(normalizeQuotes(s))).trim();
    const extractFirstJsonObject = (input: string) => {
      const start = input.indexOf('{');
      if (start < 0) return null;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let i = start; i < input.length; i++) {
        const ch = input[i];
        if (inString) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === '\\\\') {
            escaped = true;
            continue;
          }
          if (ch === '\"') inString = false;
          continue;
        }
        if (ch === '\"') {
          inString = true;
          continue;
        }
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) return input.slice(start, i + 1);
        }
      }
      return null;
    };
    try {
      return JSON.parse(stripped);
    } catch {
      // Try common repairs (Gemini sometimes includes trailing commas or comments despite instructions).
      try {
        return JSON.parse(repairJsonCandidate(stripped));
      } catch {
        // fall through
      }
      const firstObj = extractFirstJsonObject(stripped);
      if (firstObj) {
        try {
          return JSON.parse(firstObj);
        } catch {
          try {
            return JSON.parse(repairJsonCandidate(firstObj));
          } catch {
            // fall through
          }
        }
      }
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = stripped.slice(start, end + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          try {
            return JSON.parse(repairJsonCandidate(candidate));
          } catch {
            // fall through
          }
        }
      }
      throw new Error(`Gemini: response was not valid JSON. Preview: ${stripped.slice(0, 240)}`);
    }
  };

  const geminiDispatcher = args.env ? getProxyDispatcher(url, args.env) : undefined;
  return withRetries(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const geminiInit: any = {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
            generationConfig: {
              temperature: args.temperature,
              maxOutputTokens: args.maxOutputTokens ?? 2048,
              responseMimeType: 'application/json',
              ...(args.responseSchema ? { responseSchema: args.responseSchema } : {}),
            },
          }),
        };
        if (geminiDispatcher) geminiInit.dispatcher = geminiDispatcher;
        const res = await fetch(url, geminiInit);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error(`Gemini HTTP ${res.status}${text ? `: ${text}` : ''}`);
          err.status = res.status;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(res.status));
          throw err;
        }
        const raw = (await res.json()) as any;
        const usage = extractGeminiUsage(raw);
        const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== 'string') {
          const err: any = new Error('Gemini: missing text response');
          err.retryable = true;
          throw err;
        }
        try {
          return { value: parseJsonLenient(text), usage, raw };
        } catch (e) {
          const err: any = e instanceof Error ? e : new Error(String(e));
          // Gemini occasionally returns truncated/non-JSON text; retry often fixes it.
          err.retryable = true;
          throw err;
        }
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `gemini.json:${args.model}`, maxAttempts },
  );
};

const callGeminiVisionJson = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  prompt: string;
  image: { mimeType: string; bytes: Buffer };
  env?: Record<string, string>;
  responseSchema?: any;
  baseUrl?: string;
}): Promise<{ value: any; usage?: TokenUsage; raw?: any }> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model, baseUrl: args.baseUrl });
  const maxAttempts = Math.max(1, Math.min(6, Number(args.env?.VISION_LLM_MAX_ATTEMPTS || args.env?.GEMINI_MAX_ATTEMPTS || 4)));
  const geminiDispatcher = args.env ? getProxyDispatcher(url, args.env) : undefined;

  const parseJsonLenient = (raw: string) => {
    const text = String(raw || '').trim();
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    const normalizeQuotes = (s: string) =>
      s
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/\uFEFF/g, '');
    const stripJsonComments = (s: string) =>
      s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '$1');
    const stripTrailingCommas = (s: string) => {
      let out = s;
      for (let i = 0; i < 8; i++) {
        const next = out.replace(/,\s*([}\]])/g, '$1');
        if (next === out) return out;
        out = next;
      }
      return out;
    };
    const repaired = stripTrailingCommas(stripJsonComments(normalizeQuotes(stripped))).trim();
    return JSON.parse(repaired);
  };

  const raw = await withRetries(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const init: any = {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: args.image.mimeType, data: args.image.bytes.toString('base64') } },
                  { text: args.prompt },
                ],
              },
            ],
            ...(args.responseSchema ? { generationConfig: { responseMimeType: 'application/json', responseSchema: args.responseSchema, temperature: args.temperature, maxOutputTokens: args.maxOutputTokens ?? 512 } } : {
              generationConfig: { temperature: args.temperature, maxOutputTokens: args.maxOutputTokens ?? 512 },
            }),
          }),
        };
        if (geminiDispatcher) init.dispatcher = geminiDispatcher;
        const res = await fetch(url, init);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error(`Gemini HTTP ${res.status}${text ? `: ${text}` : ''}`);
          err.status = res.status;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(res.status));
          throw err;
        }
        return (await res.json()) as any;
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `gemini.vision:${args.model}`, maxAttempts },
  );

  const usage = extractGeminiUsage(raw);
  const parts = raw?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  const text = list.find((p: any) => p && typeof p === 'object' && typeof p.text === 'string')?.text;
  if (typeof text !== 'string' || !text.trim()) {
    const preview = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
    throw new Error(`Gemini: missing text response. Preview: ${String(preview || JSON.stringify(raw)).slice(0, 240)}`);
  }
  try {
    const parsed = parseJsonLenient(text);
    return { value: parsed, usage, raw };
  } catch (e) {
    const err: any = e instanceof Error ? e : new Error(String(e));
    err.retryable = true;
    throw err;
  }
};

const callGeminiToolCall = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  prompt: string;
  env?: Record<string, string>;
  functionDeclarations: any[];
  allowedFunctionNames?: string[];
  baseUrl?: string;
}): Promise<{ name: string; args: any; raw: any; usage?: TokenUsage }> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model, baseUrl: args.baseUrl });
  const maxAttempts = Math.max(1, Math.min(8, Number(args.env?.VISION_LLM_MAX_ATTEMPTS || args.env?.GEMINI_MAX_ATTEMPTS || 5)));
  const geminiDispatcher = args.env ? getProxyDispatcher(url, args.env) : undefined;

  const res = await withRetries(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const geminiInit: any = {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
            tools: [{ functionDeclarations: args.functionDeclarations }],
            toolConfig: args.allowedFunctionNames?.length
              ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: args.allowedFunctionNames } }
              : { functionCallingConfig: { mode: 'ANY' } },
            generationConfig: {
              temperature: args.temperature,
              maxOutputTokens: args.maxOutputTokens ?? 2048,
            },
          }),
        };
        if (geminiDispatcher) geminiInit.dispatcher = geminiDispatcher;
        const res = await fetch(url, geminiInit);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error(`Gemini HTTP ${res.status}${text ? `: ${text}` : ''}`);
          err.status = res.status;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(res.status));
          throw err;
        }
        return res;
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `gemini.tool:${args.model}`, maxAttempts },
  );

  const raw = (await res.json()) as any;
  const usage = extractGeminiUsage(raw);
  const parts = raw?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  const fc = list.find((p: any) => p && typeof p === 'object' && (p.functionCall || p.function_call));
  const call = (fc?.functionCall || fc?.function_call) as any;
  if (!call?.name) {
    const preview = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
    throw new Error(`Gemini: missing functionCall. Preview: ${String(preview || JSON.stringify(raw)).slice(0, 240)}`);
  }
  return { name: String(call.name), args: call.args ?? {}, raw, usage };
};

const callGeminiStreamText = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  prompt: string;
  env?: Record<string, string>;
  onDelta: (delta: string) => void;
}): Promise<string> => {
  const url = buildGeminiStreamContentUrl({ env: args.env, model: args.model });
  const maxAttempts = Math.max(1, Math.min(3, Number(args.env?.VISION_LLM_MAX_ATTEMPTS || args.env?.GEMINI_MAX_ATTEMPTS || 2)));
  const geminiDispatcher = args.env ? getProxyDispatcher(url, args.env) : undefined;
  let full = '';

  const res = await withRetries(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const init: any = {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
            generationConfig: {
              temperature: args.temperature,
              maxOutputTokens: args.maxOutputTokens ?? 512,
            },
          }),
        };
        if (geminiDispatcher) init.dispatcher = geminiDispatcher;
        const res = await fetch(url, init);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error(`Gemini HTTP ${res.status}${text ? `: ${text}` : ''}`);
          err.status = res.status;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(res.status));
          throw err;
        }
        return res;
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `gemini.stream:${args.model}`, maxAttempts },
  );

  const reader = res.body?.getReader();
  if (!reader) return full;
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const payload = JSON.parse(raw);
        const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text) {
          full += text;
          args.onDelta(text);
        }
      } catch {
        // ignore parse errors
      }
    }
  }
  return full;
};

const callOpenAICompatibleJson = async (args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  prompt: string;
  env?: Record<string, string>;
}): Promise<{ value: any; usage?: TokenUsage; raw?: any }> => {
  const url = `${args.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const llmDispatcher = args.env ? getProxyDispatcher(url, args.env) : undefined;
  const data = await withRetries(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const llmInit: any = {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${args.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: args.model,
            temperature: args.temperature,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You must respond with a single valid JSON object. No markdown.' },
              { role: 'user', content: args.prompt },
            ],
          }),
        };
        if (llmDispatcher) llmInit.dispatcher = llmDispatcher;
        const res = await fetch(url, llmInit);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error(`LLM HTTP ${res.status}${text ? `: ${text}` : ''}`);
          err.status = res.status;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(res.status));
          throw err;
        }
        return (await res.json()) as any;
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `llm.json:${args.baseUrl}`, maxAttempts: 3 },
  );

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM: missing content');
  const usageRaw = data?.usage;
  let usage: TokenUsage | undefined;
  if (usageRaw && typeof usageRaw === 'object') {
    const promptTokens = Number((usageRaw as any).prompt_tokens);
    const outputTokens = Number((usageRaw as any).completion_tokens);
    const totalTokens = Number((usageRaw as any).total_tokens);
    const out: TokenUsage = {};
    if (Number.isFinite(promptTokens)) out.promptTokens = promptTokens;
    if (Number.isFinite(outputTokens)) out.outputTokens = outputTokens;
    if (Number.isFinite(totalTokens)) out.totalTokens = totalTokens;
    if (Object.keys(out).length) usage = out;
  }
  return { value: JSON.parse(content), usage, raw: data };
};

type ModelProvider = 'gemini';

const getProviderCandidates = (preferred: string, env: Record<string, string>): ModelProvider[] => {
  const all: ModelProvider[] = ['gemini'];
  const pref = all.includes(preferred as any) ? (preferred as ModelProvider) : null;
  const unique = [pref, ...all].filter(Boolean) as ModelProvider[];

  const hasKey = (p: ModelProvider) => {
    if (p === 'gemini') return Boolean(env.GEMINI_API_KEY);
    return false;
  };

  const seen = new Set<ModelProvider>();
  return unique.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return hasKey(p);
  });
};

const normalizeGeminiImageModel = (model: string) => {
  const m = String(model || '').trim();
  if (!m) return 'gemini-2.5-flash-image';
  // Product/UX alias: "Nano Banana" image generation.
  if (m === 'nano-banana') return 'gemini-2.5-flash-image';
  if (m === 'nano-banana-pro') return 'gemini-3-pro-image-preview';
  return m;
};

const summarizeStoryForPrompt = (story: any, selection?: any) => {
  if (!story || typeof story !== 'object') return null;
  const trim = (v: any, n: number) => String(v || '').slice(0, n);
  const safeArr = (v: any) => (Array.isArray(v) ? v : []);

  const locations = safeArr(story.locations).slice(0, 12).map((l: any) => ({
    id: String(l?.id || ''),
    name: trim(l?.name, 48),
    description: trim(l?.description, 90),
  }));

  const characters = safeArr(story.characters).slice(0, 12).map((c: any) => ({
    id: String(c?.id || ''),
    name: trim(c?.name, 48),
    description: trim(c?.description, 100),
    looks: safeArr(c?.looks)
      .slice(0, 4)
      .map((lk: any) => ({ id: String(lk?.id || ''), name: trim(lk?.name, 40), description: trim(lk?.description, 80) })),
  }));

  const sequences = safeArr(story.sequences).slice(0, 8).map((s: any) => ({
    id: String(s?.id || ''),
    title: trim(s?.title, 60),
    shots: safeArr(s?.shots)
      .slice(0, 8)
      .map((sh: any) => ({
        id: String(sh?.id || ''),
        sequence: Number(sh?.sequence || 0),
        locationId: String(sh?.locationId || ''),
        timeOfDay: trim(sh?.timeOfDay, 20),
        description: trim(sh?.description, 80),
      })),
  }));

  const selType = String(selection?.type || '');
  const selId = String(selection?.id || '');
  const selParentId = String(selection?.parentId || '');
  let selectedContext: any = undefined;
  if (selType === 'shot' && selId) {
    const seq = safeArr(story.sequences).find((s: any) => String(s?.id || '') === selParentId);
    const shot = safeArr(seq?.shots).find((sh: any) => String(sh?.id || '') === selId);
    selectedContext = shot
      ? {
          type: 'shot',
          sequenceId: String(seq?.id || ''),
          shot: {
            id: String(shot?.id || ''),
            locationId: String(shot?.locationId || ''),
            timeOfDay: trim(shot?.timeOfDay, 20),
            description: trim(shot?.description, 140),
          },
        }
      : undefined;
  } else if (selType === 'character' && selId) {
    const ch = safeArr(story.characters).find((c: any) => String(c?.id || '') === selId);
    selectedContext = ch
      ? {
          type: 'character',
          character: {
            id: String(ch?.id || ''),
            name: trim(ch?.name, 48),
            description: trim(ch?.description, 120),
            looks: safeArr(ch?.looks).slice(0, 8).map((lk: any) => ({ id: String(lk?.id || ''), name: trim(lk?.name, 40) })),
          },
        }
      : undefined;
  } else if (selType === 'location' && selId) {
    const loc = safeArr(story.locations).find((l: any) => String(l?.id || '') === selId);
    selectedContext = loc
      ? {
          type: 'location',
          location: {
            id: String(loc?.id || ''),
            name: trim(loc?.name, 48),
            description: trim(loc?.description, 120),
          },
        }
      : undefined;
  }

  return {
    id: String(story.id || ''),
    title: trim(story.title, 90),
    logline: trim(story.logline, 140),
    intent: trim(story.intent, 140),
    aspectRatio: String(story.aspectRatio || ''),
    counts: {
      locations: safeArr(story.locations).length,
      characters: safeArr(story.characters).length,
      sequences: safeArr(story.sequences).length,
    },
    selectedContext,
    locations,
    characters,
    sequences,
  };
};

const summarizeStoryForSpecialistPrompt = (summary: any, agent: string) => {
  if (!summary || typeof summary !== 'object') return summary;
  const base = {
    id: summary.id,
    title: summary.title,
    logline: summary.logline,
    intent: summary.intent,
    aspectRatio: summary.aspectRatio,
    counts: summary.counts,
    selectedContext: summary.selectedContext,
  };

  if (agent === 'script_writer') {
    return { ...base, characters: summary.characters, sequences: summary.sequences };
  }
  if (agent === 'casting_director') {
    return { ...base, characters: summary.characters };
  }
  if (agent === 'environment_director') {
    return { ...base, locations: summary.locations, sequences: summary.sequences };
  }
  if (agent === 'camera_art' || agent === 'editor') {
    return { ...base, locations: summary.locations, characters: summary.characters, sequences: summary.sequences };
  }
  return summary;
};

const callGeminiImage = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  prompt: string;
  aspectRatio?: string;
  references?: Array<{ mimeType: string; bytes: Buffer; label?: string }>;
  env?: Record<string, string>;
  baseUrl?: string;
}): Promise<{ mimeType: string; bytes: Buffer; raw?: any; usage?: TokenUsage }> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model, baseUrl: args.baseUrl });
  const maxAttempts = Math.max(1, Math.min(8, Number(args.env?.VISION_LLM_MAX_ATTEMPTS || args.env?.GEMINI_MAX_ATTEMPTS || 5)));

  const generationConfig: any = {
    temperature: args.temperature,
    responseModalities: ['IMAGE'],
  };
  if (args.aspectRatio) {
    generationConfig.imageConfig = { aspectRatio: String(args.aspectRatio) };
  }

  const inputParts: any[] = [];
  const refs = Array.isArray(args.references) ? args.references.slice(0, 6) : [];
  if (refs.length) {
    inputParts.push({
      text:
        'Use the following reference images strictly for identity (characters) and set continuity (environments). ' +
        'Do NOT change rendering style to match the reference photos; follow the STYLE/StyleGuide specified in the text prompt.',
    });
    for (const r of refs) {
      if (r.label) inputParts.push({ text: `Reference (${String(r.label).slice(0, 80)}):` });
      inputParts.push({ inlineData: { mimeType: r.mimeType, data: r.bytes.toString('base64') } });
    }
  }
  inputParts.push({ text: args.prompt });

  const imgInit: any = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: inputParts }],
      generationConfig,
    }),
  };
  const imgDispatcher = args.env ? getProxyDispatcher(url, args.env) : undefined;
  const raw = await withRetries(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const init: any = { ...imgInit, signal: controller.signal };
        if (imgDispatcher) init.dispatcher = imgDispatcher;
        const res = await fetch(url, init);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err: any = new Error(`Gemini Image HTTP ${res.status}${text ? `: ${text}` : ''}`);
          err.status = res.status;
          err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(res.status));
          throw err;
        }
        return (await res.json()) as any;
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `gemini.image:${args.model}`, maxAttempts },
  );
  const usage = extractGeminiUsage(raw);

  const parts = (raw?.candidates?.[0]?.content?.parts || []) as any[];
  const inline = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const inlineData = inline?.inlineData || inline?.inline_data;
  const mimeType = String(inlineData?.mimeType || inlineData?.mime_type || 'image/png');
  const b64 = inlineData?.data;
  if (typeof b64 !== 'string' || !b64) throw new Error('Gemini Image: missing inlineData');
  return { mimeType, bytes: Buffer.from(b64, 'base64'), raw, usage };
};

const agentApiPlugin = (env: Record<string, string>): Plugin => {
  // homework branch: always call Gemini directly.
  const geminiApiKey = String(env.GEMINI_API_KEY || '').trim();
  const geminiBaseUrl = resolveGeminiBaseUrl(env);

  type PipelineKind =
    | 'agent.scaffold'
    | 'agent.direct'
    | 'asset.video.generate'
    | 'asset.image.generate'
    | 'asset.image.describe'
    | 'asset.image.store';
  type PipelineTaskToken = {
    id: string;
    userId: string;
    kind: PipelineKind;
    enqueuedAt: number;
    startedAt: number;
    attempt: number;
  };
  type QueuedTask = {
    token: Omit<PipelineTaskToken, 'startedAt' | 'attempt'>;
    start: (token: PipelineTaskToken) => void;
  };
  const pipelineConcurrencyPerUser = Math.max(1, Math.min(16, Number(env.VISION_PIPELINE_CONCURRENCY_PER_USER || 2)));
  const pipelineMaxQueuePerUser = Math.max(1, Math.min(200, Number(env.VISION_PIPELINE_MAX_QUEUE_PER_USER || 24)));
  const pipelineRateLimitPerMin = Math.max(1, Math.min(2000, Number(env.VISION_PIPELINE_RATE_LIMIT_PER_MINUTE || 120)));
  const pipelineMaxAttempts = Math.max(1, Math.min(5, Number(env.VISION_PIPELINE_MAX_ATTEMPTS || 2)));
  const pipelineAuditDir = path.resolve(process.cwd(), '.vision-audit');
  const pipelineStateDir = path.resolve(process.cwd(), '.vision-pipeline');
  const pipelineStateFile = path.join(pipelineStateDir, 'tasks.json');
  type PipelineTaskState = {
    id: string;
    route: string;
    kind: PipelineKind;
    userId: string;
    status: 'queued' | 'running' | 'success' | 'failed';
    enqueuedAt: number;
    startedAt?: number;
    endedAt?: number;
    attempts: number;
    statusCode?: number;
    error?: string;
    waitMs?: number;
    durationMs?: number;
    result?: any;
  };
  const pipelineTaskStateById = new Map<string, PipelineTaskState>();
  const pipelineTaskStateOrder: string[] = [];
  const pipelineTaskStateLimit = Math.max(200, Math.min(10_000, Number(env.VISION_PIPELINE_TASK_HISTORY_LIMIT || 2000)));
  let pipelineStateFlushTimer: any = null;
  const pipelineQueueByUser = new Map<string, QueuedTask[]>();
  const pipelineRunningByUser = new Map<string, number>();
  const pipelineRateWindows = new Map<string, { minute: number; count: number }>();

  const appendPipelineAudit = (event: Record<string, any>) => {
    try {
      fs.mkdirSync(pipelineAuditDir, { recursive: true });
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      const date = `${yyyy}-${mm}-${dd}`;
      const line = `${JSON.stringify({ ts: Date.now(), ...event })}\n`;
      fs.appendFileSync(path.join(pipelineAuditDir, `${date}.jsonl`), line);
    } catch {
      // ignore audit errors
    }
  };

  const scheduleFlushPipelineTaskState = () => {
    if (pipelineStateFlushTimer) return;
    pipelineStateFlushTimer = setTimeout(() => {
      pipelineStateFlushTimer = null;
      try {
        fs.mkdirSync(pipelineStateDir, { recursive: true });
        const tasks = pipelineTaskStateOrder
          .map((id) => pipelineTaskStateById.get(id))
          .filter(Boolean);
        fs.writeFileSync(pipelineStateFile, JSON.stringify({ updatedAt: Date.now(), tasks }, null, 2));
      } catch {
        // ignore persistence errors
      }
    }, 250);
  };

  const upsertPipelineTaskState = (task: PipelineTaskState) => {
    if (!pipelineTaskStateById.has(task.id)) pipelineTaskStateOrder.unshift(task.id);
    pipelineTaskStateById.set(task.id, task);
    while (pipelineTaskStateOrder.length > pipelineTaskStateLimit) {
      const id = pipelineTaskStateOrder.pop();
      if (id) pipelineTaskStateById.delete(id);
    }
    scheduleFlushPipelineTaskState();
  };

  const loadPipelineTaskState = () => {
    try {
      const raw = fs.readFileSync(pipelineStateFile, 'utf-8');
      const parsed = JSON.parse(raw) as { tasks?: PipelineTaskState[] };
      const items = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      for (const t of items.slice(0, pipelineTaskStateLimit)) {
        if (!t || typeof t !== 'object' || !t.id) continue;
        const recovered: PipelineTaskState =
          t.status === 'running'
            ? {
                ...t,
                status: 'failed',
                endedAt: Date.now(),
                error: t.error || 'Recovered after process restart',
              }
            : t;
        pipelineTaskStateById.set(recovered.id, recovered);
        pipelineTaskStateOrder.push(recovered.id);
      }
    } catch {
      // ignore missing/corrupt state file
    }
  };
  loadPipelineTaskState();

  const takePipelineRateToken = (userId: string, kind: PipelineKind) => {
    const minute = Math.floor(Date.now() / 60_000);
    const key = `${userId}|${kind}`;
    const prev = pipelineRateWindows.get(key);
    if (!prev || prev.minute !== minute) {
      pipelineRateWindows.set(key, { minute, count: 1 });
      return { allowed: true, remaining: pipelineRateLimitPerMin - 1 };
    }
    if (prev.count >= pipelineRateLimitPerMin) {
      return { allowed: false, remaining: 0 };
    }
    prev.count += 1;
    return { allowed: true, remaining: pipelineRateLimitPerMin - prev.count };
  };

  const pumpPipelineQueueForUser = (userId: string) => {
    const queue = pipelineQueueByUser.get(userId) || [];
    let running = Number(pipelineRunningByUser.get(userId) || 0);
    while (running < pipelineConcurrencyPerUser && queue.length > 0) {
      const task = queue.shift()!;
      running += 1;
      pipelineRunningByUser.set(userId, running);
      task.start({
        ...task.token,
        startedAt: Date.now(),
        attempt: 1,
      });
    }
    pipelineQueueByUser.set(userId, queue);
  };

  const enqueuePipelineTask = (
    req: any,
    res: any,
    args: { kind: PipelineKind; route: string },
  ): { tokenBase: Omit<PipelineTaskToken, 'startedAt' | 'attempt'>; started: Promise<PipelineTaskToken> } | null => {
    const userId = getRequestUserId(req);
    const rate = takePipelineRateToken(userId, args.kind);
    if (!rate.allowed) {
      appendPipelineAudit({
        type: 'pipeline.rate_limited',
        route: args.route,
        kind: args.kind,
        userId,
      });
      sendJson(res, 429, {
        ok: false,
        error: 'Rate limit exceeded',
        code: 'PIPELINE_RATE_LIMITED',
        retryAfterSeconds: 60,
      });
      return null;
    }

    const tokenBase = {
      id: `pipe-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      userId,
      kind: args.kind,
      enqueuedAt: Date.now(),
    };
    upsertPipelineTaskState({
      id: tokenBase.id,
      route: args.route,
      kind: args.kind,
      userId,
      status: 'queued',
      enqueuedAt: tokenBase.enqueuedAt,
      attempts: 0,
    });
    try {
      if (res && typeof res.setHeader === 'function') res.setHeader('x-vision-task-id', tokenBase.id);
    } catch {
      // ignore header errors
    }
    const queue = pipelineQueueByUser.get(userId) || [];
    if (queue.length >= pipelineMaxQueuePerUser) {
      appendPipelineAudit({
        type: 'pipeline.queue_rejected',
        route: args.route,
        kind: args.kind,
        userId,
        queueLength: queue.length,
      });
      sendJson(res, 503, {
        ok: false,
        error: 'Pipeline queue is full',
        code: 'PIPELINE_QUEUE_FULL',
        maxQueuePerUser: pipelineMaxQueuePerUser,
      });
      return null;
    }

    appendPipelineAudit({
      type: 'pipeline.queued',
      route: args.route,
      kind: args.kind,
      userId,
      queueLength: queue.length + 1,
      running: Number(pipelineRunningByUser.get(userId) || 0),
    });

    const started = new Promise<PipelineTaskToken>((resolve) => {
      queue.push({
        token: tokenBase,
        start: resolve,
      });
    });
    pipelineQueueByUser.set(userId, queue);
    pumpPipelineQueueForUser(userId);
    return { tokenBase, started };
  };

  const markPipelineTaskStarted = (startedToken: PipelineTaskToken, args: { kind: PipelineKind; route: string }) => {
    const userId = startedToken.userId;
    const prev = pipelineTaskStateById.get(startedToken.id);
    upsertPipelineTaskState({
      ...(prev as PipelineTaskState),
      id: startedToken.id,
      route: args.route,
      kind: args.kind,
      userId,
      status: 'running',
      enqueuedAt: startedToken.enqueuedAt,
      startedAt: startedToken.startedAt,
      attempts: Math.max(1, Number(prev?.attempts || 0)),
      waitMs: startedToken.startedAt - startedToken.enqueuedAt,
    });
    appendPipelineAudit({
      type: 'pipeline.started',
      route: args.route,
      kind: args.kind,
      userId,
      taskId: startedToken.id,
      waitMs: startedToken.startedAt - startedToken.enqueuedAt,
      queueLength: (pipelineQueueByUser.get(userId) || []).length,
      running: Number(pipelineRunningByUser.get(userId) || 0),
    });
  };

  const beginPipelineTask = async (
    req: any,
    res: any,
    args: { kind: PipelineKind; route: string },
  ): Promise<PipelineTaskToken | null> => {
    const enqueued = enqueuePipelineTask(req, res, args);
    if (!enqueued) return null;
    const startedToken = await enqueued.started;
    markPipelineTaskStarted(startedToken, args);
    return startedToken;
  };

  const endPipelineTask = (token: PipelineTaskToken, args: { route: string; ok: boolean; statusCode?: number; error?: any }) => {
    const running = Math.max(0, Number(pipelineRunningByUser.get(token.userId) || 0) - 1);
    pipelineRunningByUser.set(token.userId, running);
    appendPipelineAudit({
      type: args.ok ? 'pipeline.finished' : 'pipeline.failed',
      route: args.route,
      kind: token.kind,
      userId: token.userId,
      taskId: token.id,
      durationMs: Date.now() - token.startedAt,
      statusCode: args.statusCode || 0,
      error: args.error ? formatFetchError(args.error) : undefined,
    });
    const prev = pipelineTaskStateById.get(token.id);
    upsertPipelineTaskState({
      ...(prev as PipelineTaskState),
      id: token.id,
      route: args.route,
      kind: token.kind,
      userId: token.userId,
      status: args.ok ? 'success' : 'failed',
      enqueuedAt: Number(prev?.enqueuedAt || token.enqueuedAt || Date.now()),
      startedAt: Number(prev?.startedAt || token.startedAt || Date.now()),
      endedAt: Date.now(),
      attempts: Math.max(1, Number(prev?.attempts || token.attempt || 1)),
      statusCode: Number(args.statusCode || 0) || undefined,
      error: args.error ? formatFetchError(args.error) : undefined,
      waitMs: prev?.waitMs,
      durationMs: Date.now() - Number(prev?.startedAt || token.startedAt || Date.now()),
    });
    pumpPipelineQueueForUser(token.userId);
  };

  const withPipelineTask = async <T,>(
    req: any,
    res: any,
    args: { kind: PipelineKind; route: string; run: () => Promise<T> },
  ) => {
    const token = await beginPipelineTask(req, res, { kind: args.kind, route: args.route });
    if (!token) return null;
    let lastErr: any = null;
    try {
      for (let attempt = 1; attempt <= pipelineMaxAttempts; attempt++) {
        const prev = pipelineTaskStateById.get(token.id);
        if (prev) {
          upsertPipelineTaskState({
            ...prev,
            attempts: Math.max(Number(prev.attempts || 0), attempt),
            status: 'running',
          });
        }
        try {
          const out = await args.run();
          endPipelineTask(token, { route: args.route, ok: true, statusCode: Number(res?.statusCode || 200) });
          return out;
        } catch (e: any) {
          lastErr = e;
          const shouldRetry = attempt < pipelineMaxAttempts && isRetryableNetworkError(e);
          if (!shouldRetry) throw e;
          await sleep(Math.min(3000, 300 * attempt + Math.floor(Math.random() * 150)));
        }
      }
      throw lastErr;
    } catch (e) {
      endPipelineTask(token, { route: args.route, ok: false, statusCode: Number(res?.statusCode || 500), error: e });
      if (!res?.headersSent && !res?.writableEnded) {
        sendJson(res, 502, {
          ok: false,
          error: formatFetchError(e),
          code: 'PIPELINE_TASK_FAILED',
          route: args.route,
          kind: args.kind,
        });
      }
      return null;
    }
  };

  const submitPipelineTask = <T,>(
    req: any,
    res: any,
    args: { kind: PipelineKind; route: string; run: () => Promise<T>; mapResult?: (out: T) => any },
  ): { taskId: string; statusUrl: string } | null => {
    const enqueued = enqueuePipelineTask(req, res, { kind: args.kind, route: args.route });
    if (!enqueued) return null;
    const taskId = enqueued.tokenBase.id;
    enqueued.started
      .then(async (token) => {
        markPipelineTaskStarted(token, { kind: args.kind, route: args.route });
        let lastErr: any = null;
        try {
          for (let attempt = 1; attempt <= pipelineMaxAttempts; attempt++) {
            const prev = pipelineTaskStateById.get(token.id);
            if (prev) {
              upsertPipelineTaskState({
                ...prev,
                attempts: Math.max(Number(prev.attempts || 0), attempt),
                status: 'running',
              });
            }
            try {
              const out = await args.run();
              const prevDone = pipelineTaskStateById.get(token.id);
              if (prevDone) {
                upsertPipelineTaskState({
                  ...prevDone,
                  result: args.mapResult ? args.mapResult(out) : undefined,
                });
              }
              endPipelineTask(token, { route: args.route, ok: true, statusCode: 200 });
              return;
            } catch (e: any) {
              lastErr = e;
              const shouldRetry = attempt < pipelineMaxAttempts && isRetryableNetworkError(e);
              if (!shouldRetry) throw e;
              await sleep(Math.min(3000, 300 * attempt + Math.floor(Math.random() * 150)));
            }
          }
          throw lastErr;
        } catch (e: any) {
          endPipelineTask(token, { route: args.route, ok: false, statusCode: Number(e?.status || 500) || 500, error: e });
        }
      })
      .catch((e) => {
        const prev = pipelineTaskStateById.get(taskId);
        if (prev) {
          upsertPipelineTaskState({
            ...prev,
            status: 'failed',
            endedAt: Date.now(),
            error: formatFetchError(e),
          });
        }
      });
    return { taskId, statusUrl: `/api/pipeline/tasks/${encodeURIComponent(taskId)}` };
  };

	  const applyRoutes = (middlewares: any) => {
      middlewares.use('/api/pipeline/metrics', async (req: any, res: any, next: any) => {
        if (req.method !== 'GET') return next();
        const queueByUser = Array.from(pipelineQueueByUser.entries()).map(([userId, q]) => ({ userId, queued: q.length }));
        const runningByUser = Array.from(pipelineRunningByUser.entries()).map(([userId, running]) => ({ userId, running }));
        return sendJson(res, 200, {
          ok: true,
          limits: {
            concurrencyPerUser: pipelineConcurrencyPerUser,
            maxQueuePerUser: pipelineMaxQueuePerUser,
            rateLimitPerMinute: pipelineRateLimitPerMin,
            maxAttempts: pipelineMaxAttempts,
          },
          queueByUser,
          runningByUser,
        });
      });

      middlewares.use('/api/pipeline/tasks', async (req: any, res: any, next: any) => {
        if (req.method !== 'GET') return next();
        const full = String(req?.url || '');
        const [pathnameRaw, queryRaw] = full.split('?');
        const pathname = String(pathnameRaw || '');
        const base = '/api/pipeline/tasks';
        const query = new URLSearchParams(String(queryRaw || ''));
        if (pathname === base || pathname === `${base}/`) {
          const limit = Math.max(1, Math.min(500, Number(query.get('limit') || 100)));
          const userId = normalizeUserId(query.get('userId') || '');
          const status = String(query.get('status') || '').trim();
          const out = pipelineTaskStateOrder
            .map((id) => pipelineTaskStateById.get(id))
            .filter(Boolean)
            .filter((t) => (userId ? t!.userId === userId : true))
            .filter((t) => (status ? t!.status === status : true))
            .slice(0, limit);
          return sendJson(res, 200, { ok: true, count: out.length, tasks: out as any });
        }
        if (pathname.startsWith(`${base}/`)) {
          const id = decodeURIComponent(pathname.slice(`${base}/`.length));
          const task = pipelineTaskStateById.get(id);
          if (!task) return sendJson(res, 404, { ok: false, error: 'Task not found' });
          return sendJson(res, 200, { ok: true, task });
        }
        return next();
      });

	    middlewares.use('/__generated__', async (req: any, res: any, next: any) => {
	      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
	      const pathname = String(req?.url || '').split('?')[0];
        const userId = getRequestUserId(req);
	      const fileCandidates = safeGeneratedAssetPaths(pathname, userId);
	      if (!fileCandidates.length) {
	        res.statusCode = 400;
	        return res.end('Bad path');
	      }
	      try {
          let filePath = '';
          let stat: fs.Stats | null = null;
          for (const p of fileCandidates) {
            try {
              const s = fs.statSync(p);
              if (s.isFile()) {
                filePath = p;
                stat = s;
                break;
              }
            } catch {
              // try next
            }
          }
          if (!filePath || !stat) {
            res.statusCode = 404;
            return res.end('Not found');
          }
	        const size = Number(stat.size || 0);
	        const contentType = mimeByExt(path.extname(filePath));
	        res.setHeader('content-type', contentType);
	        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
	        res.setHeader('accept-ranges', 'bytes');

	        // HTML5 video commonly requests `Range` (even for metadata). If we ignore it,
	        // some browsers will treat the response as a load failure.
	        const range = String(req.headers?.range || '').trim();
	        if (req.method === 'GET' && range.startsWith('bytes=')) {
	          const m = /^bytes=(\d*)-(\d*)$/i.exec(range);
	          if (!m) {
	            res.statusCode = 416;
	            res.setHeader('content-range', `bytes */${size}`);
	            return res.end();
	          }
	          const startRaw = m[1] ? Number(m[1]) : 0;
	          const endRaw = m[2] ? Number(m[2]) : size - 1;
	          const start = Number.isFinite(startRaw) ? startRaw : 0;
	          const end = Number.isFinite(endRaw) ? endRaw : size - 1;
	          if (start < 0 || end < start || start >= size) {
	            res.statusCode = 416;
	            res.setHeader('content-range', `bytes */${size}`);
	            return res.end();
	          }
	          res.statusCode = 206;
	          res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
	          res.setHeader('content-length', String(end - start + 1));
	          return fs.createReadStream(filePath, { start, end }).pipe(res);
	        }

	        res.statusCode = 200;
	        res.setHeader('content-length', String(size));
	        if (req.method === 'HEAD') return res.end();
	        return fs.createReadStream(filePath).pipe(res);
	      } catch {
	        res.statusCode = 404;
	        return res.end('Not found');
	      }
	    });

      middlewares.use('/api/local-assets/delete', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();
        const userId = getRequestUserId(req);
        const body = await readJsonBody(req);
        const rawUrls = Array.isArray(body?.urls) ? body.urls : [];
        const urls = Array.from(
          new Set(
            rawUrls
              .map((u: any) => String(u || '').trim())
              .filter((u: string) => Boolean(u)),
          ),
        ).slice(0, 2000);

        let deleted = 0;
        let missing = 0;
        let rejected = 0;
        const errors: string[] = [];

        for (const u of urls) {
          const candidates = safeGeneratedAssetPaths(u, userId);
          if (!candidates.length) {
            rejected += 1;
            continue;
          }
          let removed = false;
          let missingCount = 0;
          for (const p of candidates) {
            try {
              await fs.promises.unlink(p);
              deleted += 1;
              removed = true;
              break;
            } catch (e: any) {
              const code = String(e?.code || '');
              if (code === 'ENOENT') {
                missingCount += 1;
                continue;
              }
              errors.push(`${path.basename(p)}:${code || 'ERR'}`);
              break;
            }
          }
          if (!removed && missingCount === candidates.length) {
            missing += 1;
          }
        }

        return sendJson(res, 200, {
          ok: true,
          requested: urls.length,
          deleted,
          missing,
          rejected,
          errors: errors.slice(0, 20),
        });
      });

	    middlewares.use('/api/asset/video/generate', async (req: any, res: any, next: any) => {
	      if (req.method !== 'POST') return next();
        const userId = getRequestUserId(req);
	      const body = await readJsonBody(req);
        const reqUrl = new URL(String(req?.url || '/api/asset/video/generate'), 'http://127.0.0.1');
        const bypassPipeline = String(reqUrl.searchParams.get('bypassPipeline') || '').trim() === '1';
        const preferHeader = String(req?.headers?.prefer || req?.headers?.Prefer || '').toLowerCase();
        const asyncRequested = !bypassPipeline && (Boolean(body?.async) || preferHeader.includes('respond-async'));

      const runVideoGenerate = async () => {
      const prompt = String(body?.prompt || '').trim();
      const promptSpec = body?.promptSpec && typeof body.promptSpec === 'object' ? body.promptSpec : null;
      const imageUrl = String(body?.imageUrl || '').trim();
      const referenceImageUrls = (Array.isArray(body?.referenceImageUrls) ? body.referenceImageUrls : [])
        .map((u: any) => String(u || '').trim())
        .filter(Boolean)
        .slice(0, 12);
      const durationRaw = Number(body?.durationSeconds ?? 6);
      const durationSeconds = durationRaw === 4 || durationRaw === 6 || durationRaw === 8 ? durationRaw : 6;
      const aspectRatio = String(body?.aspectRatio || '16:9').trim() === '9:16' ? '9:16' : '16:9';
      const resolution = String(body?.resolution || '720p').trim();
      const generateAudio = Boolean(body?.generateAudio ?? true);
      const requestedModel = String(body?.model || '').trim();
      const preferredModel = String(requestedModel || env.GEMINI_VIDEO_MODEL || 'veo-3.1-fast-generate-preview').trim();
      const fallbackModel = String(env.GEMINI_VIDEO_FALLBACK_MODEL || 'veo-3.1-generate-preview').trim();
      const modelCandidates = Array.from(new Set([preferredModel, fallbackModel].map((m) => String(m || '').trim()).filter(Boolean)));

      if (!prompt) return sendJson(res, 400, { ok: false, error: 'Missing prompt' });
      if (!imageUrl) return sendJson(res, 400, { ok: false, error: 'Missing imageUrl' });
      if (resolution !== '720p') return sendJson(res, 400, { ok: false, error: 'Only 720p is supported' });
      // Veo must call direct Gemini. Do NOT route through Compass gateway.
      if (!geminiApiKey) return sendJson(res, 400, { ok: false, error: 'Missing GEMINI_API_KEY' });

      const composeVeoImageToVideoPrompt = (basePrompt: string, spec: any, refUrls: string[]): string => {
        const core = String(basePrompt || '').trim();
        const hasLabel = (labels: string[]) => {
          if (!core) return false;
          return labels.some((label) => new RegExp(`(^|\\n)\\s*${label}\\s*:`, 'i').test(core));
        };
        const pushIfMissing = (labels: string[], line: string) => {
          if (!line || hasLabel(labels)) return;
          parts.push(line);
        };
        const parts: string[] = [];
        parts.push('Image-to-video: keep subject/environment from the source frame. Focus on detailed motion and performance beats.');
        if (core) parts.push(`Core direction: ${core}`);
        pushIfMissing(['current frame', 'frame description'], spec?.frameDescription ? `Current frame: ${String(spec.frameDescription).trim()}` : '');
        pushIfMissing(['story context', 'narrative context'], spec?.storyContext ? `Story context: ${String(spec.storyContext).trim()}` : '');
        pushIfMissing(['scene'], spec?.shotDescription ? `Scene: ${String(spec.shotDescription).trim()}` : '');
        pushIfMissing(['acting direction', 'performance direction'], spec?.actingDirection ? `Acting direction: ${String(spec.actingDirection).trim()}` : '');
        pushIfMissing(['action'], spec?.action ? `Action: ${String(spec.action).trim()}` : '');
        pushIfMissing(['dialogue'], Array.isArray(spec?.dialogue) && spec.dialogue.length ? `Dialogue: ${spec.dialogue.map((x: any) => `"${String(x || '').trim()}"`).join(' ')}` : '');
        pushIfMissing(['director notes'], spec?.directorNotes ? `Director notes: ${String(spec.directorNotes).trim()}` : '');
        pushIfMissing(['cameraman', 'camera plan'], spec?.cameraman ? `Cameraman plan: ${String(spec.cameraman).trim()}` : '');
        pushIfMissing(['camera motion', 'camera'], spec?.camera ? `Camera motion: ${String(spec.camera).trim()}` : '');
        pushIfMissing(['composition'], spec?.composition ? `Composition: ${String(spec.composition).trim()}` : '');
        pushIfMissing(['lens/look', 'lens'], spec?.lensEffect ? `Lens behavior: ${String(spec.lensEffect).trim()}` : '');
        pushIfMissing(['lighting and mood', 'lighting', 'mood'], spec?.mood ? `Lighting continuity: ${String(spec.mood).trim()}` : '');
        parts.push('Look lock: keep the source image style and identity; do not introduce a new style treatment.');
        pushIfMissing(['audio intent', 'audio'], spec?.audio ? `Audio intent: ${String(spec.audio).trim()}` : '');
        if (Array.isArray(spec?.referenceFrames) && spec.referenceFrames.length) {
          const frameSummary = spec.referenceFrames
            .slice(0, 8)
            .map((f: any, i: number) => {
              const idx = Number.isFinite(Number(f?.panelIndex)) ? `#${Number(f.panelIndex) + 1}` : `#${i + 1}`;
              const d = String(f?.description || '').trim().slice(0, 180);
              return d ? `${idx} ${d}` : idx;
            })
            .join(' | ');
          pushIfMissing(['reference frames', 'reference bundle'], frameSummary ? `Reference frame bundle: ${frameSummary}` : '');
        }
        if (refUrls.length > 1) {
          parts.push(
            `Additional references: ${refUrls.length} images provided as context. ` +
              'Current Gemini path uses the first frame as source image; keep continuity with all provided references.',
          );
        }
        const constraints = Array.isArray(spec?.constraints) ? spec.constraints : [];
        pushIfMissing(['constraints'], constraints.length ? `Constraints: ${constraints.map((x: any) => String(x).trim()).filter(Boolean).join(' ')}` : '');
        parts.push('Motion staging: one continuous shot, explicit cause->action->reaction per beat, readable transitions, no vague motion words.');
        if (!/motion quality\s*:/i.test(core)) {
          parts.push('Motion quality: natural physics, coherent anatomy, stable geometry, no jitter/flicker.');
        }
        if (!/no text overlays|no subtitles|no watermark|no logos?/i.test(core)) {
          parts.push('No text overlays, subtitles, logos, or watermark.');
        }
        return parts.join('\n').slice(0, 8000);
      };

      const promptUsed = composeVeoImageToVideoPrompt(prompt, promptSpec, referenceImageUrls);

      const loadImage = async (url: string): Promise<{ mimeType: string; bytes: Buffer } | null> => {
        const u = String(url || '').trim();
        if (!u) return null;

        if (u.startsWith('/__generated__/')) {
          const clean = u.split('?')[0].split('#')[0];
          const fileCandidates = safeGeneratedAssetPaths(clean, userId);
          for (const filePath of fileCandidates) {
            try {
              const bytes = await fs.promises.readFile(filePath);
              return { mimeType: mimeByExt(path.extname(filePath)), bytes };
            } catch {
              // try next candidate
            }
          }
          return null;
        }

        if (u.startsWith('data:image/')) {
          const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(u);
          if (!match) return null;
          return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
        }

        if (u.startsWith('http://') || u.startsWith('https://')) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 20_000);
          try {
            const init: any = { signal: controller.signal };
            const dispatcher = getProxyDispatcher(u, env);
            if (dispatcher) init.dispatcher = dispatcher;
            const resp = await fetch(u, init);
            if (!resp.ok) return null;
            const ct = String(resp.headers.get('content-type') || '');
            if (!ct.startsWith('image/')) return null;
            const bytes = Buffer.from(await resp.arrayBuffer());
            if (!bytes.length) return null;
            return { mimeType: ct.split(';')[0] || 'image/png', bytes };
          } finally {
            clearTimeout(timeout);
          }
        }

        return null;
      };

      const readVideoBytes = async (rawUrl: string): Promise<{ bytes: Buffer; mimeType: string } | null> => {
        const candidates = new Set<string>();
        const direct = String(rawUrl || '').trim();
        if (direct) candidates.add(direct);
        if (direct.startsWith('/')) candidates.add(`${resolveGeminiBaseUrl(env)}${direct}`);
        const queue = Array.from(candidates);
        for (let i = 0; i < queue.length; i++) {
          const c = queue[i];
          const withKey = c.includes('key=') ? c : `${c}${c.includes('?') ? '&' : '?'}key=${encodeURIComponent(geminiApiKey)}`;
          for (const u of [c, withKey]) {
            try {
              const resp = await withRetries(
                async () => {
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 90_000);
                  try {
                    const init: any = { signal: controller.signal, headers: { 'x-goog-api-key': geminiApiKey } };
                    const dispatcher = getProxyDispatcher(u, env);
                    const runVideoFetch = async (useDispatcher: boolean) => {
                      const reqInit: any = { ...init };
                      if (useDispatcher && dispatcher) reqInit.dispatcher = dispatcher;
                      return fetch(u, reqInit);
                    };
                    let out: any;
                    try {
                      out = await runVideoFetch(true);
                    } catch (e: any) {
                      if (dispatcher && isRetryableNetworkError(e)) {
                        out = await runVideoFetch(false);
                      } else {
                        throw e;
                      }
                    }
                    if (!out.ok) {
                      const text = await out.text().catch(() => '');
                      const err: any = new Error(`Gemini video fetch HTTP ${out.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
                      err.status = out.status;
                      err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(out.status));
                      throw err;
                    }
                    return out;
                  } finally {
                    clearTimeout(timeout);
                  }
                },
                {
                  label: `gemini.video.download:${u.slice(0, 96)}`,
                  maxAttempts: Math.max(1, Number(env.GEMINI_VIDEO_DOWNLOAD_ATTEMPTS || 3)),
                  baseDelayMs: 400,
                  maxDelayMs: 3000,
                },
              );
              const ct = String(resp.headers.get('content-type') || '').toLowerCase();
              if (ct.startsWith('video/')) {
                const bytes = Buffer.from(await resp.arrayBuffer());
                if (!bytes.length) continue;
                return { bytes, mimeType: ct.split(';')[0] || 'video/mp4' };
              }
              if (ct.includes('application/json')) {
                const data = (await resp.json().catch(() => null)) as any;
                const nextUri = String(data?.video?.uri || data?.downloadUri || data?.uri || '').trim();
                if (nextUri && !candidates.has(nextUri)) {
                  candidates.add(nextUri);
                  queue.push(nextUri);
                }
              }
            } catch {
              // ignore and try next
            }
          }
        }
        return null;
      };

      const collectStringCandidates = (input: any, maxNodes = 1200): string[] => {
        const out: string[] = [];
        const seen = new Set<any>();
        const stack: any[] = [input];
        let steps = 0;
        while (stack.length && steps < maxNodes) {
          const cur = stack.pop();
          steps++;
          if (!cur || typeof cur !== 'object') continue;
          if (seen.has(cur)) continue;
          seen.add(cur);
          for (const [k, v] of Object.entries(cur)) {
            if (typeof v === 'string') {
              const key = String(k || '').toLowerCase();
              const val = String(v || '').trim();
              if (!val) continue;
              if (
                key.includes('uri') ||
                key.includes('url') ||
                key.includes('file') ||
                val.startsWith('http://') ||
                val.startsWith('https://') ||
                val.startsWith('/') ||
                val.startsWith('files/') ||
                val.startsWith('gs://')
              ) {
                out.push(val);
              }
            } else if (v && typeof v === 'object') {
              stack.push(v);
            }
          }
        }
        return Array.from(new Set(out));
      };

      const fileNameToCandidateUrls = (name: string): string[] => {
        const n = String(name || '').trim().replace(/^\/+/, '');
        if (!n) return [];
        const base = resolveGeminiBaseUrl(env);
        if (!/^files\//.test(n)) return [];
        return Array.from(
          new Set([
            `${base}/${n}`,
            `${base}/${n}?alt=media`,
            `${base}/${n}:download`,
            `${base}/${n}:download?alt=media`,
          ]),
        );
      };

      const extractFilesPath = (value: string): string => {
        const v = String(value || '').trim();
        if (!v) return '';
        if (/^files\//.test(v)) return v;
        const idx = v.indexOf('/files/');
        if (idx >= 0) return v.slice(idx + 1);
        const idx2 = v.indexOf('files/');
        if (idx2 >= 0) return v.slice(idx2);
        return '';
      };

      const collectVideoNodes = (op: any): any[] => {
        const r = op?.response;
        const g = r?.generateVideoResponse;
        const out: any[] = [];
        const pushAny = (v: any) => {
          if (!v) return;
          if (Array.isArray(v)) out.push(...v.filter(Boolean));
          else out.push(v);
        };
        pushAny(g?.generatedSamples);
        pushAny(g?.generatedVideos);
        pushAny(g?.videos);
        pushAny(g?.samples);
        pushAny(g?.outputs);
        pushAny(g?.generatedVideo);
        pushAny(g?.video);
        pushAny(g?.sample);
        pushAny(g?.output);
        pushAny(r?.generatedSamples);
        pushAny(r?.generatedVideos);
        pushAny(r?.videos);
        pushAny(r?.samples);
        pushAny(r?.outputs);
        pushAny(r?.video);
        pushAny(op?.generatedSamples);
        pushAny(op?.generatedVideos);
        pushAny(op?.videos);
        pushAny(op?.video);
        return out;
      };

      const extractVideoUris = (node: any): string[] => {
        const candidates = [
          node?.video?.uri,
          node?.video?.url,
          node?.video?.downloadUri,
          node?.video?.signedUri,
          node?.video?.mediaLink,
          node?.video?.file?.uri,
          node?.video?.fileUri,
          node?.video?.fileName,
          node?.uri,
          node?.url,
          node?.downloadUri,
          node?.signedUri,
          node?.mediaLink,
          node?.file?.uri,
          node?.fileUri,
          node?.fileName,
          node?.name,
        ]
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        return Array.from(new Set(candidates));
      };

      try {
        const loaded = await loadImage(imageUrl);
        if (!loaded) return sendJson(res, 400, { ok: false, error: 'Unable to load source image' });

        ensureGeneratedDir(userId);
        let predictRes: any = null;
        let model = modelCandidates[0];
        let predictParamsUsed: Record<string, any> = {};
        const modelErrors: Array<{ model: string; error: string; removedParams?: string[] }> = [];
        const detectUnsupportedParam = (err: any): string | '' => {
          const text = formatFetchError(err);
          const m1 = /`([^`]+)`\s+isn'?t supported/i.exec(text);
          if (m1?.[1]) return String(m1[1]).trim();
          const m2 = /\b(enhancePrompt|generateAudio|numberOfVideos|resolution|durationSeconds|aspectRatio)\b[^.\n]*isn'?t supported/i.exec(text);
          if (m2?.[1]) return String(m2[1]).trim();
          return '';
        };
        for (const candidate of modelCandidates) {
          model = candidate;
          const predictUrl = `${buildGeminiPredictLongRunningUrl({ env, model: candidate, baseUrl: geminiBaseUrl })}?key=${encodeURIComponent(geminiApiKey)}`;
          const predictDispatcher = getProxyDispatcher(predictUrl, env);
          const baseParams: Record<string, any> = {
            aspectRatio,
            durationSeconds,
            resolution,
            enhancePrompt: true,
            numberOfVideos: 1,
          };
          if (generateAudio) baseParams.generateAudio = true;
          const removedParams: string[] = [];
          try {
            let params = { ...baseParams };
            for (let i = 0; i < 5; i++) {
              try {
                predictRes = await withRetries(
                  async () => {
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 120_000);
                    try {
                      const init: any = {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          instances: [
                            {
                              prompt: promptUsed,
                              image: {
                                bytesBase64Encoded: loaded.bytes.toString('base64'),
                                mimeType: loaded.mimeType || 'image/png',
                              },
                            },
                          ],
                          parameters: params,
                        }),
                        signal: controller.signal,
                      };
                      const runPredictFetch = async (useDispatcher: boolean) => {
                        const reqInit: any = { ...init };
                        if (useDispatcher && predictDispatcher) reqInit.dispatcher = predictDispatcher;
                        return fetch(predictUrl, reqInit);
                      };
                      let out: any;
                      try {
                        out = await runPredictFetch(true);
                      } catch (e: any) {
                        if (predictDispatcher && isRetryableNetworkError(e)) {
                          out = await runPredictFetch(false);
                        } else {
                          throw e;
                        }
                      }
                      if (!out.ok) {
                        const text = await out.text().catch(() => '');
                        const err: any = new Error(`Gemini Video HTTP ${out.status}${text ? `: ${text}` : ''}`);
                        err.status = out.status;
                        err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(out.status));
                        throw err;
                      }
                      return (await out.json()) as any;
                    } finally {
                      clearTimeout(timeout);
                    }
                  },
                  { label: `gemini.video.predict:${candidate}`, maxAttempts: 4 },
                );
                predictParamsUsed = { ...params };
                break;
              } catch (e: any) {
                const unsupported = detectUnsupportedParam(e);
                const canDowngrade =
                  Number(e?.status || 0) === 400 &&
                  unsupported &&
                  Object.prototype.hasOwnProperty.call(params, unsupported);
                if (!canDowngrade) throw e;
                delete (params as any)[unsupported];
                removedParams.push(unsupported);
              }
            }
            if (predictRes) break;
          } catch (e: any) {
            modelErrors.push({ model: candidate, error: formatFetchError(e), removedParams });
          }
        }
        if (!predictRes) {
          throw new Error(`Gemini Video: all model candidates failed. ${modelErrors.map((x) => `${x.model}: ${x.error}`).join(' | ')}`);
        }

        const operationName = String(predictRes?.name || '').trim();
        if (!operationName) throw new Error('Gemini Video: missing operation name');

        const pollStart = Date.now();
        const pollTimeoutMs = Math.max(60_000, Number(env.GEMINI_VIDEO_TIMEOUT_MS || 10 * 60_000));
        const pollIntervalMs = Math.max(1500, Number(env.GEMINI_VIDEO_POLL_INTERVAL_MS || 4000));
        let opData: any = predictRes;
        while (!opData?.done) {
          if (Date.now() - pollStart > pollTimeoutMs) {
            throw new Error(`Gemini Video timeout after ${Math.round((Date.now() - pollStart) / 1000)}s`);
          }
          await sleep(pollIntervalMs);
          const opUrl = `${buildGeminiOperationUrl({ env, operationName, baseUrl: geminiBaseUrl })}?key=${encodeURIComponent(geminiApiKey)}`;
          const opDispatcher = getProxyDispatcher(opUrl, env);
          opData = await withRetries(
            async () => {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 60_000);
              try {
                const init: any = { signal: controller.signal };
                const runOpFetch = async (useDispatcher: boolean) => {
                  const reqInit: any = { ...init };
                  if (useDispatcher && opDispatcher) reqInit.dispatcher = opDispatcher;
                  return fetch(opUrl, reqInit);
                };
                let opRes: any;
                try {
                  opRes = await runOpFetch(true);
                } catch (e: any) {
                  if (opDispatcher && isRetryableNetworkError(e)) {
                    opRes = await runOpFetch(false);
                  } else {
                    throw e;
                  }
                }
                if (!opRes.ok) {
                  const text = await opRes.text().catch(() => '');
                  const err: any = new Error(`Gemini Video operation HTTP ${opRes.status}${text ? `: ${text.slice(0, 240)}` : ''}`);
                  err.status = opRes.status;
                  err.retryable = [408, 425, 429, 500, 502, 503, 504].includes(Number(opRes.status));
                  throw err;
                }
                return (await opRes.json()) as any;
              } finally {
                clearTimeout(timeout);
              }
            },
            {
              label: `gemini.video.poll:${operationName}`,
              maxAttempts: Math.max(1, Number(env.GEMINI_VIDEO_POLL_ATTEMPTS || 4)),
              baseDelayMs: 500,
              maxDelayMs: 3500,
            },
          );
        }

        if (opData?.error) {
          const message = String(opData?.error?.message || opData?.error?.details || 'unknown error');
          throw new Error(`Gemini Video operation failed: ${message}`);
        }

        const videoNodes = collectVideoNodes(opData);
        const sample = videoNodes[0];
        const primaryVideoUri = extractVideoUris(sample)[0] || '';
        const inline = sample?.video?.inlineData || sample?.inlineData || sample?.video?.bytes || sample?.bytes;
        const inlineBytes = typeof inline?.data === 'string' ? Buffer.from(String(inline.data), 'base64') : null;

        const uriCandidates = new Set<string>();
        if (primaryVideoUri) uriCandidates.add(primaryVideoUri);
        for (const n of videoNodes) {
          for (const v of extractVideoUris(n)) uriCandidates.add(v);
        }
        for (const s of collectStringCandidates(opData)) {
          const v = String(s || '').trim();
          if (!v) continue;
          if (/^https?:\/\//i.test(v) || v.startsWith('/')) {
            uriCandidates.add(v);
            continue;
          }
          const filesPath = extractFilesPath(v);
          if (filesPath) for (const u of fileNameToCandidateUrls(filesPath)) uriCandidates.add(u);
        }

        let videoBytes: Buffer | null = inlineBytes && inlineBytes.length ? inlineBytes : null;
        let resolvedVideoUri = primaryVideoUri;
        if (!videoBytes && uriCandidates.size) {
          for (const u of uriCandidates) {
            const fetched = await readVideoBytes(u);
            if (fetched?.bytes?.length) {
              videoBytes = fetched.bytes;
              resolvedVideoUri = u;
              break;
            }
          }
        }

        if (videoBytes && videoBytes.length) {
          const hash = crypto
            .createHash('sha256')
            .update(`${model}\n${durationSeconds}\n${aspectRatio}\n${promptUsed}\n${imageUrl}\n${referenceImageUrls.join('\n')}`)
            .digest('hex')
            .slice(0, 16);
          const filename = `${Date.now()}-${hash}.mp4`;
          ensureGeneratedDir(userId);
          fs.writeFileSync(path.join(userGeneratedAssetsDir(userId), filename), videoBytes);
          return sendJson(res, 200, {
            videoUrl: buildGeneratedAssetUrl(userId, filename),
            operationName,
            debug: {
              transport: 'http',
              provider: 'gemini',
              model,
              baseUrl: geminiBaseUrl,
              durationSeconds,
              resolution,
              aspectRatio,
              bytes: videoBytes.length,
              promptPreview: prompt.slice(0, 240),
              promptUsedPreview: promptUsed.slice(0, 320),
              referenceImageCount: referenceImageUrls.length,
              requestParameters: predictParamsUsed,
              uriCandidates: Array.from(uriCandidates).slice(0, 16),
            },
          });
        }

        const gvr = opData?.response?.generateVideoResponse || {};
        const raiFilteredCount = Number(gvr?.raiMediaFilteredCount ?? gvr?.raiFilteredCount ?? 0);
        const raiReasonsRaw = Array.isArray(gvr?.raiMediaFilteredReasons)
          ? gvr.raiMediaFilteredReasons
          : Array.isArray(gvr?.raiFilteredReasons)
            ? gvr.raiFilteredReasons
            : [];
        const raiReasons = Array.from(
          new Set(
            raiReasonsRaw
              .map((r: any) => {
                if (!r) return '';
                if (typeof r === 'string') return r.trim();
                if (typeof r?.reason === 'string') return String(r.reason).trim();
                if (typeof r?.category === 'string') return String(r.category).trim();
                return '';
              })
              .filter(Boolean),
          ),
        );

        if (!resolvedVideoUri && (raiFilteredCount > 0 || raiReasons.length > 0)) {
          return sendJson(res, 422, {
            ok: false,
            code: 'RAI_MEDIA_FILTERED',
            error: `Gemini Video blocked by safety filter (filtered=${raiFilteredCount || 1})`,
            debug: {
              provider: 'gemini',
              model,
              operationName,
              raiFilteredCount,
              raiReasons,
              promptPreview: prompt.slice(0, 240),
              promptUsedPreview: promptUsed.slice(0, 320),
              referenceImageCount: referenceImageUrls.length,
            },
          });
        }

        if (!resolvedVideoUri) {
          const responseShape = JSON.stringify(
            {
              opKeys: Object.keys(opData || {}).slice(0, 30),
              responseKeys: Object.keys(opData?.response || {}).slice(0, 30),
              gvrKeys: Object.keys(opData?.response?.generateVideoResponse || {}).slice(0, 40),
              sampleKeys: Object.keys(sample || {}).slice(0, 30),
            },
            null,
            0,
          );
          throw new Error(`Gemini Video: operation completed but no downloadable video URI (shape=${responseShape})`);
        }

        // IMPORTANT: never return a remote Gemini URL to the browser.
        // Browsers can't attach the required API key headers; persisting that URL breaks preview/playback.
        // If we can't download bytes here, treat it as a transient server-side failure so the user can retry.
        const err: any = new Error('Gemini Video: operation completed but video download failed');
        err.status = 502;
        err.retryable = true;
        (err as any).debug = {
          provider: 'gemini',
          model,
          operationName,
          gateway: 'direct',
          durationSeconds,
          resolution,
          aspectRatio,
          resolvedVideoUri,
          uriCandidates: Array.from(uriCandidates).slice(0, 16),
        };
        throw err;
      } catch (e: any) {
        const status = Number(e?.status || 0);
        const code = Number.isFinite(status) && status >= 400 && status <= 599 ? status : 500;
        return sendJson(res, code, {
          ok: false,
          error: formatFetchError(e),
          debug: {
            ...(e?.debug && typeof e.debug === 'object' ? e.debug : {}),
            provider: 'gemini',
            modelCandidates,
            imageUrlPreview: imageUrl.slice(0, 200),
            promptPreview: prompt.slice(0, 200),
            promptUsedPreview: promptUsed.slice(0, 320),
            referenceImageCount: referenceImageUrls.length,
          },
        });
      }
      };

      if (asyncRequested) {
        const submitted = submitPipelineTask(req, res, {
          kind: 'asset.video.generate',
          route: '/api/asset/video/generate',
          run: async () => {
            const internalBase = String(env.VISION_INTERNAL_BASE_URL || `http://127.0.0.1:${String(env.PORT || '3000')}`).replace(/\/$/, '');
            const internalUrl = `${internalBase}/api/asset/video/generate?bypassPipeline=1`;
            const resp = await fetch(internalUrl, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                [VISION_USER_ID_HEADER]: userId,
                'x-vision-internal-pipeline': '1',
              },
              body: JSON.stringify({ ...body, async: false }),
            });
            const data = (await resp.json().catch(() => null)) as any;
            if (!resp.ok) {
              const err: any = new Error(String(data?.error || `HTTP ${resp.status}`));
              err.status = resp.status;
              err.debug = data?.debug;
              throw err;
            }
            return data;
          },
          mapResult: (out: any) => ({
            ok: Boolean(out?.videoUrl),
            videoUrl: String(out?.videoUrl || ''),
            operationName: String(out?.operationName || ''),
          }),
        });
        if (!submitted) return;
        return sendJson(res, 202, {
          ok: true,
          accepted: true,
          taskId: submitted.taskId,
          statusUrl: submitted.statusUrl,
        });
      }

      if (bypassPipeline) return runVideoGenerate();
      return withPipelineTask(req, res, {
        kind: 'asset.video.generate',
        route: '/api/asset/video/generate',
        run: runVideoGenerate,
      });
	    });

	    // Store client-generated (e.g. cropped) images into the local generated-assets directory.
	    // This keeps ShotVersion.imageUrl small (`/__generated__/...`) instead of embedding huge data URLs.
	    middlewares.use('/api/asset/image/store', async (req: any, res: any, next: any) => {
	      if (req.method !== 'POST') return next();
        return withPipelineTask(req, res, {
          kind: 'asset.image.store',
          route: '/api/asset/image/store',
          run: async () => {
        const userId = getRequestUserId(req);
	      const body = await readJsonBody(req);
	      const dataUrl = String(body?.dataUrl || '').trim();
	      const filenameHint = String(body?.filenameHint || '').trim();
	      if (!dataUrl.startsWith('data:image/')) return sendJson(res, 400, { ok: false, error: 'Expected dataUrl (data:image/*;base64,...)' });
	      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
	      if (!m) return sendJson(res, 400, { ok: false, error: 'Invalid dataUrl' });
	      const mimeType = String(m[1] || 'image/png').toLowerCase();
	      const b64 = String(m[2] || '');
	      let bytes: Buffer;
	      try {
	        bytes = Buffer.from(b64, 'base64');
	      } catch {
	        return sendJson(res, 400, { ok: false, error: 'Invalid base64' });
	      }
	      if (!bytes.length) return sendJson(res, 400, { ok: false, error: 'Empty image bytes' });
	      // Avoid OOM / accidental giant payloads.
	      if (bytes.length > 12 * 1024 * 1024) return sendJson(res, 413, { ok: false, error: 'Image too large (max 12MB)' });

	      const ext =
	        mimeType === 'image/jpeg' ? '.jpg' :
	          mimeType === 'image/webp' ? '.webp' :
	            '.png';
	      ensureGeneratedDir(userId);
	      const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
	      const safeHint = filenameHint.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
	      const filename = `${Date.now()}-${safeHint ? `${safeHint}-` : ''}${hash}${ext}`;
	      fs.writeFileSync(path.join(userGeneratedAssetsDir(userId), filename), bytes);
	      return sendJson(res, 200, { ok: true, imageUrl: buildGeneratedAssetUrl(userId, filename), mimeType, bytes: bytes.length });
          },
        });
	    });

	    middlewares.use('/api/asset/image/describe', async (req: any, res: any, next: any) => {
	      if (req.method !== 'POST') return next();
        return withPipelineTask(req, res, {
          kind: 'asset.image.describe',
          route: '/api/asset/image/describe',
          run: async () => {
        const userId = getRequestUserId(req);
	      const body = await readJsonBody(req);
	      const imageUrl = String(body?.imageUrl || '').trim();
	      if (!imageUrl) return sendJson(res, 400, { ok: false, error: 'Missing imageUrl' });
	      const describeApiKey = geminiApiKey;
	      const describeBaseUrl = geminiBaseUrl || undefined;
	      if (!describeApiKey) return sendJson(res, 400, { ok: false, error: 'Missing GEMINI_API_KEY' });

	      const loadImageBytes = async (url: string): Promise<{ mimeType: string; bytes: Buffer } | null> => {
	        const u = String(url || '').trim();
	        if (!u) return null;
	        if (u.startsWith('/__generated__/')) {
	          const clean = u.split('?')[0].split('#')[0];
            const fileCandidates = safeGeneratedAssetPaths(clean, userId);
            for (const filePath of fileCandidates) {
              try {
                const bytes = await fs.promises.readFile(filePath);
                return { mimeType: mimeByExt(path.extname(filePath)), bytes };
              } catch {
                // try next candidate
              }
            }
            return null;
	        }
	        if (u.startsWith('data:image/')) {
	          const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(u);
	          if (!match) return null;
	          return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
	        }
	        if (u.startsWith('http://') || u.startsWith('https://')) {
	          const controller = new AbortController();
	          const timeout = setTimeout(() => controller.abort(), 20_000);
	          try {
	            const init: any = { signal: controller.signal };
	            const dispatcher = getProxyDispatcher(u, env);
	            if (dispatcher) init.dispatcher = dispatcher;
	            const resp = await fetch(u, init);
	            if (!resp.ok) return null;
	            const ct = String(resp.headers.get('content-type') || '');
	            if (!ct.startsWith('image/')) return null;
	            const bytes = Buffer.from(await resp.arrayBuffer());
	            if (!bytes.length) return null;
	            return { mimeType: ct.split(';')[0] || 'image/png', bytes };
	          } finally {
	            clearTimeout(timeout);
	          }
	        }
	        return null;
	      };

	      const loaded = await loadImageBytes(imageUrl);
	      if (!loaded?.bytes?.length) return sendJson(res, 400, { ok: false, error: 'Could not load imageUrl bytes' });

	      const describeModel = String(env.VISION_DESCRIBE_MODEL || env.GEMINI_VISION_MODEL || 'gemini-2.0-flash').trim();
	      const prompt =
	        'You are a vision assistant. Analyze the provided image frame for refinement.\n' +
	        'Return JSON with:\n' +
	        '- description: 1-2 sentences, literal visual facts\n' +
	        '- keySubjects: list of key subjects (names if visible, otherwise generic)\n' +
	        '- environment: brief setting description\n' +
	        '- composition: framing and layout (shot scale, subject placement)\n' +
	        '- camera: angle and lens impression (if inferable)\n' +
	        '- lighting: direction, quality, color temperature\n' +
	        '- style: material/texture/grade keywords (literal)\n' +
	        '- constraints: do-not-change items for refinement\n' +
	        'Do not mention grids/contact sheets unless clearly present. Do not invent story context.';

	      try {
	        const out = await callGeminiVisionJson({
	          apiKey: describeApiKey,
	          model: describeModel,
	          temperature: 0.2,
	          maxOutputTokens: 768,
	          prompt,
	          image: loaded,
	          env,
	          responseSchema: GEMINI_SCHEMA.imageDescribe,
	          baseUrl: describeBaseUrl,
	        });
	        return sendJson(res, 200, { ok: true, describe: out.value, usage: out.usage });
	      } catch (e: any) {
	        const errText = formatFetchError(e);
	        return sendJson(res, 502, { ok: false, error: errText });
	      }
          },
        });
	    });

			    middlewares.use('/api/asset/image/generate', async (req, res, next) => {
			      if (req.method !== 'POST') return next();
            return withPipelineTask(req, res, {
              kind: 'asset.image.generate',
              route: '/api/asset/image/generate',
              run: async () => {
            const userId = getRequestUserId(req);
			        const body = await readJsonBody(req);

		        const prompt = String(body?.prompt || '').trim();
		        const promptSpec = body?.promptSpec;
		        const composePrompt = Boolean(body?.composePrompt);
		        const composeSettings = body?.composeSettings || {};
		        const aspectRatio = body?.aspectRatio ? String(body.aspectRatio) : undefined;
		        const referencesRaw = Array.isArray(body?.references) ? body.references : [];
		        const requireAllReferences = Boolean(body?.requireAllReferences);
		        const settings = body?.settings || {};
		        const provider = String(settings?.provider || 'gemini');
		        const model = String(settings?.model || 'nano-banana-pro');
		        const temperature = Number(settings?.temperature ?? 0.6);

        if (!prompt) return sendJson(res, 400, { ok: false, error: 'Missing prompt' });

		        let promptUsed = prompt;
		        let composed: any = null;
            let composeUsage: TokenUsage | undefined;
		        const promptPreview = prompt.slice(0, 120);

		        try {
		          if (provider === 'gemini') {
		            const usedModel = normalizeGeminiImageModel(model);
		            ensureGeneratedDir(userId);

                // Prompt composer uses the same direct Gemini transport in homework.
		            if (composePrompt && promptSpec && typeof promptSpec === 'object') {
		              try {
		                const composerModel = String(composeSettings?.model || env?.VISION_PROMPT_COMPOSER_MODEL || 'gemini-3-pro-preview');
		                const composerTemp = Number.isFinite(Number(composeSettings?.temperature)) ? Number(composeSettings.temperature) : 0.2;
		                const composerMaxTokens = Number.isFinite(Number(composeSettings?.maxOutputTokens)) ? Number(composeSettings.maxOutputTokens) : 512;
		                const trimmedSpec = JSON.parse(JSON.stringify(promptSpec));
		                if (typeof trimmedSpec?.styleGuide === 'string' && trimmedSpec.styleGuide.length > 2000) {
		                  trimmedSpec.styleGuide = trimmedSpec.styleGuide.slice(0, 2000);
		                }
		                const composePromptText =
		                  `You are a senior visual direction prompt engineer.\n` +
		                  `Compose the BEST single prompt for Gemini image generation (model: ${usedModel}).\n` +
		                  `Goal: produce a narrative keyframe (mid-action), not a poster, not concept art, not posed.\n` +
		                  `Write a cohesive prompt (1-3 short paragraphs). No headings like TASK/SCENE. No bullet lists. No JSON inside the prompt.\n` +
		                  `Preserve the medium/style in the input spec. Do not drift into generic photoreal/CGI wording unless explicitly requested.\n` +
		                  `Include: concrete frame description, composition, lighting mood, and style constraints. Add lens/DoF jargon only when it helps the requested medium.\n` +
		                  `Return ONLY JSON: {"prompt": string, "negativePrompt": string}.\n` +
		                  `Input spec JSON:\n${JSON.stringify(trimmedSpec)}\n`;

                  const composerApiKey = geminiApiKey;
                  const composerBaseUrl = geminiBaseUrl;
                  if (!composerApiKey) throw new Error('Missing GEMINI_API_KEY for prompt composition');

			                const composedRes = await callGeminiJson({
			                  apiKey: composerApiKey,
			                  baseUrl: composerBaseUrl || undefined,
			                  model: composerModel,
			                  temperature: composerTemp,
			                  maxOutputTokens: composerMaxTokens,
			                  prompt: composePromptText,
			                  env,
			                  responseSchema: GEMINI_SCHEMA.promptCompose,
			                });
                      composeUsage = composedRes.usage;
	                    composed = composedRes.value;
			                const p = String(composed?.prompt || '').trim();
			                const n = String(composed?.negativePrompt || '').trim();
		                if (p) {
		                  promptUsed = n ? `${p}\n\nNegative: ${n}` : p;
		                }
		              } catch (e: any) {
		                composed = { error: formatFetchError(e) };
		              }
		            }

		            const loadReference = async (url: string): Promise<{ mimeType: string; bytes: Buffer } | null> => {
	              const u = String(url || '').trim();
	              if (!u) return null;

	              // Local generated assets: /__generated__/...
	              if (u.startsWith('/__generated__/')) {
	                const clean = u.split('?')[0].split('#')[0];
                  const fileCandidates = safeGeneratedAssetPaths(clean, userId);
                  for (const filePath of fileCandidates) {
                    try {
                      const bytes = await fs.promises.readFile(filePath);
                      const mimeType = mimeByExt(path.extname(filePath));
                      return { mimeType, bytes };
                    } catch {
                      // try next
                    }
                  }
                  return null;
	              }

              // data: URLs
              if (u.startsWith('data:image/')) {
                const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i.exec(u);
                if (!match) return null;
                return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
              }

	              // Remote http(s) URLs
	              if (u.startsWith('http://') || u.startsWith('https://')) {
                const shrinkIfUnsplash = (input: string): string => {
                  try {
                    const parsed = new URL(input);
                    if (!/images\.unsplash\.com$/i.test(parsed.hostname)) return input;
                    parsed.searchParams.set('w', '768');
                    parsed.searchParams.set('q', '70');
                    parsed.searchParams.set('auto', 'format');
                    parsed.searchParams.set('fit', 'crop');
                    return parsed.toString();
                  } catch {
                    return input;
                  }
                };

	                try {
	                  const tryFetch = async (input: string) => {
	                    const controller = new AbortController();
	                    const timeout = setTimeout(() => controller.abort(), 15_000);
	                    try {
	                      const init: any = { signal: controller.signal };
	                      const dispatcher = getProxyDispatcher(input, env);
	                      if (dispatcher) init.dispatcher = dispatcher;
	                      const resp = await fetch(input, init);
	                      if (!resp.ok) return null;
	                      const ct = String(resp.headers.get('content-type') || '');
	                      if (!ct.startsWith('image/')) return null;
	                      const buf = Buffer.from(await resp.arrayBuffer());
                      return { mimeType: ct.split(';')[0] || 'image/png', bytes: buf, bytesLen: buf.length };
                    } finally {
                      clearTimeout(timeout);
                    }
                  };

                  const first = await withRetries(async () => await tryFetch(u), { label: 'ref-image-fetch', maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 900 });
                  if (!first) return null;
                  // If the image is too large, retry a smaller Unsplash variant when possible.
                  if (first.bytesLen > 12 * 1024 * 1024) {
                    const smallerUrl = shrinkIfUnsplash(u);
                    if (smallerUrl !== u) {
                      const second = await withRetries(async () => await tryFetch(smallerUrl), { label: 'ref-image-fetch-small', maxAttempts: 2, baseDelayMs: 200, maxDelayMs: 900 });
                      if (second && second.bytesLen <= 12 * 1024 * 1024) return { mimeType: second.mimeType, bytes: second.bytes };
                    }
                    return null;
                  }

                  return { mimeType: first.mimeType, bytes: first.bytes };
                } catch {
                  return null;
                }
              }

              return null;
            };

	            const references = (
	              Array.isArray(referencesRaw) ? referencesRaw : []
	            )
	              .slice(0, 6)
	              .map((r: any) => ({ url: String(r?.url || '').trim(), label: r?.label ? String(r.label) : undefined }))
	              .filter((r: any) => r.url);

	            const loadedRefs: Array<{ mimeType: string; bytes: Buffer; label?: string }> = [];
	            const missingRefs: Array<{ url: string; label?: string }> = [];
	            for (const r of references) {
	              try {
	                const loaded = await loadReference(r.url);
	                if (!loaded) {
	                  missingRefs.push({ url: r.url, label: r.label });
	                  continue;
	                }
	                // Keep refs reasonably small to avoid request bloat.
	                if (loaded.bytes.length > 12 * 1024 * 1024) {
	                  missingRefs.push({ url: r.url, label: r.label });
	                  continue;
	                }
	                loadedRefs.push({ ...loaded, label: r.label });
	              } catch {
	                missingRefs.push({ url: r.url, label: r.label });
	              }
	            }

	            if (requireAllReferences && references.length > 0 && loadedRefs.length < references.length) {
	              const list = missingRefs
	                .slice(0, 6)
	                .map((r) => (r.label ? `${r.label}` : r.url))
	                .filter(Boolean)
	                .join(', ');
	              throw new Error(`Missing required reference image(s): ${list || 'unknown'}`);
	            }

                if (!geminiApiKey) throw new Error('Missing GEMINI_API_KEY');
                const out = await callGeminiImage({
                  apiKey: geminiApiKey,
                  baseUrl: geminiBaseUrl,
                  model: usedModel,
                  temperature,
                  prompt: promptUsed,
                  aspectRatio,
                  references: loadedRefs,
                  env,
                });
                const gateway = 'gemini-direct';
                const baseUrlUsed = geminiBaseUrl;
                  const usage = mergeTokenUsage(out?.usage, composeUsage);

            const ext =
              out.mimeType === 'image/png'
                ? 'png'
                : out.mimeType === 'image/jpeg'
                  ? 'jpg'
                  : out.mimeType === 'image/webp'
                    ? 'webp'
                    : 'bin';
	            const hash = crypto
	              .createHash('sha256')
	              .update(`${usedModel}\n${aspectRatio || ''}\n${promptUsed}`)
	              .digest('hex')
	              .slice(0, 16);
            const filename = `${Date.now()}-${hash}.${ext}`;
			            fs.writeFileSync(path.join(userGeneratedAssetsDir(userId), filename), out.bytes);
			            return sendJson(res, 200, {
			              imageUrl: buildGeneratedAssetUrl(userId, filename),
				              debug: {
				                transport: 'http',
				                provider,
				                model: usedModel,
				                    baseUrl: baseUrlUsed || geminiBaseUrl,
                        gateway,
                        attemptedTransports: ['gemini-direct'],
                        usage,
				                mimeType: out.mimeType,
				                bytes: out.bytes.length,
				                promptPreview,
				                promptUsedPreview: String(promptUsed || '').slice(0, 240),
				                promptUsed: String(promptUsed || '').slice(0, 4000),
				                composed,
				                references: loadedRefs.map((r) => ({ mimeType: r.mimeType, bytes: r.bytes.length, label: r.label })),
				                requireAllReferences,
				                missingReferences: missingRefs,
				              },
			            });
				          }
				        } catch (e: any) {
	          return sendJson(res, 200, {
	            imageUrl:
	              `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=` +
	              `${Math.floor(Math.random() * 100000)}`,
	            debug: {
	              transport: 'mock',
	              provider,
	              model,
	              promptPreview,
	              error: formatFetchError(e),
	            },
	          });
	        }

        const url =
          `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=` +
          `${Math.floor(Math.random() * 100000)}`;

        // If no image provider is configured, fall back to a deterministic URL-like output and include metadata for debugging.
        return sendJson(res, 200, {
          imageUrl: url,
          debug: { transport: 'mock', provider, model, promptPreview },
        });
              },
            });
      });

    const writeSseHeaders = (res: any) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream; charset=utf-8');
      res.setHeader('cache-control', 'no-cache, no-transform');
      res.setHeader('connection', 'keep-alive');
      res.setHeader('x-accel-buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
    };

    const sseSend = (res: any, event: string, data: any) => {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\n`);
      for (const line of String(payload).split('\n')) {
        res.write(`data: ${line}\n`);
      }
      res.write('\n');
    };

    const handleScaffold = async (req: any, res: any, opts: { stream: boolean }) => {
      if (req.method !== 'POST') return false;
      const body = await readJsonBody(req);

	      const intent = String(body?.intent || '').trim();
	      const aspectRatio = String(body?.aspectRatio || '16:9');
	      const keyVisualUrl = body?.keyVisualUrl ? String(body.keyVisualUrl) : undefined;
	      const allowSingleFallback = Boolean(body?.allowSingleFallback);
	      const allowMockFallback = Boolean(body?.allowMockFallback);
	      const settings = body?.settings || {};
	      const plannerSettings = body?.plannerSettings || {};
      const provider = String(settings?.provider || 'gemini');
      // Gemini 1.5 models were shut down in 2025; default to a supported model.
      const model = String(settings?.model || 'gemini-3-flash-preview');
      const temperature = Number(settings?.temperature ?? 0.6);
      const maxOutputTokens = settings?.maxOutputTokens ? Number(settings.maxOutputTokens) : undefined;
      const plannerModel = String(plannerSettings?.model || '');
      const plannerTemperature = Number(plannerSettings?.temperature ?? temperature);
      const plannerMaxOutputTokens = plannerSettings?.maxOutputTokens ? Number(plannerSettings.maxOutputTokens) : maxOutputTokens;

      if (!intent) {
        if (opts.stream) {
          writeSseHeaders(res);
          sseSend(res, 'error', { ok: false, error: 'Missing intent' });
          res.end();
          return true;
        }
        sendJson(res, 400, { ok: false, error: 'Missing intent' });
        return true;
      }

      if (opts.stream) {
        writeSseHeaders(res);
      }

      let closed = false;
      req.on('close', () => {
        closed = true;
      });

	      const emit = (event: string, data: any) => {
	        if (!opts.stream) return;
	        if (closed) return;
	        sseSend(res, event, data);
	      };

	      const finish = (status: number, payload: any) => {
	        if (opts.stream) {
	          if (status >= 400) emit('error', { status, ...(payload || {}) });
	          else emit('done', payload);
	          res.end();
	          return true;
	        }
	        sendJson(res, status, payload);
	        return true;
	      };

	      const heartbeat = opts.stream
	        ? setInterval(() => {
	            if (closed) return;
	            sseSend(res, 'ping', { ts: Date.now() });
	          }, 10_000)
        : null;

      try {
        emit('hello', { intent, aspectRatio, provider, model, ts: Date.now() });

        const now = Date.now();
        const mkId = (prefix: string) => `${prefix}-${now}-${Math.random().toString(16).slice(2, 8)}`;

    const mock = () => {
      const projectId = mkId('proj');
      return {
        ok: true,
        story: {
          id: projectId,
          title: intent.split(/\\s+/).slice(0, 4).join(' ') || 'New Masterpiece',
          logline: `An AI-directed story based on: "${intent}"`,
          styleGuide:
            'Style Guide: cohesive art direction; stable medium/texture language; consistent palette and lighting logic; stable character identity; avoid style drift and accidental CG look.',
          intent,
          keyVisualUrl: keyVisualUrl || 'https://images.unsplash.com/photo-1449156059431-789955fa190a?q=80&w=2070&auto=format&fit=crop',
          aspectRatio,
          status: 'ready',
              createdAt: now,
              updatedAt: now,
              lastOpenedAt: now,
              locations: [],
              characters: [],
              sequences: [
                {
                  id: mkId('seq'),
                  title: 'Sequence 1',
                  context: 'Auto-generated scaffold.',
                  scenes: [{ id: mkId('scene'), title: 'Scene 1', shots: [] }],
                  shots: [],
                },
              ],
            },
            plan: {
              id: mkId('plan'),
              summary: 'Scaffolded a first-pass story structure (dev server mock).',
              steps: [
                { id: mkId('step'), title: 'Analyze intent', status: 'done' },
                { id: mkId('step'), title: 'Draft environments', status: 'done' },
                { id: mkId('step'), title: 'Draft casting', status: 'done' },
                { id: mkId('step'), title: 'Assemble sequences & shots', status: 'done' },
              ],
              actions: [{ type: 'SCAFFOLD_PROJECT' }],
            },
            debug: { transport: 'mock', provider, model },
          };
        };

        const scaffoldPrompt = buildScaffoldPrompt({ intent, aspectRatio });

	        const inferStyleLockFromIntent = (rawIntent: string) => {
	          const t = String(rawIntent || '').toLowerCase();
	          const has = (re: RegExp) => re.test(t);
	          if (has(/(写实|现实主义|写实电影|realistic|live[\s-]?action|photoreal|real[\s-]?film)/i)) {
	            return {
	              label: 'live-action realistic film',
	              negative: 'oil painting, watercolor, ink wash, anime, illustration, stylized CGI',
	            };
	          }
	          if (has(/(油画|oil\s*painting)/i)) return { label: 'oil painting', negative: 'live-action photorealism' };
	          if (has(/(水墨|ink\s*wash|sumie|sumi-e)/i)) return { label: 'ink wash', negative: 'live-action photorealism, glossy CGI' };
	          if (has(/(水彩|watercolor)/i)) return { label: 'watercolor', negative: 'live-action photorealism, glossy CGI' };
	          if (has(/(anime|动画|二次元|cel)/i)) return { label: 'anime cel', negative: 'live-action photorealism, oil painting' };
	          return null;
	        };

	        const applyStyleLock = (text: string, styleLock: { label: string; negative: string } | null, extras?: Array<string | undefined>) => {
	          const base = String(text || '').trim();
            const styleTranslation = buildStylePromptTranslation({ texts: [intent, ...(extras || [])], maxItems: 5 });
            const styleLine = styleTranslation ? `Style translation hints: ${styleTranslation}.` : '';
	          if (!styleLock) return [base, styleLine].filter(Boolean).join(base ? '\n' : '');
	          const block =
	            `Style lock (hard): ${styleLock.label}.\n` +
	            `Do not drift to: ${styleLock.negative}.`;
	          if (!base) return [block, styleLine].filter(Boolean).join('\n');
            const withLock = /style lock \(hard\)/i.test(base) ? base : `${base}\n${block}`;
	          return [withLock, styleLine].filter(Boolean).join('\n');
	        };

	        const buildFromSpec = (spec: any, source: string, usedProvider: string, usedModel: string, debugExtra?: any) => {
	          // Minimal mapping into the app's Story schema. IDs generated server-side for stability.
	          const projectId = mkId('proj');
	          const styleLock = inferStyleLockFromIntent(intent);
	          const locations = Array.isArray(spec?.locations) ? spec.locations : [];
	          const characters = Array.isArray(spec?.characters) ? spec.characters : [];
	          const sequences = Array.isArray(spec?.sequences) ? spec.sequences : [];
	          const styleGuideRaw = String(spec?.styleGuide || '').trim();
	          const styleGuideFallback = () => {
	            const styles = locations
	              .map((l: any) => String(l?.visualStyle || '').trim())
	              .filter(Boolean)
	              .slice(0, 3);
	            const hints = styles.length ? `VisualStyle hints: ${styles.join(' | ')}.` : '';
	            return (
	              `Style Guide:\n` +
	              `- Decide a clear rendering style/medium and stick to it.\n` +
	              `- Use cohesive palette and lighting language across all assets.\n` +
	              `- Keep character identity consistent across looks and shots.\n` +
	              (hints ? `- ${hints}\n` : '') +
	              `- No sudden style shifts; no text/watermarks.\n`
	            );
	          };
	          const styleGuide = applyStyleLock(styleGuideRaw || styleGuideFallback(), styleLock, [styleGuideRaw]);

          const locByName = new Map<string, any>();
	          const mappedLocations = locations.map((l: any) => {
	            const id = mkId('loc');
	            const item = {
	              id,
	              name: String(l?.name || 'Environment'),
	              description: String(l?.description || ''),
	              visualStyle: applyStyleLock(String(l?.visualStyle || ''), styleLock, [String(l?.description || ''), String(l?.visualStyle || '')]),
	              previewUrl: 'https://images.unsplash.com/photo-1555680202-c86f0e12f086?q=80&w=2070&auto=format&fit=crop',
	              status: 'draft',
	            };
            locByName.set(item.name.toLowerCase(), item);
            return item;
          });
          const normalizeNameKey = (v: any) =>
            String(v || '')
              .toLowerCase()
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .trim()
              .replace(/\s+/g, ' ');
          const findBestLocation = (rawName: any) => {
            const q = normalizeNameKey(rawName);
            if (!q) return null;
            const exact =
              locByName.get(String(rawName || '').toLowerCase()) ||
              mappedLocations.find((l: any) => normalizeNameKey(l?.name) === q);
            if (exact) return exact;
            const contains = mappedLocations.find((l: any) => {
              const n = normalizeNameKey(l?.name);
              return n.includes(q) || q.includes(n);
            });
            return contains || null;
          };

	          const charByName = new Map<string, any>();
	          const mappedCharacters = characters.map((c: any) => {
	            const id = mkId('char');
	            const looks = Array.isArray(c?.looks) ? c.looks : [];
	            const mappedLooks = looks.map((lk: any) => ({
	              id: mkId('look'),
	              name: String(lk?.name || 'Look'),
	              description: String(lk?.description || ''),
	              previewUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=1287&auto=format&fit=crop',
	            }));
	            const item = {
	              id,
	              name: String(c?.name || 'Character'),
	              description: String(c?.description || ''),
	              avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=1287&auto=format&fit=crop',
	              status: 'draft',
	              looks: mappedLooks,
	            };
	            charByName.set(item.name.toLowerCase(), item);
	            return item;
	          });
          const findBestCharacter = (rawName: any) => {
            const q = normalizeNameKey(rawName);
            if (!q) return null;
            const exact =
              charByName.get(String(rawName || '').toLowerCase()) ||
              mappedCharacters.find((c: any) => normalizeNameKey(c?.name) === q);
            if (exact) return exact;
            const contains = mappedCharacters.find((c: any) => {
              const n = normalizeNameKey(c?.name);
              return n.includes(q) || q.includes(n);
            });
            return contains || null;
          };
          const bindingAudit = {
            locationFallbacks: 0,
            locationUnresolved: [] as string[],
            castUnresolved: [] as string[],
          };

	          const normalizeDuration = (raw: any) => {
	            const d = Number(raw || 4);
	            if (d <= 5) return 4;
	            if (d <= 7) return 6;
	            return 8;
	          };
	          const mapShot = (sh: any, sequenceNum: number) => {
	            const locationNameRaw = String(sh?.locationName || '').trim();
	            const loc = (locationNameRaw && findBestLocation(locationNameRaw)) || mappedLocations[0];
              if (!locationNameRaw || !findBestLocation(locationNameRaw)) {
                bindingAudit.locationFallbacks += 1;
                if (locationNameRaw) bindingAudit.locationUnresolved.push(locationNameRaw);
              }
	            const castNames = Array.isArray(sh?.castNames) ? sh.castNames : [];
	            const cast = castNames
	              .map((n: any) => {
	                const ch = findBestCharacter(n);
	                if (!ch) return null;
	                const activeLookId = ch.looks?.[0]?.id || '';
	                return { id: ch.id, activeLookId };
	              })
	              .filter(Boolean);
              for (const n of castNames) {
                if (!findBestCharacter(n)) bindingAudit.castUnresolved.push(String(n || '').trim());
              }

	            return {
	              id: mkId('shot'),
	              sequence: sequenceNum,
	              locationId: loc?.id || '',
	              timeOfDay: String(sh?.timeOfDay || 'Day'),
	              description: String(sh?.description || `Shot ${sequenceNum}`),
	              duration: normalizeDuration(sh?.duration),
	              thumbnailUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2025&auto=format&fit=crop',
	              activeVersionId: 'v1',
	              versions: [
	                {
	                  id: 'v1',
	                  imageUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=2025&auto=format&fit=crop',
	                  createdAt: now,
	                  type: 'placeholder',
	                },
	              ],
	              elements: {
	                SCRIPT: { type: 'SCRIPT', prompt: String(sh?.script || ''), status: 'auto' },
	                CASTING: { type: 'CASTING', prompt: '', status: 'manual', metadata: { characters: cast } },
	                CAMERA: {
	                  type: 'CAMERA',
	                  prompt: String(sh?.camera || 'Narrative shot'),
	                  status: 'auto',
	                  metadata: {
	                    videoPrompt: applyStyleLock(
	                      String(sh?.videoPrompt || ''),
	                      styleLock,
	                      [String(sh?.description || ''), String(sh?.camera || ''), String(sh?.lighting || '')],
	                    ),
	                  },
	                },
	                LIGHTING: { type: 'LIGHTING', prompt: String(sh?.lighting || 'Scene-consistent lighting'), status: 'auto' },
	                AUDIO: { type: 'AUDIO', prompt: String(sh?.audio || 'Ambient sound'), status: 'auto' },
	              },
	              aiState: 'idle',
	            };
	          };
	          const inferSceneTitle = (rawTitle: any, shots: any[], idx: number) => {
	            const explicit = String(rawTitle || '').trim();
	            if (explicit) return explicit;
	            const first = Array.isArray(shots) ? shots[0] : null;
	            const loc = first?.locationName ? String(first.locationName).trim() : '';
	            const tod = first?.timeOfDay ? String(first.timeOfDay).trim() : '';
	            if (loc && tod) return `${loc} · ${tod}`;
	            if (loc) return loc;
	            return `Scene ${idx + 1}`;
	          };

		          const mappedSequences = sequences.map((s: any) => {
		            const seqId = mkId('seq');
                const rawDecision = (s && typeof s === 'object' ? (s.sceneDecision || s.scenePlan || s.scene_strategy) : null) as any;
		            const rawScenes = Array.isArray(s?.scenes)
		              ? s.scenes
		              : [{ title: '', summary: '', shots: Array.isArray(s?.shots) ? s.shots : [] }];
		            let seqCounter = 0;
		            const mappedScenes = rawScenes.map((sc: any, scIdx: number) => {
		              const rawShots = Array.isArray(sc?.shots) ? sc.shots : [];
		              const mappedShots = rawShots.map((sh: any) => {
		                seqCounter += 1;
		                return mapShot(sh, seqCounter);
		              });
		              return {
		                id: mkId('scene'),
		                title: inferSceneTitle(sc?.title, rawShots, scIdx),
		                summary: String(sc?.summary || '').trim() || undefined,
		                shots: mappedShots,
		              };
		            });
		            const flatShots = mappedScenes.flatMap((sc: any) => sc.shots || []);
                const inferredSplit = mappedScenes.length > 1;
                const decisionSplit =
                  typeof rawDecision?.split === 'boolean'
                    ? rawDecision.split
                    : typeof rawDecision?.splitScenes === 'boolean'
                      ? rawDecision.splitScenes
                      : inferredSplit;
                const decisionSceneCountRaw =
                  typeof rawDecision?.sceneCount === 'number'
                    ? rawDecision.sceneCount
                    : typeof rawDecision?.count === 'number'
                      ? rawDecision.count
                      : mappedScenes.length || 1;
                const decisionSceneCount = Math.max(1, Math.min(8, Math.floor(decisionSceneCountRaw)));
                const decisionRationale =
                  String(rawDecision?.rationale || rawDecision?.reason || '').trim() ||
                  (Array.isArray(s?.scenes) && s.scenes.length
                    ? decisionSplit
                      ? `Split into ${decisionSceneCount} scenes based on narrative beats.`
                      : 'Kept as one scene for tighter continuity and flow.'
                    : 'No scene breakdown provided by scaffold; defaulted to 1 scene.');
                const decisionCriteria = Array.isArray(rawDecision?.criteria)
                  ? rawDecision.criteria.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 8)
                  : undefined;
		            return {
		              id: seqId,
		              title: String(s?.title || 'Sequence'),
		              context: String(s?.context || ''),
                  sceneDecision: {
                    split: Boolean(decisionSplit),
                    sceneCount: decisionSplit ? Math.max(2, decisionSceneCount) : 1,
                    rationale: decisionRationale,
                    ...(decisionCriteria?.length ? { criteria: decisionCriteria } : {}),
                  },
		              scenes: mappedScenes,
		              shots: flatShots,
		            };
		          });

	          // Ensure each mapped location appears in at least one shot to avoid orphan environment assets.
	          const usedLocationIds = new Set(
	            mappedSequences.flatMap((seq: any) => (seq.shots || []).map((sh: any) => String(sh?.locationId || ''))),
	          );
	          const missingLocations = mappedLocations.filter((loc: any) => !usedLocationIds.has(String(loc.id || '')));
	          if (missingLocations.length) {
	            if (!mappedSequences.length) {
	              mappedSequences.push({
	                id: mkId('seq'),
	                title: 'Sequence 1',
	                context: 'Auto-generated scaffold.',
	                scenes: [{ id: mkId('scene'), title: 'Scene 1', shots: [] }],
	                shots: [],
	              });
	            }
	            const targetSeq = mappedSequences[mappedSequences.length - 1];
	            if (!Array.isArray(targetSeq.scenes) || !targetSeq.scenes.length) {
	              targetSeq.scenes = [{ id: mkId('scene'), title: 'Scene 1', shots: [] }];
	            }
	            for (const loc of missingLocations) {
	              const nextNum = (targetSeq.shots || []).length + 1;
	              const filler = mapShot(
	                {
	                  locationName: String(loc?.name || ''),
	                  timeOfDay: 'Day',
	                  duration: 4,
	                  description: `Establishing shot of ${String(loc?.name || 'the location')}.`,
	                  script: '',
	                  camera: 'Wide establishing shot',
	                  lighting: 'Natural scene-consistent lighting',
	                  audio: 'Ambient environmental sound',
	                  videoPrompt: `Establishing shot of ${String(loc?.name || 'location')}, preserve environment continuity.`,
	                },
	                nextNum,
	              );
	              targetSeq.scenes[targetSeq.scenes.length - 1].shots.push(filler);
	              targetSeq.shots.push(filler);
	            }
	          }

	          return {
	            ok: true,
		            story: {
		              id: projectId,
		              title: String(spec?.title || intent.split(/\s+/).slice(0, 4).join(' ') || 'New Masterpiece'),
		              logline: String(spec?.logline || `An AI-directed story based on: "${intent}"`),
		              styleGuide,
		              intent,
		              keyVisualUrl:
		                keyVisualUrl ||
		                'https://images.unsplash.com/photo-1449156059431-789955fa190a?q=80&w=2070&auto=format&fit=crop',
	              aspectRatio,
	              status: 'ready',
	              createdAt: now,
	              updatedAt: now,
	              lastOpenedAt: now,
	              locations: mappedLocations,
	              characters: mappedCharacters,
	              sequences: mappedSequences.length
	                ? mappedSequences
	                : [{
	                    id: mkId('seq'),
	                    title: 'Sequence 1',
	                    context: 'Auto-generated scaffold.',
	                    scenes: [{ id: mkId('scene'), title: 'Scene 1', shots: [] }],
	                    shots: [],
	                  }],
	            },
	            plan: {
	              id: mkId('plan'),
	              summary: `Scaffolded a first-pass story structure (${source}).`,
	              steps: [
	                { id: mkId('step'), title: 'Director: define vision & constraints', status: 'done' },
	                { id: mkId('step'), title: 'Script Writer: screenplay beats + dialogue', status: 'done' },
	                { id: mkId('step'), title: 'Casting Director: characters + looks', status: 'done' },
	                { id: mkId('step'), title: 'Environment Director: locations/sets', status: 'done' },
	                { id: mkId('step'), title: 'Editor: sequences & shots', status: 'done' },
                { id: mkId('step'), title: 'Camera & Art: optional shooting advisory', status: 'done' },
	              ],
	              actions: [{ type: 'SCAFFOLD_PROJECT' }],
	            },
	            debug: { transport: 'http', provider: usedProvider, model: usedModel, source, ...(usedProvider === 'gemini' ? { gateway: 'gemini-direct' } : {}), ...(debugExtra || {}) },
	            bindingAudit,
	          };
	        };

        const chosenModel = (plannerModel || model).trim() || model;
        const chosenTemperature = plannerModel ? plannerTemperature : temperature;
        const chosenMaxOutputTokens = plannerModel ? plannerMaxOutputTokens : maxOutputTokens;
        const workerModel = model;
        const workerTemperature = temperature;
        const workerMaxOutputTokens = maxOutputTokens;
        const tokenFloor = 4096;
        const mergeTokenFloor = 8192;
        const resolvedScaffoldTokens = Math.max(tokenFloor, Number(chosenMaxOutputTokens ?? 0) || 0);
        const resolvedWorkerTokens = Math.max(tokenFloor, Number(workerMaxOutputTokens ?? 0) || 0);
        const resolvedMergeTokens = Math.max(mergeTokenFloor, Number(chosenMaxOutputTokens ?? 0) || 0);

        const attemptedProviders: string[] = [];
        let lastError: any = null;
	        for (const p of getProviderCandidates(provider, env)) {
	          attemptedProviders.push(p);
	          try {
		            if (p === 'gemini') {
		              const teamTrace: any[] = [];
		              const teamMessages: any[] = [];
		              const traceId = crypto.randomUUID();
			              const call = async (
			                agent: string,
			                prompt: string,
			                opts?: { model?: string; temperature?: number; maxOutputTokens?: number; responseSchema?: any },
			              ) => {
			                const started = Date.now();
			                const meta = getPromptMetaForAgent('scaffold', agent);
				                emit('progress', { agent, provider: p, model: String(opts?.model || chosenModel) });
				                try {
                          const runGemini = async (args: { promptText: string; temperature: number; maxTokens: number }) =>
                            callGeminiJson({
                              apiKey: geminiApiKey,
                              baseUrl: geminiBaseUrl || undefined,
                              model: String(opts?.model || chosenModel),
                              temperature: args.temperature,
                              maxOutputTokens: args.maxTokens,
                              prompt: args.promptText,
                              env,
                              responseSchema: opts?.responseSchema,
                            });
                          const baseTemp = Number(opts?.temperature ?? chosenTemperature);
                          const baseTokens = Number(opts?.maxOutputTokens ?? chosenMaxOutputTokens ?? 8192);
                          let retryUsed = false;
                          let outRes: any;
                          try {
                            outRes = await runGemini({ promptText: prompt, temperature: baseTemp, maxTokens: baseTokens });
                          } catch (firstErr: any) {
                            const firstMsg = String(firstErr?.message || firstErr || '');
                            const shouldRetryCompact = /not valid json/i.test(firstMsg);
                            if (!shouldRetryCompact) throw firstErr;
                            retryUsed = true;
                            const compactPrompt =
                              `${prompt}\n\n` +
                              `CRITICAL OUTPUT FIX:\n` +
                              `- Return ONLY one valid JSON object matching the schema.\n` +
                              `- No markdown/code fences/comments.\n` +
                              `- Keep all string fields concise.\n` +
                              `- If content is long, shorten prose but keep required keys complete.\n`;
                            outRes = await runGemini({
                              promptText: compactPrompt,
                              temperature: Math.min(baseTemp, 0.2),
                              maxTokens: Math.min(16384, Math.max(baseTokens + 1024, Math.floor(baseTokens * 1.5))),
                            });
                          }
                          const out = outRes.value;
				                  const trace = {
				                    agent,
				                    provider: p,
				                    model: String(opts?.model || chosenModel),
				                    ms: Date.now() - started,
				                    ok: true,
                            ...(retryUsed ? { retryUsed: 'compact-json' } : {}),
                            gateway: 'gemini-direct',
                            usage: outRes.usage,
				                    promptId: meta?.id,
				                    promptVersion: meta?.version,
				                  };
				                  teamTrace.push(trace);
				                  teamMessages.push({
			                    agent,
			                    ok: true,
			                    ms: trace.ms,
			                    promptId: meta?.id,
			                    promptVersion: meta?.version,
			                    promptPreview: String(prompt || '').slice(0, 800),
			                    responsePreview: JSON.stringify(out).slice(0, 1600),
			                  });
			                  emit('trace', trace);
			                  return out;
			                } catch (e: any) {
				                  const trace = {
				                    agent,
				                    provider: p,
				                    model: String(opts?.model || chosenModel),
				                    ms: Date.now() - started,
				                    ok: false,
				                    error: formatFetchError(e),
                            gateway: 'gemini-direct',
				                    promptId: meta?.id,
				                    promptVersion: meta?.version,
				                  };
			                  teamTrace.push(trace);
			                  teamMessages.push({
			                    agent,
			                    ok: false,
			                    ms: trace.ms,
			                    promptId: meta?.id,
			                    promptVersion: meta?.version,
			                    promptPreview: String(prompt || '').slice(0, 800),
			                    error: formatFetchError(e),
			                  });
			                  emit('trace', trace);
			                  throw e;
			                }
			              };

              try {
                const directorBrief = await call('director.brief', buildTeamScaffoldDirectorBriefPrompt({ intent, aspectRatio }), {
                  model: chosenModel,
                  temperature: chosenTemperature,
                  maxOutputTokens: resolvedScaffoldTokens,
                  responseSchema: GEMINI_SCHEMA.scaffoldDirectorBrief,
                });
                const directorBriefJson = JSON.stringify(directorBrief);
                const casting = await call('casting_director', buildTeamScaffoldCastingDirectorPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                  maxOutputTokens: resolvedWorkerTokens,
                  responseSchema: GEMINI_SCHEMA.scaffoldCasting,
                });
                const environmentSpec = await call('environment_director', buildTeamScaffoldEnvironmentDirectorPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                  maxOutputTokens: resolvedWorkerTokens,
                  responseSchema: GEMINI_SCHEMA.scaffoldEnvironments,
                });
                const scriptSpec = await call('script_writer', buildTeamScaffoldScriptWriterPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                  maxOutputTokens: resolvedWorkerTokens,
                  responseSchema: GEMINI_SCHEMA.scaffoldScript,
                });
                const editorSpec = await call(
                  'editor',
                  buildTeamScaffoldEditorPrompt({
                    directorBriefJson,
                    scriptJson: JSON.stringify(scriptSpec),
                    environmentJson: JSON.stringify(environmentSpec),
                  }),
                  { model: workerModel, temperature: workerTemperature, maxOutputTokens: resolvedWorkerTokens, responseSchema: GEMINI_SCHEMA.scaffoldEditor },
                );
                const buildCompactEditorForCameraArt = (editorLike: any) => {
                  const sequences = Array.isArray(editorLike?.sequences) ? editorLike.sequences : [];
                  return {
                    sequences: sequences.map((seq: any) => ({
                      title: String(seq?.title || 'Sequence'),
                      context: String(seq?.context || '').slice(0, 240),
                      scenes: (Array.isArray(seq?.scenes) ? seq.scenes : []).map((scene: any) => ({
                        title: String(scene?.title || 'Scene'),
                        summary: String(scene?.summary || '').slice(0, 220),
                        shots: (Array.isArray(scene?.shots) ? scene.shots : []).map((shot: any) => ({
                          description: String(shot?.description || shot?.beat || '').slice(0, 260),
                          timeOfDay: String(shot?.timeOfDay || '').slice(0, 60),
                          duration: Number(shot?.duration || 0),
                          locationName: String(shot?.locationName || '').slice(0, 100),
                          castNames: Array.isArray(shot?.castNames) ? shot.castNames.slice(0, 4).map((x: any) => String(x || '').slice(0, 48)) : [],
                          script: String(shot?.script || '').slice(0, 320),
                        })),
                      })),
                    })),
                  };
                };
                const countCompactEditorShots = (editorLike: any) => {
                  const seqs = Array.isArray(editorLike?.sequences) ? editorLike.sequences : [];
                  let count = 0;
                  for (const seq of seqs) {
                    const scenes = Array.isArray(seq?.scenes) ? seq.scenes : [];
                    for (const scene of scenes) {
                      const shots = Array.isArray(scene?.shots) ? scene.shots : [];
                      count += shots.length;
                    }
                  }
                  return count;
                };
                const buildCameraArtFallbackSpec = (briefLike: any, ar: string) => {
                  const styleBible = (briefLike && typeof briefLike === 'object' ? (briefLike as any).styleBible : {}) || {};
                  return {
                    shootingStyleSuggestion: [
                      'Advisory only.',
                      `Maintain ${String(ar || '16:9')} cinematic continuity and motivated camera movement.`,
                      styleBible.cameraLanguage ? `Camera language hint: ${String(styleBible.cameraLanguage).trim()}.` : '',
                    ]
                      .filter(Boolean)
                      .join(' '),
                    shotGuidelines: [
                      'Prioritize readable action transitions over decorative camera moves.',
                      'Preserve actor eye-line and movement continuity between adjacent shots.',
                      'Use movement only when it reveals story information.',
                    ],
                    equipmentChoices: ['24mm/35mm/50mm prime set', 'stabilized handheld or dolly', 'practical motivated lighting package'],
                  };
                };
                let cameraArtSpec: any;
                try {
                  const compactEditor = buildCompactEditorForCameraArt(editorSpec);
                  const shotCount = countCompactEditorShots(compactEditor);
                  if (!shotCount) {
                    cameraArtSpec = {};
                  } else {
                    const cameraArtPromise = call(
                      'camera_art',
                      buildTeamScaffoldCameraArtPrompt({
                        directorBriefJson,
                        editorJson: JSON.stringify(compactEditor),
                        aspectRatio,
                      }),
                      {
                        model: workerModel,
                        temperature: workerTemperature,
                        maxOutputTokens: Math.min(resolvedWorkerTokens, 4096),
                        responseSchema: GEMINI_SCHEMA.scaffoldCameraArt,
                      },
                    );
                    const timeoutMs = Math.max(25000, Math.min(60000, 20000 + shotCount * 1200));
                    const timeoutError = new Error(`camera_art timeout (${timeoutMs}ms)`);
                    cameraArtSpec = await Promise.race([
                      cameraArtPromise,
                      new Promise((_, reject) => setTimeout(() => reject(timeoutError), timeoutMs)),
                    ]);
                  }
                } catch (e: any) {
                  cameraArtSpec = buildCameraArtFallbackSpec(directorBrief, String(aspectRatio || '16:9'));
                  teamMessages.push({
                    agent: 'camera_art',
                    ok: false,
                    degraded: true,
                    error: `camera_art failed (non-blocking), used advisory fallback: ${formatFetchError(e)}`,
                  });
                }

                const spec = await call(
                  'director.merge',
                  buildTeamScaffoldDirectorMergePrompt({
                    directorBriefJson,
                    castingJson: JSON.stringify(casting),
                    environmentJson: JSON.stringify(environmentSpec),
                    editorJson: JSON.stringify(editorSpec),
                    cameraArtJson: JSON.stringify(cameraArtSpec),
                  }),
                  { model: chosenModel, temperature: chosenTemperature, maxOutputTokens: resolvedMergeTokens, responseSchema: GEMINI_SCHEMA.scaffoldFinal },
                );

			                return finish(
			                  200,
			                  buildFromSpec(spec, 'Multi-Agent (Gemini)', p, chosenModel, { teamTrace, teamMessages, traceId, mode: 'multi-agent' }),
			                );
			              } catch (e: any) {
			                // Fall back to a single-call scaffold for this provider if multi-agent fails.
			                lastError = e;
			                if (!allowSingleFallback) {
			                  return finish(502, {
			                    ok: false,
		                    errorCode: 'MULTI_AGENT_FAILED',
		                    message: 'Multi-agent scaffold failed',
		                    provider: p,
	                    model: chosenModel,
	                    traceId,
		                    teamTrace,
		                    teamMessages,
		                    multiAgentError: e?.message || String(e),
			                    attemptedProviders,
			                    mode: 'multi-agent',
			                  });
			                }
		                const started = Date.now();
		                const meta = getPromptMetaForAgent('scaffold', 'scaffold.single');
		                emit('progress', { agent: 'scaffold.single', provider: p, model: chosenModel });
			                const specRes = await callGeminiJson({
			                  apiKey: geminiApiKey,
                        baseUrl: geminiBaseUrl || undefined,
			                  model: chosenModel,
			                  temperature: chosenTemperature,
	                  maxOutputTokens: resolvedMergeTokens,
	                  prompt: scaffoldPrompt,
			                  env,
			                  responseSchema: GEMINI_SCHEMA.scaffoldFinal,
			                });
                      const spec = specRes.value;
				                const trace = {
				                  agent: 'scaffold.single',
				                  provider: p,
				                  model: chosenModel,
				                  ms: Date.now() - started,
				                  ok: true,
                          gateway: 'gemini-direct',
                          usage: specRes.usage,
				                  promptId: meta?.id,
				                  promptVersion: meta?.version,
				                };
			                teamTrace.push(trace);
			                teamMessages.push({
			                  agent: 'scaffold.single',
			                  ok: true,
			                  ms: trace.ms,
			                  promptId: meta?.id,
			                  promptVersion: meta?.version,
			                  promptPreview: String(scaffoldPrompt || '').slice(0, 800),
			                  responsePreview: JSON.stringify(spec).slice(0, 1600),
			                  multiAgentError: e?.message || String(e),
			                });
			                emit('trace', trace);
			                return finish(
			                  200,
			                  buildFromSpec(spec, 'Single-call (Gemini)', p, chosenModel, {
			                    teamTrace,
			                    teamMessages,
			                    traceId,
			                    mode: 'single-call',
			                    multiAgentError: e?.message || String(e),
			                  }),
			                );
			              }
		            }

		            if (p === 'openai') {
		              const teamTrace: any[] = [];
		              const traceId = crypto.randomUUID();
		              const call = async (agent: string, prompt: string, opts?: { model?: string; temperature?: number }) => {
		                const started = Date.now();
			                const meta = getPromptMetaForAgent('scaffold', agent);
			                emit('progress', { agent, provider: p, model: String(opts?.model || chosenModel) });
			                try {
			                  const outRes = await callOpenAICompatibleJson({
		                    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
		                    apiKey: env.OPENAI_API_KEY,
		                    model: String(opts?.model || chosenModel),
	                    temperature: Number(opts?.temperature ?? chosenTemperature),
			                    prompt,
			                    env,
			                  });
			                  const trace = {
			                    agent,
			                    provider: p,
			                    model: String(opts?.model || chosenModel),
			                    ms: Date.now() - started,
			                    ok: true,
                          usage: outRes.usage,
			                    promptId: meta?.id,
			                    promptVersion: meta?.version,
			                  };
			                  teamTrace.push(trace);
			                  emit('trace', trace);
			                  return outRes.value;
			                } catch (e: any) {
		                  const trace = {
		                    agent,
		                    provider: p,
		                    model: String(opts?.model || chosenModel),
		                    ms: Date.now() - started,
		                    ok: false,
		                    error: formatFetchError(e),
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  };
		                  teamTrace.push(trace);
		                  emit('trace', trace);
		                  throw e;
		                }
		              };

              try {
                const directorBrief = await call('director.brief', buildTeamScaffoldDirectorBriefPrompt({ intent, aspectRatio }), {
                  model: chosenModel,
                  temperature: chosenTemperature,
                });
                const directorBriefJson = JSON.stringify(directorBrief);
                const casting = await call('casting_director', buildTeamScaffoldCastingDirectorPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                });
                const environmentSpec = await call('environment_director', buildTeamScaffoldEnvironmentDirectorPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                });
                const scriptSpec = await call('script_writer', buildTeamScaffoldScriptWriterPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                });
                const editorSpec = await call(
                  'editor',
                  buildTeamScaffoldEditorPrompt({
                    directorBriefJson,
                    scriptJson: JSON.stringify(scriptSpec),
                    environmentJson: JSON.stringify(environmentSpec),
                  }),
                  { model: workerModel, temperature: workerTemperature },
                );
                const cameraArtSpec = await call(
                  'camera_art',
                  buildTeamScaffoldCameraArtPrompt({
                    directorBriefJson,
                    editorJson: JSON.stringify(editorSpec),
                    aspectRatio,
                  }),
                  { model: workerModel, temperature: workerTemperature },
                );

                const spec = await call(
                  'director.merge',
                  buildTeamScaffoldDirectorMergePrompt({
                    directorBriefJson,
                    castingJson: JSON.stringify(casting),
                    environmentJson: JSON.stringify(environmentSpec),
                    editorJson: JSON.stringify(editorSpec),
                    cameraArtJson: JSON.stringify(cameraArtSpec),
                  }),
                  { model: chosenModel, temperature: chosenTemperature },
                );

		                return finish(200, buildFromSpec(spec, 'Multi-Agent (OpenAI)', p, chosenModel, { teamTrace, traceId }));
		              } catch (e: any) {
		                lastError = e;
		                if (!allowSingleFallback) {
		                  return finish(502, {
		                    ok: false,
		                    errorCode: 'MULTI_AGENT_FAILED',
		                    message: 'Multi-agent scaffold failed',
	                    provider: p,
	                    model: chosenModel,
	                    traceId,
	                    teamTrace,
	                    multiAgentError: e?.message || String(e),
		                    attemptedProviders,
		                    mode: 'multi-agent',
		                  });
		                }
			                const started = Date.now();
			                const meta = getPromptMetaForAgent('scaffold', 'scaffold.single');
			                emit('progress', { agent: 'scaffold.single', provider: p, model: chosenModel });
			                const specRes = await callOpenAICompatibleJson({
			                  baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
			                  apiKey: env.OPENAI_API_KEY,
		                  model: chosenModel,
	                  temperature: chosenTemperature,
			                  prompt: scaffoldPrompt,
			                  env,
			                });
                      const spec = specRes.value;
			                const trace = {
			                  agent: 'scaffold.single',
			                  provider: p,
			                  model: chosenModel,
			                  ms: Date.now() - started,
			                  ok: true,
                        usage: specRes.usage,
			                  promptId: meta?.id,
			                  promptVersion: meta?.version,
			                };
		                teamTrace.push(trace);
		                emit('trace', trace);
		                return finish(
		                  200,
		                  buildFromSpec(spec, 'Single-call (OpenAI)', p, chosenModel, { teamTrace, traceId, multiAgentError: e?.message || String(e) }),
		                );
		              }
		            }

		            if (p === 'deepseek') {
		              const teamTrace: any[] = [];
		              const traceId = crypto.randomUUID();
		              const call = async (agent: string, prompt: string, opts?: { model?: string; temperature?: number }) => {
		                const started = Date.now();
			                const meta = getPromptMetaForAgent('scaffold', agent);
			                emit('progress', { agent, provider: p, model: String(opts?.model || chosenModel) });
			                try {
			                  const outRes = await callOpenAICompatibleJson({
		                    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
		                    apiKey: env.DEEPSEEK_API_KEY,
		                    model: String(opts?.model || chosenModel),
	                    temperature: Number(opts?.temperature ?? chosenTemperature),
			                    prompt,
			                    env,
			                  });
			                  const trace = {
			                    agent,
			                    provider: p,
			                    model: String(opts?.model || chosenModel),
			                    ms: Date.now() - started,
			                    ok: true,
                          usage: outRes.usage,
			                    promptId: meta?.id,
			                    promptVersion: meta?.version,
			                  };
			                  teamTrace.push(trace);
			                  emit('trace', trace);
			                  return outRes.value;
			                } catch (e: any) {
		                  const trace = {
		                    agent,
		                    provider: p,
		                    model: String(opts?.model || chosenModel),
		                    ms: Date.now() - started,
		                    ok: false,
		                    error: formatFetchError(e),
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  };
		                  teamTrace.push(trace);
		                  emit('trace', trace);
		                  throw e;
		                }
		              };

              try {
                const directorBrief = await call('director.brief', buildTeamScaffoldDirectorBriefPrompt({ intent, aspectRatio }), {
                  model: chosenModel,
                  temperature: chosenTemperature,
                });
                const directorBriefJson = JSON.stringify(directorBrief);
                const casting = await call('casting_director', buildTeamScaffoldCastingDirectorPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                });
                const environmentSpec = await call('environment_director', buildTeamScaffoldEnvironmentDirectorPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                });
                const scriptSpec = await call('script_writer', buildTeamScaffoldScriptWriterPrompt({ directorBriefJson }), {
                  model: workerModel,
                  temperature: workerTemperature,
                });
                const editorSpec = await call(
                  'editor',
                  buildTeamScaffoldEditorPrompt({
                    directorBriefJson,
                    scriptJson: JSON.stringify(scriptSpec),
                    environmentJson: JSON.stringify(environmentSpec),
                  }),
                  { model: workerModel, temperature: workerTemperature },
                );
                const cameraArtSpec = await call(
                  'camera_art',
                  buildTeamScaffoldCameraArtPrompt({
                    directorBriefJson,
                    editorJson: JSON.stringify(editorSpec),
                    aspectRatio,
                  }),
                  { model: workerModel, temperature: workerTemperature },
                );

                const spec = await call(
                  'director.merge',
                  buildTeamScaffoldDirectorMergePrompt({
                    directorBriefJson,
                    castingJson: JSON.stringify(casting),
                    environmentJson: JSON.stringify(environmentSpec),
                    editorJson: JSON.stringify(editorSpec),
                    cameraArtJson: JSON.stringify(cameraArtSpec),
                  }),
                  { model: chosenModel, temperature: chosenTemperature },
                );

		                return finish(200, buildFromSpec(spec, 'Multi-Agent (DeepSeek)', p, chosenModel, { teamTrace, traceId }));
		              } catch (e: any) {
		                lastError = e;
		                if (!allowSingleFallback) {
		                  return finish(502, {
		                    ok: false,
		                    errorCode: 'MULTI_AGENT_FAILED',
		                    message: 'Multi-agent scaffold failed',
	                    provider: p,
	                    model: chosenModel,
	                    traceId,
	                    teamTrace,
	                    multiAgentError: e?.message || String(e),
		                    attemptedProviders,
		                    mode: 'multi-agent',
		                  });
		                }
			                const started = Date.now();
			                const meta = getPromptMetaForAgent('scaffold', 'scaffold.single');
			                emit('progress', { agent: 'scaffold.single', provider: p, model: chosenModel });
			                const specRes = await callOpenAICompatibleJson({
			                  baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
			                  apiKey: env.DEEPSEEK_API_KEY,
		                  model: chosenModel,
	                  temperature: chosenTemperature,
			                  prompt: scaffoldPrompt,
			                  env,
			                });
                      const spec = specRes.value;
			                const trace = {
			                  agent: 'scaffold.single',
			                  provider: p,
			                  model: chosenModel,
			                  ms: Date.now() - started,
			                  ok: true,
                        usage: specRes.usage,
			                  promptId: meta?.id,
			                  promptVersion: meta?.version,
			                };
		                teamTrace.push(trace);
		                emit('trace', trace);
		                return finish(
		                  200,
		                  buildFromSpec(spec, 'Single-call (DeepSeek)', p, chosenModel, { teamTrace, traceId, multiAgentError: e?.message || String(e) }),
		                );
		              }
		            }
          } catch (e: any) {
            lastError = e;
	          }
	        }

	        const fallback = {
	          ...mock(),
	          debug: {
	            transport: 'mock',
	            provider,
	            model,
	            attemptedProviders,
	            error: lastError?.message || String(lastError || 'No provider keys configured'),
	          },
	        };

	        if (allowMockFallback) {
	          return finish(200, fallback as any);
	        }

	        return finish(502, {
	          ok: false,
	          errorCode: 'ALL_PROVIDERS_FAILED',
	          message: 'Scaffold failed (all providers)',
	          provider,
	          model,
	          attemptedProviders,
	          lastError: lastError ? formatFetchError(lastError) : undefined,
	        });
	      } finally {
	        if (heartbeat) clearInterval(heartbeat as any);
	      }
    };

    middlewares.use('/api/agent/scaffold/stream', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      const handled = await withPipelineTask(req, res, {
        kind: 'agent.scaffold',
        route: '/api/agent/scaffold/stream',
        run: async () => handleScaffold(req, res, { stream: true }),
      });
      if (handled == null) return;
      if (!handled) return next();
    });

    middlewares.use('/api/agent/scaffold', async (req, res, next) => {
      if (req.method !== 'POST') return next();
      const handled = await withPipelineTask(req, res, {
        kind: 'agent.scaffold',
        route: '/api/agent/scaffold',
        run: async () => handleScaffold(req, res, { stream: false }),
      });
      if (handled == null) return;
      if (!handled) return next();
    });

    const sendSse = (res: any, event: string, data: any) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    middlewares.use('/api/agent/direct', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        return withPipelineTask(req, res, {
          kind: 'agent.direct',
          route: '/api/agent/direct',
          run: async () => {
        const body = await readJsonBody(req);

        const message = String(body?.message || '').trim();
        const selection = body?.selection || {};
        const story = body?.story || null;
        const settings = body?.settings || {};
        const allowSingleFallback = Boolean(body?.allowSingleFallback);
        const useFunctionCalling = Boolean(body?.useFunctionCalling);
        const provider = String(settings?.provider || 'gemini');
        const model = String(settings?.model || 'gemini-3-flash-preview');
        const temperature = Number(settings?.temperature ?? 0.6);
        const maxOutputTokens = settings?.maxOutputTokens ? Number(settings.maxOutputTokens) : undefined;
        const tokenFloor = 4096;
        const mergeTokenFloor = 8192;
        const resolvedTokens = Math.max(tokenFloor, Number(maxOutputTokens ?? 0) || 0);
        const resolvedMergeTokens = Math.max(mergeTokenFloor, Number(maxOutputTokens ?? 0) || 0);
        const stream = Boolean(body?.useStreaming);

        if (stream) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders?.();
          sendSse(res, 'status', { message: 'Started' });
        }

        const emit = stream ? (event: string, data: any) => sendSse(res, event, data) : null;
        const sendResult = (payload: any, status = 200) => {
          if (!stream) return sendJson(res, status, payload);
          sendSse(res, 'result', payload);
          res.end();
          return true;
        };
        const sendError = (payload: any, status = 502) => {
          if (!stream) return sendJson(res, status, payload);
          sendSse(res, 'error', payload);
          res.end();
          return true;
        };

        if (!message) return sendError({ ok: false, error: 'Missing message' }, 400);

        const now = Date.now();
		        const mkId = (prefix: string) => `${prefix}-${now}-${Math.random().toString(16).slice(2, 8)}`;

        const directorActionsFunction = {
          name: 'director_actions',
          description: 'Return the final reply and structured actions to apply in the app.',
          parameters: schemaObject({
            required: ['reply', 'actions'],
            propertyOrdering: ['reply', 'actions'],
            properties: {
              reply: schemaString(),
              actions: schemaArray(
                schemaObject({
                  required: ['type'],
                  propertyOrdering: ['type', 'payload'],
                  properties: {
                    type: schemaString(),
                    payload: schemaObject({
                      // Keep permissive; prefer structured fields but allow _raw as escape hatch.
                      properties: {
                        _raw: schemaString(),
                        id: schemaString(),
                        parentId: schemaString(),
                        type: schemaString(),
                        characterId: schemaString(),
                        lookId: schemaString(),
                        name: schemaString(),
                        description: schemaString(),
                        locationId: schemaString(),
                        sequenceId: schemaString(),
                        shotId: schemaString(),
                        elementType: schemaString(),
                        prompt: schemaString(),
                        script: schemaString(),
                        timeOfDay: schemaString(),
                        duration: schemaInt(),
                        visualStyle: schemaString(),
                        status: schemaString(),
                        patch: schemaFreeformObject(),
                        metadata: schemaFreeformObject(),
                      },
                    }),
                  },
                }),
              ),
            },
          }),
        };

        const specialistResponseFunction = {
          name: 'specialist_response',
          description: 'Return specialist notes and suggested actions.',
          parameters: schemaObject({
            required: ['notes', 'suggestedActions'],
            propertyOrdering: ['notes', 'suggestedActions'],
            properties: {
              notes: schemaString(),
              suggestedActions: schemaArray(
                schemaObject({
                  required: ['type', 'payload'],
                  propertyOrdering: ['type', 'payload'],
                  properties: {
                    type: schemaString(),
                    payload: schemaFreeformObject(),
                  },
                }),
              ),
            },
          }),
        };

        const normalizeActionPayload = (payload: any) => {
          if (!payload || typeof payload !== 'object') return payload;
          const raw = (payload as any)?._raw;
          if (typeof raw === 'string' && raw.trim()) {
            const parsed = parseLooseJsonObject(raw);
            if (parsed && typeof parsed === 'object') return parsed;
          }
          return payload;
        };

        const extractLookFieldsFromText = (text: string) => {
          const s = String(text || '').trim();
          if (!s) return { characterId: '', name: '', description: '' };

          const pickFirst = (re: RegExp) => {
            const m = s.match(re);
            return m?.[1] ? String(m[1]).trim() : '';
          };

          const pickFirstAny = (re: RegExp) => {
            const m = s.match(re);
            if (!m) return '';
            const v = m?.[1] ?? m?.[0] ?? '';
            return String(v).trim();
          };

          // Sometimes specialists embed a JSON object inside a freeform sentence. Try extracting/parsing it.
          const embeddedJson = (() => {
            const m = s.match(/\{[\s\S]*\}/);
            const maybe = m?.[0] ? String(m[0]).trim() : '';
            if (!maybe) return null;
            const parsed = parseLooseJsonObject(maybe);
            return parsed && typeof parsed === 'object' ? (parsed as any) : null;
          })();
          if (embeddedJson) {
            const characterId = String(embeddedJson.characterId || embeddedJson.parentId || '').trim();
            const name = String(embeddedJson.name || '').trim();
            const description = String(embeddedJson.description || embeddedJson.desc || '').trim();
            if (characterId && name && description) return { characterId, name, description };
          }

          const characterId =
            pickFirst(/\breference\s*:\s*(char-[a-zA-Z0-9-]+)/i) ||
            pickFirst(/\bcharacterId\s*[:=]\s*(char-[a-zA-Z0-9-]+)/i) ||
            pickFirst(/\bparentId\s*[:=]\s*(char-[a-zA-Z0-9-]+)/i) ||
            pickFirstAny(/\((char-[a-zA-Z0-9-]+)\)/i) ||
            pickFirstAny(/\b(char-[a-zA-Z0-9-]+)\b/i);

          let name = pickFirst(/\bname\s*[:=]\s*([^\n\r]+)/i);
          if (name) {
            name = name
              .split(/(?:\bcharacter\b|\brequest\b|\breference\b|\bref\b)\s*[:(]/i)[0]
              .replace(/[.。]\s*$/g, '')
              .trim();
          }
          if (!name) {
            // Common merge format: "<desc> ## Look Name ## char-..."
            const m = s.match(/##\s*([^#\n\r]+?)\s*##/);
            if (m?.[1]) name = String(m[1]).trim();
          }
          if (!name) {
            // Sometimes the look name is emitted as a markdown heading.
            const m = s.match(/^\s*#{1,6}\s*([^\n\r#]+?)\s*#*\s*$/m);
            if (m?.[1]) name = String(m[1]).trim();
          }

          // Prefer explicit description field
          let description = pickFirst(/\bdescription\s*[:=]\s*([\s\S]+)$/i) || pickFirst(/\bdesc\s*[:=]\s*([\s\S]+)$/i);
          if (!description) {
            // Common pattern: "<description> Name: <name>. Character: ..."
            const mName = s.match(/\bname\s*[:=]\s*/i);
            if (mName && typeof mName.index === 'number') {
              description = s.slice(0, mName.index).trim();
            } else if (name) {
              // Alternate pattern: "... name: X - <description>"
              const mDash = s.match(/\bname\s*[:=]\s*[^\n\r-]+-\s*([\s\S]+)$/i);
              if (mDash?.[1]) description = String(mDash[1]).trim();
            }
          }
          if (!description) {
            // If we have a "## Name ##" marker, treat everything before it as description.
            const m = s.match(/##\s*([^#\n\r]+?)\s*##/);
            if (m && typeof (m as any).index === 'number') {
              const idx = (m as any).index as number;
              if (idx > 0) description = s.slice(0, idx).trim();
            }
          }
          description = String(description || '').trim();

          return {
            characterId: characterId.startsWith('char-') ? characterId : '',
            name: String(name || '').trim(),
            description,
          };
        };

        const normalizeAction = (action: any) => {
          let type = String(action?.type || '').trim();
          if (!type) return null;
          let payloadRaw = normalizeActionPayload(action?.payload);

          // Map common non-canonical action names from specialists into the app's action set.
          if (type === 'ADD_LOOK') type = 'CREATE_CHARACTER_LOOK';
          if (type === 'CREATE_LOOK') type = 'CREATE_CHARACTER_LOOK';
          if (type === 'CREATE_ELEMENT' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const elementType = String(p?.elementType || '').toUpperCase();
            if (elementType === 'LOOK') {
              type = 'CREATE_CHARACTER_LOOK';
              payloadRaw = {
                characterId: p.parentId,
                parentId: p.parentId,
                name: p.name,
                description: p.description,
                _raw: p._raw,
              };
            }
          }

          // Heuristic: Gemini schema-freeform payload sometimes comes back as {_raw:"{...}"} where the object contains
          // shorthand fields like {id, description}. Convert these into the app's expected payload shapes.
          if (type === 'UPDATE_ELEMENT' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const selType = String(selection?.type || '');
            const selSeqId = selType === 'sequence' ? String(selection?.id || '') : selType === 'shot' ? String(selection?.parentId || '') : '';

            // Shorthand camera update: {id:<shotId>, description:<cameraPrompt>}
            if (!p.sequenceId && !p.shotId && typeof p.id === 'string' && typeof p.description === 'string') {
              return {
                type,
                payload: {
                  sequenceId: selSeqId || String(p.sequenceId || ''),
                  shotId: String(p.id),
                  elementType: 'CAMERA',
                  prompt: String(p.description),
                },
              };
            }
            // Shorthand script update: {id:<shotId>, script:<scriptText>}
            if (!p.sequenceId && !p.shotId && typeof p.id === 'string' && typeof p.script === 'string') {
              return {
                type,
                payload: {
                  sequenceId: selSeqId || String(p.sequenceId || ''),
                  shotId: String(p.id),
                  elementType: 'SCRIPT',
                  prompt: String(p.script),
                },
              };
            }

            return { type, payload: p };
          }

          if (type === 'CREATE_CHARACTER_LOOK') {
            const selType = String(selection?.type || '');
            const selectedCharacterId = selType === 'character' ? String(selection?.id || '') : '';

            if (typeof payloadRaw === 'string' && payloadRaw.trim()) {
              const f = extractLookFieldsFromText(payloadRaw);
              const characterId = f.characterId || selectedCharacterId;
              if (characterId && f.name && f.description) return { type, payload: { characterId, name: f.name, description: f.description } };
            }

            if (payloadRaw && typeof payloadRaw === 'object') {
              const p: any = payloadRaw;
              // If merge returned payload as {_raw: "..."} keep parsing.
              if (typeof p._raw === 'string' && p._raw.trim()) {
                const f = extractLookFieldsFromText(String(p._raw));
                const characterId = f.characterId || selectedCharacterId;
                if (characterId && f.name && f.description) return { type, payload: { characterId, name: f.name, description: f.description } };
              }
              const characterId = String(p.characterId || p.parentId || selectedCharacterId || '').trim();
              const name = String(p.name || '').trim();
              const description = String(p.description || '').trim();
              if (characterId && name && description) return { type, payload: { characterId, name, description } };
            }
            return null;
          }

          if (type === 'UPDATE_CHARACTER_LOOK') {
            const selType = String(selection?.type || '');
            const selectedCharacterId = selType === 'character' ? String(selection?.id || '') : '';
            if (payloadRaw && typeof payloadRaw === 'object') {
              const p: any = payloadRaw;
              if (typeof p._raw === 'string' && p._raw.trim()) {
                // Support simple "reference: char-... lookId: ... name: ... description: ..."
                const rawText = String(p._raw);
                const pickFirst = (re: RegExp) => {
                  const m = rawText.match(re);
                  return m?.[1] ? String(m[1]).trim() : '';
                };
                const characterId =
                  pickFirst(/\breference\s*:\s*(char-[a-zA-Z0-9-]+)/i) ||
                  pickFirst(/\bcharacterId\s*[:=]\s*(char-[a-zA-Z0-9-]+)/i) ||
                  selectedCharacterId;
                const lookId = pickFirst(/\blookId\s*:\s*([a-zA-Z0-9-]+)/i);
                const name = pickFirst(/\bname\s*:\s*([^\n\r]+)/i);
                const description = pickFirst(/\bdescription\s*:\s*([\s\S]+)$/i);
                if (characterId && lookId) {
                  const patch: any = {};
                  if (name) patch.name = name;
                  if (description) patch.description = description;
                  return { type, payload: { characterId, lookId, patch } };
                }
              }
              const characterId = String(p.characterId || p.parentId || selectedCharacterId || '').trim();
              const lookId = String(p.lookId || p.id || '').trim();
              if (characterId && lookId) {
                const patch: any = p.patch && typeof p.patch === 'object' ? { ...p.patch } : {};
                if (typeof p.name === 'string') patch.name = p.name;
                if (typeof p.description === 'string') patch.description = p.description;
                return { type, payload: { characterId, lookId, patch } };
              }
              return { type, payload: p };
            }
          }

          if (type === 'UPDATE_SHOT' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            if (!p.shotId && typeof p.id === 'string') {
              const selType = String(selection?.type || '');
              const selSeqId = selType === 'sequence' ? String(selection?.id || '') : selType === 'shot' ? String(selection?.parentId || '') : '';
              return { type, payload: { shotId: String(p.id), sequenceId: selSeqId || String(p.sequenceId || ''), patch: { description: p.description } } };
            }
            return { type, payload: p };
          }

          if (type === 'UPDATE_CHARACTER' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            if (!p.characterId && typeof p.id === 'string') {
              return { type, payload: { characterId: String(p.id), patch: { name: p.name, description: p.description, status: p.status } } };
            }
            return { type, payload: p };
          }

          if (type === 'UPDATE_LOCATION' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const locationId = String(p.locationId || p.id || '').trim();
            if (locationId) {
              const patch: any = p.patch && typeof p.patch === 'object' ? { ...p.patch } : {};
              if (typeof p.name === 'string') patch.name = p.name;
              if (typeof p.description === 'string') patch.description = p.description;
              if (typeof p.visualStyle === 'string') patch.visualStyle = p.visualStyle;
              if (typeof p.status === 'string') patch.status = p.status;
              return { type, payload: { locationId, patch } };
            }
            return { type, payload: p };
          }

          if (type === 'UPDATE_STORY' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const patch: any = p.patch && typeof p.patch === 'object' ? { ...p.patch } : {};
            if (typeof p.title === 'string') patch.title = p.title;
            if (typeof p.logline === 'string') patch.logline = p.logline;
            if (typeof p.intent === 'string') patch.intent = p.intent;
            if (typeof p.keyVisualUrl === 'string') patch.keyVisualUrl = p.keyVisualUrl;
            return { type, payload: { patch } };
          }

          if (type === 'NAVIGATE' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const navType = String(p.type || p.targetType || '').trim();
            const id = String(p.id || p.targetId || '').trim();
            if (navType && id) return { type, payload: { type: navType, id } };
            return { type, payload: p };
          }

          if (type === 'CREATE_LOCATION' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            if (p._raw && typeof p._raw === 'string') {
              const parsed = parseLooseJsonObject(p._raw);
              if (parsed && typeof parsed === 'object') return { type, payload: parsed };
            }
            return { type, payload: p };
          }

          if (type === 'CREATE_CHARACTER' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            if (p._raw && typeof p._raw === 'string') {
              const parsed = parseLooseJsonObject(p._raw);
              if (parsed && typeof parsed === 'object') return { type, payload: parsed };
            }
            return { type, payload: p };
          }

          if (type === 'CREATE_SHOT' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const sequenceId = String(p.sequenceId || p.parentId || '').trim();
            if (sequenceId) return { type, payload: { ...p, sequenceId } };
            return { type, payload: p };
          }

          if (type === 'DELETE_SHOT' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const sequenceId = String(p.sequenceId || p.parentId || '').trim();
            const shotId = String(p.shotId || p.id || '').trim();
            if (sequenceId && shotId) return { type, payload: { sequenceId, shotId } };
            return { type, payload: p };
          }

          if (type === 'MOVE_SHOT' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const sequenceId = String(p.sequenceId || p.parentId || '').trim();
            const shotId = String(p.shotId || p.id || '').trim();
            if (sequenceId && shotId) return { type, payload: { ...p, sequenceId, shotId } };
            return { type, payload: p };
          }

          if (type === 'SET_CAST' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const sequenceId = String(p.sequenceId || p.parentId || '').trim();
            const shotId = String(p.shotId || p.id || '').trim();
            if (sequenceId && shotId) return { type, payload: { ...p, sequenceId, shotId } };
            return { type, payload: p };
          }

          if (type === 'GENERATE_CHARACTER_AVATAR' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const characterId = String(p.characterId || p.id || '').trim();
            if (characterId) return { type, payload: { characterId } };
            return { type, payload: p };
          }

          if (type === 'GENERATE_CHARACTER_LOOK' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const characterId = String(p.characterId || p.parentId || '').trim();
            const lookId = String(p.lookId || p.id || '').trim();
            if (characterId && lookId) return { type, payload: { characterId, lookId } };
            return { type, payload: p };
          }

          if (type === 'GENERATE_LOCATION_PREVIEW' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const locationId = String(p.locationId || p.id || '').trim();
            if (locationId) return { type, payload: { locationId } };
            return { type, payload: p };
          }

          if (type === 'GENERATE_SHOT_IMAGE' && payloadRaw && typeof payloadRaw === 'object') {
            const p: any = payloadRaw;
            const sequenceId = String(p.sequenceId || p.parentId || '').trim();
            const shotId = String(p.shotId || p.id || '').trim();
            if (sequenceId && shotId) return { type, payload: { sequenceId, shotId } };
            return { type, payload: p };
          }

          if (type === 'UPDATE_SHOT') {
            const p: any = payloadRaw || {};
            const shotId = String(p?.shotId || '').trim();
            if (!shotId) return null;
            return { type, payload: p };
          }

          if (type === 'CREATE_SHOT') {
            const p: any = payloadRaw || {};
            const sequenceId = String(p?.sequenceId || '').trim();
            if (!sequenceId) return null;
            return { type, payload: p };
          }

          if (type === 'UPDATE_ELEMENT') {
            const p: any = payloadRaw || {};
            const shotId = String(p?.shotId || '').trim();
            const sequenceId = String(p?.sequenceId || '').trim();
            const elementType = String(p?.elementType || '').trim();
            if (!shotId || !sequenceId || !elementType) return null;
            return { type, payload: p };
          }

          if (type === 'SET_CAST') {
            const p: any = payloadRaw || {};
            const shotId = String(p?.shotId || '').trim();
            const sequenceId = String(p?.sequenceId || '').trim();
            if (!shotId || !sequenceId) return null;
            return { type, payload: p };
          }

          if (payloadRaw && typeof payloadRaw === 'object') return { type, payload: payloadRaw };
          return { type, ...(payloadRaw !== undefined ? { payload: payloadRaw } : {}) };
        };

        const normalizeActions = (arr: any) => {
          const actions = Array.isArray(arr) ? arr : [];
          const normalized = actions.map(normalizeAction).filter(Boolean) as any[];
          const seen = new Set<string>();
          const sig = (a: any) => {
            const t = String(a?.type || '');
            const p = a?.payload;
            if (t === 'CREATE_CHARACTER_LOOK') {
              return `CREATE_CHARACTER_LOOK:${String(p?.characterId || '')}:${String(p?.name || '')}:${String(p?.description || '')}`;
            }
            try {
              return `${t}:${JSON.stringify(p)}`;
            } catch {
              return `${t}:${String(p)}`;
            }
          };
          return normalized.filter((a) => {
            const k = sig(a);
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        };

        const maybeInjectStyleGuide = (actions: any[], msg: string, storyObj: any) => {
          const text = String(msg || '').toLowerCase();
          const wantsStyle =
            /视觉|风格|视觉语言|美术|style|visual|art direction|主视觉|kv|key visual/.test(text);
          if (!wantsStyle) return actions;
          const hasStoryStyle = actions.some((a) => {
            if (a?.type !== 'UPDATE_STORY') return false;
            const patch = a?.payload?.patch || a?.payload || {};
            return typeof patch?.styleGuide === 'string' && String(patch.styleGuide || '').trim();
          });
          if (hasStoryStyle) return actions;

          let styleCandidate = '';
          for (const a of actions) {
            if (a?.type !== 'UPDATE_LOCATION') continue;
            const p = a?.payload || {};
            const patch = p?.patch || p;
            const v = String(patch?.visualStyle || '').trim();
            if (v) {
              styleCandidate = v;
              break;
            }
          }
          if (!styleCandidate) {
            for (const a of actions) {
              if (a?.type !== 'UPDATE_ELEMENT') continue;
              const p = a?.payload || {};
              const meta = p?.metadata || {};
              const v = String(meta?.videoPrompt || p?.prompt || '').trim();
              if (v) {
                styleCandidate = v;
                break;
              }
            }
          }
          if (!styleCandidate) return actions;

          const current = String(storyObj?.styleGuide || '').trim();
          if (styleCandidate && styleCandidate !== current) {
            return [
              ...actions,
              { type: 'UPDATE_STORY', payload: { patch: { styleGuide: styleCandidate } } },
            ];
          }
          return actions;
        };

		        const rule = () => {
		          const raw = message;
		          const lower = message.toLowerCase();
            const storyObj = story && typeof story === 'object' ? story : null;
            const safeArr = (v: any) => (Array.isArray(v) ? v : []);
            const findMentioned = (items: any[]) => {
              const found: any[] = [];
              for (const it of safeArr(items)) {
                const name = String(it?.name || '').toLowerCase();
                if (name && lower.includes(name)) found.push(it);
              }
              return found;
            };

	          const actions: any[] = [];
	          const notes: string[] = [];

            // Navigation
            if (['open', 'go to', 'goto', '打开', '进入', '跳转'].some((k) => lower.includes(k))) {
              const chars = storyObj ? findMentioned(safeArr((storyObj as any).characters)) : [];
              if (chars.length) {
                actions.push({ type: 'NAVIGATE', payload: { type: 'character', id: String(chars[0].id || '') } });
                notes.push('navigate → character');
              } else {
                const locs = storyObj ? findMentioned(safeArr((storyObj as any).locations)) : [];
                if (locs.length) {
                  actions.push({ type: 'NAVIGATE', payload: { type: 'location', id: String(locs[0].id || '') } });
                  notes.push('navigate → location');
                }
              }
            }

            // Simple story edits via "标题: xxx" / "logline: xxx"
            if (/(title|标题)\s*[:：]\s*/i.test(raw)) {
              const m = raw.match(/(?:title|标题)\s*[:：]\s*(.+)$/i);
              const title = m?.[1]?.trim();
              if (title) {
                actions.push({ type: 'UPDATE_STORY', payload: { patch: { title } } });
                notes.push('update story title');
              }
            }
            if (/(logline|一句话)\s*[:：]\s*/i.test(raw)) {
              const m = raw.match(/(?:logline|一句话)\s*[:：]\s*(.+)$/i);
              const logline = m?.[1]?.trim();
              if (logline) {
                actions.push({ type: 'UPDATE_STORY', payload: { patch: { logline } } });
                notes.push('update story logline');
              }
            }

            // Create sequence / shot
            if (['new sequence', '新增sequence', '新增段落', '新增序列', 'add sequence'].some((k) => lower.includes(k))) {
              actions.push({ type: 'CREATE_SEQUENCE', payload: {} });
              notes.push('create sequence');
            }
	            if (['new shot', '新增镜头', '新增分镜', '新增beat', 'add shot', 'add beat'].some((k) => lower.includes(k))) {
	              if (selection?.type === 'shot') {
	                const shotId = String(selection?.id || '');
	                const sequenceId = String(selection?.parentId || '');
	                if (shotId && sequenceId) {
	                  actions.push({ type: 'CREATE_SHOT', payload: { sequenceId, afterShotId: shotId } });
	                  notes.push('create shot (after current)');
	                }
	              } else if (selection?.type === 'sequence') {
	                const sequenceId = String(selection?.id || '');
	                if (sequenceId) {
	                  actions.push({ type: 'CREATE_SHOT', payload: { sequenceId } });
	                  notes.push('create shot (append)');
	                }
	              }
	            }

            // Create look (rule fallback)
            if (['new look', 'add look', 'create look', '新增look', '新增造型', '新增定妆', '新增服装', '新增造型照'].some((k) => lower.includes(k))) {
              const characters = storyObj ? findMentioned(safeArr((storyObj as any).characters)) : [];
              const characterId =
                selection?.type === 'character'
                  ? String(selection?.id || '')
                  : characters[0]?.id
                    ? String(characters[0].id)
                    : '';

              if (characterId) {
                const ch = storyObj ? safeArr((storyObj as any).characters).find((c: any) => String(c?.id || '') === characterId) : null;
                const n = (Array.isArray(ch?.looks) ? ch.looks.length : 0) + 1;
                const nameMatch =
                  raw.match(/(?:look|造型|定妆)\s*[:：]\s*([^\n,，;；]+)/i) ||
                  raw.match(/(?:叫|命名)\s*([^\n,，;；]+)/i) ||
                  raw.match(/new look\s+(.+)$/i);
                const name = String((nameMatch?.[1] || `Look ${n}`)).trim();
                const descMatch = raw.match(/(?:desc|description|描述)\s*[:：]\s*(.+)$/i);
                const description =
                  String(descMatch?.[1] || '').trim() ||
                  `Wardrobe/makeup/hair variation for ${String(ch?.name || 'this character')}. Keep identity consistent with the base avatar.`;

                actions.push({ type: 'CREATE_CHARACTER_LOOK', payload: { characterId, name, description } });
                notes.push('create character look');
              }
            }

	            // Shot structure edits
	            if (selection?.type === 'shot') {
	              const shotId = String(selection?.id || '');
	              const sequenceId = String(selection?.parentId || '');
	              if (shotId && sequenceId) {
                if (lower.includes('night') || lower.includes('夜')) {
                  actions.push({ type: 'UPDATE_SHOT', payload: { shotId, sequenceId, patch: { timeOfDay: 'Night' } } });
                  notes.push('shot time → night');
                }
                if (lower.includes('day') || lower.includes('白天')) {
                  actions.push({ type: 'UPDATE_SHOT', payload: { shotId, sequenceId, patch: { timeOfDay: 'Day' } } });
                  notes.push('shot time → day');
                }
                const locs = storyObj ? findMentioned(safeArr((storyObj as any).locations)) : [];
                if (locs.length) {
                  actions.push({ type: 'UPDATE_SHOT', payload: { shotId, sequenceId, patch: { locationId: String(locs[0].id || '') } } });
                  notes.push('shot environment → ' + String(locs[0].name || ''));
                }
                const chars = storyObj ? findMentioned(safeArr((storyObj as any).characters)) : [];
                if (chars.length && ['add', '加入', '加上', '加', 'cast'].some((k) => lower.includes(k))) {
                  const cast = chars.slice(0, 4).map((c: any) => ({ id: String(c?.id || ''), activeLookId: String(c?.looks?.[0]?.id || '') }));
                  actions.push({ type: 'SET_CAST', payload: { shotId, sequenceId, cast } });
                  notes.push('set cast');
                }
              }
            }

            const wantsGenerate = ['generate', 'render', 'asset', 'assets', 'image', 'images', '出图', '生成', '渲染', '资产', '缩略图'].some((k) =>
              lower.includes(k)
            );
            if (wantsGenerate) {
              if (selection?.type === 'shot') {
                const shotId = String(selection?.id || '');
                const sequenceId = String(selection?.parentId || '');
                if (shotId && sequenceId) {
                  actions.push({ type: 'GENERATE_SHOT_IMAGE', payload: { shotId, sequenceId } });
                  notes.push('generate shot image');
                }
              } else if (selection?.type === 'location') {
                const locationId = String(selection?.id || '');
                if (locationId) {
                  actions.push({ type: 'GENERATE_LOCATION_PREVIEW', payload: { locationId } });
                  notes.push('generate location preview');
                }
	              } else if (selection?.type === 'character') {
	                const characterId = String(selection?.id || '');
	                if (characterId) {
	                  actions.push({ type: 'GENERATE_CHARACTER_AVATAR', payload: { characterId } });
	                  notes.push('generate character avatar');
	                }
	              } else {
	                const scope = ['kv', 'key visual', '主视觉', '主kv'].some((k) => lower.includes(k))
                    ? 'masterkv'
                    : ['shot', 'shots', '镜头', '分镜'].some((k) => lower.includes(k))
	                    ? 'shots'
	                  : ['location', 'locations', '环境', '置景'].some((k) => lower.includes(k))
	                    ? 'locations'
	                    : ['character', 'characters', '角色', '人物'].some((k) => lower.includes(k))
	                      ? 'characters'
	                      : ['look', 'looks', '造型'].some((k) => lower.includes(k))
	                        ? 'looks'
	                        : 'all';
	                actions.push({ type: 'GENERATE_PROJECT_ASSETS', payload: { scope, concurrency: 2 } });
	                notes.push(`generate project assets (${scope})`);
	              }
	            }

	          if (selection?.type === 'shot') {
	            const shotId = String(selection?.id || '');
	            const sequenceId = String(selection?.parentId || '');

	            if (shotId && sequenceId) {
	              if (lower.includes('close up') || lower.includes('close-up') || lower.includes('closeup') || lower.includes('特写')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'CAMERA', prompt: 'Close-up shot, subject-isolated framing' },
	                });
	                notes.push('camera → close-up');
	              }

	              if (lower.includes('wide') || lower.includes('establishing') || lower.includes('远景') || lower.includes('全景')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'CAMERA', prompt: 'Wide establishing shot, layered composition' },
	                });
	                notes.push('camera → wide');
	              }

	              if (lower.includes('warmer') || lower.includes('warm') || lower.includes('暖')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'LIGHTING', prompt: 'Warm lighting, golden tones' },
	                });
	                notes.push('lighting → warmer');
	              }

	              if (lower.includes('cooler') || lower.includes('cool') || lower.includes('冷')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'LIGHTING', prompt: 'Cool lighting, blue tones' },
	                });
	                notes.push('lighting → cooler');
	              }
	            }
	          }

	          return {
	            reply: actions.length
	              ? `I mapped your directive into ${actions.length} structured change(s): ${notes.join(', ')}.`
	              : `I couldn't map that into a structured change yet. Try: "warmer light", "close up", "wide establishing".`,
	            plan: {
	              id: mkId('plan'),
	              summary: notes.length > 0 ? `Proposed edits: ${notes.join(', ')}` : 'No structured edits recognized (rule-based).',
	              steps: [
	                { id: mkId('step'), title: 'Parse directive', status: 'done' },
	                { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
	              ],
	              actions,
	            },
	            actions,
	            debug: { transport: 'rule', provider, model },
	          };
	        };

	        // For now, we keep direct as a thin wrapper; the frontend already has a rule-based fallback.
	        // When keys are configured, Gemini can propose UPDATE_ELEMENT actions as JSON.
          const attemptedProviders: string[] = [];
          let lastError: any = null;
          const selectionJson = JSON.stringify(selection || {});
          const storySummary = story ? summarizeStoryForPrompt(story, selection) : null;
          const storyJson = storySummary ? JSON.stringify(storySummary) : '{}';
          const allowedActionsText = [
            'NAVIGATE',
            'UPDATE_STORY',
            'CREATE_LOCATION',
            'DELETE_LOCATION',
            'UPDATE_LOCATION',
            'CREATE_CHARACTER',
            'DELETE_CHARACTER',
            'UPDATE_CHARACTER',
            'CREATE_CHARACTER_LOOK',
            'UPDATE_CHARACTER_LOOK',
            'CREATE_SEQUENCE',
            'RENAME_SEQUENCE',
            'DELETE_SEQUENCE',
            'CREATE_SHOT',
            'MOVE_SHOT',
            'DELETE_SHOT',
            'UPDATE_SHOT',
            'UPDATE_ELEMENT',
            'SET_CAST',
            'GENERATE_PROJECT_ASSETS',
            'GENERATE_SHOT_IMAGE',
            'GENERATE_LOCATION_PREVIEW',
            'GENERATE_CHARACTER_AVATAR',
            'GENERATE_CHARACTER_LOOK',
          ].join(', ');
          for (const p of getProviderCandidates(provider, env)) {
            attemptedProviders.push(p);
            try {
			          if (p === 'gemini' && geminiApiKey && geminiBaseUrl) {
		              const teamTrace: any[] = [];
		              const teamMessages: any[] = [];
		              const traceId = crypto.randomUUID();
	              const call = async (agent: string, prompt: string, responseSchema?: any) => {
	                const started = Date.now();
	                const meta = getPromptMetaForAgent('direct', agent);
	                emit?.('agent_start', { agent });
	                try {
	                  const outRes = await callGeminiJson({
                      apiKey: geminiApiKey,
                      baseUrl: geminiBaseUrl || undefined,
                      model,
                      temperature,
                      maxOutputTokens: resolvedTokens,
                      prompt,
                      env,
                      responseSchema,
                    });
                      const out = outRes.value;
	                  teamTrace.push({
	                    agent,
	                    provider: p,
	                    model,
	                    ms: Date.now() - started,
	                    ok: true,
                      gateway: 'gemini-direct',
                      usage: outRes.usage,
	                    promptId: meta?.id,
	                    promptVersion: meta?.version,
	                  });
	                  emit?.('agent_done', { agent, ok: true, ms: Date.now() - started });
	                  teamMessages.push({
                    agent,
                    ok: true,
                    ms: Date.now() - started,
                    promptId: meta?.id,
                    promptVersion: meta?.version,
                    promptPreview: String(prompt || '').slice(0, 800),
                    responsePreview: JSON.stringify(out).slice(0, 1600),
                  });
                  return out;
                } catch (e: any) {
                  teamTrace.push({
                    agent,
                    provider: p,
                    model,
                    ms: Date.now() - started,
                    ok: false,
                    error: formatFetchError(e),
                    promptId: meta?.id,
                    promptVersion: meta?.version,
                  });
                  emit?.('agent_done', { agent, ok: false, ms: Date.now() - started, error: formatFetchError(e) });
                  teamMessages.push({
                    agent,
                    ok: false,
                    ms: Date.now() - started,
                    promptId: meta?.id,
                    promptVersion: meta?.version,
                    promptPreview: String(prompt || '').slice(0, 800),
                    error: formatFetchError(e),
                  });
                  throw e;
                }
              };

              try {
                const planner = useFunctionCalling
                  ? await (async () => {
                      const started = Date.now();
                      const meta = getPromptMetaForAgent('direct', 'director.plan');
                      emit?.('agent_start', { agent: 'director.plan' });
	                      let toolOut: any;
	                      try {
	                        toolOut = await callGeminiToolCall({
	                          apiKey: geminiApiKey,
                            baseUrl: geminiBaseUrl || undefined,
	                          model,
	                          temperature,
	                          maxOutputTokens: resolvedTokens,
                          prompt:
                            buildTeamDirectPlannerPrompt({
                              selectionJson,
                              storyJson,
                              directive: message,
                            }) + `\n\nIMPORTANT: You MUST call the function \"plan_response\" exactly once. Do not output JSON text.`,
                          env,
                          functionDeclarations: [
                            {
                              name: 'plan_response',
                              description: 'Return planner selection of agents to consult and focus areas.',
                              parameters: GEMINI_SCHEMA.directorPlan,
                            },
                          ],
                          allowedFunctionNames: ['plan_response'],
                        });
                      } catch (e: any) {
                        emit?.('agent_done', { agent: 'director.plan', ok: false, ms: Date.now() - started, error: formatFetchError(e) });
                        throw e;
                      }
	                      teamTrace.push({
	                        agent: 'director.plan',
	                        provider: p,
	                        model,
	                        ms: Date.now() - started,
	                        ok: true,
                          gateway: 'gemini-direct',
                          usage: toolOut?.usage,
	                        promptId: meta?.id,
	                        promptVersion: meta?.version,
	                      });
                      emit?.('agent_done', { agent: 'director.plan', ok: true, ms: Date.now() - started });
                      teamMessages.push({
                        agent: 'director.plan',
                        ok: true,
                        ms: Date.now() - started,
                        promptId: meta?.id,
                        promptVersion: meta?.version,
                        promptPreview: String(buildTeamDirectPlannerPrompt({ selectionJson, storyJson, directive: message }) || '').slice(0, 800),
                        responsePreview: JSON.stringify(toolOut?.args || {}).slice(0, 1600),
                        toolCall: toolOut?.name,
                      });
                      return toolOut?.args || {};
                    })()
                  : await call(
                      'director.plan',
                      buildTeamDirectPlannerPrompt({
                        selectionJson,
                        storyJson,
                        directive: message,
                      }),
                      GEMINI_SCHEMA.directorPlan,
                    );
                const requestedAgentsRaw = Array.isArray(planner?.requestedAgents) ? planner.requestedAgents : [];
                const requestedAgents = adjustRequestedAgents(requestedAgentsRaw as any, selection, message);
                const allowedAgents = new Set(['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art']);
                const uniqAgents: string[] = Array.from(
                  new Set(requestedAgents.map((x: any) => String(x || '').trim()).filter((x: string) => allowedAgents.has(x))),
                );
                const focusObj: Record<string, unknown> =
                  planner?.focus && typeof planner.focus === 'object' && !Array.isArray(planner.focus) ? (planner.focus as any) : {};

                const specialistJsonByAgent: Record<string, string> = {};
                const specialistResultsByAgent: Record<string, any> = {};
                const specialistErrors: Array<{ agent: string; error: string }> = [];
                for (const a of uniqAgents.slice(0, 4)) {
                  const focus = typeof focusObj[a] === 'string' ? String(focusObj[a]) : '';
                    try {
                      const specialistStoryJson = JSON.stringify(
                        summarizeStoryForSpecialistPrompt(storySummary, a as string) || storySummary || {},
                      );
                      const prompt = buildTeamDirectSpecialistPrompt({
                        agent: a as any,
                        focus,
                        selectionJson,
                        storyJson: specialistStoryJson,
                        directive: message,
                      });
                      const out = useFunctionCalling
                        ? await (async () => {
                            const started = Date.now();
                            const meta = getPromptMetaForAgent('direct', a);
                            emit?.('agent_start', { agent: a });
	                            let toolOut: any;
	                            try {
	                              toolOut = await callGeminiToolCall({
	                                apiKey: geminiApiKey,
                                  baseUrl: geminiBaseUrl || undefined,
	                                model,
	                                temperature,
	                                maxOutputTokens: resolvedTokens,
	                                prompt: prompt + `\n\nIMPORTANT: You MUST call the function \"specialist_response\" exactly once. Do not output JSON text.`,
	                                env,
	                                functionDeclarations: [specialistResponseFunction],
	                                allowedFunctionNames: ['specialist_response'],
	                              });
                            } catch (e: any) {
                              emit?.('agent_done', { agent: a, ok: false, ms: Date.now() - started, error: formatFetchError(e) });
                              throw e;
                            }
	                            teamTrace.push({
	                              agent: a,
	                              provider: p,
	                              model,
	                              ms: Date.now() - started,
	                              ok: true,
                                gateway: 'gemini-direct',
                                usage: toolOut?.usage,
	                              promptId: meta?.id,
	                              promptVersion: meta?.version,
	                            });
                            emit?.('agent_done', { agent: a, ok: true, ms: Date.now() - started });
                            teamMessages.push({
                              agent: a,
                              ok: true,
                              ms: Date.now() - started,
                              promptId: meta?.id,
                              promptVersion: meta?.version,
                              promptPreview: String(prompt || '').slice(0, 600),
                              responsePreview: JSON.stringify(toolOut?.args || {}).slice(0, 1600),
                              toolCall: toolOut?.name,
                            });
                            return toolOut?.args || {};
                          })()
                        : await call(a, prompt, GEMINI_SCHEMA.directorSpecialist);
                      const suggested = normalizeActions(out?.suggestedActions);
                      const normalized = { ...(out || {}), suggestedActions: suggested };
                      specialistResultsByAgent[a] = normalized;
                      specialistJsonByAgent[a] = JSON.stringify(normalized);
                    } catch (e: any) {
                      const err = formatFetchError(e);
                      specialistErrors.push({ agent: a, error: err });
                      specialistResultsByAgent[a] = { notes: '', suggestedActions: [], error: err };
                      specialistJsonByAgent[a] = JSON.stringify({ notes: '', suggestedActions: [], error: err });
                      continue;
                    }
                }

                emit?.('status', { message: 'Merging…' });
                const mergePrompt = buildTeamDirectMergePrompt({
	                    selectionJson,
	                    storyJson,
	                    directive: message,
	                    plannerJson: JSON.stringify(planner || {}),
	                    specialistJsonByAgent,
	                    allowedActionsText,
	                  });

                  const final = useFunctionCalling
                    ? await (async () => {
                        const started = Date.now();
                        const meta = getPromptMetaForAgent('direct', 'director.merge');
	                        emit?.('agent_start', { agent: 'director.merge' });
	                        let out: any;
	                        try {
	                          out = await callGeminiToolCall({
	                            apiKey: geminiApiKey,
                              baseUrl: geminiBaseUrl || undefined,
	                            model,
	                            temperature,
	                            maxOutputTokens: resolvedMergeTokens,
	                            prompt:
	                              mergePrompt +
	                              `\n\nIMPORTANT: You MUST call the function \"director_actions\" exactly once. Do not output JSON text.`,
	                            env,
	                            functionDeclarations: [directorActionsFunction],
	                            allowedFunctionNames: ['director_actions'],
	                          });
                        } catch (e: any) {
                          emit?.('agent_done', { agent: 'director.merge', ok: false, ms: Date.now() - started, error: formatFetchError(e) });
                          throw e;
                        }
	                        teamTrace.push({
	                          agent: 'director.merge',
	                          provider: p,
	                          model,
	                          ms: Date.now() - started,
	                          ok: true,
                            gateway: 'gemini-direct',
                            usage: out?.usage,
	                          promptId: meta?.id,
	                          promptVersion: meta?.version,
	                        });
                        emit?.('agent_done', { agent: 'director.merge', ok: true, ms: Date.now() - started });
                        teamMessages.push({
                          agent: 'director.merge',
                          ok: true,
                          ms: Date.now() - started,
                          promptId: meta?.id,
                          promptVersion: meta?.version,
                          promptPreview: String(mergePrompt || '').slice(0, 800),
                          responsePreview: JSON.stringify(out?.args || {}).slice(0, 1600),
                          toolCall: out?.name,
                        });
                        return out?.args || {};
                      })()
                    : await call('director.merge', mergePrompt, GEMINI_SCHEMA.directorFinal);

	                const actions = maybeInjectStyleGuide(normalizeActions(final?.actions), message, story);
	                const taskCheck = {
                  requested: uniqAgents,
                  errors: specialistErrors,
                  empty: uniqAgents.filter((a) => !specialistErrors.find((x) => x.agent === a) && (specialistResultsByAgent[a]?.suggestedActions || []).length === 0),
                };
                const response = {
		                  reply: String(final?.reply || planner?.reply || 'OK'),
	                  plan: {
	                    id: mkId('plan'),
	                    summary: uniqAgents.length ? `Multi-agent consult: ${uniqAgents.join(', ')}` : 'Multi-agent director (no consult needed).',
                    steps: [
                      { id: mkId('step'), title: 'Director: plan', status: 'done' },
                      ...(uniqAgents.map((a: string) => {
                          const failed = specialistErrors.find((x) => x.agent === a);
                          const hasActions = (specialistResultsByAgent[a]?.suggestedActions || []).length > 0;
                          return { id: mkId('step'), title: `Specialist: ${a}`, status: failed || !hasActions ? 'error' : 'done' };
                        }) as any),
                      { id: mkId('step'), title: 'Director: merge actions', status: 'done' },
                    ],
                    actions,
	                  },
	                  actions,
		                  debug: {
	                        transport: 'http',
	                        provider: p,
	                        model,
                          gateway: 'gemini-direct',
	                        teamTrace,
	                        teamMessages,
	                        traceId,
	                        mode: useFunctionCalling ? 'multi-agent-fc' : 'multi-agent',
	                        specialistErrors,
	                        taskCheck,
	                      },
	                };
	                return sendResult(response, 200);
				              } catch (e: any) {
			                lastError = e;
                if (!allowSingleFallback) {
                  return sendError({
                    ok: false,
                    errorCode: 'MULTI_AGENT_FAILED',
                    message: 'Multi-agent director failed',
                    provider: p,
                    model,
                    traceId,
                    teamTrace,
                    teamMessages,
                    multiAgentError: e?.message || String(e),
                    mode: 'multi-agent',
                  }, 502);
                }
		                // Single-call fallback
                const started = Date.now();
                const meta = getPromptMetaForAgent('direct', 'director.actions');
                emit?.('agent_start', { agent: 'director.actions' });
                const singlePrompt = buildDirectorActionsPrompt({
	                    selectionJson,
	                    storyJson: story ? storyJson : undefined,
	                    directive: message,
		                  });
	                    let output: any;
                      let outputUsage: TokenUsage | undefined;
	                    try {
	                      if (useFunctionCalling) {
                          const toolRes = await callGeminiToolCall({
                            apiKey: geminiApiKey,
                            baseUrl: geminiBaseUrl || undefined,
                            model,
                            temperature,
                            maxOutputTokens: resolvedMergeTokens,
                            prompt:
                              singlePrompt +
                              `\n\nIMPORTANT: You MUST call the function \"director_actions\" exactly once. Do not output JSON text.`,
                            env,
                            functionDeclarations: [directorActionsFunction],
                            allowedFunctionNames: ['director_actions'],
                          });
                          output = toolRes.args;
                          outputUsage = toolRes.usage;
                        } else {
                          const outRes = await callGeminiJson({
                            apiKey: geminiApiKey,
                            baseUrl: geminiBaseUrl || undefined,
                            model,
                            temperature,
                            maxOutputTokens: resolvedMergeTokens,
                            prompt: singlePrompt,
                            env,
                          });
                          output = outRes.value;
                          outputUsage = outRes.usage;
                        }
	                    } catch (e: any) {
	                      emit?.('agent_done', { agent: 'director.actions', ok: false, ms: Date.now() - started, error: formatFetchError(e) });
	                      throw e;
	                    }
	                teamTrace.push({
	                  agent: 'director.actions',
	                  provider: p,
	                  model,
	                  ms: Date.now() - started,
	                  ok: true,
                    gateway: 'gemini-direct',
                    usage: outputUsage,
	                  promptId: meta?.id,
	                  promptVersion: meta?.version,
	                });
                emit?.('agent_done', { agent: 'director.actions', ok: true, ms: Date.now() - started });
			                teamMessages.push({
			                  agent: 'director.actions',
			                  ok: true,
			                  ms: Date.now() - started,
			                  promptId: meta?.id,
			                  promptVersion: meta?.version,
		                  promptPreview: String(
		                    buildDirectorActionsPrompt({
		                      selectionJson,
		                      storyJson: story ? storyJson : undefined,
		                      directive: message,
		                    }),
		                  ).slice(0, 600),
			                  responsePreview: JSON.stringify(output).slice(0, 1600),
			                  multiAgentError: e?.message || String(e),
			                });
			                const actions = maybeInjectStyleGuide(normalizeActions(output?.actions), message, story);
			                const response = {
			                  reply: String(output?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: 'Generated structured actions (Gemini, single-call fallback).',
                    steps: [
                      { id: mkId('step'), title: 'Parse directive', status: 'done' },
                      { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
                    ],
                    actions,
                  },
                  actions,
	                  debug: {
	                    transport: 'http',
	                    provider: p,
	                    model,
                      gateway: 'gemini-direct',
	                    teamTrace,
	                    teamMessages,
	                    traceId,
	                    mode: useFunctionCalling ? 'single-call-fc' : 'single-call',
	                    multiAgentError: e?.message || String(e),
	                  },
			                };
			                return sendResult(response, 200);
			              }
			          }

		          if (p === 'openai' && env.OPENAI_API_KEY) {
	              const teamTrace: any[] = [];
	              const traceId = crypto.randomUUID();
	              const call = async (agent: string, prompt: string) => {
		                const started = Date.now();
		                const meta = getPromptMetaForAgent('direct', agent);
		                try {
		                  const outRes = await callOpenAICompatibleJson({
	                    baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
	                    apiKey: env.OPENAI_API_KEY,
	                    model,
	                    temperature,
		                    prompt,
		                    env,
		                  });
		                  teamTrace.push({
		                    agent,
		                    provider: p,
		                    model,
		                    ms: Date.now() - started,
		                    ok: true,
                        usage: outRes.usage,
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  });
		                  return outRes.value;
		                } catch (e: any) {
	                  teamTrace.push({
	                    agent,
	                    provider: p,
	                    model,
	                    ms: Date.now() - started,
	                    ok: false,
	                    error: formatFetchError(e),
                      gateway: 'gemini-direct',
	                    promptId: meta?.id,
	                    promptVersion: meta?.version,
	                  });
	                  throw e;
	                }
	              };

              try {
                emit?.('status', { message: 'Planning…' });
                const planner = await call(
                  'director.plan',
                  buildTeamDirectPlannerPrompt({
                    selectionJson,
                    storyJson,
                    directive: message,
                  }),
                );
                const requestedAgentsRaw = Array.isArray(planner?.requestedAgents) ? planner.requestedAgents : [];
                const requestedAgents = adjustRequestedAgents(requestedAgentsRaw as any, selection, message);
                const allowedAgents = new Set(['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art']);
                const uniqAgents: string[] = Array.from(
                  new Set(requestedAgents.map((x: any) => String(x || '').trim()).filter((x: string) => allowedAgents.has(x))),
                );
                const focusObj: Record<string, unknown> =
                  planner?.focus && typeof planner.focus === 'object' && !Array.isArray(planner.focus) ? (planner.focus as any) : {};

                const specialistJsonByAgent: Record<string, string> = {};
                const specialistResultsByAgent: Record<string, any> = {};
                for (const a of uniqAgents.slice(0, 4)) {
                  const focus = typeof focusObj[a] === 'string' ? String(focusObj[a]) : '';
                  emit?.('status', { message: `Consulting ${a}…` });
                  const specialistStoryJson = JSON.stringify(
                    summarizeStoryForSpecialistPrompt(storySummary, a as string) || storySummary || {},
                  );
                  const out = await call(
                    a,
                    buildTeamDirectSpecialistPrompt({
                      agent: a as any,
                      focus,
                      selectionJson,
                      storyJson: specialistStoryJson,
                      directive: message,
                    }),
                  );
                  const suggested = normalizeActions(out?.suggestedActions);
                  const normalized = { ...(out || {}), suggestedActions: suggested };
                  specialistResultsByAgent[a] = normalized;
                  specialistJsonByAgent[a] = JSON.stringify(normalized);
                }

                const final = await call(
                  'director.merge',
                  buildTeamDirectMergePrompt({
                    selectionJson,
                    storyJson,
                    directive: message,
                    plannerJson: JSON.stringify(planner || {}),
                    specialistJsonByAgent,
                    allowedActionsText,
                  }),
                );
                const actions = Array.isArray(final?.actions) ? final.actions : [];
                const taskCheck = {
                  requested: uniqAgents,
                  empty: uniqAgents.filter((a) => (specialistResultsByAgent[a]?.suggestedActions || []).length === 0),
                };
                const response = {
                  reply: String(final?.reply || planner?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: uniqAgents.length ? `Multi-agent consult: ${uniqAgents.join(', ')}` : 'Multi-agent director (no consult needed).',
                    steps: [
                      { id: mkId('step'), title: 'Director: plan', status: 'done' },
                      ...(uniqAgents.map((a: string) => {
                        const hasActions = (specialistResultsByAgent[a]?.suggestedActions || []).length > 0;
                        return { id: mkId('step'), title: `Specialist: ${a}`, status: hasActions ? 'done' : 'error' };
                      }) as any),
                      { id: mkId('step'), title: 'Director: merge actions', status: 'done' },
                    ],
                    actions,
	                  },
                  actions,
                  debug: { transport: 'http', provider: p, model, teamTrace, traceId, mode: 'multi-agent', taskCheck },
                };
                return sendResult(response, 200);
	              } catch (e: any) {
	                lastError = e;
                if (!allowSingleFallback) {
                  return sendError({
                    ok: false,
                    errorCode: 'MULTI_AGENT_FAILED',
                    message: 'Multi-agent director failed',
                    provider: p,
                    model,
                    traceId,
                    teamTrace,
                    multiAgentError: e?.message || String(e),
                    mode: 'multi-agent',
                  }, 502);
                }
		                const started = Date.now();
		                const meta = getPromptMetaForAgent('direct', 'director.actions');
		                const outputRes = await callOpenAICompatibleJson({
		                  baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
		                  apiKey: env.OPENAI_API_KEY,
	                  model,
	                  temperature,
	                  prompt: buildDirectorActionsPrompt({
	                    selectionJson,
	                    storyJson: story ? storyJson : undefined,
	                    directive: message,
		                  }),
		                  env,
		                });
                    const output = outputRes.value;
		                teamTrace.push({
		                  agent: 'director.actions',
		                  provider: p,
		                  model,
		                  ms: Date.now() - started,
		                  ok: true,
                      usage: outputRes.usage,
		                  promptId: meta?.id,
		                  promptVersion: meta?.version,
		                });
                const actions = Array.isArray(output?.actions) ? output.actions : [];
                const response = {
                  reply: String(output?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: 'Generated structured actions (OpenAI, single-call fallback).',
                    steps: [
                      { id: mkId('step'), title: 'Parse directive', status: 'done' },
                      { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
                    ],
                    actions,
	                  },
                  actions,
                  debug: { transport: 'http', provider: p, model, teamTrace, traceId, mode: 'single-call', multiAgentError: e?.message || String(e) },
                };
                return sendResult(response, 200);
	              }
		          }

		          if (p === 'deepseek' && env.DEEPSEEK_API_KEY) {
	              const teamTrace: any[] = [];
	              const traceId = crypto.randomUUID();
	              const call = async (agent: string, prompt: string) => {
		                const started = Date.now();
		                const meta = getPromptMetaForAgent('direct', agent);
		                try {
		                  const outRes = await callOpenAICompatibleJson({
	                    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
	                    apiKey: env.DEEPSEEK_API_KEY,
	                    model,
	                    temperature,
		                    prompt,
		                    env,
		                  });
		                  teamTrace.push({
		                    agent,
		                    provider: p,
		                    model,
		                    ms: Date.now() - started,
		                    ok: true,
                        usage: outRes.usage,
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  });
		                  return outRes.value;
		                } catch (e: any) {
	                  teamTrace.push({
	                    agent,
	                    provider: p,
	                    model,
	                    ms: Date.now() - started,
	                    ok: false,
	                    error: formatFetchError(e),
	                    promptId: meta?.id,
	                    promptVersion: meta?.version,
	                  });
	                  throw e;
	                }
	              };

              try {
                const planner = await call(
                  'director.plan',
                  buildTeamDirectPlannerPrompt({
                    selectionJson,
                    storyJson,
                    directive: message,
                  }),
                );
                const requestedAgentsRaw = Array.isArray(planner?.requestedAgents) ? planner.requestedAgents : [];
                const requestedAgents = adjustRequestedAgents(requestedAgentsRaw as any, selection, message);
                const allowedAgents = new Set(['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art']);
                const uniqAgents: string[] = Array.from(
                  new Set(requestedAgents.map((x: any) => String(x || '').trim()).filter((x: string) => allowedAgents.has(x))),
                );
                const focusObj: Record<string, unknown> =
                  planner?.focus && typeof planner.focus === 'object' && !Array.isArray(planner.focus) ? (planner.focus as any) : {};

                const specialistJsonByAgent: Record<string, string> = {};
                const specialistResultsByAgent: Record<string, any> = {};
                for (const a of uniqAgents.slice(0, 4)) {
                  const focus = typeof focusObj[a] === 'string' ? String(focusObj[a]) : '';
                  const specialistStoryJson = JSON.stringify(
                    summarizeStoryForSpecialistPrompt(storySummary, a as string) || storySummary || {},
                  );
                  const out = await call(
                    a,
                    buildTeamDirectSpecialistPrompt({
                      agent: a as any,
                      focus,
                      selectionJson,
                      storyJson: specialistStoryJson,
                      directive: message,
                    }),
                  );
                  const suggested = normalizeActions(out?.suggestedActions);
                  const normalized = { ...(out || {}), suggestedActions: suggested };
                  specialistResultsByAgent[a] = normalized;
                  specialistJsonByAgent[a] = JSON.stringify(normalized);
                }

                const final = await call(
                  'director.merge',
                  buildTeamDirectMergePrompt({
                    selectionJson,
                    storyJson,
                    directive: message,
                    plannerJson: JSON.stringify(planner || {}),
                    specialistJsonByAgent,
                    allowedActionsText,
                  }),
                );
                const actions = Array.isArray(final?.actions) ? final.actions : [];
                const taskCheck = {
                  requested: uniqAgents,
                  empty: uniqAgents.filter((a) => (specialistResultsByAgent[a]?.suggestedActions || []).length === 0),
                };
                const response = {
                  reply: String(final?.reply || planner?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: uniqAgents.length ? `Multi-agent consult: ${uniqAgents.join(', ')}` : 'Multi-agent director (no consult needed).',
                    steps: [
                      { id: mkId('step'), title: 'Director: plan', status: 'done' },
                      ...(uniqAgents.map((a: string) => {
                        const hasActions = (specialistResultsByAgent[a]?.suggestedActions || []).length > 0;
                        return { id: mkId('step'), title: `Specialist: ${a}`, status: hasActions ? 'done' : 'error' };
                      }) as any),
                      { id: mkId('step'), title: 'Director: merge actions', status: 'done' },
                    ],
                    actions,
	                  },
                  actions,
                  debug: { transport: 'http', provider: p, model, teamTrace, traceId, mode: 'multi-agent', taskCheck },
                };
                return sendResult(response, 200);
	              } catch (e: any) {
	                lastError = e;
                if (!allowSingleFallback) {
                  return sendError({
                    ok: false,
                    errorCode: 'MULTI_AGENT_FAILED',
                    message: 'Multi-agent director failed',
                    provider: p,
                    model,
                    traceId,
                    teamTrace,
                    multiAgentError: e?.message || String(e),
                    mode: 'multi-agent',
                  }, 502);
                }
		                const started = Date.now();
		                const meta = getPromptMetaForAgent('direct', 'director.actions');
		                const outputRes = await callOpenAICompatibleJson({
		                  baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
		                  apiKey: env.DEEPSEEK_API_KEY,
	                  model,
	                  temperature,
	                  prompt: buildDirectorActionsPrompt({
	                    selectionJson,
	                    storyJson: story ? storyJson : undefined,
	                    directive: message,
		                  }),
		                  env,
		                });
                    const output = outputRes.value;
		                teamTrace.push({
		                  agent: 'director.actions',
		                  provider: p,
		                  model,
		                  ms: Date.now() - started,
		                  ok: true,
                      usage: outputRes.usage,
		                  promptId: meta?.id,
		                  promptVersion: meta?.version,
		                });
                const actions = Array.isArray(output?.actions) ? output.actions : [];
                const response = {
                  reply: String(output?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: 'Generated structured actions (DeepSeek, single-call fallback).',
                    steps: [
                      { id: mkId('step'), title: 'Parse directive', status: 'done' },
                      { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
                    ],
                    actions,
	                  },
                  actions,
                  debug: { transport: 'http', provider: p, model, teamTrace, traceId, mode: 'single-call', multiAgentError: e?.message || String(e) },
                };
                return sendResult(response, 200);
	              }
		          }
            } catch (e: any) {
              lastError = e;
            }
          }

          const fallback = rule();
          return sendResult({
            ...fallback,
            debug: {
              transport: 'rule',
              provider,
              model,
              attemptedProviders,
              error: lastError?.message || String(lastError || 'No provider keys configured'),
            },
          }, 200);
          },
        });
      });
  };

  return {
    name: 'vision-studio-agent-api',
    configureServer(server) {
      applyRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      applyRoutes(server.middlewares);
    },
  };
};

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), agentApiPlugin(env)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
