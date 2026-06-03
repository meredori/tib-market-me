"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const config_1 = require("../../config");
function applyMigrations(db) {
    node_fs_1.default.mkdirSync(config_1.config.migrationsDir, { recursive: true });
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
    const appliedRows = db.prepare("SELECT name FROM schema_migrations").all();
    const appliedSet = new Set(appliedRows.map((row) => row.name));
    const files = node_fs_1.default
        .readdirSync(config_1.config.migrationsDir)
        .filter((fileName) => fileName.endsWith(".sql"))
        .sort((a, b) => a.localeCompare(b));
    const markApplied = db.prepare("INSERT INTO schema_migrations(name) VALUES (?)");
    for (const fileName of files) {
        if (appliedSet.has(fileName)) {
            continue;
        }
        const sqlPath = node_path_1.default.resolve(config_1.config.migrationsDir, fileName);
        const sql = node_fs_1.default.readFileSync(sqlPath, "utf-8");
        const applyOne = db.transaction(() => {
            db.exec(sql);
            markApplied.run(fileName);
        });
        applyOne();
    }
}
