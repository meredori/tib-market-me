import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrations";
import { getLootInbox, markLootInboxItemState } from "./lootSelling";

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
    ) VALUES ('Antica', ?, ?, ?, ?, ?, 'test', 2, 5, 5, 'success')
    `
  ).run(isoHoursAgo(hoursAgo + 1), isoHoursAgo(hoursAgo), isoHoursAgo(hoursAgo), isoHoursAgo(hoursAgo), isoHoursAgo(hoursAgo));
  return Number(inserted.lastInsertRowid);
}

function insertItem(runId: number, item: {
  id: number;
  name: string;
  value: number;
  reference?: number;
  sourceRuns?: number;
  confidence?: number;
  liquidity?: number;
  monthSold?: number;
  daySold?: number;
  npcBuy?: number;
  overrideMode?: string;
  overrideHoursAgo?: number;
}): void {
  db.prepare(
    `
    INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
    VALUES (?, ?, ?, 'loot', '{}', ?)
    `
  ).run(item.id, item.name, item.name, isoHoursAgo(1));
  db.prepare(
    `
    INSERT INTO market_item_features (
      run_id, item_id, upstream_time, sell_offer, buy_offer, month_sold, day_sold, sell_offers, active_traders
    ) VALUES (?, ?, 1, ?, -1, ?, ?, 5, 2)
    `
  ).run(runId, item.id, item.value, item.monthSold ?? 20, item.daySold ?? 2);
  db.prepare(
    `
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
      client_value, trend, trend_score, liquidity, confidence, historical_reference_price,
      final_adjusted_price, divergence_pct, adjustment_reason, source_run_count
    ) VALUES (?, ?, 'snapshot pricing', 'test', ?, ?, ?, 'stable', 0.1, ?, ?, ?, ?, NULL, 'test', ?)
    `
  ).run(
    runId,
    item.id,
    item.value,
    item.value,
    item.value,
    item.liquidity ?? 0.7,
    item.confidence ?? 0.85,
    item.reference ?? null,
    item.value,
    item.sourceRuns ?? 8
  );
  if (item.npcBuy) {
    db.prepare(
      `
      INSERT INTO item_npc_buy (
        item_id, npc_name, location, price, currency_object_type_id,
        currency_quest_flag_display_name, fetched_at
      ) VALUES (?, 'Rashid', 'Carlin', ?, 0, '', ?)
      `
    ).run(item.id, item.npcBuy, isoHoursAgo(1));
  }
  if (item.overrideMode && item.overrideMode !== "auto") {
    db.prepare(
      `
      INSERT INTO item_value_overrides (item_id, override_mode, updated_at)
      VALUES (?, ?, ?)
      `
    ).run(item.id, item.overrideMode, isoHoursAgo(item.overrideHoursAgo ?? 4));
  }
}

function insertHunt(label: string, lootItems: Array<{ name: string; quantity: number }>, excluded: string[] = [], hoursAgo = 2): void {
  db.prepare(
    `
    INSERT INTO hunt_uploads (
      label, uploaded_at, started_at, duration_minutes, total_xp, total_loot_gold,
      total_supply_cost, raw_text, processed_json, excluded_items_json
    ) VALUES (?, ?, ?, 60, 1, 1, 0, '', ?, ?)
    `
  ).run(
    label,
    isoHoursAgo(hoursAgo),
    isoHoursAgo(hoursAgo),
    JSON.stringify({
      parsed: {
        loot_items: lootItems.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          normalized_name: item.name.toLowerCase()
        }))
      }
    }),
    JSON.stringify(excluded)
  );
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("loot selling inbox", () => {
  it("classifies recently looted items into sell and hold actions", () => {
    const runId = insertRun(2);
    insertItem(runId, { id: 100, name: "Hot Fang", value: 150, reference: 100, sourceRuns: 10 });
    insertItem(runId, { id: 101, name: "Cold Gem", value: 60, reference: 120, sourceRuns: 10 });
    insertHunt("Loot Hunt", [
      { name: "Hot Fang", quantity: 5 },
      { name: "Cold Gem", quantity: 4 }
    ]);

    const inbox = getLootInbox(db) as Record<string, unknown>;
    const items = inbox.items as Array<Record<string, unknown>>;

    expect((inbox.summary as Record<string, unknown>).total_estimated_value).toBe(990);
    expect(items.find((item) => item.name === "Hot Fang")?.action).toBe("sell_now");
    expect(items.find((item) => item.name === "Hot Fang")?.reason_labels).toContain("above historical band");
    expect(items.find((item) => item.name === "Cold Gem")?.action).toBe("hold");
    expect(items.find((item) => item.name === "Cold Gem")?.reason_labels).toContain("below historical band");
  });

  it("surfaces NPC, stale, unknown, and override review buckets", () => {
    const runId = insertRun(60);
    insertItem(runId, { id: 200, name: "Vendor Horn", value: 15, npcBuy: 80, monthSold: 0, liquidity: 0.02, confidence: 0.3 });
    insertItem(runId, { id: 201, name: "Override Relic", value: 30_000, reference: 28_000, overrideMode: "market" });
    insertHunt("Review Hunt", [
      { name: "Vendor Horn", quantity: 3 },
      { name: "Override Relic", quantity: 2 },
      { name: "Mystery Dust", quantity: 9 }
    ]);

    const inbox = getLootInbox(db) as Record<string, unknown>;
    const items = inbox.items as Array<Record<string, unknown>>;
    const summary = inbox.summary as Record<string, unknown>;
    const buckets = summary.buckets as Record<string, number>;

    expect(items.find((item) => item.name === "Vendor Horn")?.action).toBe("npc_vendor");
    expect(items.find((item) => item.name === "Vendor Horn")?.warning_labels).toContain("stale data");
    expect(items.find((item) => item.name === "Mystery Dust")?.action).toBe("unknown_price");
    expect(items.find((item) => item.name === "Override Relic")?.warning_labels).toContain("review override");
    expect(buckets.npc_vendor).toBe(1);
    expect(buckets.unknown_price).toBe(1);
    expect(buckets.override_review).toBe(1);
    expect(buckets.stale_data).toBeGreaterThanOrEqual(1);
  });

  it("reviews old and disagreeing overrides without hiding manual ignore as unknown", () => {
    const runId = insertRun(2);
    insertItem(runId, {
      id: 300,
      name: "Ignored Relic",
      value: 2_000,
      reference: 2_100,
      overrideMode: "ignore",
      overrideHoursAgo: 24 * 45
    });
    insertHunt("Override Hunt", [{ name: "Ignored Relic", quantity: 3 }]);

    const inbox = getLootInbox(db) as Record<string, unknown>;
    const item = (inbox.items as Array<Record<string, unknown>>).find((row) => row.name === "Ignored Relic");

    expect(item?.action).toBe("review_price");
    expect(item?.reason_labels).toContain("manual override");
    expect(item?.warning_labels).toContain("old override");
    expect(item?.warning_labels).toContain("override disagrees");
    expect(item?.warning_labels).toContain("itemprices impact");
    expect(item?.warning_labels).not.toContain("unknown price");
  });

  it("filters the inbox by recent hunt window", () => {
    const runId = insertRun(2);
    insertItem(runId, { id: 400, name: "Recent Drop", value: 100 });
    insertItem(runId, { id: 401, name: "Old Drop", value: 100 });
    insertHunt("Recent Hunt", [{ name: "Recent Drop", quantity: 1 }], [], 12);
    insertHunt("Old Hunt", [{ name: "Old Drop", quantity: 1 }], [], 24 * 45);

    const inbox = getLootInbox(db, { days: 30 }) as Record<string, unknown>;
    const names = (inbox.items as Array<Record<string, unknown>>).map((item) => item.name);

    expect(names).toContain("Recent Drop");
    expect(names).not.toContain("Old Drop");
  });

  it("hides listed and sold items until a newer hunt loots them again", () => {
    const runId = insertRun(2);
    insertItem(runId, { id: 500, name: "Repeat Drop", value: 100 });
    insertHunt("First Hunt", [{ name: "Repeat Drop", quantity: 2 }], [], 24);

    const listed = markLootInboxItemState(db, { normalized_name: "repeat drop", status: "listed" }) as Record<string, unknown>;
    expect((listed.state as Record<string, unknown>).status).toBe("listed");

    const hiddenInbox = getLootInbox(db, { days: 30 }) as Record<string, unknown>;
    expect((hiddenInbox.items as Array<Record<string, unknown>>).map((item) => item.name)).not.toContain("Repeat Drop");

    insertHunt("Second Hunt", [{ name: "Repeat Drop", quantity: 1 }], [], 1);
    const visibleInbox = getLootInbox(db, { days: 30 }) as Record<string, unknown>;
    const item = (visibleInbox.items as Array<Record<string, unknown>>).find((row) => row.name === "Repeat Drop");

    expect(item?.quantity).toBe(3);
    expect(item?.inbox_state).toMatchObject({ status: "listed" });

    markLootInboxItemState(db, { normalized_name: "repeat drop", status: "active" });
    const clearedInbox = getLootInbox(db, { days: 30 }) as Record<string, unknown>;
    expect((clearedInbox.items as Array<Record<string, unknown>>).find((row) => row.name === "Repeat Drop")?.inbox_state).toBeNull();
  });
});
