
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, ArrowLeft, ArrowUp, Rocket, Smartphone, Tv, Instagram, Clapperboard, Loader2, X, CheckCircle2, AlertTriangle, Paperclip } from 'lucide-react';
import { AgentPlan, AiSettings, AspectRatio, Story } from '../../types';
import { createLocalMockProject, scaffoldProjectStream, scaffoldProjectWithSettings } from '../../lib/ai/agent/scaffold';
import { runDirectorCommand } from '../../lib/ai/agent/direct';
import { isAgentApiError } from '../../lib/ai/agent/apiError';
import { applyAssetBlocked, applyAssetError, applyAssetQueued, applyAssetResult, applyAssetStart, buildAssetJobs, executeAssetJobs, getJobLabel } from '../../lib/ai/assetExecutor';

type PreflightMsg = { id: string; role: 'user' | 'agent' | 'system'; content: string; attachmentIds?: string[] };
type PreflightAttachment = {
  id: string;
  url: string;
  name?: string;
  createdAt?: number;
  sourceMessageId?: string;
  assignedTo: string; // unassigned | global | character:<name> | location:<name>
};

interface ProjectCreationWizardProps {
  aiSettings: AiSettings;
  workflowMode?: 'auto' | 'interaction';
  onWorkflowModeChange?: (mode: 'auto' | 'interaction') => void;
  onComplete: (project: Story, plan: AgentPlan, debug?: any) => void;
  onDraftProject?: (project: Story) => void;
  onCancel: () => void;
}

