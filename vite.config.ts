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
import { getPromptMetaForAgent } from './lib/ai/promptMeta';
import { ProxyAgent } from 'undici';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const GENERATED_ASSETS_DIR = path.resolve(process.cwd(), '.vision-assets');

type GeminiResponseSchema = any;
const schemaString = (): GeminiResponseSchema => ({ type: 'STRING' });
const schemaInt = (): GeminiResponseSchema => ({ type: 'INTEGER' });
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
          required: ['title', 'context', 'shots'],
          propertyOrdering: ['title', 'context', 'shots'],
          properties: {
            title: schemaString(),
            context: schemaString(),
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
  scaffoldCameraArt: schemaObject({
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
                required: ['camera', 'lighting', 'audio', 'videoPrompt'],
                propertyOrdering: ['camera', 'lighting', 'audio', 'videoPrompt'],
                properties: {
                  camera: schemaString(),
                  lighting: schemaString(),
                  audio: schemaString(),
                  videoPrompt: schemaString(),
                },
              }),
            ),
          },
        }),
      ),
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
          required: ['title', 'context', 'shots'],
          propertyOrdering: ['title', 'context', 'shots'],
          properties: {
            title: schemaString(),
            context: schemaString(),
            shots: schemaArray(
              schemaObject({
                required: [
                  'description',
                  'timeOfDay',
                  'duration',
                  'camera',
                  'lighting',
                  'audio',
                  'locationName',
                  'castNames',
                  'script',
                  'videoPrompt',
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
                  videoPrompt: schemaString(),
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

const ensureGeneratedDir = () => {
  try {
    fs.mkdirSync(GENERATED_ASSETS_DIR, { recursive: true });
  } catch {
    // ignore
  }
};

const safeGeneratedAssetPath = (urlPathname: string) => {
  const decoded = decodeURIComponent(String(urlPathname || ''));
  // Accept either a full pathname (`/__generated__/file.png`) or a relative-ish path.
  let rel = decoded.split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!rel) return null;

  // Map `/__generated__/file.png` -> `.vision-assets/file.png`
  if (rel === '__generated__') return null;
  if (rel.startsWith('__generated__/')) rel = rel.slice('__generated__/'.length);

  // Hardening: only allow a single filename (no subdirs).
  if (!rel) return null;
  if (rel.includes('..') || rel.includes('\\') || rel.includes('/')) return null;
  return path.join(GENERATED_ASSETS_DIR, rel);
};

const mimeByExt = (ext: string) => {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
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
  const raw = String(env?.COMPASS_GATEWAY_URL || env?.GATEWAY_URL || env?.GEMINI_BASE_URL || '').trim();
  if (raw) return raw.replace(/\/$/, '');
  return 'https://generativelanguage.googleapis.com/v1beta';
};

const buildGeminiGenerateContentUrl = (args: { env?: Record<string, string>; model: string }) => {
  const baseUrl = resolveGeminiBaseUrl(args.env);
  return `${baseUrl}/models/${encodeURIComponent(args.model)}:generateContent`;
};

const callGeminiJson = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  prompt: string;
  env?: Record<string, string>;
  responseSchema?: any;
}): Promise<any> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model });
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
        return res;
      } finally {
        clearTimeout(timeout);
      }
    },
    { label: `gemini.json:${args.model}`, maxAttempts },
  );

  const data = (await res.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Gemini: missing text response');
  return parseJsonLenient(text);
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
}): Promise<{ name: string; args: any; raw: any }> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model });
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

  const data = (await res.json()) as any;
  const parts = data?.candidates?.[0]?.content?.parts;
  const list = Array.isArray(parts) ? parts : [];
  const fc = list.find((p: any) => p && typeof p === 'object' && (p.functionCall || p.function_call));
  const call = (fc?.functionCall || fc?.function_call) as any;
  if (!call?.name) {
    const preview = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    throw new Error(`Gemini: missing functionCall. Preview: ${String(preview || JSON.stringify(data)).slice(0, 240)}`);
  }
  return { name: String(call.name), args: call.args ?? {}, raw: data };
};

