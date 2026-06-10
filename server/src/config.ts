import path from "node:path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, "..");
const LOCAL_APP_DATA = process.env.LOCALAPPDATA
  ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local") : "");

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
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
  ignoredItemExportValue: envNumber("IGNORED_ITEM_EXPORT_VALUE", 1),
  dbPath: path.resolve(PROJECT_ROOT, "data", "tibia-market.sqlite"),
  migrationsDir: path.resolve(PROJECT_ROOT, "db", "migrations"),
  outputItemPricesPath: path.resolve(WORKSPACE_ROOT, "itemprices.json"),
  itemImagesDir: path.resolve(WORKSPACE_ROOT, "ui-app", "public", "items"),
  tibiaLogDir: process.env.TIBIA_LOG_DIR
    ?? path.resolve(LOCAL_APP_DATA, "Tibia", "packages", "Tibia", "log"),
  pricingModel: "snapshot pricing",
  pricingModelVersion: "robust-v1"
};

export type AppConfig = typeof config;
