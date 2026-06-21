const BaseExecutor = require('./base');

const DEFAULT_TIMEOUT_MS = 30000;
const RESPONSE_MAX_LENGTH = 500;

class HttpExecutor extends BaseExecutor {
  constructor(options = {}) {
    super(options);
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.responseMaxLength = options.responseMaxLength || RESPONSE_MAX_LENGTH;
  }

  get type() {
    return 'http';
  }

  canExecute(task) {
    return Boolean(task && task.url && typeof task.url === 'string');
  }

  async execute(task) {
    const method = String(task.method || 'GET').toUpperCase();
    const url = task.url;
    const headers = task.headers ? (typeof task.headers === 'string' ? JSON.parse(task.headers) : task.headers) : {};
    const body = task.body;

    const options = {
      method,
      headers,
      timeout: this.timeoutMs,
    };

    if (method === 'POST' && body !== null && body !== undefined) {
      options.body = body;
    }

    let responseText;
    let success = true;

    try {
      const resp = await globalThis.fetch(url, options);
      const text = await resp.text();
      responseText = text.slice(0, this.responseMaxLength);
      if (!resp.ok) {
        success = false;
      }
    } catch (fetchErr) {
      success = false;
      responseText = String(fetchErr.message || fetchErr).slice(0, this.responseMaxLength);
    }

    return {
      success,
      response: responseText,
    };
  }
}

module.exports = HttpExecutor;
