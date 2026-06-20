const {
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_COMPLETED,
  STATUS_FAILED,
  getPendingTasks,
  updateTaskStatus,
  completeTask,
} = require('./db');

const MAX_WORKERS = 5;
const POLL_INTERVAL = 1000;

class TaskScheduler {
  constructor(maxWorkers = MAX_WORKERS) {
    this.maxWorkers = maxWorkers;
    this.inProgress = new Set();
    this.running = false;
    this.pollTimer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._pollLoop();
  }

  stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  _pollLoop() {
    if (!this.running) return;
    this._dispatchPendingTasks().catch((err) => {
      console.error('Scheduler poll error:', err);
    });
    this.pollTimer = setTimeout(() => this._pollLoop(), POLL_INTERVAL);
  }

  async _dispatchPendingTasks() {
    const available = this.maxWorkers - this.inProgress.size;
    if (available <= 0) return;

    const pending = getPendingTasks();
    const toRun = pending.filter((t) => !this.inProgress.has(t.id)).slice(0, available);

    for (const task of toRun) {
      this.inProgress.add(task.id);
      this._executeTask(task).catch((err) => {
        console.error('Unexpected task execution error:', err);
      });
    }
  }

  async _executeTask(task) {
    const taskId = task.id;
    try {
      const startedAt = new Date().toISOString();
      updateTaskStatus(taskId, STATUS_RUNNING, startedAt);

      const startTime = Date.now();
      const method = task.method.toUpperCase();
      const url = task.url;
      const headers = task.headers ? JSON.parse(task.headers) : {};
      const body = task.body;

      const options = {
        method,
        headers,
        timeout: 30000,
      };

      if (method === 'POST' && body !== null && body !== undefined) {
        options.body = body;
      }

      let responseText;
      let success = true;

      try {
        const resp = await fetch(url, options);
        const text = await resp.text();
        responseText = text.slice(0, 500);
        if (!resp.ok) {
          success = false;
        }
      } catch (fetchErr) {
        success = false;
        responseText = String(fetchErr.message || fetchErr).slice(0, 500);
      }

      const durationMs = Date.now() - startTime;
      const completedAt = new Date().toISOString();
      const status = success ? STATUS_COMPLETED : STATUS_FAILED;

      completeTask(taskId, status, responseText, durationMs, completedAt);
    } catch (err) {
      const completedAt = new Date().toISOString();
      const errorMsg = String(err.message || err).slice(0, 500);
      completeTask(taskId, STATUS_FAILED, errorMsg, 0, completedAt);
    } finally {
      this.inProgress.delete(taskId);
    }
  }
}

module.exports = TaskScheduler;
