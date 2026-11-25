import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Remembered = { label: string; sh: Set<string> };

export interface RepeatMemory {
  recent(now: number): Remembered[];
  add(label: string, sh: Set<string>, now: number): void;
  close?(): void;
}

export function inMemory(window: number, ttlSeconds = 0): RepeatMemory {
  const items: (Remembered & { at: number })[] = [];
  return {
    recent(now) {
      return ttlSeconds > 0 ? items.filter((r) => now - r.at < ttlSeconds * 1000) : items;
    },
    add(label, sh, now) {
      items.push({ label, sh, at: now });
      if (items.length > window) items.shift();
    },
  };
}

export function sqliteMemory(path: string, window: number, ttlSeconds = 0): RepeatMemory {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 2000");
  db.run("CREATE TABLE IF NOT EXISTS recent (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, label TEXT NOT NULL, shingles TEXT NOT NULL)");
  db.run("CREATE INDEX IF NOT EXISTS recent_at ON recent(at)");
  const read = db.query<{ label: string; shingles: string }, [number, number]>("SELECT label, shingles FROM recent WHERE at > ? ORDER BY id DESC LIMIT ?");
  const put = db.query("INSERT INTO recent (at, label, shingles) VALUES (?, ?, ?)");
  const trim = db.query("DELETE FROM recent WHERE id <= (SELECT id FROM recent ORDER BY id DESC LIMIT 1 OFFSET ?) OR at <= ?");
  return {
    recent(now) {
      return read.all(ttlSeconds > 0 ? now - ttlSeconds * 1000 : -1, window).map((r) => ({ label: r.label, sh: new Set(r.shingles.split("\u0001")) }));
    },
    add(label, sh, now) {
      db.transaction(() => {
        put.run(now, label, [...sh].join("\u0001"));
        trim.run(window, ttlSeconds > 0 ? now - ttlSeconds * 1000 : -1);
      })();
    },
    close() {
      db.close();
    },
  };
}
