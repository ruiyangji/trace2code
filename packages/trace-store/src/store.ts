import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  type RecordingRun,
  type RawTraceEvent,
  RecordingRunSchema,
  RawTraceEventSchema,
  serializeRunHeader,
  serializeTraceEvent,
  validateTraceLines,
} from '@trace2code/protocol';

export interface StoredAttachment {
  id: string;
  runId: string;
  type: string;
  filePath: string;
  createdAt: string;
}

let sqlInstance: SqlJsStatic | null = null;

async function getSql(): Promise<SqlJsStatic> {
  if (!sqlInstance) {
    sqlInstance = await initSqlJs();
  }
  return sqlInstance;
}

export class TraceStore {
  private dbPath: string;
  private db: SqlJsDatabase | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async init(): Promise<void> {
    const SQL = await getSql();
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }
    this.migrate();
  }

  private ensureDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('TraceStore not initialized. Call await store.init() first.');
    }
    return this.db;
  }

  private persist(): void {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  private migrate(): void {
    const db = this.ensureDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        integration TEXT NOT NULL,
        capture_mode TEXT NOT NULL,
        browser_json TEXT NOT NULL,
        config_json TEXT NOT NULL,
        tabs_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        tab_id TEXT NOT NULL,
        frame_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        target_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_run_seq ON events(run_id, seq);

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.persist();
  }

  saveRun(run: RecordingRun): void {
    const validated = RecordingRunSchema.parse(run);
    const db = this.ensureDb();

    db.run(
      `INSERT OR REPLACE INTO runs (
        id, name, started_at, ended_at, integration, capture_mode, browser_json, config_json, tabs_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validated.id,
        validated.name,
        validated.startedAt,
        validated.endedAt || null,
        validated.integration,
        validated.captureMode,
        JSON.stringify(validated.browser),
        JSON.stringify(validated.config),
        JSON.stringify(validated.tabs),
      ]
    );
    this.persist();
  }

  getRun(runId: string): RecordingRun | null {
    const db = this.ensureDb();
    const stmt = db.prepare(`SELECT * FROM runs WHERE id = :runId`);
    stmt.bind({ ':runId': runId });

    if (!stmt.step()) {
      stmt.free();
      return null;
    }

    const row = stmt.getAsObject() as any;
    stmt.free();

    return {
      id: row.id,
      name: row.name,
      startedAt: row.started_at,
      endedAt: row.ended_at || undefined,
      integration: row.integration,
      captureMode: row.capture_mode,
      browser: JSON.parse(row.browser_json),
      config: JSON.parse(row.config_json),
      tabs: JSON.parse(row.tabs_json),
    };
  }

  listRuns(): RecordingRun[] {
    const db = this.ensureDb();
    const res = db.exec(`SELECT * FROM runs ORDER BY started_at DESC`);
    if (res.length === 0) return [];

    const columns = res[0].columns;
    const values = res[0].values;

    return values.map((row) => {
      const obj: any = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });

      return {
        id: obj.id,
        name: obj.name,
        startedAt: obj.started_at,
        endedAt: obj.ended_at || undefined,
        integration: obj.integration,
        captureMode: obj.capture_mode,
        browser: JSON.parse(obj.browser_json),
        config: JSON.parse(obj.config_json),
        tabs: JSON.parse(obj.tabs_json),
      };
    });
  }

  appendEvents(runId: string, events: RawTraceEvent[]): void {
    const db = this.ensureDb();
    for (const e of events) {
      const validated = RawTraceEventSchema.parse(e);
      db.run(
        `INSERT OR REPLACE INTO events (
          id, run_id, seq, timestamp_ms, tab_id, frame_id, type, payload_json, target_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          validated.id,
          runId,
          validated.seq,
          validated.timestampMs,
          validated.tabId,
          validated.frameId,
          validated.type,
          JSON.stringify(validated.payload),
          validated.target ? JSON.stringify(validated.target) : null,
        ]
      );
    }
    this.persist();
  }

  getEvents(runId: string): RawTraceEvent[] {
    const db = this.ensureDb();
    const stmt = db.prepare(`SELECT * FROM events WHERE run_id = :runId ORDER BY seq ASC`);
    stmt.bind({ ':runId': runId });

    const results: RawTraceEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      results.push({
        id: row.id,
        runId: row.run_id,
        seq: row.seq,
        timestampMs: row.timestamp_ms,
        tabId: row.tab_id,
        frameId: row.frame_id,
        type: row.type,
        payload: JSON.parse(row.payload_json),
        target: row.target_json ? JSON.parse(row.target_json) : undefined,
      });
    }
    stmt.free();
    return results;
  }

  saveAttachment(runId: string, type: string, filePath: string): StoredAttachment {
    const id = `att_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const createdAt = new Date().toISOString();
    const db = this.ensureDb();

    db.run(
      `INSERT INTO attachments (id, run_id, type, file_path, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, runId, type, filePath, createdAt]
    );
    this.persist();

    return { id, runId, type, filePath, createdAt };
  }

  getAttachments(runId: string): StoredAttachment[] {
    const db = this.ensureDb();
    const stmt = db.prepare(`SELECT * FROM attachments WHERE run_id = :runId`);
    stmt.bind({ ':runId': runId });

    const results: StoredAttachment[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as any;
      results.push({
        id: row.id,
        runId: row.run_id,
        type: row.type,
        filePath: row.file_path,
        createdAt: row.created_at,
      });
    }
    stmt.free();
    return results;
  }

  exportJsonl(runId: string, outFilePath: string): void {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found in store`);
    }

    const events = this.getEvents(runId);
    const dir = path.dirname(outFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const lines: string[] = [];
    lines.push(serializeRunHeader(run));
    for (const evt of events) {
      lines.push(serializeTraceEvent(evt));
    }

    fs.writeFileSync(outFilePath, lines.join('\n') + '\n', 'utf-8');
  }

  importJsonl(inFilePath: string): RecordingRun {
    if (!fs.existsSync(inFilePath)) {
      throw new Error(`File not found: ${inFilePath}`);
    }

    const content = fs.readFileSync(inFilePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const validation = validateTraceLines(lines);

    if (!validation.valid || !validation.run) {
      throw new Error(`Trace file invalid: ${validation.errors.join('; ')}`);
    }

    const run = validation.run;
    this.saveRun(run);

    const events: RawTraceEvent[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parsed = JSON.parse(lines[i]);
      events.push(parsed);
    }

    this.appendEvents(run.id, events);
    return run;
  }

  close(): void {
    if (this.db) {
      this.persist();
      this.db.close();
      this.db = null;
    }
  }
}
