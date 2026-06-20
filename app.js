const express = require('express');
const {
  initDb,
  createTask,
  getTask,
  listTasks,
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

app.post('/tasks', (req, res) => {
  const { url, method = 'GET', headers, body } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const methodUpper = String(method).toUpperCase();
  if (!['GET', 'POST'].includes(methodUpper)) {
    return res.status(400).json({ error: 'method must be GET or POST' });
  }

  const taskId = createTask(url, methodUpper, headers || null, body || null);

  return res.status(201).json({ task_id: taskId });
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
