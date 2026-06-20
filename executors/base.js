class BaseExecutor {
  constructor(options = {}) {
    this.options = options;
  }

  get type() {
    throw new Error('Subclasses must implement get type()');
  }

  canExecute(task) {
    return true;
  }

  async execute(task) {
    throw new Error('Subclasses must implement async execute(task)');
  }
}

module.exports = BaseExecutor;
