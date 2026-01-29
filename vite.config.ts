import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

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

const callGeminiJson = async (args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  prompt: string;
}): Promise<any> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`;

  const parseJsonLenient = (raw: string) => {
    const text = String(raw || '').trim();
    const stripped = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    try {
      return JSON.parse(stripped);
    } catch {
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = stripped.slice(start, end + 1);
        return JSON.parse(candidate);
      }
      throw new Error('Gemini: response was not valid JSON');
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: args.prompt }] }],
      generationConfig: {
        temperature: args.temperature,
        maxOutputTokens: args.maxOutputTokens ?? 2048,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }

  const data = (await res.json()) as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Gemini: missing text response');
  return parseJsonLenient(text);
};

const callOpenAICompatibleJson = async (args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  prompt: string;
}): Promise<any> => {
  const url = `${args.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You must respond with a single valid JSON object. No markdown.' },
        { role: 'user', content: args.prompt },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }
  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('LLM: missing content');
  return JSON.parse(content);
};

const agentApiPlugin = (env: Record<string, string>): Plugin => {
  return {
    name: 'vision-studio-agent-api',
    configureServer(server) {
      server.middlewares.use('/api/asset/image/generate', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const body = await readJsonBody(req);

        const prompt = String(body?.prompt || '').trim();
        const settings = body?.settings || {};
        const provider = String(settings?.provider || 'gemini');
        const model = String(settings?.model || 'nano-banana-pro');

        const url =
          `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop&sig=` +
          `${Math.floor(Math.random() * 100000)}`;

        // Image generation is intentionally stubbed for now; we return a deterministic URL-like output
        // and include model metadata for debugging.
        return sendJson(res, 200, {
          imageUrl: url,
          debug: { transport: 'mock', provider, model, promptPreview: prompt.slice(0, 120) },
        });
      });

      server.middlewares.use('/api/agent/scaffold', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const body = await readJsonBody(req);

        const intent = String(body?.intent || '').trim();
        const aspectRatio = String(body?.aspectRatio || '16:9');
        const keyVisualUrl = body?.keyVisualUrl ? String(body.keyVisualUrl) : undefined;
        const settings = body?.settings || {};
        const plannerSettings = body?.plannerSettings || {};
        const provider = String(settings?.provider || 'gemini');
        // Gemini 1.5 models were shut down in 2025; default to a supported 2.5 model.
        const model = String(settings?.model || 'gemini-2.5-flash');
        const temperature = Number(settings?.temperature ?? 0.6);
        const maxOutputTokens = settings?.maxOutputTokens ? Number(settings.maxOutputTokens) : undefined;
        const plannerModel = String(plannerSettings?.model || '');
        const plannerTemperature = Number(plannerSettings?.temperature ?? temperature);
        const plannerMaxOutputTokens = plannerSettings?.maxOutputTokens ? Number(plannerSettings.maxOutputTokens) : maxOutputTokens;

        if (!intent) return sendJson(res, 400, { ok: false, error: 'Missing intent' });

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
                { id: mkId('seq'), title: 'Sequence 1', context: 'Auto-generated scaffold.', shots: [] },
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

	        const scaffoldPrompt =
	          `You are scaffolding a video project. Output a JSON object with keys: ` +
	          `"title","logline","locations","characters","sequences".\n` +
	          `- locations: array of {name,description,visualStyle}\n` +
	          `- characters: array of {name,description,looks:[{name,description}]}\n` +
	          `- sequences: array of {title,context,shots:[{description,timeOfDay,duration,camera,lighting,audio,locationName,castNames[]}]}\n` +
	          `Rules: duration is seconds (integer 2-8). 3-6 sequences, each 3-6 shots.\n` +
	          `Intent: ${intent}\n` +
	          `AspectRatio: ${aspectRatio}\n`;

	        const buildFromSpec = (spec: any, source: string, usedModel: string) => {
	          // Minimal mapping into the app's Story schema. IDs generated server-side for stability.
	          const projectId = mkId('proj');
	          const locations = Array.isArray(spec?.locations) ? spec.locations : [];
	          const characters = Array.isArray(spec?.characters) ? spec.characters : [];
	          const sequences = Array.isArray(spec?.sequences) ? spec.sequences : [];

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
	                    type: 'base',
	                  },
	                ],
	                elements: {
	                  SCRIPT: { type: 'SCRIPT', prompt: '', status: 'auto' },
	                  CASTING: { type: 'CASTING', prompt: '', status: 'manual', metadata: { characters: cast } },
	                  CAMERA: { type: 'CAMERA', prompt: String(sh?.camera || 'Cinematic shot'), status: 'auto' },
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
	                { id: mkId('step'), title: 'Analyze intent', status: 'done' },
	                { id: mkId('step'), title: 'Draft environments', status: 'done' },
	                { id: mkId('step'), title: 'Draft casting', status: 'done' },
	                { id: mkId('step'), title: 'Assemble sequences & shots', status: 'done' },
	              ],
	              actions: [{ type: 'SCAFFOLD_PROJECT' }],
	            },
	            debug: { transport: 'http', provider, model: usedModel, source },
	          };
	        };

        try {
	          if (provider === 'gemini' && env.GEMINI_API_KEY) {
	            const chosenModel = plannerModel || model;
	            const spec = await callGeminiJson({
	              apiKey: env.GEMINI_API_KEY,
	              model: chosenModel,
	              temperature: plannerModel ? plannerTemperature : temperature,
	              maxOutputTokens: plannerModel ? plannerMaxOutputTokens : maxOutputTokens,
	              prompt: scaffoldPrompt,
	            });
	            return sendJson(res, 200, buildFromSpec(spec, 'Gemini', chosenModel));
	          }

	          if (provider === 'openai' && env.OPENAI_API_KEY) {
	            const spec = await callOpenAICompatibleJson({
	              baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
	              apiKey: env.OPENAI_API_KEY,
	              model,
	              temperature,
	              prompt: scaffoldPrompt,
	            });
	            return sendJson(res, 200, buildFromSpec(spec, 'OpenAI', model));
	          }

	          if (provider === 'deepseek' && env.DEEPSEEK_API_KEY) {
	            const spec = await callOpenAICompatibleJson({
	              baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
	              apiKey: env.DEEPSEEK_API_KEY,
	              model,
	              temperature,
	              prompt: scaffoldPrompt,
	            });
	            return sendJson(res, 200, buildFromSpec(spec, 'DeepSeek', model));
	          }
	        } catch (e: any) {
	          return sendJson(res, 200, { ...mock(), debug: { transport: 'mock', provider, model, error: e?.message || String(e) } });
	        }

        return sendJson(res, 200, mock());
      });

      server.middlewares.use('/api/agent/direct', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        const body = await readJsonBody(req);

        const message = String(body?.message || '').trim();
        const selection = body?.selection || {};
        const settings = body?.settings || {};
        const provider = String(settings?.provider || 'gemini');
        const model = String(settings?.model || 'gemini-2.5-flash');
        const temperature = Number(settings?.temperature ?? 0.6);

        if (!message) return sendJson(res, 400, { ok: false, error: 'Missing message' });

        const now = Date.now();
	        const mkId = (prefix: string) => `${prefix}-${now}-${Math.random().toString(16).slice(2, 8)}`;

	        const rule = () => {
	          const lower = message.toLowerCase();
	          const actions: any[] = [];
	          const notes: string[] = [];

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
	        try {
	          if (provider === 'gemini' && env.GEMINI_API_KEY) {
            const output = await callGeminiJson({
              apiKey: env.GEMINI_API_KEY,
              model,
              temperature,
              prompt:
                `Given a user directive and current selection, propose structured actions.\\n` +
                `Return JSON: { "reply": string, "actions": [ { "type": "UPDATE_ELEMENT", "payload": { "sequenceId": string, "shotId": string, "elementType": "CAMERA"|"LIGHTING"|"AUDIO"|"SCRIPT", "prompt": string } } ] }\\n` +
                `Selection: ${JSON.stringify(selection)}\\n` +
                `Directive: ${message}\\n`,
            });

            const actions = Array.isArray(output?.actions) ? output.actions : [];
	            return sendJson(res, 200, {
	              reply: String(output?.reply || 'OK'),
	              plan: {
	                id: mkId('plan'),
	                summary: 'Generated structured actions (Gemini).',
	                steps: [
	                  { id: mkId('step'), title: 'Parse directive', status: 'done' },
	                  { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
	                ],
	                actions,
	              },
	              actions,
	              debug: { transport: 'http', provider, model },
	            });
	          }

	          if (provider === 'openai' && env.OPENAI_API_KEY) {
	            const output = await callOpenAICompatibleJson({
	              baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
	              apiKey: env.OPENAI_API_KEY,
	              model,
	              temperature,
	              prompt:
	                `Return JSON: { "reply": string, "actions": [ { "type": "UPDATE_ELEMENT", "payload": { "sequenceId": string, "shotId": string, "elementType": "CAMERA"|"LIGHTING"|"AUDIO"|"SCRIPT", "prompt": string } } ] }.\n` +
	                `Selection: ${JSON.stringify(selection)}\n` +
	                `Directive: ${message}\n`,
	            });
	            const actions = Array.isArray(output?.actions) ? output.actions : [];
	            return sendJson(res, 200, {
	              reply: String(output?.reply || 'OK'),
	              plan: {
	                id: mkId('plan'),
	                summary: 'Generated structured actions (OpenAI).',
	                steps: [
	                  { id: mkId('step'), title: 'Parse directive', status: 'done' },
	                  { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
	                ],
	                actions,
	              },
	              actions,
	              debug: { transport: 'http', provider, model },
	            });
	          }

	          if (provider === 'deepseek' && env.DEEPSEEK_API_KEY) {
	            const output = await callOpenAICompatibleJson({
	              baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
	              apiKey: env.DEEPSEEK_API_KEY,
	              model,
	              temperature,
	              prompt:
	                `Return JSON: { "reply": string, "actions": [ { "type": "UPDATE_ELEMENT", "payload": { "sequenceId": string, "shotId": string, "elementType": "CAMERA"|"LIGHTING"|"AUDIO"|"SCRIPT", "prompt": string } } ] }.\n` +
	                `Selection: ${JSON.stringify(selection)}\n` +
	                `Directive: ${message}\n`,
	            });
	            const actions = Array.isArray(output?.actions) ? output.actions : [];
	            return sendJson(res, 200, {
	              reply: String(output?.reply || 'OK'),
	              plan: {
	                id: mkId('plan'),
	                summary: 'Generated structured actions (DeepSeek).',
	                steps: [
	                  { id: mkId('step'), title: 'Parse directive', status: 'done' },
	                  { id: mkId('step'), title: 'Generate structured actions', status: 'done' },
	                ],
	                actions,
	              },
	              actions,
	              debug: { transport: 'http', provider, model },
	            });
	          }
	        } catch (e: any) {
	          return sendJson(res, 200, { ...rule(), debug: { transport: 'rule', provider, model, error: e?.message || String(e) } });
	        }

        return sendJson(res, 200, rule());
      });
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
