const {
  describe,
  it,
  assert,
  installFetchMock,
  wait,
} = require('./helpers');

const ctx = global.__TEST_CTX__;

describe('GET /health', () => {
  it('returns ok', async () => {
    const r = await fetch(`${ctx.baseUrl}/health`);
    const d = await r.json();
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(d, { status: 'ok' });
  });
});

describe('POST /tasks - normal cases', () => {
  it('accepts GET task without headers/body', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/get',
        method: 'GET',
      }),
    });
    assert.strictEqual(r.status, 201);
    const d = await r.json();
    assert.ok(/^[0-9a-f-]{36}$/.test(d.task_id), 'task_id should be uuid');
    assert.strictEqual(d.scheduled_at, null);
  });

  it('accepts POST task with headers and body', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/post',
        method: 'POST',
        headers: { 'X-Token': 'abc' },
        body: 'payload',
      }),
    });
    assert.strictEqual(r.status, 201);
    const d = await r.json();
    assert.ok(d.task_id);
  });

  it('defaults method to GET when omitted', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/default' }),
    });
    const d = await r.json();
    assert.strictEqual(r.status, 201);
    const saved = ctx.storage.getTask(d.task_id);
    assert.strictEqual(saved.method, 'GET');
  });

  it('accepts delay_seconds and returns scheduled_at in ISO', async () => {
    const before = new Date(Date.now() + 10 * 1000).toISOString();
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/delay', delay_seconds: 15 }),
    });
    const after = new Date(Date.now() + 30 * 1000).toISOString();
    assert.strictEqual(r.status, 201);
    const d = await r.json();
    assert.ok(d.scheduled_at >= before, `scheduled_at ${d.scheduled_at} should be >= ${before}`);
    assert.ok(d.scheduled_at <= after, `scheduled_at ${d.scheduled_at} should be <= ${after}`);
  });

  it('accepts scheduled_at ISO in future', async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/future', scheduled_at: future }),
    });
    assert.strictEqual(r.status, 201);
    const d = await r.json();
    assert.strictEqual(d.scheduled_at, future);
  });
});

describe('POST /tasks - invalid cases', () => {
  it('rejects missing url with 400', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'GET' }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.ok(/url is required/i.test(d.error));
  });

  it('rejects empty url with 400', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '' }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.ok(/url is required/i.test(d.error));
  });

  it('rejects unsupported method PUT/DELETE', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x', method: 'DELETE' }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.ok(/method must be GET or POST/.test(d.error));
  });

  it('rejects invalid scheduled_at format with error_code=invalid_format', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x', scheduled_at: 'not-a-date' }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.strictEqual(d.error_code, 'invalid_format');
    assert.ok(d.requested_time);
    assert.ok(d.server_time);
    assert.ok(/ISO 8601/.test(d.error));
  });

  it('rejects past scheduled_at with error_code=time_in_past and both times', async () => {
    const past = '2020-01-01T00:00:00Z';
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x', scheduled_at: past }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.strictEqual(d.error_code, 'time_in_past');
    assert.strictEqual(d.requested_time, past);
    assert.ok(d.server_time, 'server_time should be present');
    assert.ok(new Date(d.server_time) > new Date(past));
    assert.ok(/已过期/.test(d.error));
  });

  it('rejects non-numeric delay_seconds with error_code=invalid_delay', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x', delay_seconds: 'abc' }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.strictEqual(d.error_code, 'invalid_delay');
    assert.strictEqual(d.requested_delay, 'abc');
    assert.ok(d.server_time);
  });

  it('rejects negative delay_seconds with error_code=negative_delay', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://x', delay_seconds: -10 }),
    });
    assert.strictEqual(r.status, 400);
    const d = await r.json();
    assert.strictEqual(d.error_code, 'negative_delay');
    assert.strictEqual(d.requested_delay, -10);
  });
});

describe('POST /tasks - dedupe 2-second window', () => {
  it('rapid identical submissions share one task_id', async () => {
    const fixedScheduledAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const payload = {
      url: 'https://example.com/dedupe',
      method: 'GET',
      headers: { 'X-Run': 'unique' },
      scheduled_at: fixedScheduledAt,
    };
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`${ctx.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      ids.push(d.task_id);
    }
    const uniq = new Set(ids);
    assert.strictEqual(uniq.size, 1, `expected 1 unique task_id, got ${uniq.size}: ${ids.join(',')}`);
  });

  it('different payloads produce different task_ids', async () => {
    const a = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://a', delay_seconds: 60 }),
    }).then((r) => r.json());
    const b = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://b', delay_seconds: 60 }),
    }).then((r) => r.json());
    assert.notStrictEqual(a.task_id, b.task_id);
  });
});

describe('GET /tasks/:id', () => {
  it('returns 404 for missing id', async () => {
    const r = await fetch(`${ctx.baseUrl}/tasks/00000000-0000-0000-0000-000000000000`);
    assert.strictEqual(r.status, 404);
    const d = await r.json();
    assert.ok(/not found/i.test(d.error));
  });

  it('returns full task shape for valid id', async () => {
    const create = await fetch(`${ctx.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/shape',
        method: 'POST',
        headers: { 'X-Key': 'v' },
        body: 'hi',
        delay_seconds: 120,
      }),
    }).then((r) => r.json());

    const r = await fetch(`${ctx.baseUrl}/tasks/${create.task_id}`);
    assert.strictEqual(r.status, 200);
    const t = await r.json();
    assert.strictEqual(t.id, create.task_id);
    assert.strictEqual(t.url, 'https://example.com/shape');
    assert.strictEqual(t.method, 'POST');
    assert.strictEqual(t.status, ctx.statuses.STATUS_PENDING);
    assert.ok(t.created_at);
    assert.ok(t.scheduled_at);
    for (const k of ['response', 'duration_ms', 'started_at', 'completed_at']) {
      assert.strictEqual(t[k], null, `${k} should be null for pending task`);
    }
  });
});

