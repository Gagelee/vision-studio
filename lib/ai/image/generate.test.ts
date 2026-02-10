import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImageFromPrompt } from './generate';

const settings = {
  provider: 'gemini',
  model: 'gemini-3-flash-preview',
  temperature: 0.5,
  maxOutputTokens: 2048,
};

const jsonResponse = (status: number, body: any, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
  });

describe('generateImageFromPrompt async task polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps task binding and succeeds after transient polling errors', async () => {
    vi.useFakeTimers();
    const accepted: Array<{ taskId: string; statusUrl: string }> = [];
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/asset/image/generate')) {
        return jsonResponse(202, { accepted: true, taskId: 'task-img-1', statusUrl: '/api/pipeline/tasks/task-img-1' });
      }
      if (url.includes('/api/pipeline/tasks/task-img-1')) {
        pollCount += 1;
        if (pollCount <= 2) return jsonResponse(502, { ok: false, error: 'bad gateway' });
        return jsonResponse(200, {
          ok: true,
          task: { id: 'task-img-1', status: 'success', result: { imageUrl: '/__generated__/ok.png', debug: { source: 'poll' } } },
        });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = generateImageFromPrompt({
      prompt: 'test prompt',
      settings,
      strict: true,
      onTaskAccepted: (task) => accepted.push(task),
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const out = await promise;
    expect(out.imageUrl).toBe('/__generated__/ok.png');
    expect(String(out.debug?.taskId || '')).toBe('task-img-1');
    expect(accepted).toEqual([{ taskId: 'task-img-1', statusUrl: '/api/pipeline/tasks/task-img-1' }]);
  });

  it('fails fast on task 404 to prevent hanging UI states', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/asset/image/generate')) {
        return jsonResponse(202, { accepted: true, taskId: 'task-img-404', statusUrl: '/api/pipeline/tasks/task-img-404' });
      }
      if (url.includes('/api/pipeline/tasks/task-img-404')) {
        return jsonResponse(404, { ok: false, error: 'Task not found' });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = generateImageFromPrompt({
      prompt: 'test prompt',
      settings,
      strict: true,
    });

    const rejected = expect(promise).rejects.toMatchObject({
      message: 'Image task not found',
      code: 'PIPELINE_TASK_NOT_FOUND',
      taskId: 'task-img-404',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
  });

  it('tracks concurrent tasks independently under out-of-order polling', async () => {
    vi.useFakeTimers();
    const accepted: Array<{ tag: string; taskId: string; statusUrl: string }> = [];
    const pollCounts: Record<string, number> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/asset/image/generate')) {
        const body = JSON.parse(String(init?.body || '{}')) as any;
        const prompt = String(body?.prompt || '');
        if (prompt.includes('A')) {
          return jsonResponse(202, { accepted: true, taskId: 'task-img-a', statusUrl: '/api/pipeline/tasks/task-img-a' });
        }
        return jsonResponse(202, { accepted: true, taskId: 'task-img-b', statusUrl: '/api/pipeline/tasks/task-img-b' });
      }
      if (url.includes('/api/pipeline/tasks/task-img-a')) {
        pollCounts.a = (pollCounts.a || 0) + 1;
        if (pollCounts.a < 3) return jsonResponse(200, { ok: true, task: { id: 'task-img-a', status: 'running' } });
        return jsonResponse(200, {
          ok: true,
          task: { id: 'task-img-a', status: 'success', result: { imageUrl: '/__generated__/a.png' } },
        });
      }
      if (url.includes('/api/pipeline/tasks/task-img-b')) {
        pollCounts.b = (pollCounts.b || 0) + 1;
        return jsonResponse(200, {
          ok: true,
          task: { id: 'task-img-b', status: 'success', result: { imageUrl: '/__generated__/b.png' } },
        });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const taskA = generateImageFromPrompt({
      prompt: 'prompt-A',
      settings,
      strict: true,
      onTaskAccepted: (task) => accepted.push({ tag: 'A', ...task }),
    });
    const taskB = generateImageFromPrompt({
      prompt: 'prompt-B',
      settings,
      strict: true,
      onTaskAccepted: (task) => accepted.push({ tag: 'B', ...task }),
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const [outA, outB] = await Promise.all([taskA, taskB]);
    expect(outA.imageUrl).toBe('/__generated__/a.png');
    expect(outB.imageUrl).toBe('/__generated__/b.png');
    expect(
      accepted
        .map((x) => `${x.tag}:${x.taskId}`)
        .sort(),
    ).toEqual(['A:task-img-a', 'B:task-img-b']);
  });
});
