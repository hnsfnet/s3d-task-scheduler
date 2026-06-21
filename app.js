const express = require('express');
const {
  Storage,
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_COMPLETED,
  STATUS_FAILED,
} = require('./storage');
const { createDefaultRegistry } = require('./executors');
const TaskScheduler = require('./scheduler');

const DEFAULT_PORT = 5000;

function formatTask(task) {
  return {
    id: task.id,
    url: task.url,
    method: task.method,
    status: task.status,
    response: task.response,
    duration_ms: task.duration_ms,
    created_at: task.created_at,
    scheduled_at: task.scheduled_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
  };
}

const STATUS_TEXT = {
  [STATUS_PENDING]: '等待中',
  [STATUS_RUNNING]: '执行中',
  [STATUS_COMPLETED]: '已完成',
  [STATUS_FAILED]: '失败',
};

function resolveScheduledAt({ delay_seconds, scheduled_at }) {
  if (delay_seconds === undefined && scheduled_at === undefined) {
    return { scheduledAt: null };
  }

  let target;
  let requestedTime = null;

  if (scheduled_at !== undefined) {
    requestedTime = String(scheduled_at);
    const parsed = new Date(scheduled_at);
    if (isNaN(parsed.getTime())) {
      return {
        error: '指定的执行时间格式无效，请使用 ISO 8601 格式（如 2026-06-21T10:00:00Z）',
        error_code: 'invalid_format',
        requested_time: requestedTime,
        server_time: new Date().toISOString(),
      };
    }
    target = parsed;
  }

  if (delay_seconds !== undefined) {
    if (typeof delay_seconds !== 'number' || isNaN(delay_seconds)) {
      return {
        error: 'delay_seconds 必须是数字',
        error_code: 'invalid_delay',
        requested_delay: delay_seconds,
        server_time: new Date().toISOString(),
      };
    }
    if (delay_seconds < 0) {
      return {
        error: 'delay_seconds 不能为负数',
        error_code: 'negative_delay',
        requested_delay: delay_seconds,
        server_time: new Date().toISOString(),
      };
    }
    const fromDelay = new Date(Date.now() + delay_seconds * 1000);
    if (!target) {
      target = fromDelay;
      requestedTime = `delay_seconds=${delay_seconds} (约 ${fromDelay.toISOString()})`;
    }
  }

  const now = new Date();
  if (target.getTime() <= now.getTime()) {
    return {
      error: '指定的执行时间已过期',
      error_code: 'time_in_past',
      requested_time: requestedTime || target.toISOString(),
      server_time: now.toISOString(),
    };
  }

  return { scheduledAt: target.toISOString() };
}

function createApp() {
  const app = express();

  app.use(express.json());

  app.use((req, res, next) => {
    req.storage = app.get('storage');
    next();
  });

  app.post('/tasks', (req, res) => {
    const { url, method = 'GET', headers, body, delay_seconds, scheduled_at } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const methodUpper = String(method).toUpperCase();
    if (!['GET', 'POST'].includes(methodUpper)) {
      return res.status(400).json({ error: 'method must be GET or POST' });
    }

    const resolved = resolveScheduledAt({ delay_seconds, scheduled_at });
    if (resolved.error) {
      return res.status(400).json(resolved);
    }

    const taskId = req.storage.createTask(
      url,
      methodUpper,
      headers || null,
      body || null,
      resolved.scheduledAt
    );

    return res.status(201).json({ task_id: taskId, scheduled_at: resolved.scheduledAt });
  });

  app.get('/tasks/:id', (req, res) => {
    const task = req.storage.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    return res.json(formatTask(task));
  });

  app.get('/tasks', (req, res) => {
    const tasks = req.storage.listTasks();
    return res.json(tasks.map(formatTask));
  });

  app.get('/stats', (req, res) => {
    const stats = req.storage.getStats();
    return res.json(stats);
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

async function startServer(port = process.env.PORT || DEFAULT_PORT) {
  const app = createApp();
  const storage = new Storage();
  await storage.init();
  app.set('storage', storage);

  const executorRegistry = createDefaultRegistry();
  const scheduler = new TaskScheduler(storage, executorRegistry, { maxWorkers: 5 });
  scheduler.start();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Task scheduler service started on http://127.0.0.1:${port}`);

      const gracefulShutdown = () => {
        console.log('Shutting down gracefully...');
        scheduler.stop();
        server.close(() => {
          console.log('Server stopped');
          process.exit(0);
        });
        setTimeout(() => process.exit(0), 5000);
      };

      process.on('SIGINT', gracefulShutdown);
      process.on('SIGTERM', gracefulShutdown);

      resolve({ app, server, storage, scheduler, port });
    });
    server.on('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = {
  createApp,
  startServer,
  resolveScheduledAt,
  formatTask,
  STATUS_TEXT,
  DEFAULT_PORT,
};