describe('GET /tasks', () => {
  it('lists tasks ordered by created_at DESC', async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${ctx.baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://order/${i}`, delay_seconds: 600 + i }),
      });
      const d = await r.json();
      ids.push(d.task_id);
      await wait(15);
    }

    const r = await fetch(`${ctx.baseUrl}/tasks`);
    assert.strictEqual(r.status, 200);
    const list = await r.json();
    assert.ok(list.length >= 3);
    const allIds = list.map((t) => t.id);
    const positions = ids.map((id) => allIds.indexOf(id));
    for (const p of positions) assert.ok(p >= 0, `id not found in list`);
    assert.deepStrictEqual(
      positions,
      [...positions].sort((a, b) => a - b).reverse(),
      'ids should appear in list ordered DESC by created_at (last created first)'
    );
    for (const t of list) {
      for (const k of ['id', 'url', 'method', 'status', 'created_at']) {
        assert.ok(k in t, `task missing key ${k}`);
      }
    }
  });
});

async function waitUntilTaskDone(baseUrl, taskId, maxMs = 5000, pollMs = 100) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const task = await fetch(`${baseUrl}/tasks/${taskId}`).then((r) => r.json());
    if (task.status !== 'pending' && task.status !== 'running') {
      return task;
    }
    await wait(pollMs);
  }
  return fetch(`${baseUrl}/tasks/${taskId}`).then((r) => r.json());
}

describe('GET /stats', () => {
  it('returns summary with required keys', async () => {
    const r = await fetch(`${ctx.baseUrl}/stats`);
    assert.strictEqual(r.status, 200);
    const s = await r.json();
    for (const k of ['total', 'success', 'failed', 'pending', 'running', 'avg_duration_ms']) {
      assert.ok(k in s, `stats missing key ${k}`);
      assert.strictEqual(typeof s[k], 'number', `stats key ${k} not a number`);
    }
    assert.ok(s.total >= 0);
    assert.strictEqual(s.total, s.success + s.failed + s.pending + s.running);
    assert.ok(s.avg_duration_ms >= 0);
  });

  it('reflects completed tasks in stats after execution', async () => {
    const mock = installFetchMock({
      'GET https://example.com/exec': { status: 200, body: 'done' },
    });
    try {
      const taskId = await ctx.storage.createTask('https://example.com/exec', 'GET', null, null, null);
      const executor = ctx.scheduler.executors.resolve({ url: 'https://example.com/exec' });
      const raw = await ctx.storage.getTask(taskId);

      await ctx.storage.updateTaskStatus(taskId, ctx.statuses.STATUS_RUNNING, new Date().toISOString());
      const startedAt = Date.now();
      const result = await executor.execute(raw);
      const duration = Date.now() - startedAt;

      await ctx.storage.completeTask(
        taskId,
        result.success ? ctx.statuses.STATUS_COMPLETED : ctx.statuses.STATUS_FAILED,
        result.response,
        duration,
        new Date().toISOString()
      );

      const stats = await fetch(`${ctx.baseUrl}/stats`).then((r) => r.json());
      assert.ok(stats.success >= 1, `expected at least 1 success, got ${stats.success}`);

      const task = await fetch(`${ctx.baseUrl}/tasks/${taskId}`).then((r) => r.json());
      assert.strictEqual(task.status, ctx.statuses.STATUS_COMPLETED);
      assert.strictEqual(task.response, 'done');
      assert.ok(task.duration_ms >= 0);
      assert.ok(task.started_at);
      assert.ok(task.completed_at);
    } finally {
      mock.restore();
    }
  });

  it('records failed (non-2xx) HTTP responses as failed status', async () => {
    const mock = installFetchMock({
      'GET https://example.com/bad': { status: 502, body: 'bad gateway' },
    });
    try {
      const taskId = await ctx.storage.createTask('https://example.com/bad', 'GET', null, null, null);
      const executor = ctx.scheduler.executors.resolve({ url: 'https://example.com/bad' });
      const raw = await ctx.storage.getTask(taskId);

      await ctx.storage.updateTaskStatus(taskId, ctx.statuses.STATUS_RUNNING, new Date().toISOString());
      const startedAt = Date.now();
      const result = await executor.execute(raw);
      const duration = Date.now() - startedAt;

      await ctx.storage.completeTask(
        taskId,
        result.success ? ctx.statuses.STATUS_COMPLETED : ctx.statuses.STATUS_FAILED,
        result.response,
        duration,
        new Date().toISOString()
      );

      const task = await fetch(`${ctx.baseUrl}/tasks/${taskId}`).then((r) => r.json());
      assert.strictEqual(task.status, ctx.statuses.STATUS_FAILED);
      assert.strictEqual(task.response, 'bad gateway');

      const stats = await fetch(`${ctx.baseUrl}/stats`).then((r) => r.json());
      assert.ok(stats.failed >= 1);
    } finally {
      mock.restore();
    }
  });
});
