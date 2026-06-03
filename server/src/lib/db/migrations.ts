import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../../config";

type MigrationRow = {
  name: string;
};

export function applyMigrations(db: Database.Database): void {
  fs.mkdirSync(config.migrationsDir, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedRows = db.prepare("SELECT name FROM schema_migrations").all() as MigrationRow[];
  const appliedSet = new Set(appliedRows.map((row) => row.name));

  const files = fs
    .readdirSync(config.migrationsDir)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  const markApplied = db.prepare("INSERT INTO schema_migrations(name) VALUES (?)");

  for (const fileName of files) {
    if (appliedSet.has(fileName)) {
      continue;
    }

    const sqlPath = path.resolve(config.migrationsDir, fileName);
    const sql = fs.readFileSync(sqlPath, "utf-8");

    const applyOne = db.transaction(() => {
      db.exec(sql);
      markApplied.run(fileName);
    });

    applyOne();
  }
}