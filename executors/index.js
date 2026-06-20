const BaseExecutor = require('./base');
const HttpExecutor = require('./http');

class ExecutorRegistry {
  constructor() {
    this.executors = new Map();
  }

  register(executor) {
    if (!(executor instanceof BaseExecutor)) {
      throw new Error('Executor must be an instance of BaseExecutor');
    }
    this.executors.set(executor.type, executor);
    return this;
  }

  get(type) {
    return this.executors.get(type);
  }

  resolve(task) {
    for (const executor of this.executors.values()) {
      if (executor.canExecute(task)) {
        return executor;
      }
    }
    throw new Error(`No executor found for task ${task ? task.id : '(unknown)'}`);
  }

  listTypes() {
    return Array.from(this.executors.keys());
  }
}

function createDefaultRegistry(options = {}) {
  const registry = new ExecutorRegistry();
  registry.register(new HttpExecutor(options.http || {}));
  return registry;
}

module.exports = {
  ExecutorRegistry,
  BaseExecutor,
  HttpExecutor,
  createDefaultRegistry,
};
