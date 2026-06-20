const express = require('express');
const {
  initDb,
  createTask,
  getTask,
  listTasks,
  getStats,
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_COMPLETED,
  STATUS_FAILED,
} = require('./db');
const TaskScheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

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

  if (scheduled_at !== undefined) {
    const parsed = new Date(scheduled_at);
    if (isNaN(parsed.getTime())) {
      return { error: 'scheduled_at is not a valid datetime' };
    }
    target = parsed;
  }

  if (delay_seconds !== undefined) {
    if (typeof delay_seconds !== 'number' || isNaN(delay_seconds)) {
      return { error: 'delay_seconds must be a number' };
    }
    if (delay_seconds < 0) {
      return { error: 'delay_seconds must not be negative' };
    }
    const fromDelay = new Date(Date.now() + delay_seconds * 1000);
    if (!target) {
      target = fromDelay;
    }
  }

  const now = new Date();
  if (target.getTime() <= now.getTime()) {
    return { error: 'scheduled time is in the past' };
  }

  return { scheduledAt: target.toISOString() };
}

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
    return res.status(400).json({ error: resolved.error });
  }

  const taskId = createTask(url, methodUpper, headers || null, body || null, resolved.scheduledAt);

  return res.status(201).json({ task_id: taskId, scheduled_at: resolved.scheduledAt });
});

app.get('/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  return res.json(formatTask(task));
});

app.get('/tasks', (req, res) => {
  const tasks = listTasks();
  return res.json(tasks.map(formatTask));
});

app.get('/stats', (req, res) => {
  const stats = getStats();
  return res.json(stats);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

let scheduler;

async function startServer() {
  await initDb();
  scheduler = new TaskScheduler(5);
  scheduler.start();

  const server = app.listen(PORT, () => {
    console.log(`Task scheduler service started on http://127.0.0.1:${PORT}`);
  });

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
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
