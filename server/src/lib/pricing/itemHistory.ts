import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { config } from "../../config";
import { TibiaMarketClient, type MarketRow } from "../tibiamarket/client";

export type ItemHistorySummary = {
  item_id: number;
  source: "sync" | "api";
  snapshot_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  min_sell_offer: number | null;
  max_sell_offer: number | null;
  median_sell_offer: number | null;
  fetched: boolean;
};

export type HistoricalPricingContext = {
  source_run_count: number;
  reference_price: number | null;
  low_band: number | null;
  high_band: number | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function snapshotKey(row: Record<string, unknown>, fallback: number): string {
  const time = asText(row.time) || String(asInt(row.time) ?? "");
  const lastUpdate = asText(row.last_update) || asText(row.created_at) || asText(row.snapshot_at);
  return time || lastUpdate || `row-${fallback}`;
}

function snapshotAt(row: Record<string, unknown>): string | null {
  const raw = asText(row.created_at) || asText(row.snapshot_at) || asText(row.last_update);
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  const time = asInt(row.time);
  return time !== null && time > 0 ? new Date(time * 1000).toISOString() : null;
}

export function storeSyncSnapshotHistory(
  db: Database.Database,
  rows: MarketRow[],
  fetchedAt: string = nowIso()
): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO item_market_history (
      item_id, server, source, snapshot_key, snapshot_at, payload_json, payload_hash, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const store = db.transaction(() => {
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (typeof row !== "object" || row === null || typeof row.id !== "number") {
        continue;
      }
      const payloadJson = JSON.stringify(row);
      insert.run(
        Math.trunc(row.id),
        config.serverName,
        "sync",
        snapshotKey(row, index),
        snapshotAt(row),
        payloadJson,
        sha256(payloadJson),
        fetchedAt
      );
    }
  });

  store();
}

function getRows(db: Database.Database, itemId: number): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT source, snapshot_at, payload_json, fetched_at
      FROM item_market_history
      WHERE item_id = ?
        AND server = ?
      ORDER BY COALESCE(snapshot_at, fetched_at) ASC
    `
    )
    .all(Math.trunc(itemId), config.serverName) as Array<Record<string, unknown>>;
}

export function summarizeItemHistory(db: Database.Database, itemId: number): ItemHistorySummary | null {
  const rows = getRows(db, itemId);
  if (!rows.length) {
    return null;
  }

  const sellOffers: number[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(asText(row.payload_json)) as Record<string, unknown>;
      const sellOffer = asInt(payload.sell_offer);
      if (sellOffer !== null && sellOffer > 0) {
        sellOffers.push(sellOffer);
      }
    } catch {
      // Ignore malformed cache rows; they should not block a hunt preview.
    }
  }

  sellOffers.sort((a, b) => a - b);
  const median = sellOffers.length ? sellOffers[Math.floor(sellOffers.length / 2)] : null;
  const first = rows[0];
  const last = rows[rows.length - 1];

  return {
    item_id: Math.trunc(itemId),
    source: rows.some((row) => row.source === "api") ? "api" : "sync",
    snapshot_count: rows.length,
    first_seen_at: asText(first.snapshot_at) || asText(first.fetched_at) || null,
    last_seen_at: asText(last.snapshot_at) || asText(last.fetched_at) || null,
    min_sell_offer: sellOffers.length ? sellOffers[0] : null,
    max_sell_offer: sellOffers.length ? sellOffers[sellOffers.length - 1] : null,
    median_sell_offer: median,
    fetched: false
  };
}

function comparableHistoryValue(payload: Record<string, unknown>): number | null {
  const sellOffer = asInt(payload.sell_offer);
  const dayAverageSell = asInt(payload.day_average_sell);
  const monthAverageSell = asInt(payload.month_average_sell);
  const daySold = asInt(payload.day_sold) ?? 0;
  const monthSold = asInt(payload.month_sold) ?? 0;

  if (sellOffer !== null && sellOffer > 0) {
    return sellOffer;
  }
  if (dayAverageSell !== null && dayAverageSell > 0 && daySold > 0) {
    return dayAverageSell;
  }
  if (monthAverageSell !== null && monthAverageSell > 0 && monthSold > 0) {
    return monthAverageSell;
  }
  return null;
}

export function getHistoricalPricingContext(db: Database.Database, itemId: number): HistoricalPricingContext {
  const rows = getRows(db, itemId);
  const values: number[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(asText(row.payload_json)) as Record<string, unknown>;
      const comparable = comparableHistoryValue(payload);
      if (comparable !== null && comparable > 0) {
        values.push(comparable);
      }
    } catch {
      // Ignore malformed cache rows.
    }
  }

  values.sort((a, b) => a - b);
  if (values.length < 4) {
    return {
      source_run_count: values.length,
      reference_price: null,
      low_band: null,
      high_band: null
    };
  }

  const median = values[Math.floor(values.length / 2)];
  const bandPct = values.length >= 10 ? 0.25 : 0.35;
  return {
    source_run_count: values.length,
    reference_price: median,
    low_band: Math.max(1, Math.round(median * (1 - bandPct))),
    high_band: Math.max(1, Math.round(median * (1 + bandPct)))
  };
}

export async function ensureItemHistory(
  db: Database.Database,
  itemId: number,
  startDaysAgo = 30
): Promise<ItemHistorySummary | null> {
  const existing = summarizeItemHistory(db, itemId);
  if (existing?.source === "api") {
    return existing;
  }

  const client = new TibiaMarketClient();
  const rows = await client.getItemHistory(config.serverName, Math.trunc(itemId), startDaysAgo);
  const fetchedAt = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO item_market_history (
      item_id, server, source, snapshot_key, snapshot_at, payload_json, payload_hash, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const store = db.transaction(() => {
    rows.forEach((row, index) => {
      const payloadJson = JSON.stringify(row);
      insert.run(
        Math.trunc(itemId),
        config.serverName,
        "api",
        snapshotKey(row, index),
        snapshotAt(row),
        payloadJson,
        sha256(payloadJson),
        fetchedAt
      );
    });
  });
  store();

  const summary = summarizeItemHistory(db, itemId);
  return summary ? { ...summary, fetched: true } : existing;
}
