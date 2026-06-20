const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const STATUS_PENDING = 'pending';
const STATUS_RUNNING = 'running';
const STATUS_COMPLETED = 'completed';
const STATUS_FAILED = 'failed';

const DEDUPE_WINDOW_MS = 2000;
const DB_PATH = path.join(__dirname, '..', 'tasks.db');

class Storage {
  constructor(dbPath = DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
    this.recentTasks = new Map();
    this.dedupeCleanupTimer = null;
  }

  async init() {
    if (this.db) return this.db;

    this.SQL = await initSqlJs();

    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(fileBuffer);
    } else {
      this.db = new this.SQL.Database();
    }

    this.db.run(`
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
        completed_at TEXT,
        scheduled_at TEXT
      )
    `);

    const colInfo = this.db.exec(`PRAGMA table_info(tasks)`);
    if (colInfo.length > 0) {
      const colNames = colInfo[0].values.map((r) => r[1]);
      if (!colNames.includes('scheduled_at')) {
        this.db.run(`ALTER TABLE tasks ADD COLUMN scheduled_at TEXT`);
      }
    }

    this._saveDb();
    return this.db;
  }

  _saveDb() {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  _ensureDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
  }

  _generateId() {
    return crypto.randomUUID();
  }

  _taskFingerprint(url, method, headers, body, scheduledAt) {
    const headersStr = headers ? JSON.stringify(headers) : '';
    const bodyStr = body ?? '';
    const schedStr = scheduledAt ?? '';
    const raw = `${method}:${url}:${headersStr}:${bodyStr}:${schedStr}`;
    return crypto.createHash('sha1').update(raw).digest('hex');
  }

  _cleanupDedupeCache() {
    const now = Date.now();
    for (const [fp, info] of this.recentTasks) {
      if (now - info.created_at_ms > DEDUPE_WINDOW_MS) {
        this.recentTasks.delete(fp);
      }
    }
  }

  _startDedupeCleanup() {
    if (this.dedupeCleanupTimer) return;
    this.dedupeCleanupTimer = setInterval(() => this._cleanupDedupeCache(), DEDUPE_WINDOW_MS);
    if (this.dedupeCleanupTimer.unref) {
      this.dedupeCleanupTimer.unref();
    }
  }

  createTask(url, method, headers, body, scheduledAt) {
    this._ensureDb();

    const fp = this._taskFingerprint(url, method, headers, body, scheduledAt);
    const nowMs = Date.now();

    const cached = this.recentTasks.get(fp);
    if (cached && nowMs - cached.created_at_ms < DEDUPE_WINDOW_MS) {
      return cached.task_id;
    }

    const id = this._generateId();
    const createdAt = new Date(nowMs).toISOString();
    const headersJson = headers ? JSON.stringify(headers) : null;

    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, url, method, headers, body, status, created_at, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([id, url, method, headersJson, body, STATUS_PENDING, createdAt, scheduledAt]);
    stmt.free();
    this._saveDb();

    this.recentTasks.set(fp, { task_id: id, created_at_ms: nowMs });
    this._startDedupeCleanup();

    return id;
  }

  getTask(id) {
    this._ensureDb();
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    stmt.bind([id]);
    let result = null;
    if (stmt.step()) {
      result = stmt.getAsObject();
    }
    stmt.free();
    return result;
  }

  listTasks() {
    this._ensureDb();
    const result = this.db.exec('SELECT * FROM tasks ORDER BY created_at DESC');
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

  updateTaskStatus(id, status, startedAt = null) {
    this._ensureDb();
    if (startedAt) {
      const stmt = this.db.prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?');
      stmt.run([status, startedAt, id]);
      stmt.free();
    } else {
      const stmt = this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?');
      stmt.run([status, id]);
      stmt.free();
    }
    this._saveDb();
  }

  completeTask(id, status, response, durationMs, completedAt) {
    this._ensureDb();
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, response = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `);
    stmt.run([status, response, durationMs, completedAt, id]);
    stmt.free();
    this._saveDb();
  }

  getPendingTasks() {
    this._ensureDb();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status = ?
        AND (scheduled_at IS NULL OR scheduled_at <= ?)
      ORDER BY created_at ASC
    `);
    stmt.bind([STATUS_PENDING, now]);

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

  getStats() {
    this._ensureDb();
    const countByStatus = (status) => {
      const stmt = this.db.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE status = ?`);
      stmt.bind([status]);
      let count = 0;
      if (stmt.step()) {
        count = stmt.get()[0];
      }
      stmt.free();
      return count;
    };

    const totalStmt = this.db.prepare(`SELECT COUNT(*) AS c FROM tasks`);
    let total = 0;
    if (totalStmt.step()) {
      total = totalStmt.get()[0];
    }
    totalStmt.free();

    const success = countByStatus(STATUS_COMPLETED);
    const failed = countByStatus(STATUS_FAILED);
    const pending = countByStatus(STATUS_PENDING);
    const running = countByStatus(STATUS_RUNNING);

    const avgStmt = this.db.prepare(`SELECT AVG(duration_ms) AS a FROM tasks WHERE status = ?`);
    avgStmt.bind([STATUS_COMPLETED]);
    let avgDurationMs = 0;
    if (avgStmt.step()) {
      const val = avgStmt.get()[0];
      if (val !== null && val !== undefined) {
        avgDurationMs = Math.round(val);
      }
    }
    avgStmt.free();

    return {
      total,
      success,
      failed,
      pending,
      running,
      avg_duration_ms: avgDurationMs,
    };
  }
}

module.exports = {
  Storage,
  STATUS_PENDING,
  STATUS_RUNNING,
  STATUS_COMPLETED,
  STATUS_FAILED,
};