const callOpenAICompatibleJson = async (args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  prompt: string;
  env?: Record<string, string>;
}): Promise<any> => {
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
  return JSON.parse(content);
};

type ModelProvider = 'gemini' | 'openai' | 'deepseek';

const getProviderCandidates = (preferred: string, env: Record<string, string>): ModelProvider[] => {
  const all: ModelProvider[] = ['gemini', 'openai', 'deepseek'];
  const pref = all.includes(preferred as any) ? (preferred as ModelProvider) : null;
  const unique = [pref, ...all].filter(Boolean) as ModelProvider[];

  const hasKey = (p: ModelProvider) => {
    if (p === 'gemini') return Boolean(env.COMPASS_API_KEY || env.GEMINI_API_KEY);
    if (p === 'openai') return Boolean(env.OPENAI_API_KEY);
    if (p === 'deepseek') return Boolean(env.DEEPSEEK_API_KEY);
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

const summarizeStoryForPrompt = (story: any) => {
  if (!story || typeof story !== 'object') return null;
  const trim = (v: any, n: number) => String(v || '').slice(0, n);
  const safeArr = (v: any) => (Array.isArray(v) ? v : []);

  const locations = safeArr(story.locations).slice(0, 30).map((l: any) => ({
    id: String(l?.id || ''),
    name: trim(l?.name, 60),
    description: trim(l?.description, 120),
    visualStyle: trim(l?.visualStyle, 80),
  }));

  const characters = safeArr(story.characters).slice(0, 30).map((c: any) => ({
    id: String(c?.id || ''),
    name: trim(c?.name, 60),
    description: trim(c?.description, 140),
    looks: safeArr(c?.looks)
      .slice(0, 10)
      .map((lk: any) => ({ id: String(lk?.id || ''), name: trim(lk?.name, 60), description: trim(lk?.description, 140) })),
  }));

  const sequences = safeArr(story.sequences).slice(0, 20).map((s: any) => ({
    id: String(s?.id || ''),
    title: trim(s?.title, 80),
    shots: safeArr(s?.shots)
      .slice(0, 20)
      .map((sh: any) => ({
        id: String(sh?.id || ''),
        sequence: Number(sh?.sequence || 0),
        locationId: String(sh?.locationId || ''),
        description: trim(sh?.description, 120),
      })),
  }));

  return {
    id: String(story.id || ''),
    title: trim(story.title, 120),
    logline: trim(story.logline, 220),
    intent: trim(story.intent, 220),
    aspectRatio: String(story.aspectRatio || ''),
    counts: {
      locations: safeArr(story.locations).length,
      characters: safeArr(story.characters).length,
      sequences: safeArr(story.sequences).length,
    },
    locations,
    characters,
    sequences,
  };
};

const callGeminiImage = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  prompt: string;
  aspectRatio?: string;
  references?: Array<{ mimeType: string; bytes: Buffer; label?: string }>;
  env?: Record<string, string>;
}): Promise<{ mimeType: string; bytes: Buffer }> => {
  const url = buildGeminiGenerateContentUrl({ env: args.env, model: args.model });
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
  const data = await withRetries(
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

  const parts = (data?.candidates?.[0]?.content?.parts || []) as any[];
  const inline = parts.find((p) => p?.inlineData?.data || p?.inline_data?.data);
  const inlineData = inline?.inlineData || inline?.inline_data;
  const mimeType = String(inlineData?.mimeType || inlineData?.mime_type || 'image/png');
  const b64 = inlineData?.data;
  if (typeof b64 !== 'string' || !b64) throw new Error('Gemini Image: missing inlineData');
  return { mimeType, bytes: Buffer.from(b64, 'base64') };
};

const agentApiPlugin = (env: Record<string, string>): Plugin => {
  // Support calling Gemini through internal gateways (e.g. Compass) by setting:
  // - COMPASS_API_KEY / COMPASS_GATEWAY_URL (or GATEWAY_URL)
  // Falls back to direct Google Gemini via GEMINI_API_KEY.
  const geminiApiKey = String(env.COMPASS_API_KEY || env.GEMINI_API_KEY || '').trim();
  const geminiBaseUrl = resolveGeminiBaseUrl(env);

  const applyRoutes = (middlewares: any) => {
    middlewares.use('/__generated__', async (req: any, res: any, next: any) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const pathname = String(req?.url || '').split('?')[0];
      const filePath = safeGeneratedAssetPath(pathname);
      if (!filePath) {
        res.statusCode = 400;
        return res.end('Bad path');
      }
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          res.statusCode = 404;
          return res.end('Not found');
        }
        res.statusCode = 200;
        res.setHeader('content-type', mimeByExt(path.extname(filePath)));
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.statusCode = 404;
        return res.end('Not found');
      }
    });

	    middlewares.use('/api/asset/image/generate', async (req, res, next) => {
	      if (req.method !== 'POST') return next();
	        const body = await readJsonBody(req);

	        const prompt = String(body?.prompt || '').trim();
	        const aspectRatio = body?.aspectRatio ? String(body.aspectRatio) : undefined;
	        const referencesRaw = Array.isArray(body?.references) ? body.references : [];
	        const requireAllReferences = Boolean(body?.requireAllReferences);
	        const settings = body?.settings || {};
	        const provider = String(settings?.provider || 'gemini');
	        const model = String(settings?.model || 'nano-banana-pro');
	        const temperature = Number(settings?.temperature ?? 0.6);

        if (!prompt) return sendJson(res, 400, { ok: false, error: 'Missing prompt' });

        const promptPreview = prompt.slice(0, 120);

        try {
          if (provider === 'gemini' && geminiApiKey) {
            const usedModel = normalizeGeminiImageModel(model);
            ensureGeneratedDir();

	            const loadReference = async (url: string): Promise<{ mimeType: string; bytes: Buffer } | null> => {
	              const u = String(url || '').trim();
	              if (!u) return null;

	              // Local generated assets: /__generated__/...
	              if (u.startsWith('/__generated__/')) {
	                const clean = u.split('?')[0].split('#')[0];
	                const filePath = safeGeneratedAssetPath(clean);
	                if (!filePath) return null;
	                const bytes = await fs.promises.readFile(filePath);
	                const mimeType = mimeByExt(path.extname(filePath));
	                return { mimeType, bytes };
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

		            const out = await callGeminiImage({
		              apiKey: geminiApiKey,
		              model: usedModel,
		              temperature,
		              prompt,
		              aspectRatio,
		              references: loadedRefs,
		              env,
		            });

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
              .update(`${usedModel}\n${aspectRatio || ''}\n${prompt}`)
              .digest('hex')
              .slice(0, 16);
            const filename = `${Date.now()}-${hash}.${ext}`;
            fs.writeFileSync(path.join(GENERATED_ASSETS_DIR, filename), out.bytes);
            return sendJson(res, 200, {
              imageUrl: `/__generated__/${filename}`,
		              debug: {
		                transport: 'http',
		                provider,
		                model: usedModel,
                    baseUrl: geminiBaseUrl,
		                mimeType: out.mimeType,
		                bytes: out.bytes.length,
		                promptPreview,
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
      const model = String(settings?.model || 'gemini-3-pro-preview');
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
            'Style Guide: cinematic, cohesive art direction; consistent palette and lighting language; stable character identity; avoid drastic style shifts.',
          intent,
          keyVisualUrl: keyVisualUrl || 'https://images.unsplash.com/photo-1449156059431-789955fa190a?q=80&w=2070&auto=format&fit=crop',
          aspectRatio,
          status: 'ready',
              createdAt: now,
              updatedAt: now,
              lastOpenedAt: now,
              locations: [],
              characters: [],
              sequences: [{ id: mkId('seq'), title: 'Sequence 1', context: 'Auto-generated scaffold.', shots: [] }],
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

	        const buildFromSpec = (spec: any, source: string, usedProvider: string, usedModel: string, debugExtra?: any) => {
	          // Minimal mapping into the app's Story schema. IDs generated server-side for stability.
	          const projectId = mkId('proj');
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
	          const styleGuide = styleGuideRaw || styleGuideFallback();

          const locByName = new Map<string, any>();
          const mappedLocations = locations.map((l: any) => {
            const id = mkId('loc');
            const item = {
              id,
              name: String(l?.name || 'Environment'),
              description: String(l?.description || ''),
              visualStyle: String(l?.visualStyle || ''),
              previewUrl: 'https://images.unsplash.com/photo-1555680202-c86f0e12f086?q=80&w=2070&auto=format&fit=crop',
              status: 'draft',
            };
            locByName.set(item.name.toLowerCase(), item);
            return item;
          });

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

	          const mappedSequences = sequences.map((s: any) => {
	            const seqId = mkId('seq');
	            const shots = Array.isArray(s?.shots) ? s.shots : [];
	            const mappedShots = shots.map((sh: any, idx: number) => {
	              const locationName = String(sh?.locationName || '').toLowerCase();
	              const loc = (locationName && locByName.get(locationName)) || mappedLocations[0];
	              const castNames = Array.isArray(sh?.castNames) ? sh.castNames : [];
	              const cast = castNames
	                .map((n: any) => {
	                  const ch = charByName.get(String(n || '').toLowerCase());
	                  if (!ch) return null;
	                  const activeLookId = ch.looks?.[0]?.id || '';
	                  return { id: ch.id, activeLookId };
	                })
	                .filter(Boolean);

	              return {
	                id: mkId('shot'),
	                sequence: idx + 1,
	                locationId: loc?.id || '',
	                timeOfDay: String(sh?.timeOfDay || 'Day'),
	                description: String(sh?.description || `Shot ${idx + 1}`),
	                duration: Number(sh?.duration || 4),
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
	                  CAMERA: { type: 'CAMERA', prompt: String(sh?.camera || 'Cinematic shot'), status: 'auto', metadata: { videoPrompt: String(sh?.videoPrompt || '') } },
	                  LIGHTING: { type: 'LIGHTING', prompt: String(sh?.lighting || 'Cinematic lighting'), status: 'auto' },
	                  AUDIO: { type: 'AUDIO', prompt: String(sh?.audio || 'Ambient sound'), status: 'auto' },
	                },
	                aiState: 'idle',
	              };
	            });

	            return {
	              id: seqId,
	              title: String(s?.title || 'Sequence'),
	              context: String(s?.context || ''),
	              shots: mappedShots,
	            };
	          });

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
	                : [{ id: mkId('seq'), title: 'Sequence 1', context: 'Auto-generated scaffold.', shots: [] }],
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
	                { id: mkId('step'), title: 'Camera & Art: shot settings + video prompts', status: 'done' },
	              ],
	              actions: [{ type: 'SCAFFOLD_PROJECT' }],
	            },
	            debug: { transport: 'http', provider: usedProvider, model: usedModel, source, ...(debugExtra || {}) },
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
			                  const out = await callGeminiJson({
	                    apiKey: geminiApiKey,
	                    model: String(opts?.model || chosenModel),
                    temperature: Number(opts?.temperature ?? chosenTemperature),
                    maxOutputTokens: Number(opts?.maxOutputTokens ?? chosenMaxOutputTokens ?? 8192),
                    prompt,
                    env,
                    responseSchema: opts?.responseSchema,
                  });
			                  const trace = {
			                    agent,
			                    provider: p,
			                    model: String(opts?.model || chosenModel),
			                    ms: Date.now() - started,
			                    ok: true,
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
                const cameraArtSpec = await call(
                  'camera_art',
                  buildTeamScaffoldCameraArtPrompt({
                    directorBriefJson,
                    editorJson: JSON.stringify(editorSpec),
                    aspectRatio,
                  }),
                  { model: workerModel, temperature: workerTemperature, maxOutputTokens: resolvedWorkerTokens, responseSchema: GEMINI_SCHEMA.scaffoldCameraArt },
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
		                const spec = await callGeminiJson({
		                  apiKey: geminiApiKey,
		                  model: chosenModel,
		                  temperature: chosenTemperature,
                  maxOutputTokens: resolvedMergeTokens,
                  prompt: scaffoldPrompt,
		                  env,
		                  responseSchema: GEMINI_SCHEMA.scaffoldFinal,
		                });
			                const trace = {
			                  agent: 'scaffold.single',
			                  provider: p,
			                  model: chosenModel,
			                  ms: Date.now() - started,
			                  ok: true,
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
		                  const out = await callOpenAICompatibleJson({
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
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  };
		                  teamTrace.push(trace);
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
		                const spec = await callOpenAICompatibleJson({
		                  baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
		                  apiKey: env.OPENAI_API_KEY,
	                  model: chosenModel,
                  temperature: chosenTemperature,
		                  prompt: scaffoldPrompt,
		                  env,
		                });
		                const trace = {
		                  agent: 'scaffold.single',
		                  provider: p,
		                  model: chosenModel,
		                  ms: Date.now() - started,
		                  ok: true,
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
		                  const out = await callOpenAICompatibleJson({
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
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  };
		                  teamTrace.push(trace);
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
		                const spec = await callOpenAICompatibleJson({
		                  baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
		                  apiKey: env.DEEPSEEK_API_KEY,
	                  model: chosenModel,
                  temperature: chosenTemperature,
		                  prompt: scaffoldPrompt,
		                  env,
		                });
		                const trace = {
		                  agent: 'scaffold.single',
		                  provider: p,
		                  model: chosenModel,
		                  ms: Date.now() - started,
		                  ok: true,
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
      const handled = await handleScaffold(req, res, { stream: true });
      if (!handled) return next();
    });

    middlewares.use('/api/agent/scaffold', async (req, res, next) => {
      const handled = await handleScaffold(req, res, { stream: false });
      if (!handled) return next();
    });

    middlewares.use('/api/agent/direct', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const body = await readJsonBody(req);

        const message = String(body?.message || '').trim();
        const selection = body?.selection || {};
        const story = body?.story || null;
        const settings = body?.settings || {};
        const allowSingleFallback = Boolean(body?.allowSingleFallback);
        const useFunctionCalling = Boolean(body?.useFunctionCalling);
        const provider = String(settings?.provider || 'gemini');
        const model = String(settings?.model || 'gemini-3-pro-preview');
        const temperature = Number(settings?.temperature ?? 0.6);

        if (!message) return sendJson(res, 400, { ok: false, error: 'Missing message' });

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
	                  payload: { shotId, sequenceId, elementType: 'CAMERA', prompt: 'Close-up shot, shallow depth of field' },
	                });
	                notes.push('camera → close-up');
	              }

	              if (lower.includes('wide') || lower.includes('establishing') || lower.includes('远景') || lower.includes('全景')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'CAMERA', prompt: 'Wide establishing shot, cinematic composition' },
	                });
	                notes.push('camera → wide');
	              }

	              if (lower.includes('warmer') || lower.includes('warm') || lower.includes('暖')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'LIGHTING', prompt: 'Warm cinematic lighting, golden tones' },
	                });
	                notes.push('lighting → warmer');
	              }

	              if (lower.includes('cooler') || lower.includes('cool') || lower.includes('冷')) {
	                actions.push({
	                  type: 'UPDATE_ELEMENT',
	                  payload: { shotId, sequenceId, elementType: 'LIGHTING', prompt: 'Cool cinematic lighting, blue tones' },
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
          const storyJson = story ? JSON.stringify(summarizeStoryForPrompt(story)) : '{}';
          const allowedActionsText = [
            'NAVIGATE',
            'UPDATE_STORY',
            'CREATE_LOCATION',
            'UPDATE_LOCATION',
            'CREATE_CHARACTER',
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
          ]
            .map((t) => `- ${t}`)
            .join('\n');
          for (const p of getProviderCandidates(provider, env)) {
            attemptedProviders.push(p);
            try {
		          if (p === 'gemini' && geminiApiKey) {
		              const teamTrace: any[] = [];
		              const teamMessages: any[] = [];
		              const traceId = crypto.randomUUID();
		              const call = async (agent: string, prompt: string, responseSchema?: any) => {
		                const started = Date.now();
		                const meta = getPromptMetaForAgent('direct', agent);
		                try {
		                  const out = await callGeminiJson({ apiKey: geminiApiKey, model, temperature, prompt, env, responseSchema });
		                  teamTrace.push({
		                    agent,
		                    provider: p,
		                    model,
		                    ms: Date.now() - started,
		                    ok: true,
		                    promptId: meta?.id,
		                    promptVersion: meta?.version,
		                  });
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
	                const planner = await call(
                  'director.plan',
                  buildTeamDirectPlannerPrompt({
                    selectionJson,
                    storyJson,
                    directive: message,
                  }),
                  GEMINI_SCHEMA.directorPlan,
                );
                const requestedAgents = Array.isArray(planner?.requestedAgents) ? planner.requestedAgents : [];
                const allowedAgents = new Set(['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art']);
                const uniqAgents: string[] = Array.from(
                  new Set(requestedAgents.map((x: any) => String(x || '').trim()).filter((x: string) => allowedAgents.has(x))),
                );
	                const focusObj: Record<string, unknown> =
	                  planner?.focus && typeof planner.focus === 'object' && !Array.isArray(planner.focus) ? (planner.focus as any) : {};

	                const specialistJsonByAgent: Record<string, string> = {};
                  const specialistErrors: Array<{ agent: string; error: string }> = [];
	                for (const a of uniqAgents.slice(0, 4)) {
	                  const focus = typeof focusObj[a] === 'string' ? String(focusObj[a]) : '';
                    try {
	                    const out = await call(
	                      a,
	                      buildTeamDirectSpecialistPrompt({
	                        agent: a as any,
	                        focus,
	                        selectionJson,
	                        storyJson,
	                        directive: message,
	                      }),
	                      GEMINI_SCHEMA.directorSpecialist,
	                    );
                      const suggested = normalizeActions(out?.suggestedActions);
	                      specialistJsonByAgent[a] = JSON.stringify({ ...(out || {}), suggestedActions: suggested });
                    } catch (e: any) {
                      const err = formatFetchError(e);
                      specialistErrors.push({ agent: a, error: err });
                      specialistJsonByAgent[a] = JSON.stringify({ notes: '', suggestedActions: [], error: err });
                      continue;
                    }
	                }

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
                        const out = await callGeminiToolCall({
                          apiKey: geminiApiKey,
                          model,
                          temperature,
                          prompt:
                            mergePrompt +
                            `\n\nIMPORTANT: You MUST call the function \"director_actions\" exactly once. Do not output JSON text.`,
                          env,
                          functionDeclarations: [directorActionsFunction],
                          allowedFunctionNames: ['director_actions'],
                        });
                        teamTrace.push({
                          agent: 'director.merge',
                          provider: p,
                          model,
                          ms: Date.now() - started,
                          ok: true,
                          promptId: meta?.id,
                          promptVersion: meta?.version,
                        });
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

		                const actions = normalizeActions(final?.actions);
				                return sendJson(res, 200, {
				                  reply: String(final?.reply || planner?.reply || 'OK'),
			                  plan: {
			                    id: mkId('plan'),
			                    summary: uniqAgents.length ? `Multi-agent consult: ${uniqAgents.join(', ')}` : 'Multi-agent director (no consult needed).',
	                    steps: [
	                      { id: mkId('step'), title: 'Director: plan', status: 'done' },
	                      ...(uniqAgents.map((a: string) => {
                          const failed = specialistErrors.find((x) => x.agent === a);
                          return { id: mkId('step'), title: `Specialist: ${a}`, status: failed ? 'error' : 'done' };
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
                            teamTrace,
                            teamMessages,
                            traceId,
                            mode: useFunctionCalling ? 'multi-agent-fc' : 'multi-agent',
                            specialistErrors,
                          },
				                });
				              } catch (e: any) {
			                lastError = e;
			                if (!allowSingleFallback) {
		                  return sendJson(res, 502, {
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
		                  });
		                }
		                // Single-call fallback
	                const started = Date.now();
	                const meta = getPromptMetaForAgent('direct', 'director.actions');
                    const singlePrompt = buildDirectorActionsPrompt({
	                    selectionJson,
	                    storyJson: story ? storyJson : undefined,
	                    directive: message,
		                  });
                    const output = useFunctionCalling
                      ? (await callGeminiToolCall({
                          apiKey: geminiApiKey,
                          model,
                          temperature,
                          prompt:
                            singlePrompt +
                            `\n\nIMPORTANT: You MUST call the function \"director_actions\" exactly once. Do not output JSON text.`,
                          env,
                          functionDeclarations: [directorActionsFunction],
                          allowedFunctionNames: ['director_actions'],
                        })).args
                      : await callGeminiJson({
                          apiKey: geminiApiKey,
                          model,
                          temperature,
                          prompt: singlePrompt,
                          env,
                        });
		                teamTrace.push({
		                  agent: 'director.actions',
		                  provider: p,
		                  model,
		                  ms: Date.now() - started,
		                  ok: true,
		                  promptId: meta?.id,
		                  promptVersion: meta?.version,
		                });
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
		                  ).slice(0, 800),
			                  responsePreview: JSON.stringify(output).slice(0, 1600),
			                  multiAgentError: e?.message || String(e),
			                });
				                const actions = normalizeActions(output?.actions);
				                return sendJson(res, 200, {
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
			                    teamTrace,
			                    teamMessages,
			                    traceId,
			                    mode: useFunctionCalling ? 'single-call-fc' : 'single-call',
			                    multiAgentError: e?.message || String(e),
			                  },
			                });
			              }
			          }

		          if (p === 'openai' && env.OPENAI_API_KEY) {
	              const teamTrace: any[] = [];
	              const traceId = crypto.randomUUID();
	              const call = async (agent: string, prompt: string) => {
	                const started = Date.now();
	                const meta = getPromptMetaForAgent('direct', agent);
	                try {
	                  const out = await callOpenAICompatibleJson({
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
	                    promptId: meta?.id,
	                    promptVersion: meta?.version,
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
                const requestedAgents = Array.isArray(planner?.requestedAgents) ? planner.requestedAgents : [];
                const allowedAgents = new Set(['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art']);
                const uniqAgents: string[] = Array.from(
                  new Set(requestedAgents.map((x: any) => String(x || '').trim()).filter((x: string) => allowedAgents.has(x))),
                );
                const focusObj: Record<string, unknown> =
                  planner?.focus && typeof planner.focus === 'object' && !Array.isArray(planner.focus) ? (planner.focus as any) : {};

                const specialistJsonByAgent: Record<string, string> = {};
                for (const a of uniqAgents.slice(0, 4)) {
                  const focus = typeof focusObj[a] === 'string' ? String(focusObj[a]) : '';
                  const out = await call(
                    a,
                    buildTeamDirectSpecialistPrompt({
                      agent: a as any,
                      focus,
                      selectionJson,
                      storyJson,
                      directive: message,
                    }),
                  );
                  specialistJsonByAgent[a] = JSON.stringify(out || {});
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
                return sendJson(res, 200, {
                  reply: String(final?.reply || planner?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: uniqAgents.length ? `Multi-agent consult: ${uniqAgents.join(', ')}` : 'Multi-agent director (no consult needed).',
                    steps: [
                      { id: mkId('step'), title: 'Director: plan', status: 'done' },
                      ...(uniqAgents.map((a: string) => ({ id: mkId('step'), title: `Specialist: ${a}`, status: 'done' })) as any),
                      { id: mkId('step'), title: 'Director: merge actions', status: 'done' },
                    ],
                    actions,
	                  },
	                  actions,
	                  debug: { transport: 'http', provider: p, model, teamTrace, traceId, mode: 'multi-agent' },
	                });
	              } catch (e: any) {
	                lastError = e;
	                if (!allowSingleFallback) {
	                  return sendJson(res, 502, {
	                    ok: false,
	                    errorCode: 'MULTI_AGENT_FAILED',
	                    message: 'Multi-agent director failed',
	                    provider: p,
	                    model,
	                    traceId,
	                    teamTrace,
	                    multiAgentError: e?.message || String(e),
	                    mode: 'multi-agent',
	                  });
	                }
	                const started = Date.now();
	                const meta = getPromptMetaForAgent('direct', 'director.actions');
	                const output = await callOpenAICompatibleJson({
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
	                teamTrace.push({
	                  agent: 'director.actions',
	                  provider: p,
	                  model,
	                  ms: Date.now() - started,
	                  ok: true,
	                  promptId: meta?.id,
	                  promptVersion: meta?.version,
	                });
	                const actions = Array.isArray(output?.actions) ? output.actions : [];
	                return sendJson(res, 200, {
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
	                });
	              }
		          }

		          if (p === 'deepseek' && env.DEEPSEEK_API_KEY) {
	              const teamTrace: any[] = [];
	              const traceId = crypto.randomUUID();
	              const call = async (agent: string, prompt: string) => {
	                const started = Date.now();
	                const meta = getPromptMetaForAgent('direct', agent);
	                try {
	                  const out = await callOpenAICompatibleJson({
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
	                    promptId: meta?.id,
	                    promptVersion: meta?.version,
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
                const requestedAgents = Array.isArray(planner?.requestedAgents) ? planner.requestedAgents : [];
                const allowedAgents = new Set(['script_writer', 'casting_director', 'editor', 'environment_director', 'camera_art']);
                const uniqAgents: string[] = Array.from(
                  new Set(requestedAgents.map((x: any) => String(x || '').trim()).filter((x: string) => allowedAgents.has(x))),
                );
                const focusObj: Record<string, unknown> =
                  planner?.focus && typeof planner.focus === 'object' && !Array.isArray(planner.focus) ? (planner.focus as any) : {};

                const specialistJsonByAgent: Record<string, string> = {};
                for (const a of uniqAgents.slice(0, 4)) {
                  const focus = typeof focusObj[a] === 'string' ? String(focusObj[a]) : '';
                  const out = await call(
                    a,
                    buildTeamDirectSpecialistPrompt({
                      agent: a as any,
                      focus,
                      selectionJson,
                      storyJson,
                      directive: message,
                    }),
                  );
                  specialistJsonByAgent[a] = JSON.stringify(out || {});
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
                return sendJson(res, 200, {
                  reply: String(final?.reply || planner?.reply || 'OK'),
                  plan: {
                    id: mkId('plan'),
                    summary: uniqAgents.length ? `Multi-agent consult: ${uniqAgents.join(', ')}` : 'Multi-agent director (no consult needed).',
                    steps: [
                      { id: mkId('step'), title: 'Director: plan', status: 'done' },
                      ...(uniqAgents.map((a: string) => ({ id: mkId('step'), title: `Specialist: ${a}`, status: 'done' })) as any),
                      { id: mkId('step'), title: 'Director: merge actions', status: 'done' },
                    ],
                    actions,
	                  },
	                  actions,
	                  debug: { transport: 'http', provider: p, model, teamTrace, traceId, mode: 'multi-agent' },
	                });
	              } catch (e: any) {
	                lastError = e;
	                if (!allowSingleFallback) {
	                  return sendJson(res, 502, {
	                    ok: false,
	                    errorCode: 'MULTI_AGENT_FAILED',
	                    message: 'Multi-agent director failed',
	                    provider: p,
	                    model,
	                    traceId,
	                    teamTrace,
	                    multiAgentError: e?.message || String(e),
	                    mode: 'multi-agent',
	                  });
	                }
	                const started = Date.now();
	                const meta = getPromptMetaForAgent('direct', 'director.actions');
	                const output = await callOpenAICompatibleJson({
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
	                teamTrace.push({
	                  agent: 'director.actions',
	                  provider: p,
	                  model,
	                  ms: Date.now() - started,
	                  ok: true,
	                  promptId: meta?.id,
	                  promptVersion: meta?.version,
	                });
	                const actions = Array.isArray(output?.actions) ? output.actions : [];
	                return sendJson(res, 200, {
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
	                });
	              }
		          }
            } catch (e: any) {
              lastError = e;
            }
          }

          const fallback = rule();
          return sendJson(res, 200, {
            ...fallback,
            debug: {
              transport: 'rule',
              provider,
              model,
              attemptedProviders,
              error: lastError?.message || String(lastError || 'No provider keys configured'),
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
