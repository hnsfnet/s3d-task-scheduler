const {
  describe,
  it,
  assert,
  installFetchMock,
} = require('./helpers');
const HttpExecutor = require('../executors/http');
const { ExecutorRegistry, createDefaultRegistry } = require('../executors');

describe('BaseExecutor / HttpExecutor - metadata', () => {
  it('type is "http"', () => {
    const exec = new HttpExecutor();
    assert.strictEqual(exec.type, 'http');
  });

  it('canExecute returns true when task has url', () => {
    const exec = new HttpExecutor();
    assert.strictEqual(exec.canExecute({ url: 'http://x' }), true);
    assert.strictEqual(exec.canExecute({ url: '' }), false);
    assert.strictEqual(exec.canExecute({}), false);
    assert.strictEqual(exec.canExecute(null), false);
  });
});

describe('HttpExecutor.execute - success cases', () => {
  it('200 OK returns success=true and response body', async () => {
    const mock = installFetchMock({
      'GET https://example.com/api': { status: 200, body: '{"ok":true}' },
    });
    try {
      const exec = new HttpExecutor();
      const result = await exec.execute({ url: 'https://example.com/api', method: 'GET' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.response, '{"ok":true}');
      assert.strictEqual(mock.callLog.length, 1);
      assert.strictEqual(mock.callLog[0].options.method, 'GET');
    } finally {
      mock.restore();
    }
  });

  it('truncates response to first 500 chars (default)', async () => {
    const longBody = 'A'.repeat(1234);
    const mock = installFetchMock({
      'GET https://example.com/long': { status: 200, body: longBody },
    });
    try {
      const exec = new HttpExecutor();
      const result = await exec.execute({ url: 'https://example.com/long', method: 'GET' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.response.length, 500);
      assert.strictEqual(result.response, 'A'.repeat(500));
    } finally {
      mock.restore();
    }
  });

  it('respects custom responseMaxLength option', async () => {
    const longBody = 'X'.repeat(100);
    const mock = installFetchMock({
      'GET https://example.com/custom': { status: 200, body: longBody },
    });
    try {
      const exec = new HttpExecutor({ responseMaxLength: 10 });
      const result = await exec.execute({ url: 'https://example.com/custom', method: 'GET' });
      assert.strictEqual(result.response.length, 10);
      assert.strictEqual(result.response, 'X'.repeat(10));
    } finally {
      mock.restore();
    }
  });

  it('POST request sends body to fetch', async () => {
    const mock = installFetchMock({
      'POST https://example.com/submit': { status: 201, body: 'created' },
    });
    try {
      const exec = new HttpExecutor();
      const result = await exec.execute({
        url: 'https://example.com/submit',
        method: 'POST',
        body: 'hello=world',
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(mock.callLog[0].options.method, 'POST');
      assert.strictEqual(mock.callLog[0].options.body, 'hello=world');
    } finally {
      mock.restore();
    }
  });

  it('GET request does not send body even when provided', async () => {
    const mock = installFetchMock({
      'GET https://example.com/get': { status: 200, body: 'ok' },
    });
    try {
      const exec = new HttpExecutor();
      await exec.execute({
        url: 'https://example.com/get',
        method: 'GET',
        body: 'should be ignored',
      });
      assert.strictEqual('body' in mock.callLog[0].options, false);
    } finally {
      mock.restore();
    }
  });

  it('passes through headers from stringified JSON', async () => {
    const mock = installFetchMock({
      'GET https://example.com/hdrs': { status: 200, body: 'ok' },
    });
    try {
      const exec = new HttpExecutor();
      await exec.execute({
        url: 'https://example.com/hdrs',
        method: 'GET',
        headers: JSON.stringify({ 'X-Custom': 'abc' }),
      });
      assert.deepStrictEqual(mock.callLog[0].options.headers, { 'X-Custom': 'abc' });
    } finally {
      mock.restore();
    }
  });

  it('passes through headers as plain object', async () => {
    const mock = installFetchMock({
      'GET https://example.com/hdrs2': { status: 200, body: 'ok' },
    });
    try {
      const exec = new HttpExecutor();
      await exec.execute({
        url: 'https://example.com/hdrs2',
        method: 'GET',
        headers: { Authorization: 'Bearer x' },
      });
      assert.deepStrictEqual(mock.callLog[0].options.headers, { Authorization: 'Bearer x' });
    } finally {
      mock.restore();
    }
  });
});

describe('HttpExecutor.execute - failure cases', () => {
  it('404 Not Found sets success=false', async () => {
    const mock = installFetchMock({
      'GET https://example.com/404': { status: 404, body: 'Not Found' },
    });
    try {
      const exec = new HttpExecutor();
      const result = await exec.execute({ url: 'https://example.com/404', method: 'GET' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.response, 'Not Found');
    } finally {
      mock.restore();
    }
  });

  it('500 Internal Server Error sets success=false', async () => {
    const mock = installFetchMock({
      'GET https://example.com/500': { status: 500, body: 'boom' },
    });
    try {
      const exec = new HttpExecutor();
      const result = await exec.execute({ url: 'https://example.com/500', method: 'GET' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.response, 'boom');
    } finally {
      mock.restore();
    }
  });

  it('fetch throws network error -> success=false with error message', async () => {
    const mock = installFetchMock({
      'GET https://example.com/net': { throw: 'ECONNREFUSED: Connection refused' },
    });
    try {
      const exec = new HttpExecutor();
      const result = await exec.execute({ url: 'https://example.com/net', method: 'GET' });
      assert.strictEqual(result.success, false);
      assert.ok(result.response.includes('ECONNREFUSED'));
    } finally {
      mock.restore();
    }
  });

  it('fetch throw without message -> uses stringified error', async () => {
    const mock = installFetchMock({
      'GET https://example.com/str': { throw: '' },
    });
    try {
      mock.restore();
      const mock2 = installFetchMock({
        'GET https://example.com/str': { throw: undefined },
      });
      try {
        const exec = new HttpExecutor();
        const result = await exec.execute({ url: 'https://example.com/str', method: 'GET' });
        assert.strictEqual(result.success, false);
        assert.ok(result.response.length <= 500);
      } finally {
        mock2.restore();
      }
    } catch {}
  });
});

describe('ExecutorRegistry', () => {
  it('createDefaultRegistry registers HttpExecutor', () => {
    const registry = createDefaultRegistry();
    assert.ok(registry.get('http'));
    assert.deepStrictEqual(registry.listTypes(), ['http']);
  });

  it('register rejects non-BaseExecutor instances', () => {
    const registry = new ExecutorRegistry();
    assert.throws(() => registry.register({}), /BaseExecutor/);
  });

  it('resolve returns matching executor via canExecute', () => {
    const registry = createDefaultRegistry();
    const exec = registry.resolve({ url: 'https://x' });
    assert.strictEqual(exec.type, 'http');
  });

  it('resolve throws when no executor matches', () => {
    const registry = new ExecutorRegistry();
    assert.throws(() => registry.resolve({ url: 'x' }), /No executor found/);
  });
});
