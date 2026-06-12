import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrations";
import {
  addMarketWatchlistItem,
  getMarketDashboardSummary,
  getMarketWatchlist,
  removeMarketWatchlistItem
} from "./marketDashboard";

let db: Database.Database;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function createDb(): Database.Database {
  const database = new Database(":memory:");
  applyMigrations(database);
  return database;
}

function insertRun(hoursAgo: number): number {
  const inserted = db.prepare(
    `
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run("Antica", isoHoursAgo(hoursAgo + 1), isoHoursAgo(hoursAgo), isoHoursAgo(hoursAgo), isoHoursAgo(hoursAgo), isoHoursAgo(hoursAgo), "test", 2, 5, 5, "success");
  return Number(inserted.lastInsertRowid);
}

function insertItem(runId: number, item: {
  id: number;
  name: string;
  clientValue: number;
  reference?: number;
  divergence?: number;
  sourceRuns?: number;
  confidence?: number;
  liquidity?: number;
  monthSold?: number;
  daySold?: number;
  sellOffers?: number;
}): void {
  db.prepare(
    `
    INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
    VALUES (?, ?, ?, ?, '{}', ?)
    `
  ).run(item.id, item.name, item.name, "loot", isoHoursAgo(2));
  db.prepare(
    `
    INSERT INTO market_item_features (
      run_id, item_id, upstream_time, sell_offer, buy_offer, month_sold, day_sold, sell_offers, active_traders
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(runId, item.id, 1, item.clientValue, -1, item.monthSold ?? 10, item.daySold ?? 1, item.sellOffers ?? 5, 2);
  db.prepare(
    `
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
      client_value, trend, trend_score, liquidity, confidence, historical_reference_price,
      final_adjusted_price, divergence_pct, adjustment_reason, source_run_count
    ) VALUES (?, ?, 'conservative_min', 'test', ?, ?, ?, 'stable', 0.1, ?, ?, ?, ?, ?, 'test', ?)
    `
  ).run(
    runId,
    item.id,
    item.clientValue,
    item.clientValue,
    item.clientValue,
    item.liquidity ?? 0.5,
    item.confidence ?? 0.8,
    item.reference ?? null,
    item.clientValue,
    item.divergence ?? null,
    item.sourceRuns ?? 0
  );
  db.prepare(
    `
    INSERT INTO item_market_history (item_id, server, source, snapshot_key, snapshot_at, payload_json, payload_hash, fetched_at)
    VALUES (?, 'Antica', 'sync', ?, ?, ?, ?, ?)
    `
  ).run(item.id, `snap-${item.id}`, isoHoursAgo(2), JSON.stringify({ sell_offer: item.clientValue }), `hash-${item.id}`, isoHoursAgo(2));
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("market dashboard summary", () => {
  it("labels fresh and stale latest sync snapshots", () => {
    const freshRun = insertRun(2);
    insertItem(freshRun, { id: 100, name: "Fresh Loot", clientValue: 90, reference: 120, divergence: -25, sourceRuns: 6 });

    expect((getMarketDashboardSummary(db).freshness as Record<string, unknown>).status).toBe("fresh");

    db.close();
    db = createDb();
    const staleRun = insertRun(50);
    insertItem(staleRun, { id: 101, name: "Stale Loot", clientValue: 90, reference: 120, divergence: -25, sourceRuns: 6 });

    const summary = getMarketDashboardSummary(db);
    expect((summary.freshness as Record<string, unknown>).status).toBe("stale");
    expect(summary.warnings as string[]).toContain("Market data is a stale snapshot. Treat prices as trend evidence, not live listings.");
  });

  it("surfaces historically cheap items and items that need more snapshots", () => {
    const runId = insertRun(2);
    insertItem(runId, { id: 200, name: "Cheap Loot", clientValue: 60, reference: 100, divergence: -40, sourceRuns: 8 });
    insertItem(runId, { id: 201, name: "Thin Loot", clientValue: 300, confidence: 0.2, monthSold: 1, sourceRuns: 1 });

    const summary = getMarketDashboardSummary(db);
    const cheap = summary.historicallyCheap as Array<Record<string, unknown>>;
    const quiet = summary.quietItems as Array<Record<string, unknown>>;

    expect(cheap[0].name).toBe("Cheap Loot");
    expect(cheap[0].reason_labels).toContain("below historical band");
    expect(quiet.find((item) => item.name === "Thin Loot")?.warning_labels).toContain("needs more snapshots");
  });

  it("includes watchlist context and supports idempotent favorite add/remove", () => {
    const runId = insertRun(50);
    insertItem(runId, { id: 300, name: "Favorite Loot", clientValue: 80, reference: 120, divergence: -33, sourceRuns: 6 });

    addMarketWatchlistItem(db, 300);
    addMarketWatchlistItem(db, 300);

    const watchlist = getMarketWatchlist(db).items;
    expect(watchlist).toHaveLength(1);
    expect(watchlist[0].name).toBe("Favorite Loot");
    expect(watchlist[0].warning_labels).toContain("stale snapshot");

    expect(removeMarketWatchlistItem(db, 300)).toBe(true);
    expect(getMarketWatchlist(db).items).toHaveLength(0);
  });

  it("ranks looted items by stored hunt loot and latest snapshot value", () => {
    const runId = insertRun(2);
    insertItem(runId, { id: 400, name: "Valuable Fang", clientValue: 1000, reference: 900, divergence: 11, sourceRuns: 5 });
    insertItem(runId, { id: 401, name: "Small Gem", clientValue: 100, reference: 120, divergence: -17, sourceRuns: 5 });
    db.prepare(
      `
      INSERT INTO hunt_uploads (label, duration_minutes, total_xp, total_loot_gold, total_supply_cost, raw_text, processed_json)
      VALUES ('Loot Hunt', 60, 1, 1, 0, '', ?)
      `
    ).run(JSON.stringify({
      parsed: {
        loot_items: [
          { name: "Valuable Fang", quantity: 2, normalized_name: "valuable fang" },
          { name: "Small Gem", quantity: 3, normalized_name: "small gem" }
        ]
      },
      loot_items: []
    }));

    const summary = getMarketDashboardSummary(db);
    const hotLooted = summary.hotLootedItems as Array<Record<string, unknown>>;

    expect(hotLooted[0].name).toBe("Valuable Fang");
    expect(hotLooted[0].looted_value).toBe(2000);
    expect(hotLooted[0].reason_labels).toContain("high looted value");
  });
});
