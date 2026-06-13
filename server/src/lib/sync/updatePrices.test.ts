import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrations";
import { getItemDetails } from "./updatePrices";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  applyMigrations(db);
});

afterEach(() => {
  db.close();
});

describe("item details", () => {
  it("fills NPC names from raw metadata when older sync rows stored blank names", () => {
    const runId = Number(db.prepare(
      `
      INSERT INTO market_runs (
        server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
        pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
      ) VALUES ('Victoris', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z',
        '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z',
        'test', 2, 1, 1, 'success')
      `
    ).run().lastInsertRowid);

    db.prepare(
      `
      INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
      VALUES (?, ?, ?, ?, ?, '2026-06-12T00:00:00.000Z')
      `
    ).run(281, "giant shimmering pearl", "giant shimmering pearl", "Valuables", JSON.stringify({
      id: 281,
      name: "giant shimmering pearl",
      npc_buy: [
        { name: "Augustin", location: "Bounac", price: 3000 },
        { name: "Briasol", location: "Ab'Dendriel City", price: 3000 }
      ],
      npc_sell: []
    }));

    db.prepare(
      `
      INSERT INTO item_npc_buy (
        item_id, npc_name, location, price, currency_object_type_id, currency_quest_flag_display_name, fetched_at
      ) VALUES (281, '', 'Bounac', 3000, 0, '', '2026-06-12T00:00:00.000Z')
      `
    ).run();
    db.prepare(
      `
      INSERT INTO market_item_features (run_id, item_id, upstream_time, sell_offer, month_sold, month_average_sell)
      VALUES (?, 281, 1, 2900, 10, 3000)
      `
    ).run(runId);
    db.prepare(
      `
      INSERT INTO market_item_prices (
        run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
        client_value, trend, trend_score, liquidity, confidence, source_run_count
      ) VALUES (?, 281, 'snapshot pricing', 'test', 3000, 3000, 3000, 'stable', 0, 0.8, 0.9, 6)
      `
    ).run(runId);

    const details = getItemDetails(db, 281);

    expect(details?.npc_buy_rows).toMatchObject([
      { npc_name: "Augustin", location: "Bounac", price: 3000 },
      { npc_name: "Briasol", location: "Ab'Dendriel City", price: 3000 }
    ]);
  });

  it("exposes max, fair, and minimum sale prices as the canonical loot logic values", () => {
    const runId = Number(db.prepare(
      `
      INSERT INTO market_runs (
        server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
        pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
      ) VALUES ('Victoris', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z',
        '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z',
        'test', 2, 1, 1, 'success')
      `
    ).run().lastInsertRowid);

    db.prepare(
      `
      INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
      VALUES (500, 'valuable fang', 'valuable fang', 'Valuables', '{}', '2026-06-12T00:00:00.000Z')
      `
    ).run();
    db.prepare(
      `
      INSERT INTO market_item_features (
        run_id, item_id, upstream_time, sell_offer, month_sold, day_sold, month_average_sell,
        month_highest_sell, month_lowest_sell
      ) VALUES (?, 500, 1, 9000, 40, 2, 10000, 15000, 1000)
      `
    ).run(runId);
    db.prepare(
      `
      INSERT INTO market_item_prices (
        run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
        client_value, trend, trend_score, liquidity, confidence, source_run_count
      ) VALUES (?, 500, 'snapshot pricing', 'test', 10000, 11000, 10000, 'stable', 0, 0.8, 0.9, 6)
      `
    ).run(runId);

    const details = getItemDetails(db, 500);
    const logic = details?.loot_logic as Record<string, unknown>;

    expect(logic.max_list_price).toBe(15000);
    expect(logic.fair_sale_price).toBe(10000);
    expect(logic.min_list_price).toBe(9000);
    expect(logic).not.toHaveProperty("price");
    expect(logic).not.toHaveProperty("list_price");
    expect(logic).not.toHaveProperty("min_price");
    expect(logic).not.toHaveProperty("undercut_price");
  });
});
