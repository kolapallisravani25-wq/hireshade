import { app } from '../../_server/app';
import Database from 'better-sqlite3';

let _db: InstanceType<typeof Database> | null = null;

function getDb() {
  if (_db) return _db;
  _db = new Database('app.db');
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS quick_links (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      url       TEXT    NOT NULL,
      created_at TEXT   NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return _db;
}

const controller = app.defineTableController(
  {
    customDataFetcher: async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const db = getDb();
      const offset = (page - 1) * pageSize;

      const records = db
        .prepare('SELECT id, title, url, created_at FROM quick_links ORDER BY id DESC LIMIT ? OFFSET ?')
        .all(pageSize, offset) as any[];

      const row = db
        .prepare('SELECT COUNT(*) as total FROM quick_links')
        .get() as { total: number };

      return { records, total: row.total };
    },
  },
  {
    createLink: async (input: { title: string; url: string }) => {
      const t = (input.title || '').trim();
      const u = (input.url || '').trim();
      if (!t) throw new Error('Title is required');
      if (!u) throw new Error('URL is required');

      const db = getDb();
      const result = db
        .prepare('INSERT INTO quick_links (title, url) VALUES (?, ?)')
        .run(t, u);

      return { success: true, id: result.lastInsertRowid };
    },

    updateLink: async (input: { id: number; title: string; url: string }) => {
      const t = (input.title || '').trim();
      const u = (input.url || '').trim();
      if (!t) throw new Error('Title is required');
      if (!u) throw new Error('URL is required');

      const db = getDb();
      db.prepare('UPDATE quick_links SET title = ?, url = ? WHERE id = ?').run(t, u, input.id);

      return { success: true };
    },

    deleteLink: async (input: { id: number }) => {
      const db = getDb();
      db.prepare('DELETE FROM quick_links WHERE id = ?').run(input.id);
      return { success: true };
    },
  }
);

export default controller;
export type Procedures = typeof controller.procedures;