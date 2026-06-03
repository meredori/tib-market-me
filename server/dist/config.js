"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const node_path_1 = __importDefault(require("node:path"));
const PROJECT_ROOT = node_path_1.default.resolve(__dirname, "..");
const WORKSPACE_ROOT = node_path_1.default.resolve(PROJECT_ROOT, "..");
function envNumber(name, fallback) {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}
exports.config = {
    projectRoot: PROJECT_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
    apiBase: "https://api.tibiamarket.top",
    serverName: process.env.TIBIA_SERVER ?? "Victoris",
    host: process.env.HOST ?? "127.0.0.1",
    port: envNumber("PORT", 8787),
    salesTaxPct: envNumber("SALES_TAX_PCT", 8),
    requestTimeoutMs: envNumber("REQUEST_TIMEOUT_MS", 20_000),
    maxRetries: envNumber("MAX_RETRIES", 6),
    pageLimit: envNumber("PAGE_LIMIT", 250),
    pagePauseMs: envNumber("PAGE_PAUSE_MS", 350),
    dbPath: node_path_1.default.resolve(PROJECT_ROOT, "data", "tibia-market.sqlite"),
    migrationsDir: node_path_1.default.resolve(PROJECT_ROOT, "db", "migrations"),
    outputFlatPath: node_path_1.default.resolve(WORKSPACE_ROOT, "itemsprices.json"),
    outputDetailPath: node_path_1.default.resolve(WORKSPACE_ROOT, "itemsprices.detailed.json"),
    outputMetaPath: node_path_1.default.resolve(WORKSPACE_ROOT, "itemsprices.meta.json"),
    itemImagesDir: node_path_1.default.resolve(WORKSPACE_ROOT, "ui-app", "public", "items"),
    pricingModel: "snapshot pricing",
    pricingModelVersion: "robust-v1"
};
