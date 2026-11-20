import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

/** Append-only. Each entry upgrades the schema by one user_version. */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT;`,
  `CREATE TABLE self_test (
     id     INTEGER PRIMARY KEY CHECK (id = 1),
     result TEXT NOT NULL
   ) STRICT;
   CREATE TABLE capture_matrix (
     app           TEXT PRIMARY KEY,
     result        TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
     notes         TEXT NOT NULL,
     tested_at     TEXT NOT NULL,
     windows_build INTEGER
   ) STRICT;`,
  `CREATE TABLE kb_files (
     path       TEXT PRIMARY KEY,
     hash       TEXT NOT NULL,
     chunks     INTEGER NOT NULL,
     qa         INTEGER NOT NULL,
     error      TEXT,
     indexed_at INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE kb_chunks (
     id       INTEGER PRIMARY KEY,
     file     TEXT NOT NULL,
     kind     TEXT NOT NULL CHECK (kind IN ('qa', 'text')),
     question TEXT,
     text     TEXT NOT NULL,
     vec      BLOB,
     qvec     BLOB
   ) STRICT;
   CREATE INDEX kb_chunks_file ON kb_chunks(file);
   CREATE VIRTUAL TABLE kb_fts USING fts5(question, text, tokenize = 'porter unicode61');`,
  `CREATE TABLE meetings (
     id         INTEGER PRIMARY KEY,
     title      TEXT NOT NULL,
     started_at INTEGER NOT NULL,
     ended_at   INTEGER,
     status     TEXT NOT NULL CHECK (status IN ('recording', 'summarizing', 'done', 'error', 'interrupted')),
     minutes    TEXT,
     error      TEXT,
     model      TEXT,
     file       TEXT,
     words      INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE TABLE meeting_lines (
     id         INTEGER PRIMARY KEY,
     meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
     source     TEXT NOT NULL CHECK (source IN ('them', 'you')),
     text       TEXT NOT NULL,
     at         INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX meeting_lines_meeting ON meeting_lines(meeting_id);`
]

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

/** Runs fn inside a transaction, rolling back if it throws. */
export function transaction(db: Db, fn: () => void): void {
  db.exec('BEGIN')
  try {
    fn()
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function userVersion(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get()
  const value = row?.['user_version']
  return typeof value === 'number' ? value : 0
}

function migrate(db: Db): void {
  for (let version = userVersion(db); version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version]
    if (sql === undefined) break
    transaction(db, () => {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${version + 1}`)
    })
  }
}
