import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../../config";

function ensureDirectoryFor(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function openDatabase(): Database.Database {
  ensureDirectoryFor(config.dbPath);
  const db = new Database(config.dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  return db;
}