export const ProjectCreationWizard: React.FC<ProjectCreationWizardProps> = ({
  aiSettings,
  workflowMode = 'auto',
  onWorkflowModeChange,
  onComplete,
  onDraftProject,
  onCancel,
}) => {
  const createPreflightSeedStory = (intentText: string, aspectRatio: AspectRatio): Story => {
    const now = Date.now();
    return {
      id: `preflight-${now}`,
      title: intentText.trim().split(/\s+/).slice(0, 6).join(' ') || 'Preflight',
      logline: intentText.trim() || 'Preflight intent',
      intent: intentText.trim(),
      styleGuide: '',
      keyVisualUrl: '',
      aspectRatio,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      locations: [],
      characters: [],
      sequences: [],
    };
  };

  const [intent, setIntent] = useState('');
  const landingPlaceholders = useMemo(
    () => [
      'A cyberpunk neon street in 2077...',
      'A lonely lighthouse in a digital storm...',
      'Space opera set in a dying sun...',
      'Minimalist sci-fi architecture...',
      'Surreal dreamscape of floating clocks...',
    ],
    [],
  );
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [ratio, setRatio] = useState<AspectRatio>('16:9');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreflightOpen, setIsPreflightOpen] = useState(false);
  const [preflightInput, setPreflightInput] = useState('');
  const [preflightMessages, setPreflightMessages] = useState<PreflightMsg[]>([]);
  const [isPreflightThinking, setIsPreflightThinking] = useState(false);
  const [isPreflightScrolling, setIsPreflightScrolling] = useState(false);
  const [preflightReady, setPreflightReady] = useState(false);
  const [preflightBrief, setPreflightBrief] = useState('');
  const [preflightAttachments, setPreflightAttachments] = useState<PreflightAttachment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; url: string; name?: string; createdAt?: number }>>([]);
  const [knownTargets, setKnownTargets] = useState<string[]>(['global']);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mockFallbackConfirmArmed, setMockFallbackConfirmArmed] = useState(false);
  const [singleFallbackConfirmArmed, setSingleFallbackConfirmArmed] = useState(false);
  const [canSingleFallback, setCanSingleFallback] = useState(false);
  const [phase, setPhase] = useState<'scaffold' | 'assets'>('scaffold');
  const [assetTotal, setAssetTotal] = useState(0);
  const [assetDone, setAssetDone] = useState(0);
  const [assetErrors, setAssetErrors] = useState(0);
  const [assetCurrent, setAssetCurrent] = useState<string>('');
  const [scaffoldCurrent, setScaffoldCurrent] = useState<string>('');
  const [assetStartAt, setAssetStartAt] = useState<number>(0);
  const [skipArmed, setSkipArmed] = useState(false);
  const lastScaffoldRef = useRef<Awaited<ReturnType<typeof scaffoldProjectWithSettings>> | null>(null);
  const lastScaffoldArgsRef = useRef<{ intent: string; ratio: AspectRatio } | null>(null);
  const storyRef = useRef<Story | null>(null);
  const completedRef = useRef(false);
  const stopUiUpdatesRef = useRef(false);
  const preflightFileRef = useRef<HTMLInputElement | null>(null);
  const preflightMessagesRef = useRef<HTMLDivElement | null>(null);
  const preflightScrollTimeoutRef = useRef<number | null>(null);
  const sharedInputAnchorRef = useRef<HTMLDivElement | null>(null);
  const [sharedInputStartOffset, setSharedInputStartOffset] = useState<number>(130);
  const [sharedInputMeasured, setSharedInputMeasured] = useState(false);
  const [sharedInputTransitionEnabled, setSharedInputTransitionEnabled] = useState(false);
  const [isSharedInputFocused, setIsSharedInputFocused] = useState(false);
  const formats: { label: string; ratio: AspectRatio; icon: any }[] = [
    { label: 'Cinema', ratio: '16:9', icon: Tv },
    { label: 'Social', ratio: '9:16', icon: Smartphone },
    { label: 'Square', ratio: '1:1', icon: Instagram },
    { label: 'Portrait', ratio: '4:5', icon: Clapperboard },
  ];
  const progressPct = useMemo(() => {
    if (!isProcessing) return 0;
    if (phase === 'scaffold') return 30;
    const denom = Math.max(1, assetTotal);
    return 30 + Math.round((assetDone / denom) * 70);
  }, [assetDone, assetTotal, isProcessing, phase]);
  useEffect(() => {
    if (!isPreflightOpen) return;
    const el = preflightMessagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isPreflightOpen, preflightMessages, isPreflightThinking]);

  useEffect(() => {
    if (String(intent || '').trim()) return;
    const timer = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % landingPlaceholders.length);
    }, 2600);
    return () => clearInterval(timer);
  }, [intent, landingPlaceholders]);

  useEffect(() => {
    const measure = () => {
      if (typeof window === 'undefined') return;
      const el = sharedInputAnchorRef.current;
      if (!el) {
        setSharedInputMeasured(true);
        return;
      }
      const rect = el.getBoundingClientRect();
      const centerY = rect.top + rect.height / 2;
      setSharedInputStartOffset(centerY - window.innerHeight / 2);
    };
    const raf1 = requestAnimationFrame(() => {
      measure();
      const raf2 = requestAnimationFrame(() => {
        measure();
        setSharedInputMeasured(true);
      });
      (window as any).__pcw_raf2 = raf2;
    });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf1);
      if ((window as any).__pcw_raf2) cancelAnimationFrame((window as any).__pcw_raf2);
      window.removeEventListener('resize', measure);
    };
  }, [workflowMode, ratio]);

  useEffect(() => {
    if (!sharedInputMeasured) return;
    const t = window.setTimeout(() => setSharedInputTransitionEnabled(true), 0);
    return () => window.clearTimeout(t);
  }, [sharedInputMeasured]);

  const resetProgress = () => {
    setPlan(null);
    setError(null);
    setMockFallbackConfirmArmed(false);
    setSingleFallbackConfirmArmed(false);
    setCanSingleFallback(false);
    setPhase('scaffold');
    setAssetTotal(0);
    setAssetDone(0);
    setAssetErrors(0);
    setAssetCurrent('');
    setAssetStartAt(0);
    setSkipArmed(false);
    setScaffoldCurrent('');
    setIsPreflightOpen(false);
    setPreflightInput('');
    setPreflightMessages([]);
    setIsPreflightThinking(false);
    setPreflightReady(false);
    setPreflightBrief('');
    setPreflightAttachments([]);
    setPendingAttachments([]);
    setKnownTargets(['global']);
    storyRef.current = null;
    lastScaffoldRef.current = null;
    lastScaffoldArgsRef.current = null;
    completedRef.current = false;
    stopUiUpdatesRef.current = false;
  };

  const finishCreation = (project: Story, planArg: AgentPlan, debug?: any) => {
    if (completedRef.current) return;
    completedRef.current = true;
    stopUiUpdatesRef.current = true;
    setIsProcessing(false);
    onComplete(project, planArg, debug);
  };

  const readReferenceFiles = async (files: ArrayLike<File> | null | undefined) => {
    const picked = Array.from(files || [])
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 4);
    const reads = picked.map(
      (file) =>
        new Promise<{ id: string; url: string; name?: string; createdAt?: number }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id: `preflight-ref-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              url: String(reader.result || ''),
              name: file.name,
              createdAt: Date.now(),
            });
          reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
          reader.readAsDataURL(file);
        }),
    );
    const settled = await Promise.allSettled(reads);
    return settled
      .filter((r): r is PromiseFulfilledResult<{ id: string; url: string; name?: string; createdAt?: number }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((r) => r.url);
  };

  const parseMentionTarget = (text: string): string | null => {
    const t = String(text || '');
    const m = t.match(/@([^\s,.;:!?]+)/);
    if (!m?.[1]) return null;
    const raw = String(m[1]).trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower.startsWith('loc:') || lower.startsWith('location:')) {
      const v = raw.split(':').slice(1).join(':').trim();
      return v ? `location:${v}` : 'location:primary';
    }
    if (lower.startsWith('char:') || lower.startsWith('character:')) {
      const v = raw.split(':').slice(1).join(':').trim();
      return v ? `character:${v}` : null;
    }
    return `character:${raw}`;
  };

  const inferTargetFromRecentAgent = (): string | null => {
    const lastAgent = [...preflightMessages].reverse().find((m) => m.role === 'agent');
    const text = String(lastAgent?.content || '').toLowerCase();
    if (!text) return null;
    // Conservative default: only auto-route to global when it's clearly KV/style related.
    // Character/location routing without explicit mention is too error-prone.
    if (/(kv|style|look and feel|visual anchor|master visual)/i.test(text)) return 'global';
    return null;
  };

  const extractSuggestedTargetsFromAgentReply = (reply: string): string[] => {
    const text = String(reply || '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const out = new Set<string>();
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (/(kv|master visual|style guide|visual anchor)/i.test(lower)) out.add('global');
      const quoted = [...line.matchAll(/"([^"]{2,48})"/g)].map((m) => String(m[1] || '').trim()).filter(Boolean);
      if (/(cast|character|protagonist|hero|role)/i.test(lower)) {
        for (const q of quoted) out.add(`character:${q}`);
      }
      if (/(location|scene|setting|environment)/i.test(lower)) {
        for (const q of quoted) out.add(`location:${q}`);
      }
      const listMatch = line.match(/(?:location|scene|setting|environment)[^:]*:\s*(.+)$/i);
      if (listMatch?.[1]) {
        for (const item of String(listMatch[1]).split(',').map((x) => x.trim()).filter(Boolean)) {
          if (item.length >= 2 && item.length <= 48) out.add(`location:${item}`);
        }
      }
    }
    return Array.from(out);
  };

  const resolveAttachmentTarget = (messageText: string): string => {
    const byMention = parseMentionTarget(messageText);
    if (byMention) return byMention;
    const byContext = inferTargetFromRecentAgent();
    if (byContext) return byContext;
    return 'unassigned';
  };

  const sendPreflightMessage = async (userText: string, opts?: { kickoff?: boolean }) => {
    const text = String(userText || '').trim();
    const hasFiles = pendingAttachments.length > 0;
    if (!text && !hasFiles && !opts?.kickoff) return;
    if (isPreflightThinking) return;
    const content = text || (hasFiles ? '[Attachments]' : '');
    const target = hasFiles ? resolveAttachmentTarget(content) : '';
    const userMsgId = `p-u-${Date.now()}`;
    const liftedAttachments: PreflightAttachment[] = (pendingAttachments || []).map((a) => ({
      ...a,
      sourceMessageId: userMsgId,
      assignedTo: target || 'unassigned',
    }));
    const userMsg: PreflightMsg | null = content
      ? {
          id: userMsgId,
          role: 'user',
          content: content,
          attachmentIds: liftedAttachments.map((a) => a.id),
        }
      : null;
    const nextMessages = userMsg ? [...preflightMessages, userMsg] : preflightMessages.slice();
    if (userMsg) setPreflightMessages(nextMessages);
    if (!opts?.kickoff && (content.trim() || liftedAttachments.length)) {
      // Any new user input invalidates previous "ready" until director reconfirms.
      setPreflightReady(false);
      setPreflightBrief('');
    }
    if (liftedAttachments.length) {
      setPreflightAttachments((prev) => [...prev, ...liftedAttachments]);
      setPendingAttachments([]);
      if (target && !knownTargets.includes(target)) setKnownTargets((prev) => [...prev, target]);
    }
    setPreflightInput('');
    setIsPreflightThinking(true);
    try {
      const conversation = nextMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
      const seedStory = createPreflightSeedStory(String(intent || '').trim(), ratio);
      const globalRefs = [...preflightAttachments, ...liftedAttachments]
        .filter((x) => String(x.assignedTo || '') === 'global')
        .map((x) => ({ id: x.id, url: x.url, name: x.name, createdAt: x.createdAt }));
      const preflightStory = {
        ...seedStory,
        referenceImages: globalRefs,
        referenceMode: globalRefs.length ? 'auto' : 'off',
      } as any;
      const assignmentSummary = [...preflightAttachments, ...liftedAttachments]
        .map((a) => `${a.name || a.id} -> ${a.assignedTo}`)
        .join('\n');
      const res = await runDirectorCommand({
        message: [
          '[Start Project Interaction Preflight]',
          'Goal: clarify requirements before scaffold+asset generation.',
          'Behavior:',
          '- Ask concise follow-up questions until enough information is collected.',
          '- When enough, include a line exactly: READY_TO_SCAFFOLD',
          '- Then provide "Brief:" followed by concise bullet points.',
          '- Mention if references are missing and what assumptions will be used.',
          `Current intent: ${String(intent || '').trim()}`,
          `Uploaded references count: ${[...preflightAttachments, ...liftedAttachments].length}`,
          assignmentSummary ? `Attachment assignments:\n${assignmentSummary}` : 'Attachment assignments: (none)',
          `Conversation:\n${conversation || '(empty)'}`,
          opts?.kickoff ? 'Kickoff: Ask your first clarifying question now.' : '',
        ]
          .filter(Boolean)
          .join('\n'),
        selection: { type: 'creation', id: 'creation' },
        story: preflightStory,
        settings: aiSettings.direct,
        allowSingleFallback: false,
        useFunctionCalling: Boolean((aiSettings.direct as any)?.useFunctionCalling),
      });
      const reply = String(res?.reply || '').trim();
      setPreflightMessages((prev) => [...prev, { id: `p-a-${Date.now()}`, role: 'agent', content: reply || '(empty reply)' }]);
      const suggestedTargets = extractSuggestedTargetsFromAgentReply(reply);
      if (suggestedTargets.length) {
        setKnownTargets((prev) => {
          const s = new Set(prev);
          for (const t of suggestedTargets) s.add(t);
          return Array.from(s);
        });
      }
      const readyNow =
        /READY_TO_SCAFFOLD/i.test(reply) ||
        /ready to (generate|scaffold|proceed|start)/i.test(reply) ||
        /可以开始|可开始|开始生成|已准备好|准备好了|可以进入生成/i.test(reply);
      const askMore =
        /(\?|还需要|还需|请补充|请提供|can you|could you|please provide|which|what|do you|是否|要不要|有没有)/i.test(reply) &&
        !readyNow;
      if (readyNow) setPreflightReady(true);
      else if (askMore) setPreflightReady(false);
      if (readyNow) {
        const brief = reply.replace(/READY_TO_SCAFFOLD/gi, '').trim();
        setPreflightBrief(brief);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreflightMessages((prev) => [...prev, { id: `p-s-${Date.now()}`, role: 'system', content: `Preflight error: ${msg}` }]);
    } finally {
      setIsPreflightThinking(false);
    }
  };

  const runAssets = async (res: Awaited<ReturnType<typeof scaffoldProjectWithSettings>>) => {
    // Auto-generate assets during creation so the progress UI is honest and users understand the wait.
    const ASSET_STAGE_TIMEOUT_MS = 6 * 60_000;
    let total = 0;
    let done = 0;
    let errors = 0;

    if (aiSettings.image.provider !== 'mock') {
      setPhase('assets');
      setAssetStartAt(Date.now());
      setSkipArmed(false);
      const jobs = buildAssetJobs(res.story, 'all');
      total = jobs.length;
      setAssetTotal(jobs.length);

      if (jobs.length > 0) {
        storyRef.current = jobs.reduce((acc, job) => applyAssetQueued(acc, job), storyRef.current || res.story);
        if (storyRef.current) onDraftProject?.(storyRef.current);
          const assetExec = executeAssetJobs({
	          jobs,
	          settings: aiSettings.image,
	          aspectRatio: res.story.aspectRatio,
	          concurrency: 2,
	          getStoryForRefs: () => storyRef.current,
	          maxAttempts: 3,
	          stopAfterMasterKvFailure: false,
		          onEvent: (ev) => {
                if (stopUiUpdatesRef.current) return;
		            const currentStory = storyRef.current || res.story;
		            if (ev.type === 'start') {
		              storyRef.current = applyAssetStart(currentStory, ev.job);
	              setAssetCurrent(getJobLabel(ev.job, storyRef.current));
                if (storyRef.current) onDraftProject?.(storyRef.current);
	              return;
	            }
	            if (ev.type === 'success') {
              storyRef.current = applyAssetResult(currentStory, ev.job, ev.imageUrl, ev.meta);
	              done = ev.done;
	              setAssetDone(ev.done);
	              setAssetCurrent(getJobLabel(ev.job, storyRef.current));
                if (storyRef.current) onDraftProject?.(storyRef.current);
	              return;
	            }
	            if (ev.type === 'blocked') {
	              storyRef.current = applyAssetBlocked(currentStory, ev.job, ev.reason);
	              done = ev.done;
	              setAssetDone(ev.done);
	              setAssetErrors((n) => n + 1);
	              setAssetCurrent(getJobLabel(ev.job, storyRef.current));
                if (storyRef.current) onDraftProject?.(storyRef.current);
	              return;
	            }
	            // error
	            storyRef.current = applyAssetError(currentStory, ev.job, ev.error);
	            done = ev.done;
	            errors += 1;
	            setAssetDone(ev.done);
	            setAssetErrors((n) => n + 1);
	            setAssetCurrent(getJobLabel(ev.job, storyRef.current));
              if (storyRef.current) onDraftProject?.(storyRef.current);
		          },
		        });
          const race = await Promise.race([
            assetExec.then(() => 'done' as const),
            new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ASSET_STAGE_TIMEOUT_MS)),
          ]);
          if (race === 'timeout') {
            const partial = storyRef.current || res.story;
            finishCreation(partial, res.plan, {
              ...res.debug,
              assets: { total, done, errors, timedOut: true, timeoutMs: ASSET_STAGE_TIMEOUT_MS },
            });
            return;
          }
	      }
    }

    const finalStory = storyRef.current || res.story;
    finishCreation(finalStory, res.plan, {
      ...res.debug,
      assets: { total, done, errors },
    });
  };

  const runScaffold = async (opts?: { allowSingleFallback?: boolean; intentOverride?: string; retriedJsonRepair?: boolean }) => {
    const effectiveIntent = String(opts?.intentOverride || intent || '').trim();
    if (!effectiveIntent) return;
    setIsProcessing(true);
    setError(null);
    setMockFallbackConfirmArmed(false);
    setSingleFallbackConfirmArmed(false);
    setCanSingleFallback(false);
    setPhase('scaffold');
    setAssetTotal(0);
    setAssetDone(0);
    setAssetErrors(0);
    setAssetCurrent('');
    setAssetStartAt(0);
    setSkipArmed(false);
    setScaffoldCurrent('');
    storyRef.current = null;
    completedRef.current = false;
    stopUiUpdatesRef.current = false;

    let scaffoldIntent = effectiveIntent;
    lastScaffoldArgsRef.current = { intent: scaffoldIntent, ratio };
    try {
      // Prefer streaming for better transparency (multi-agent is long-running and prone to idle timeouts).
      const res =
        aiSettings.scaffoldWorker.provider !== 'mock'
          ? await scaffoldProjectStream(
              {
                intent: scaffoldIntent,
                aspectRatio: ratio,
                settings: aiSettings.scaffoldWorker,
                plannerSettings: aiSettings.scaffoldPlanner,
                allowSingleFallback: Boolean(opts?.allowSingleFallback),
              },
              {
                onEvent: (ev) => {
                  if (ev.event === 'progress') {
                    const agent = String(ev.data?.agent || '');
                    const provider = String(ev.data?.provider || '');
                    const model = String(ev.data?.model || '');
                    setScaffoldCurrent([agent, provider && model ? `${provider}/${model}` : ''].filter(Boolean).join(' • '));
                  }
                  if (ev.event === 'trace') {
                    const agent = String(ev.data?.agent || '');
                    const ok = ev.data?.ok === true ? 'ok' : ev.data?.ok === false ? 'fail' : '';
                    setScaffoldCurrent([agent, ok].filter(Boolean).join(' • '));
                  }
                  if (ev.event === 'hello') {
                    setScaffoldCurrent('Starting multi-agent scaffold…');
                  }
                },
              },
            )
          : await scaffoldProjectWithSettings({
              intent: scaffoldIntent,
              aspectRatio: ratio,
              aiSettings,
              allowSingleFallback: Boolean(opts?.allowSingleFallback),
            });
        const normalized = (preflightAttachments || []).map((a) => ({
          id: a.id,
          url: a.url,
          name: a.name,
          createdAt: a.createdAt,
          assignedTo: String(a.assignedTo || 'unassigned'),
        }));
        const globalRefs = normalized.filter((a) => a.assignedTo === 'global').map(({ assignedTo, ...x }) => x);
        const charRefs = normalized.filter((a) => a.assignedTo.startsWith('character:'));
        const locRefs = normalized.filter((a) => a.assignedTo.startsWith('location:'));
        const enrichedStory = {
          ...res.story,
          referenceImages: globalRefs as any,
          referenceMode: globalRefs.length ? 'auto' : (res.story as any).referenceMode,
          characters: (res.story.characters || []).map((c) => {
            const next = charRefs
              .filter((r) => {
                const name = String(r.assignedTo.split(':').slice(1).join(':') || '').trim().toLowerCase();
                const cn = String(c.name || '').trim().toLowerCase();
                return name && (cn.includes(name) || name.includes(cn));
              })
              .map(({ assignedTo, ...x }) => x);
            if (!next.length) return c;
            return {
              ...c,
              referenceImages: ([...(Array.isArray((c as any).referenceImages) ? (c as any).referenceImages : []), ...next].slice(-4) as any),
              referenceMode: 'auto',
            } as any;
          }),
          locations: (res.story.locations || []).map((l) => {
            const next = locRefs
              .filter((r) => {
                const name = String(r.assignedTo.split(':').slice(1).join(':') || '').trim().toLowerCase();
                const ln = String(l.name || '').trim().toLowerCase();
                return name && (ln.includes(name) || name.includes(ln));
              })
              .map(({ assignedTo, ...x }) => x);
            if (!next.length) return l;
            return {
              ...l,
              referenceImages: ([...(Array.isArray((l as any).referenceImages) ? (l as any).referenceImages : []), ...next].slice(-4) as any),
              referenceMode: 'auto',
            } as any;
          }),
        } as Story;
        const enrichedRes = { ...res, story: enrichedStory } as typeof res;
	      lastScaffoldRef.current = enrichedRes;
	      storyRef.current = enrichedStory;
	      setPlan(enrichedRes.plan);
        onDraftProject?.(enrichedStory);
	      await runAssets(enrichedRes);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      const looksLikeJsonFormatIssue =
        /not valid json|invalid json|json parse|response was not valid json|malformed json/i.test(errMsg);
      const isGemini25Flash =
        aiSettings.scaffoldWorker.provider === 'gemini' &&
        /gemini-2\.5-flash/i.test(String(aiSettings.scaffoldWorker.model || ''));
      if (looksLikeJsonFormatIssue && isGemini25Flash && !opts?.retriedJsonRepair) {
        setScaffoldCurrent('Retrying with strict JSON mode…');
        const strictIntent = [
          effectiveIntent,
          'Output constraint: return exactly one valid JSON object only; no markdown; no prose; no truncation.',
          'If content is too long, reduce counts but keep schema complete.',
        ].join('\n');
        await runScaffold({
          allowSingleFallback: true,
          intentOverride: strictIntent,
          retriedJsonRepair: true,
        });
        return;
      }
      if (isAgentApiError(e) && e.bodyJson?.errorCode === 'MULTI_AGENT_FAILED') {
        setCanSingleFallback(true);
        setError(String(e.bodyJson?.multiAgentError || e.bodyJson?.message || e.message || 'Multi-agent scaffold failed'));
        return;
      }
      setCanSingleFallback(false);
      setError(errMsg);
    }
  };

  const openInteractionPreflight = (initialPrompt?: string) => {
    const seededPrompt = String(initialPrompt || '').trim();
    setIsPreflightOpen(true);
    setPreflightInput('');
    setPreflightReady(false);
    setPreflightBrief('');

    if (seededPrompt) {
      setPreflightMessages([]);
      setTimeout(() => {
        sendPreflightMessage(seededPrompt).catch(() => {});
      }, 0);
      return;
    }

    setPreflightMessages([
      {
        id: `p-s-${Date.now()}`,
        role: 'system',
        content: 'Interaction preflight started. Director will ask clarifying questions. Upload references here if available.',
      },
    ]);
    setTimeout(() => {
      sendPreflightMessage('', { kickoff: true }).catch(() => {});
    }, 0);
  };

  const handleGenerate = async () => {
    const seededPrompt = String(intent || '').trim();
    if (!seededPrompt) return;
    resetProgress();
    if (workflowMode === 'interaction') {
      openInteractionPreflight(seededPrompt);
      return;
    }
    await runScaffold({ allowSingleFallback: false });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleGenerate();
  };

  const handleForceStart = () => {
    const notes = [
      preflightBrief ? `Director Brief:\n${preflightBrief}` : '',
      preflightAttachments.length
        ? (() => {
            const byTarget = new Map<string, PreflightAttachment[]>();
            for (const a of preflightAttachments) {
              const k = String(a.assignedTo || 'unassigned');
              byTarget.set(k, [...(byTarget.get(k) || []), a]);
            }
            const lines: string[] = [];
            for (const [target, items] of byTarget.entries()) {
              const names = items.map((x) => x.name || x.id).join(', ');
              lines.push(`- ${target}: ${names}`);
            }
            return [
              'Reference Assignments (must be preserved through agent handoff):',
              ...lines,
              'Instruction: Director MUST pass these assignments to Casting/Environment sub-agents and ensure downstream asset generation uses the matched references.',
            ].join('\n');
          })()
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const finalIntent = notes
      ? `${String(intent || '').trim()}\n\nInteraction Notes:\n${notes}`
      : String(intent || '').trim();
    setIsPreflightOpen(false);
    runScaffold({ allowSingleFallback: false, intentOverride: finalIntent }).catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  const hasIntent = Boolean(String(intent || '').trim());
  const activeInputValue = String(isPreflightOpen ? preflightInput : intent || '').trim();
  const isSharedInputSelected = isSharedInputFocused || Boolean(activeInputValue);
  const hasPreflightFooterContent = preflightAttachments.length > 0;
  const isInteractionMode = workflowMode === 'interaction';
  const isPreflightTransition = isPreflightOpen && !isProcessing;
  const submitLabel = isInteractionMode ? 'Start Interaction' : 'Start Production';
  const submitHint = isInteractionMode
    ? 'Open Director preflight and align references before scaffold.'
    : 'Run one-shot scaffold and start generating assets directly.';

  // Hero title tuning: adjust these values to iterate metal gradient + glow quickly.
  const heroTitleStyle = {
    directMetalGradient:
      'linear-gradient(100deg, #596475 0%, #aebccd 24%, #eef4fb 50%, #ffffff 64%, #d9e2ee 80%, #7f8da0 100%)',
    metalGradient:
      'linear-gradient(102deg, #6f7b8d 0%, #bcc8d7 30%, #e8f0f8 56%, #ffffff 76%, #ffffff 90%, #f7fbff 100%)',
    baseGlowGradient:
      'linear-gradient(102deg, rgba(180,198,220,0.18) 0%, rgba(220,232,246,0.24) 52%, rgba(255,255,255,0.58) 78%, rgba(255,255,255,0.76) 92%, rgba(255,255,255,0.72) 100%)',
    // Thresholded glow: only right-side high-luminance region emits strong bloom.
    highlightGlowGradient:
      'linear-gradient(104deg, transparent 0%, transparent 60%, rgba(255,255,255,0.92) 76%, rgba(255,255,255,0.98) 90%, rgba(255,255,255,0.9) 100%)',
    spreadGlowGradient:
      'linear-gradient(108deg, transparent 0%, transparent 64%, rgba(255,255,255,0.44) 80%, rgba(255,255,255,0.56) 92%, rgba(255,255,255,0.46) 100%)',
    baseGlowOpacity: 0.2,
    highlightGlowOpacity: 0.92,
    spreadGlowOpacity: 0.66,
    baseGlowBlurPx: 10,
    highlightGlowBlurPx: 14,
    spreadGlowBlurPx: 30,
  } as const;

  return (
    <div className="fixed inset-0 z-[2000] bg-[#050505] flex items-center justify-center p-8 overflow-hidden">
        <style>
          {`
            @keyframes pcw-border-breathe {
              0%, 100% {
                opacity: 0.62;
                box-shadow: 0 0 18px rgba(255,255,255,0.4), 0 0 36px rgba(210,230,255,0.22), 0 0 30px rgba(255,196,170,0.14);
              }
              50% {
                opacity: 1;
                box-shadow: 0 0 34px rgba(255,255,255,0.72), 0 0 78px rgba(215,235,255,0.44), 0 0 62px rgba(255,208,182,0.24);
              }
            }
            @keyframes pcw-aura-breathe {
              0%, 100% {
                opacity: 0.3;
                transform: scale(0.994);
              }
              50% {
                opacity: 0.74;
                transform: scale(1.012);
              }
            }
            @keyframes pcw-sheen-drift {
              0% {
                transform: translateX(-16%) scaleX(0.9);
                opacity: 0.2;
              }
              50% {
                opacity: 0.52;
              }
              100% {
                transform: translateX(16%) scaleX(1.04);
                opacity: 0.2;
              }
            }
            @keyframes pcw-rocket-breathe {
              0%, 100% {
                box-shadow: 0 0 0 1px rgba(255,255,255,0.22), 0 0 16px rgba(255,255,255,0.12);
                transform: scale(1);
              }
              50% {
                box-shadow: 0 0 0 1px rgba(255,255,255,0.4), 0 0 30px rgba(255,255,255,0.26);
                transform: scale(1.03);
              }
            }
            @keyframes pcw-logo-shell-breathe {
              0%, 100% {
                transform: scale(1);
                box-shadow: 0 0 0 1px rgba(255,255,255,0.38), 0 0 24px rgba(255,255,255,0.34);
              }
              50% {
                transform: scale(1.03);
                box-shadow: 0 0 0 1px rgba(255,255,255,0.56), 0 0 42px rgba(255,255,255,0.58);
              }
            }
            @keyframes pcw-logo-core-breathe {
              0%, 100% {
                opacity: 0.84;
                transform: scale(1);
              }
              50% {
                opacity: 1;
                transform: scale(1.04);
              }
            }
            .pcw-scroll {
              scrollbar-gutter: stable;
              scrollbar-width: none; /* Firefox default hidden */
            }
            .pcw-scroll::-webkit-scrollbar {
              width: 0px;
              height: 0px;
            }
            .pcw-scroll:hover,
            .pcw-scroll[data-scrolling='1'] {
              scrollbar-width: thin;
              scrollbar-color: rgba(255,255,255,0.38) transparent;
            }
            .pcw-scroll:hover::-webkit-scrollbar,
            .pcw-scroll[data-scrolling='1']::-webkit-scrollbar {
              width: 10px;
              height: 10px;
            }
            .pcw-scroll::-webkit-scrollbar-thumb {
              background: rgba(255,255,255,0.22);
              border-radius: 999px;
              border: 2px solid rgba(0,0,0,0.0);
              background-clip: padding-box;
            }
            .pcw-scroll:hover::-webkit-scrollbar-thumb,
            .pcw-scroll[data-scrolling='1']::-webkit-scrollbar-thumb {
              background: rgba(255,255,255,0.36);
            }
            .pcw-scroll::-webkit-scrollbar-corner {
              background: transparent;
            }
          `}
        </style>
        {/* Cinematic Background */}
        <div className="absolute inset-0 z-0 bg-black" />
        <div
          className={`absolute inset-0 z-[1] transition-all duration-700 ${
            isPreflightOpen
              ? 'opacity-100 bg-gradient-to-b from-black/20 via-black/45 to-black/85'
              : 'opacity-0 bg-gradient-to-b from-transparent via-transparent to-black/0'
          }`}
        />

        <button
          type="button"
          onClick={() => {
            if (isPreflightOpen) {
              setIsPreflightOpen(false);
              return;
            }
            onCancel();
          }}
          className="absolute top-10 left-10 z-[2600] h-11 w-11 rounded-full bg-white/10 border border-white/15 text-white/85 flex items-center justify-center shadow-[0_0_22px_rgba(255,255,255,0.12)] hover:bg-white/15 hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] transition-all"
          title={isPreflightOpen ? 'Back to Initialize' : 'Back to Library'}
          aria-label={isPreflightOpen ? 'Back to Initialize' : 'Back to Library'}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div
          className="relative z-10 w-full max-w-4xl text-center"
        >
            {isProcessing ? (
                <div className="max-w-3xl mx-auto space-y-12 animate-in zoom-in-95 duration-500 px-8 py-10">
                    <div
                      className="relative w-24 h-24 min-w-24 min-h-24 aspect-square mx-auto shrink-0 rounded-full border border-zinc-300/80 bg-white/15 shadow-[0_0_0_1px_rgba(255,255,255,0.45),0_0_26px_rgba(255,255,255,0.42)]"
                      style={{ animation: 'pcw-logo-shell-breathe 2.8s ease-in-out infinite' }}
                    >
                        <div className="absolute inset-[18px] rounded-full bg-white/90" style={{ animation: 'pcw-logo-core-breathe 2.8s ease-in-out infinite' }} />
                    </div>
                    <div>
	                        <h2 className="text-4xl font-black text-white tracking-tighter mb-4">Director AI is Thinking...</h2>
	                        <p className="text-white/58 font-medium text-lg max-w-md mx-auto">
	                            {phase === 'scaffold'
                                ? 'Scaffolding story architecture, casting performers, and 置景 (Sets) for your masterwork.'
                                : `Generating assets (${assetDone}/${Math.max(1, assetTotal)})…`}
	                        </p>
	                    </div>
                    {error && (
                        <div className="max-w-xl mx-auto p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200 text-sm flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                            <div className="text-left">
                                <div className="font-bold mb-1">Scaffolding needs retry</div>
                                <div className="opacity-80 break-words">{error}</div>
                                <div className="mt-3 flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setError(null);
                                      setMockFallbackConfirmArmed(false);
                                      setSingleFallbackConfirmArmed(false);
                                      runScaffold({ allowSingleFallback: false }).catch((e) =>
                                        setError(e instanceof Error ? e.message : String(e)),
                                      );
                                    }}
                                    className="px-4 py-2 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-100 text-[11px] font-black uppercase tracking-widest hover:bg-rose-500/25"
                                  >
                                    Retry Scaffold
                                  </button>
                                  {canSingleFallback && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!singleFallbackConfirmArmed) {
                                          setSingleFallbackConfirmArmed(true);
                                          return;
                                        }
                                        setError(null);
                                        setSingleFallbackConfirmArmed(false);
                                        runScaffold({ allowSingleFallback: true }).catch((e) =>
                                          setError(e instanceof Error ? e.message : String(e)),
                                        );
                                      }}
                                      className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-[11px] font-black uppercase tracking-widest hover:bg-white/10"
                                    >
                                      {singleFallbackConfirmArmed ? 'Confirm Single-call' : 'Use Single-call'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!mockFallbackConfirmArmed) {
                                        setMockFallbackConfirmArmed(true);
                                        return;
                                      }
                                      const args = lastScaffoldArgsRef.current;
                                      if (!args) return;
                                      setError(null);
                                      setMockFallbackConfirmArmed(false);
                                      setSingleFallbackConfirmArmed(false);
                                      const mockRes = createLocalMockProject(args.intent, args.ratio);
                                      lastScaffoldRef.current = mockRes as any;
                                      storyRef.current = mockRes.story;
                                      setPlan(mockRes.plan);
                                      runAssets(mockRes as any).catch((e) => setError(e instanceof Error ? e.message : String(e)));
                                    }}
                                    className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-[11px] font-black uppercase tracking-widest hover:bg-white/10"
                                  >
                                    {mockFallbackConfirmArmed ? 'Confirm Local Mock' : 'Use Local Mock'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setError(null);
                                      setMockFallbackConfirmArmed(false);
                                      setSingleFallbackConfirmArmed(false);
                                      setIsProcessing(false);
                                    }}
                                    className="text-[11px] font-black uppercase tracking-widest text-rose-200/80 hover:underline"
                                  >
                                    Back
                                  </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {plan && (
                        <div className="max-w-xl mx-auto space-y-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.35em] text-white/30">Plan</div>
                            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-4 text-left space-y-2">
                                <div className="text-white/80 text-sm font-medium mb-2">{plan.summary}</div>
                                <div className="space-y-2">
                                    {plan.steps.map(step => (
                                        <div key={step.id} className="flex items-center gap-3 text-sm text-white/70">
                                            {step.status === 'done' ? (
                                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                            ) : step.status === 'error' ? (
                                                <AlertTriangle className="w-4 h-4 text-rose-400" />
                                            ) : (
                                                <Loader2 className="w-4 h-4 animate-spin text-white/40" />
                                            )}
                                            <span>{step.title}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
	                    <div className="flex flex-col gap-2 max-w-xs mx-auto">
	                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
	                            <div
                                  className="h-full bg-[linear-gradient(90deg,rgba(214,226,242,0.72)_0%,rgba(255,255,255,0.98)_52%,rgba(202,215,232,0.76)_100%)] transition-all duration-500"
                                  style={{ width: `${progressPct}%` }}
                                />
	                        </div>
	                        <div className="flex justify-between text-[10px] font-bold text-white/55 uppercase tracking-widest">
	                            <span>Analysis</span>
	                            <span>{phase === 'assets' ? `Assets ${assetDone}/${Math.max(1, assetTotal)}` : 'Scaffolding'}</span>
	                        </div>
	                          {phase === 'assets' && assetCurrent && (
	                            <div className="text-[11px] text-white/36 font-mono break-words">
	                              {assetCurrent}{assetErrors ? ` (errors: ${assetErrors})` : ''}
	                            </div>
	                          )}
                            {phase === 'assets' && assetStartAt > 0 && (
                              <div className="text-[10px] text-white/36 font-mono">
                                Elapsed: {Math.floor(Math.max(0, Date.now() - assetStartAt) / 1000)}s
                              </div>
                            )}
                            {phase === 'scaffold' && scaffoldCurrent && (
                              <div className="text-[11px] text-white/36 font-mono break-words">
                                {scaffoldCurrent}
                              </div>
                            )}
		                          <div className="text-[10px] text-white/28 font-mono">
                            Image: {aiSettings.image.provider}/{aiSettings.image.model}
                            {aiSettings.image.provider === 'mock' ? ' (mock — assets will NOT be generated)' : ''}
                          </div>
                          {phase === 'assets' && plan && (
                            <div className="pt-2 flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!skipArmed) {
                                    setSkipArmed(true);
                                    return;
                                  }
                                  const partial = storyRef.current || lastScaffoldRef.current?.story;
                                  const currentPlan = lastScaffoldRef.current?.plan || plan;
                                  if (!partial || !currentPlan) return;
                                  finishCreation(partial, currentPlan, {
                                    ...(lastScaffoldRef.current as any)?.debug,
                                    assets: {
                                      total: assetTotal,
                                      done: assetDone,
                                      errors: assetErrors,
                                      skipped: true,
                                    },
                                  });
                                }}
                                className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/15 text-white/80 text-[10px] font-black uppercase tracking-widest hover:bg-white/15"
                              >
                                {skipArmed ? 'Confirm Enter Project' : 'Enter Project Now'}
                              </button>
                            </div>
                          )}
		                    </div>
		                </div>
	            ) : (
                <div
                  className={`space-y-10 animate-in slide-in-from-bottom-20 duration-1000 ${
                    isPreflightOpen ? '' : '-translate-y-[8vh]'
                  }`}
                >
                    <div
                      className={`space-y-5 transition-all duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                        isPreflightTransition ? 'opacity-0 -translate-y-14 scale-[0.96] blur-[2px] pointer-events-none' : 'opacity-100 translate-y-0 scale-100'
                      }`}
                    >
                        <div className="text-center text-[11px] font-thin uppercase tracking-[0.5em] text-white/45">
                          Initialize Masterpiece
                        </div>
                        <h1 className="relative inline-flex flex-col items-center overflow-visible pr-[0.2em] text-6xl md:text-[8rem] font-medium tracking-[-0.03em]">
                          <span className="relative z-30 block pb-[0.1em] leading-[1.08]">
                            <span
                              className="relative z-10 inline-block bg-clip-text text-transparent pb-[0.08em] leading-[1.08]"
                              style={{
                                backgroundImage: heroTitleStyle.directMetalGradient,
                                textShadow: '0 0 6px rgba(242,248,255,0.14)',
                              }}
                            >
                              Direct your
                            </span>
                          </span>
                          <span className="relative z-0 block w-fit italic px-[0.1em] leading-[0.92]">
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 bg-clip-text text-transparent"
                              style={{
                                backgroundImage: heroTitleStyle.baseGlowGradient,
                                opacity: heroTitleStyle.baseGlowOpacity,
                                filter: `blur(${heroTitleStyle.baseGlowBlurPx}px)`,
                              }}
                            >
                              <span className="inline-block pr-[0.08em]">Vision</span>
                            </span>
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 bg-clip-text text-transparent"
                              style={{
                                backgroundImage: heroTitleStyle.highlightGlowGradient,
                                opacity: heroTitleStyle.highlightGlowOpacity,
                                filter: `blur(${heroTitleStyle.highlightGlowBlurPx}px)`,
                              }}
                            >
                              <span className="inline-block pr-[0.08em]">Vision</span>
                            </span>
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-0 bg-clip-text text-transparent"
                              style={{
                                backgroundImage: heroTitleStyle.spreadGlowGradient,
                                opacity: heroTitleStyle.spreadGlowOpacity,
                                filter: `blur(${heroTitleStyle.spreadGlowBlurPx}px)`,
                              }}
                            >
                              <span className="inline-block pr-[0.08em]">Vision</span>
                            </span>
                            <span
                              className="relative z-10 block bg-clip-text text-transparent"
                              style={{
                                backgroundImage: heroTitleStyle.metalGradient,
                                textShadow: '0 0 22px rgba(245,249,255,0.34)',
                              }}
                            >
                              <span className="inline-block pr-[0.08em]">Vision</span>
                            </span>
                          </span>
                        </h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8">
                      <div className="space-y-8">
                        <div
                          className={`flex justify-center transition-all duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                            isPreflightTransition ? 'opacity-0 -translate-x-10 scale-95 blur-[1px] pointer-events-none' : 'opacity-100 translate-x-0 scale-100'
                          }`}
                        >
                          <div className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
                            <button
                              type="button"
                              onClick={() => onWorkflowModeChange?.('auto')}
                              className={`px-6 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all ${
                                workflowMode === 'auto' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                              }`}
                            >
                              Auto
                            </button>
                            <button
                              type="button"
                              onClick={() => onWorkflowModeChange?.('interaction')}
                              className={`px-6 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.2em] transition-all ${
                                workflowMode === 'interaction' ? 'bg-white text-black' : 'text-white/70 hover:text-white'
                              }`}
                            >
                              Interactive
                            </button>
                          </div>
                        </div>

                        <div
                          ref={sharedInputAnchorRef}
                          className={`h-[88px] transition-all duration-[900ms] ${
                            isPreflightTransition ? 'opacity-0 pointer-events-none' : 'opacity-100'
                          }`}
                        />

                        <div
                          className={`flex items-center justify-center gap-3 md:gap-4 transition-all duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                            isPreflightTransition ? 'opacity-0 translate-x-12 scale-95 blur-[1px] pointer-events-none' : 'opacity-100 translate-x-0 scale-100'
                          }`}
                        >
                          {formats.map((f) => (
                            <button
                              key={f.ratio}
                              type="button"
                              onClick={() => setRatio(f.ratio)}
                              className={`w-[102px] h-[102px] flex flex-col items-center justify-center gap-2 rounded-2xl transition-all border ${
                                ratio === f.ratio
                                  ? 'bg-white text-black border-white shadow-[0_0_30px_rgba(255,255,255,0.08)]'
                                  : 'bg-white/[0.03] text-white/40 border-white/10 hover:bg-white/[0.07]'
                              }`}
                            >
                              <f.icon className="w-5 h-5" />
                              <span className="text-[10px] font-black uppercase tracking-[0.16em]">{f.label}</span>
                            </button>
                          ))}
                        </div>

                        <div
                          className={`text-center text-[10px] uppercase tracking-[0.3em] text-white/35 transition-all duration-700 ${
                            isPreflightTransition ? 'opacity-0 translate-y-8 pointer-events-none' : 'opacity-100 translate-y-0'
                          }`}
                        >
                          {submitHint}
                        </div>
                      </div>

                      <div
                        className={`fixed inset-0 z-[2400] flex flex-col text-white transition-[opacity,transform] duration-[1100ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                          isPreflightOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'
                        }`}
                      >
	                        <div className="absolute inset-0 z-0 pointer-events-none">
	                          <div className="absolute inset-0 bg-black"></div>
	                        </div>

                        <input
                          ref={preflightFileRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={async (e) => {
                            const refs = await readReferenceFiles(e.target.files);
                            if (!refs.length) return;
                            setPendingAttachments((prev) => [...prev, ...refs].slice(0, 4));
                            if (preflightFileRef.current) preflightFileRef.current.value = '';
                          }}
                        />

                        <main
                          className={`relative z-40 flex-1 min-h-0 w-full max-w-[min(96vw,1320px)] mx-auto flex flex-col overflow-hidden -mt-2 transition-all duration-[950ms] delay-75 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                            isPreflightOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-[0.985]'
                          }`}
                        >
		                          <div className="relative flex-1 min-h-0 rounded-[30px] overflow-hidden shadow-[0_26px_80px_rgba(0,0,0,0.48)]">
		                            {/* Frosted glass base: real backdrop blur, no fake thickness/borders. */}
		                            <div className="pointer-events-none absolute inset-0 rounded-[30px] backdrop-blur-[22px] bg-white/[0.04]" />
		                            {/* Radial gradient overlay (very low coverage) to pick up ambient energy. */}
		                            <div className="pointer-events-none absolute inset-0 rounded-[30px] bg-[radial-gradient(120%_110%_at_18%_10%,rgba(148,189,255,0.16),transparent_52%),radial-gradient(120%_110%_at_84%_10%,rgba(255,168,130,0.12),transparent_52%)]" />
		                            {/* Opaque black center that feathers to transparent edges, revealing the frosted glass. */}
		                            <div className="pointer-events-none absolute inset-0 rounded-[30px] bg-black [mask-image:radial-gradient(140%_120%_at_50%_50%,black_0%,black_56%,rgba(0,0,0,0.72)_74%,rgba(0,0,0,0.28)_90%,transparent_100%)] [-webkit-mask-image:radial-gradient(140%_120%_at_50%_50%,black_0%,black_56%,rgba(0,0,0,0.72)_74%,rgba(0,0,0,0.28)_90%,transparent_100%)]" />
		                            <div
		                              ref={preflightMessagesRef}
		                              className="pcw-scroll relative z-10 h-full overflow-y-auto px-6 md:px-10 pt-3 pb-2 space-y-5 flex flex-col"
		                              data-scrolling={isPreflightScrolling ? '1' : '0'}
		                              onScroll={() => {
		                                setIsPreflightScrolling(true);
		                                if (preflightScrollTimeoutRef.current) window.clearTimeout(preflightScrollTimeoutRef.current);
		                                preflightScrollTimeoutRef.current = window.setTimeout(() => setIsPreflightScrolling(false), 650);
		                              }}
		                            >
                              {preflightMessages.map((m) => (
                                <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                                  <div className={`text-[9px] font-black uppercase tracking-[0.26em] mb-2 opacity-45 ${m.role === 'user' ? 'mr-2' : 'ml-2'}`}>
                                    {m.role === 'user' ? 'Auteur' : m.role === 'agent' ? 'Directeur' : 'System'}
                                  </div>
                                  <div
                                    className={`max-w-[88%] px-5 py-4 text-left text-[14px] leading-relaxed tracking-tight whitespace-pre-wrap ${
                                      m.role === 'user'
                                        ? 'bg-white text-black font-semibold rounded-[26px] rounded-tr-[8px] shadow-[0_16px_34px_rgba(0,0,0,0.34)]'
                                        : m.role === 'agent'
                                          ? 'bg-[linear-gradient(105deg,rgba(11,16,27,0.84)_0%,rgba(15,19,26,0.74)_48%,rgba(21,24,31,0.62)_100%)] border border-white/14 text-white/90 font-normal rounded-[26px] rounded-tl-[8px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.34)] backdrop-blur-xl'
                                          : 'bg-white/[0.05] border border-white/14 text-zinc-200 rounded-[22px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] backdrop-blur-xl'
                                    }`}
                                  >
                                    {m.content}
                                    {m.attachmentIds?.length ? (
                                      <div className="mt-4 flex flex-wrap gap-2">
                                        {m.attachmentIds.map((id) => {
                                          const a = preflightAttachments.find((x) => x.id === id);
                                          if (!a) return null;
                                          return (
                                            <span key={id} className="px-2 py-1 rounded-full bg-black/45 border border-white/15 text-[10px] text-zinc-100">
                                              {a.name || 'attachment'} {'->'} {a.assignedTo}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                              {isPreflightThinking && (
                                <div className="flex flex-col items-start">
                                  <div className="text-[9px] font-black uppercase tracking-[0.26em] mb-2 opacity-45 ml-2">Directeur</div>
                                  <div className="px-5 py-3 bg-black/35 border border-white/12 rounded-[16px] flex items-center gap-2.5">
                                    <div className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce"></div>
                                    <div className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce [animation-delay:200ms]"></div>
                                    <div className="w-1.5 h-1.5 bg-white/70 rounded-full animate-bounce [animation-delay:400ms]"></div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </main>

                        {hasPreflightFooterContent && (
                          <footer
                            className={`relative z-[60] w-full max-w-[min(96vw,1320px)] mx-auto px-8 md:px-12 pb-1 pt-1 flex flex-col gap-2 transition-all duration-[980ms] delay-150 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                              isPreflightOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-10 scale-[0.985]'
                            }`}
                          >
                            {preflightAttachments.length > 0 && (
                              <div className="rounded-xl border border-white/12 bg-black/30 p-3 space-y-2">
                                <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-300 font-black">Attachment Inbox</div>
                                <div className="space-y-2 max-h-40 overflow-y-auto">
                                  {preflightAttachments.map((a) => (
                                    <div key={a.id} className="flex items-center gap-2">
                                      <div className="text-[11px] text-white/80 truncate flex-1">{a.name || a.id}</div>
                                      <select
                                        value={a.assignedTo}
                                        onChange={(e) => {
                                          const v = String(e.target.value || 'unassigned');
                                          setPreflightAttachments((prev) =>
                                            prev.map((x) => (x.id === a.id ? { ...x, assignedTo: v } : x)),
                                          );
                                          if (v && !knownTargets.includes(v)) setKnownTargets((prev) => [...prev, v]);
                                        }}
                                        className="h-8 rounded-md bg-black/40 text-[11px] text-white px-2 focus:outline-none focus:ring-2 focus:ring-[#ee4d2d]/40"
                                      >
                                        <option value="unassigned">unassigned</option>
                                        {knownTargets.map((t) => (
                                          <option key={t} value={t}>
                                            {t}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </footer>
                        )}
                      </div>

                      {!isProcessing && (
                        <div
                          className={`fixed left-1/2 top-1/2 w-[min(92vw,880px)] will-change-transform transition-[transform,opacity] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                            sharedInputTransitionEnabled ? 'duration-[980ms]' : 'duration-0'
                          } ${
                            isPreflightOpen ? 'z-[2450]' : 'z-[8]'
                          }`}
                          style={{
                            transform: isPreflightOpen
                              ? 'translate(-50%, calc(50vh - 160px))'
                              : sharedInputMeasured
                                ? `translate(-50%, ${sharedInputStartOffset + 27}px)`
                                : 'translate(-50%, 0px)',
                            opacity: 1,
                          }}
                        >
                          <div className="relative group">
                            {isPreflightOpen && pendingAttachments.length > 0 && (
                              <div className="absolute left-0 right-0 bottom-full mb-2 z-30 rounded-2xl border border-white/12 bg-black/40 px-3 py-2 backdrop-blur-xl">
                                <div className="flex gap-2 overflow-x-auto py-1 pcw-scroll">
                                  {pendingAttachments.map((r) => (
                                    <div key={r.id} className="relative group flex-shrink-0">
                                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-black/60 border border-white/14">
                                        {String(r.url || '').startsWith('data:image') ? (
                                          <img src={r.url} alt={r.name || 'reference'} className="w-full h-full object-cover" />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center text-white/30 text-[10px]">Ref</div>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== r.id))}
                                        className="absolute -top-1 -right-1 w-5 h-5 bg-white text-black rounded-full flex items-center justify-center shadow-xl hover:scale-110 z-10 transition-transform"
                                        aria-label="Remove attachment"
                                        title="Remove"
                                      >
                                        <X className="w-3 h-3" strokeWidth={3} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className={`pointer-events-none absolute -inset-3 rounded-[40px] blur-3xl transition duration-700 ${
                              isPreflightOpen
                                ? 'bg-[radial-gradient(circle_at_20%_50%,rgba(145,190,255,0.25),transparent_48%),radial-gradient(circle_at_80%_50%,rgba(255,138,92,0.2),transparent_44%)] opacity-80'
                                : isSharedInputFocused
                                  ? 'bg-white/10 opacity-0'
                                  : 'bg-white/8 opacity-55 group-hover:opacity-70'
                            }`}></div>
                            <div className={`absolute -inset-[4px] rounded-[38px] overflow-hidden pointer-events-none transition-opacity duration-500 ${
                              isSharedInputSelected ? 'opacity-0' : 'opacity-95 group-hover:opacity-100'
                            }`}>
                              <div
                                className="absolute -inset-[2px] rounded-[40px] blur-xl bg-[radial-gradient(circle_at_15%_50%,rgba(188,220,255,0.58),transparent_48%),radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.24),transparent_62%),radial-gradient(circle_at_85%_50%,rgba(255,182,142,0.52),transparent_48%)]"
                                style={{ animation: 'pcw-aura-breathe 3.2s cubic-bezier(0.4,0,0.2,1) infinite' }}
                              />
                              <div
                                className="absolute inset-[3px] rounded-[34px] border-[0.2px] border-slate-100/40 bg-transparent"
                                style={{ animation: 'pcw-border-breathe 3.2s cubic-bezier(0.4,0,0.2,1) infinite' }}
                              />
                              <div
                                className="absolute inset-[3px] rounded-[34px] bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.6)_48%,transparent_100%)] mix-blend-screen blur-[1px]"
                                style={{ animation: 'pcw-sheen-drift 4.2s ease-in-out infinite' }}
                              />
                            </div>
                            <div className={`relative z-10 rounded-[32px] flex items-center px-6 py-2 shadow-2xl transition-all duration-700 bg-[#050505] backdrop-blur-[18px] ${
                              isSharedInputSelected
                                ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.22),0_24px_62px_rgba(0,0,0,0.58)]'
                                : 'shadow-[0_20px_52px_rgba(0,0,0,0.5)]'
                            }`}>
	                              <div className="relative w-10 h-10 mr-2">
                                <button
                                  type="button"
                                  onClick={() => preflightFileRef.current?.click()}
                                  className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
                                    isPreflightOpen
                                      ? 'opacity-100 text-white/75 hover:text-white bg-white/[0.06] rounded-xl'
                                      : 'opacity-0 text-white/20 pointer-events-none'
                                  }`}
                                  title="Attach reference"
                                >
                                  <Paperclip className="w-6 h-6" />
                                </button>
	                                <div
	                                  className={`pointer-events-none absolute inset-0 flex items-center justify-center text-white/30 transition-all duration-300 ${
	                                    isPreflightOpen ? 'opacity-0' : 'opacity-100'
	                                  }`}
	                                >
	                                  <Sparkles className="w-5 h-5" />
	                                </div>
	                              </div>
                              <input
                                autoFocus={!isPreflightOpen}
                                value={isPreflightOpen ? preflightInput : intent}
                                onChange={(e) => (isPreflightOpen ? setPreflightInput(e.target.value) : setIntent(e.target.value))}
                                onPaste={async (e) => {
                                  if (!isPreflightOpen) return;
                                  const files = Array.from(e.clipboardData?.files || []);
                                  if (!files.length) return;
                                  const refs = await readReferenceFiles(files);
                                  if (!refs.length) return;
                                  e.preventDefault();
                                  setPendingAttachments((prev) => [...prev, ...refs].slice(0, 4));
                                }}
                                onFocus={() => setIsSharedInputFocused(true)}
                                onBlur={() => setIsSharedInputFocused(false)}
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter' || e.shiftKey) return;
                                  e.preventDefault();
                                  if (isPreflightOpen) {
                                    if (isPreflightThinking) return;
                                    if (!preflightInput.trim() && pendingAttachments.length === 0) {
                                      handleForceStart();
                                      return;
                                    }
                                    sendPreflightMessage(preflightInput).catch(() => {});
                                    return;
                                  }
                                  handleGenerate().catch(() => {});
                                }}
                                className="flex-1 bg-transparent border-none outline-none text-base font-light tracking-wide text-white placeholder-white/10 h-14"
                                placeholder={isPreflightOpen ? 'Refine the visual language...' : landingPlaceholders[placeholderIndex]}
                              />
                              <button
                                type="button"
                                disabled={
                                  isPreflightOpen
                                    ? isPreflightThinking
                                    : !hasIntent
                                }
                                onClick={() => {
                                  if (isPreflightOpen) {
                                    if (!preflightInput.trim() && pendingAttachments.length === 0) {
                                      handleForceStart();
                                      return;
                                    }
                                    sendPreflightMessage(preflightInput).catch(() => {});
                                    return;
                                  }
                                  handleGenerate().catch(() => {});
                                }}
                                className={`ml-4 w-12 h-12 rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all duration-500 disabled:opacity-20 disabled:scale-100 shadow-2xl ${
                                  isPreflightOpen
                                    ? preflightInput.trim() || pendingAttachments.length > 0
                                      ? 'bg-white text-black'
                                      : 'bg-white text-black'
                                    : 'bg-white text-black'
                                }`}
                                style={
                                  isPreflightOpen && !(preflightInput.trim() || pendingAttachments.length > 0)
                                    ? { animation: 'pcw-rocket-breathe 2.2s ease-in-out infinite' }
                                    : undefined
                                }
                                title={isPreflightOpen ? (preflightInput.trim() || pendingAttachments.length > 0 ? 'Send' : 'Force Start') : submitLabel}
                              >
                                {isPreflightOpen ? (
                                  preflightInput.trim() || pendingAttachments.length > 0 ? (
                                    <ArrowUp className="w-6 h-6" strokeWidth={2.5} />
                                  ) : (
                                    <Rocket className="w-5 h-5" strokeWidth={2.4} />
                                  )
                                ) : (
                                  <ArrowUp className="w-6 h-6" strokeWidth={2.5} />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </form>
                </div>
            )}
        </div>
    </div>
  );
};
