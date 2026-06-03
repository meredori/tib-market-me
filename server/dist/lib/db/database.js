"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openDatabase = openDatabase;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const config_1 = require("../../config");
function ensureDirectoryFor(filePath) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
}
function openDatabase() {
    ensureDirectoryFor(config_1.config.dbPath);
    const db = new better_sqlite3_1.default(config_1.config.dbPath);
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    return db;
}
