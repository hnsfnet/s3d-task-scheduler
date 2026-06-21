const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ORIGINAL_FETCH = typeof global.fetch === 'function' ? global.fetch : undefined;
const results = [];
let currentSuite = null;

function resetGlobals() {
  if (ORIGINAL_FETCH !== undefined) {
    global.fetch = ORIGINAL_FETCH;
    globalThis.fetch = ORIGINAL_FETCH;
  } else {
    delete global.fetch;
    delete globalThis.fetch;
  }
}

function describe(name, fn) {
  currentSuite = name;
  results.push({ suite: name, cases: [] });
  try {
    fn();
  } catch (e) {
    const suite = results[results.length - 1];
    suite.cases.push({
      name: '<suite error>',
      error: e,
      passed: false,
    });
  }
}

function it(name, fn) {
  const suite = results[results.length - 1];
  const case_ = { name, passed: true, error: null, duration_ms: 0 };
  try {
    const start = Date.now();
    const ret = fn();
    if (ret && typeof ret.then === 'function') {
      case_._async = ret.then(
        () => {
          case_.duration_ms = Date.now() - start;
          resetGlobals();
        },
        (err) => {
          case_.passed = false;
          case_.error = err;
          case_.duration_ms = Date.now() - start;
          resetGlobals();
        }
      );
    } else {
      case_.duration_ms = Date.now() - start;
      resetGlobals();
    }
  } catch (e) {
    case_.passed = false;
    case_.error = e;
    resetGlobals();
  }
  suite.cases.push(case_);
}

async function runAll() {
  for (const suite of results) {
    for (const c of suite.cases) {
      if (c._async) await c._async;
    }
  }
  return results;
}

function printResults(allResults) {
  let total = 0;
  let passed = 0;
  let failed = 0;
  for (const suite of allResults) {
    console.log(`\n  ${suite.suite}`);
    for (const c of suite.cases) {
      total++;
      const icon = c.passed ? '✓' : '✗';
      const tag = c.passed ? 'PASS' : 'FAIL';
      console.log(`    ${icon} [${tag}] ${c.name} (${c.duration_ms}ms)`);
      if (!c.passed && c.error) {
        const msg = c.error instanceof Error ? c.error.stack || c.error.message : String(c.error);
        console.log(`\n      ${msg.split('\n').join('\n      ')}\n`);
        failed++;
      } else {
        passed++;
      }
    }
  }
  console.log(`\n  Total: ${total}  Passed: ${passed}  Failed: ${failed}`);
  return failed === 0;
}

function installFetchMock(mockResponses) {
  const originalFetch = global.fetch;
  const callLog = [];

  const mockFn = async (url, options = {}) => {
    callLog.push({ url, options });
    const key = options?.method ? `${options.method} ${url}` : `GET ${url}`;
    const mock = mockResponses[key] || mockResponses[url];
    if (mock) {
      if (mock.throw) {
        const err = new Error(mock.throw);
        for (const k of Object.keys(mock.throwProps || {})) err[k] = mock.throwProps[k];
        throw err;
      }
      return new MockResponse(mock.status || 200, mock.body || '', mock.headers || {});
    }
    if (originalFetch) {
      return originalFetch.call(global, url, options);
    }
    throw new Error(`fetch mock: no response registered for ${key}`);
  };

  global.fetch = mockFn;
  globalThis.fetch = mockFn;

  return {
    callLog,
    restore() {
      global.fetch = originalFetch;
      globalThis.fetch = originalFetch;
    },
    wasCalled(keyOrUrl) {
      return callLog.some((c) => {
        const k = c.options?.method ? `${c.options.method} ${c.url}` : `GET ${c.url}`;
        return k === keyOrUrl || c.url === keyOrUrl;
      });
    },
  };
}

class MockResponse {
  constructor(status, body, headers = {}) {
    this.status = status;
    this.statusText = status === 200 ? 'OK' : 'Error';
    this.ok = status >= 200 && status < 300;
    this._body = body;
    this.headers = new Map(Object.entries(headers));
  }
  async text() {
    return this._body;
  }
  async json() {
    return JSON.parse(this._body);
  }
}

async function startTestServer() {
  const { createApp } = require(path.join(__dirname, '..', 'app'));
  const { Storage, STATUS_PENDING, STATUS_RUNNING, STATUS_COMPLETED, STATUS_FAILED } = require(path.join(__dirname, '..', 'storage'));
  const { createDefaultRegistry } = require(path.join(__dirname, '..', 'executors'));
  const TaskScheduler = require(path.join(__dirname, '..', 'scheduler'));

  const dbPath = path.join(__dirname, `test-${crypto.randomUUID()}.db`);
  const storage = new Storage(dbPath);
  await storage.init();

  const app = createApp();
  app.set('storage', storage);

  const executorRegistry = createDefaultRegistry();
  const scheduler = new TaskScheduler(storage, executorRegistry, { maxWorkers: 2 });
  scheduler.start();

  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        storage,
        scheduler,
        statuses: { STATUS_PENDING, STATUS_RUNNING, STATUS_COMPLETED, STATUS_FAILED },
        async close() {
          scheduler.stop();
          await new Promise((r) => server.close(r));
          try {
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          } catch {}
        },
      });
    });
    server.on('error', reject);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  describe,
  it,
  runAll,
  printResults,
  assert,
  installFetchMock,
  MockResponse,
  startTestServer,
  wait,
};
