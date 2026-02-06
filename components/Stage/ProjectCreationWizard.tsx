
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, ArrowRight, Smartphone, Tv, Instagram, Clapperboard, Loader2, X, CheckCircle2, AlertTriangle, Upload } from 'lucide-react';
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
  const [ratio, setRatio] = useState<AspectRatio>('16:9');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPreflightOpen, setIsPreflightOpen] = useState(false);
  const [preflightInput, setPreflightInput] = useState('');
  const [preflightMessages, setPreflightMessages] = useState<PreflightMsg[]>([]);
  const [isPreflightThinking, setIsPreflightThinking] = useState(false);
  const [preflightReady, setPreflightReady] = useState(false);
  const [preflightBrief, setPreflightBrief] = useState('');
  const [forceStartArmed, setForceStartArmed] = useState(false);
  const [unassignedProceedArmed, setUnassignedProceedArmed] = useState(false);
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
  const unassignedAttachmentCount = useMemo(
    () => preflightAttachments.filter((a) => String(a.assignedTo || '') === 'unassigned').length,
    [preflightAttachments],
  );

  useEffect(() => {
    if (!isPreflightOpen) return;
    const el = preflightMessagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isPreflightOpen, preflightMessages, isPreflightThinking]);

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
    setForceStartArmed(false);
    setUnassignedProceedArmed(false);
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

  const readReferenceFiles = async (files: FileList | null) => {
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
    setForceStartArmed(false);
    setUnassignedProceedArmed(false);
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
        setForceStartArmed(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetProgress();
    if (workflowMode === 'interaction') {
      setIsPreflightOpen(true);
      setPreflightMessages([
        {
          id: `p-s-${Date.now()}`,
          role: 'system',
          content: 'Interaction preflight started. Director will ask clarifying questions. Upload references here if available.',
        },
      ]);
      setPreflightInput('');
      setPreflightReady(false);
      setPreflightBrief('');
      setForceStartArmed(false);
      setTimeout(() => {
        sendPreflightMessage('', { kickoff: true }).catch(() => {});
      }, 0);
      return;
    }
    await runScaffold({ allowSingleFallback: false });
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-[#050505] flex items-center justify-center p-8 overflow-hidden">
        {/* Cinematic Background */}
        <div className="absolute inset-0 z-0">
             <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-[#ee4d2d]/10"></div>
             <div className="absolute inset-0 opacity-20 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
        </div>

        <button onClick={onCancel} className="absolute top-10 right-10 text-white/40 hover:text-white transition-colors">
            <X className="w-8 h-8" />
        </button>

        <div className="relative z-10 w-full max-w-4xl text-center">
            {isProcessing ? (
                <div className="space-y-12 animate-in zoom-in-95 duration-500">
                    <div className="relative w-24 h-24 mx-auto">
                        <div className="absolute inset-0 rounded-full border-2 border-white/5 animate-[ping_2s_infinite]"></div>
                        <div className="absolute inset-0 rounded-full border-t-2 border-[#ee4d2d] animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Sparkles className="w-10 h-10 text-[#ee4d2d] animate-pulse" />
                        </div>
                    </div>
                    <div>
	                        <h2 className="text-4xl font-black text-white tracking-tighter mb-4">Director AI is Thinking...</h2>
	                        <p className="text-white/40 font-medium text-lg max-w-md mx-auto">
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
	                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
	                            <div
                                  className="h-full bg-[#ee4d2d] transition-all duration-500"
                                  style={{ width: `${progressPct}%` }}
                                />
	                        </div>
	                        <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
	                            <span>Analysis</span>
	                            <span>{phase === 'assets' ? `Assets ${assetDone}/${Math.max(1, assetTotal)}` : 'Scaffolding'}</span>
	                        </div>
	                          {phase === 'assets' && assetCurrent && (
	                            <div className="text-[11px] text-white/30 font-mono break-words">
	                              {assetCurrent}{assetErrors ? ` (errors: ${assetErrors})` : ''}
	                            </div>
	                          )}
                            {phase === 'assets' && assetStartAt > 0 && (
                              <div className="text-[10px] text-white/30 font-mono">
                                Elapsed: {Math.floor(Math.max(0, Date.now() - assetStartAt) / 1000)}s
                              </div>
                            )}
                            {phase === 'scaffold' && scaffoldCurrent && (
                              <div className="text-[11px] text-white/30 font-mono break-words">
                                {scaffoldCurrent}
                              </div>
                            )}
		                          <div className="text-[10px] text-white/20 font-mono">
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
                <div className="space-y-16 animate-in slide-in-from-bottom-20 duration-1000">
                    <div className="space-y-4">
                        <div className="flex items-center justify-center gap-3 text-[#ee4d2d] mb-4">
                            <div className="w-12 h-px bg-[#ee4d2d]/30"></div>
                            <Sparkles className="w-6 h-6" />
                            <span className="text-xs font-black uppercase tracking-[0.4em]">Initialize Narrative</span>
                            <div className="w-12 h-px bg-[#ee4d2d]/30"></div>
                        </div>
                        <h1 className="text-8xl font-black text-white tracking-tighter leading-[0.85]">
                            What is your <span className="text-[#ee4d2d]">Masterpiece</span>?
                        </h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-12">
                        <div className="relative group">
                            <input 
                                autoFocus
                                className="w-full bg-transparent border-b-2 border-white/10 focus:border-[#ee4d2d] transition-all py-8 text-4xl font-bold text-white text-center placeholder-white/10 focus:outline-none"
                                placeholder="A neon noir chase through rainy Tokyo..."
                                value={intent}
                                onChange={(e) => setIntent(e.target.value)}
                            />
                            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-focus-within:w-full bg-[#ee4d2d] transition-all duration-700"></div>
                        </div>

                        <div className="flex items-center justify-center gap-6">
                            {formats.map(f => (
                                <button 
                                    key={f.ratio}
                                    type="button"
                                    onClick={() => setRatio(f.ratio)}
                                    className={`flex flex-col items-center gap-3 p-6 rounded-3xl transition-all border-2 ${
                                        ratio === f.ratio 
                                        ? 'bg-white text-black border-white shadow-[0_0_50px_rgba(255,255,255,0.1)]' 
                                        : 'bg-white/5 text-white/40 border-white/5 hover:bg-white/10'
                                    }`}
                                >
                                    <f.icon className="w-6 h-6" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{f.label}</span>
                                </button>
                            ))}
                        </div>

                        <div className="max-w-xl mx-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur px-4 py-3">
                          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-3">
                            Workflow Entry Mode
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <button
                              type="button"
                              onClick={() => onWorkflowModeChange?.('auto')}
                              className={`px-4 py-3 rounded-xl border text-left transition-all ${
                                workflowMode === 'auto'
                                  ? 'bg-white text-black border-white'
                                  : 'bg-white/5 text-white/70 border-white/15 hover:bg-white/10'
                              }`}
                            >
                              <div className="text-xs font-black uppercase tracking-widest">Auto</div>
                              <div className="mt-1 text-[11px] opacity-80">One-shot direct execution.</div>
                            </button>
                            <button
                              type="button"
                              onClick={() => onWorkflowModeChange?.('interaction')}
                              className={`px-4 py-3 rounded-xl border text-left transition-all ${
                                workflowMode === 'interaction'
                                  ? 'bg-amber-400 text-black border-amber-300'
                                  : 'bg-white/5 text-white/70 border-white/15 hover:bg-white/10'
                              }`}
                            >
                              <div className="text-xs font-black uppercase tracking-widest">Interaction</div>
                              <div className="mt-1 text-[11px] opacity-80">Back-and-forth before generation.</div>
                            </button>
                          </div>
                        </div>

                        {!isPreflightOpen && (
                          <button
                              type="submit"
                              disabled={!intent.trim()}
                              className="group flex items-center gap-4 px-12 py-6 bg-white text-black rounded-full text-xl font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all disabled:opacity-20"
                          >
                              Start Production
                              <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform" />
                          </button>
                        )}
                    </form>

                    {isPreflightOpen && (
                      <div className="fixed inset-0 z-[2600] bg-black/60 backdrop-blur-sm p-6 flex items-center justify-center">
                      <div className="w-full max-w-3xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-6 text-left max-h-[78vh] flex flex-col">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-4">Interaction Preflight</div>
                        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
                        <div ref={preflightMessagesRef} className="rounded-2xl border border-white/10 bg-black/20 p-4 h-72 overflow-y-auto space-y-3">
                          {preflightMessages.map((m) => (
                            <div key={m.id} className={`text-sm ${m.role === 'user' ? 'text-white' : m.role === 'agent' ? 'text-amber-200' : 'text-zinc-400'}`}>
                              <span className="text-[10px] font-black uppercase tracking-wider mr-2 opacity-70">{m.role}</span>
                              <span className="whitespace-pre-wrap">{m.content}</span>
                              {m.attachmentIds?.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {m.attachmentIds.map((id) => {
                                    const a = preflightAttachments.find((x) => x.id === id);
                                    if (!a) return null;
                                    return (
                                      <span key={id} className="px-1.5 py-0.5 rounded border border-white/15 text-[10px] text-zinc-300">
                                        {a.name || 'attachment'} {'->'} {a.assignedTo}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ))}
                          {isPreflightThinking && <div className="text-xs text-white/50">Director is typing…</div>}
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
                            setPreflightMessages((prev) => [
                              ...prev,
                              { id: `p-s-${Date.now()}`, role: 'system', content: `Queued attachments: ${refs.map((r) => r.name || 'image').join(', ')}` },
                            ]);
                            if (preflightFileRef.current) preflightFileRef.current.value = '';
                          }}
                        />

                        {pendingAttachments.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {pendingAttachments.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                onClick={() => setPendingAttachments((prev) => prev.filter((x) => x.id !== r.id))}
                                className="px-2 py-1 rounded-md border border-white/15 text-[10px] text-white/70"
                              >
                                Pending: {r.name || 'reference'} ✕
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => preflightFileRef.current?.click()}
                            className="px-3 py-2 rounded-xl border border-white/15 text-white/80 text-[11px] font-black uppercase tracking-widest hover:bg-white/10"
                          >
                            <span className="inline-flex items-center gap-1"><Upload className="w-3.5 h-3.5" />Refs</span>
                          </button>
                          <input
                            value={preflightInput}
                            onChange={(e) => setPreflightInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              if (isPreflightThinking) return;
                              if (!preflightInput.trim() && pendingAttachments.length === 0) return;
                              e.preventDefault();
                              sendPreflightMessage(preflightInput).catch(() => {});
                            }}
                            className="flex-1 h-11 rounded-xl bg-black/30 border border-white/10 px-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#ee4d2d]/60"
                            placeholder="Reply to Director..."
                          />
                          <button
                            type="button"
                            disabled={isPreflightThinking || (!preflightInput.trim() && pendingAttachments.length === 0)}
                            onClick={() => sendPreflightMessage(preflightInput)}
                            className="px-4 h-11 rounded-xl bg-white text-black text-[11px] font-black uppercase tracking-widest disabled:opacity-30"
                          >
                            Send
                          </button>
                        </div>

                        {preflightReady && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-100 whitespace-pre-wrap">
                            {preflightBrief || 'Director marked READY_TO_SCAFFOLD.'}
                          </div>
                        )}

                        {preflightAttachments.length > 0 && (
                          <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-black">Attachment Inbox</div>
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
                                    className="h-8 rounded-md bg-black/40 border border-white/15 text-[11px] text-white px-2"
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
                        </div>

                        <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setIsPreflightOpen(false);
                              setPreflightInput('');
                              setPreflightMessages([]);
                              setPreflightReady(false);
                              setPreflightBrief('');
                              setForceStartArmed(false);
                              setUnassignedProceedArmed(false);
                              setPendingAttachments([]);
                              setPreflightAttachments([]);
                            }}
                            className="px-4 py-2 rounded-xl border border-white/15 text-white/80 text-[11px] font-black uppercase tracking-widest hover:bg-white/10"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isPreflightThinking}
                            onClick={() => {
                              if (!preflightReady && !forceStartArmed) {
                                setForceStartArmed(true);
                                return;
                              }
                              if (unassignedAttachmentCount > 0 && !unassignedProceedArmed) {
                                setUnassignedProceedArmed(true);
                                return;
                              }
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
                              setForceStartArmed(false);
                              setUnassignedProceedArmed(false);
                              runScaffold({ allowSingleFallback: false, intentOverride: finalIntent }).catch((err) =>
                                setError(err instanceof Error ? err.message : String(err)),
                              );
                            }}
                            className="px-4 py-2 rounded-xl bg-[#ee4d2d] text-white text-[11px] font-black uppercase tracking-widest hover:bg-[#f05d40] disabled:opacity-30"
                          >
                            {unassignedAttachmentCount > 0 && unassignedProceedArmed
                              ? `Confirm Start (${unassignedAttachmentCount} Unassigned)`
                              : preflightReady
                                ? 'Start Generate'
                                : forceStartArmed
                                  ? 'Confirm Force Start'
                                  : 'Force Start'}
                          </button>
                        </div>
                      </div>
                      </div>
                    )}
                </div>
            )}
        </div>
    </div>
  );
};
