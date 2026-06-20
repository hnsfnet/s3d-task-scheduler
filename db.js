const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'tasks.db');

const STATUS_PENDING = 'pending';
const STATUS_RUNNING = 'running';
const STATUS_COMPLETED = 'completed';
const STATUS_FAILED = 'failed';

let db = null;
let SQL = null;

async function initDb() {
  if (db) return db;

  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      method TEXT NOT NULL,
      headers TEXT,
      body TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      response TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    )
  `);

  saveDb();
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

function generateId() {
  return crypto.randomUUID();
}

function createTask(url, method, headers, body) {
  const id = generateId();
  const createdAt = new Date().toISOString();
  const headersJson = headers ? JSON.stringify(headers) : null;

  const stmt = getDb().prepare(`
    INSERT INTO tasks (id, url, method, headers, body, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([id, url, method, headersJson, body, STATUS_PENDING, createdAt]);
  stmt.free();
  saveDb();
  return id;
}

function getTask(id) {
  const stmt = getDb().prepare('SELECT * FROM tasks WHERE id = ?');
  stmt.bind([id]);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function listTasks() {
  const result = getDb().exec('SELECT * FROM tasks ORDER BY created_at DESC');
  if (result.length === 0) return [];

  const columns = result[0].columns;
  const values = result[0].values;

  return values.map((row) => {
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

function updateTaskStatus(id, status, startedAt = null) {
  if (startedAt) {
    const stmt = getDb().prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?');
    stmt.run([status, startedAt, id]);
    stmt.free();
  } else {
    const stmt = getDb().prepare('UPDATE tasks SET status = ? WHERE id = ?');
    stmt.run([status, id]);
    stmt.free();
  }
  saveDb();
}

function completeTask(id, status, response, durationMs, completedAt) {
  const stmt = getDb().prepare(`
    UPDATE tasks
    SET status = ?, response = ?, duration_ms = ?, completed_at = ?
    WHERE id = ?
  `);
  stmt.run([status, response, durationMs, completedAt, id]);
  stmt.free();
  saveDb();
}

function getPendingTasks() {
  const stmt = getDb().prepare(`
    SELECT * FROM tasks
    WHERE status = ?
    ORDER BY created_at ASC
  `);
  stmt.bind([STATUS_PENDING]);

  const tasks = [];
  const columns = stmt.getColumnNames();
  while (stmt.step()) {
    const row = stmt.get();
    const obj = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    tasks.push(obj);
  }
  stmt.free();
  return tasks;
}

module.exports = {
  initDb,
  getDb,
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  completeTask,
  getPendingTasks,
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_COMPLETED,
  STATUS_FAILED,
};
