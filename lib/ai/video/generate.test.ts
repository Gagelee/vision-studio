import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateVideoFromImage } from './generate';

const jsonResponse = (status: number, body: any, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
  });

describe('generateVideoFromImage async task polling', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('recovers from transient poll failures and returns video output', async () => {
    vi.useFakeTimers();
    const accepted: Array<{ taskId: string; statusUrl: string }> = [];
    let pollCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/asset/video/generate')) {
        return jsonResponse(202, { accepted: true, taskId: 'task-vid-1', statusUrl: '/api/pipeline/tasks/task-vid-1' });
      }
      if (url.includes('/api/pipeline/tasks/task-vid-1')) {
        pollCount += 1;
        if (pollCount <= 3) return jsonResponse(500, { ok: false, error: 'temporary server error' });
        return jsonResponse(200, {
          ok: true,
          task: {
            id: 'task-vid-1',
            status: 'success',
            result: { videoUrl: '/__generated__/ok.mp4', operationName: 'ops/123' },
          },
        });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = generateVideoFromImage({
      prompt: 'video prompt',
      imageUrl: '/__generated__/k.png',
      durationSeconds: 4,
      onTaskAccepted: (task) => accepted.push(task),
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const out = await promise;
    expect(out.videoUrl).toBe('/__generated__/ok.mp4');
    expect(out.taskId).toBe('task-vid-1');
    expect(accepted).toEqual([{ taskId: 'task-vid-1', statusUrl: '/api/pipeline/tasks/task-vid-1' }]);
  });

  it('returns task-not-found error on 404 status endpoint', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/asset/video/generate')) {
        return jsonResponse(202, { accepted: true, taskId: 'task-vid-404', statusUrl: '/api/pipeline/tasks/task-vid-404' });
      }
      if (url.includes('/api/pipeline/tasks/task-vid-404')) {
        return jsonResponse(404, { ok: false, error: 'Task not found' });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = generateVideoFromImage({
      prompt: 'video prompt',
      imageUrl: '/__generated__/k.png',
      durationSeconds: 4,
    });

    const rejected = expect(promise).rejects.toMatchObject({
      message: 'Video task not found',
      code: 'PIPELINE_TASK_NOT_FOUND',
      taskId: 'task-vid-404',
    });
    await vi.advanceTimersByTimeAsync(2_000);
    await rejected;
  });

  it('keeps concurrent video task results isolated when poll order is interleaved', async () => {
    vi.useFakeTimers();
    const accepted: Array<{ tag: string; taskId: string; statusUrl: string }> = [];
    const pollCounts: Record<string, number> = {};
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/asset/video/generate')) {
        const body = JSON.parse(String(init?.body || '{}')) as any;
        const prompt = String(body?.prompt || '');
        if (prompt.includes('A')) {
          return jsonResponse(202, { accepted: true, taskId: 'task-vid-a', statusUrl: '/api/pipeline/tasks/task-vid-a' });
        }
        return jsonResponse(202, { accepted: true, taskId: 'task-vid-b', statusUrl: '/api/pipeline/tasks/task-vid-b' });
      }
      if (url.includes('/api/pipeline/tasks/task-vid-a')) {
        pollCounts.a = (pollCounts.a || 0) + 1;
        if (pollCounts.a < 3) return jsonResponse(200, { ok: true, task: { id: 'task-vid-a', status: 'running' } });
        return jsonResponse(200, {
          ok: true,
          task: { id: 'task-vid-a', status: 'success', result: { videoUrl: '/__generated__/a.mp4', operationName: 'ops/a' } },
        });
      }
      if (url.includes('/api/pipeline/tasks/task-vid-b')) {
        pollCounts.b = (pollCounts.b || 0) + 1;
        return jsonResponse(200, {
          ok: true,
          task: { id: 'task-vid-b', status: 'success', result: { videoUrl: '/__generated__/b.mp4', operationName: 'ops/b' } },
        });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    const taskA = generateVideoFromImage({
      prompt: 'video-A',
      imageUrl: '/__generated__/frame-a.png',
      durationSeconds: 4,
      onTaskAccepted: (task) => accepted.push({ tag: 'A', ...task }),
    });
    const taskB = generateVideoFromImage({
      prompt: 'video-B',
      imageUrl: '/__generated__/frame-b.png',
      durationSeconds: 4,
      onTaskAccepted: (task) => accepted.push({ tag: 'B', ...task }),
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);

    const [outA, outB] = await Promise.all([taskA, taskB]);
    expect(outA.videoUrl).toBe('/__generated__/a.mp4');
    expect(outB.videoUrl).toBe('/__generated__/b.mp4');
    expect(
      accepted
        .map((x) => `${x.tag}:${x.taskId}`)
        .sort(),
    ).toEqual(['A:task-vid-a', 'B:task-vid-b']);
  });
});
