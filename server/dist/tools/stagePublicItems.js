"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const database_1 = require("../lib/db/database");
const config_1 = require("../config");
const MANUAL_TRACK_PATH = node_path_1.default.resolve(config_1.config.workspaceRoot, "assets", "manual-item-images.json");
function parseArgs(argv) {
    let source = node_path_1.default.resolve(config_1.config.workspaceRoot, "assets", "generated", "items-archive");
    let destination = config_1.config.itemImagesDir;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if ((arg === "-s" || arg === "--source") && argv[i + 1]) {
            source = node_path_1.default.resolve(argv[i + 1]);
            i += 1;
            continue;
        }
        if ((arg === "-d" || arg === "--destination") && argv[i + 1]) {
            destination = node_path_1.default.resolve(argv[i + 1]);
            i += 1;
        }
    }
    return { source, destination };
}
function loadManualIds() {
    if (!node_fs_1.default.existsSync(MANUAL_TRACK_PATH)) {
        return [3043, 3048, 3052];
    }
    const raw = node_fs_1.default.readFileSync(MANUAL_TRACK_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    const ids = Array.isArray(parsed.itemIds) ? parsed.itemIds : [];
    const normalized = ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);
    return Array.from(new Set(normalized)).sort((a, b) => a - b);
}
function loadDatabaseIds() {
    const db = (0, database_1.openDatabase)();
    try {
        const latestRun = db.prepare("SELECT id FROM market_runs ORDER BY id DESC LIMIT 1").get();
        if (latestRun?.id) {
            const rows = db
                .prepare(`SELECT DISTINCT item_id
           FROM market_item_prices
           WHERE run_id = ?
           ORDER BY item_id ASC`)
                .all(latestRun.id);
            if (rows.length > 0) {
                return rows.map((row) => row.item_id);
            }
        }
        const metadataRows = db
            .prepare("SELECT item_id FROM item_metadata ORDER BY item_id ASC")
            .all();
        return metadataRows.map((row) => row.item_id);
    }
    catch {
        return [];
    }
    finally {
        db.close();
    }
}
function clearDestinationPngs(destination) {
    node_fs_1.default.mkdirSync(destination, { recursive: true });
    const entries = node_fs_1.default.readdirSync(destination, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) {
            continue;
        }
        node_fs_1.default.unlinkSync(node_path_1.default.join(destination, entry.name));
    }
}
function stageImages(source, destination, ids) {
    let copied = 0;
    const missing = [];
    for (const itemId of ids) {
        const sourcePath = node_path_1.default.join(source, `${itemId}.png`);
        const destinationPath = node_path_1.default.join(destination, `${itemId}.png`);
        if (!node_fs_1.default.existsSync(sourcePath)) {
            missing.push(itemId);
            continue;
        }
        node_fs_1.default.copyFileSync(sourcePath, destinationPath);
        copied += 1;
    }
    return { copied, missing };
}
function main() {
    const { source, destination } = parseArgs(process.argv.slice(2));
    if (!node_fs_1.default.existsSync(source)) {
        throw new Error(`Archive source directory not found: ${source}`);
    }
    const manualIds = loadManualIds();
    const dbIds = loadDatabaseIds();
    const ids = Array.from(new Set([...dbIds, ...manualIds])).sort((a, b) => a - b);
    clearDestinationPngs(destination);
    const result = stageImages(source, destination, ids);
    console.log([
        `staged ${result.copied} item images to ${destination}`,
        `db ids: ${dbIds.length}`,
        `manual ids: ${manualIds.length}`,
        `total selected ids: ${ids.length}`
    ].join(" | "));
    if (result.missing.length > 0) {
        const preview = result.missing.slice(0, 20).join(", ");
        console.warn(`missing ${result.missing.length} archive images. First missing item ids: ${preview}${result.missing.length > 20 ? ", ..." : ""}`);
    }
}
main();
