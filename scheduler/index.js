const {
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_COMPLETED,
  STATUS_FAILED,
} = require('../storage');

const MAX_WORKERS = 5;
const POLL_INTERVAL = 1000;

class TaskScheduler {
  constructor(storage, executorRegistry, options = {}) {
    if (!storage || typeof storage.getPendingTasks !== 'function') {
      throw new Error('TaskScheduler requires a valid Storage instance');
    }
    if (!executorRegistry || typeof executorRegistry.resolve !== 'function') {
      throw new Error('TaskScheduler requires a valid ExecutorRegistry instance');
    }

    this.storage = storage;
    this.executors = executorRegistry;
    this.maxWorkers = options.maxWorkers || MAX_WORKERS;
    this.pollInterval = options.pollInterval || POLL_INTERVAL;
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
    this.pollTimer = setTimeout(() => this._pollLoop(), this.pollInterval);
  }

  async _dispatchPendingTasks() {
    const available = this.maxWorkers - this.inProgress.size;
    if (available <= 0) return;

    const pending = this.storage.getPendingTasks();
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
      this.storage.updateTaskStatus(taskId, STATUS_RUNNING, startedAt);

      const startTime = Date.now();
      const executor = this.executors.resolve(task);
      const result = await executor.execute(task);
      const durationMs = Date.now() - startTime;

      const completedAt = new Date().toISOString();
      const status = result.success ? STATUS_COMPLETED : STATUS_FAILED;

      this.storage.completeTask(taskId, status, result.response, durationMs, completedAt);
    } catch (err) {
      const completedAt = new Date().toISOString();
      const errorMsg = String(err.message || err).slice(0, 500);
      this.storage.completeTask(taskId, STATUS_FAILED, errorMsg, 0, completedAt);
    } finally {
      this.inProgress.delete(taskId);
    }
  }
}

module.exports = TaskScheduler;
