import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../config";
import { applyMigrations } from "../db/migrations";
import { getHuntingPlaceDetail, listHuntingPlaces } from "./intelligence";

let db: Database.Database;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function createDb(): Database.Database {
  const database = new Database(":memory:");
  applyMigrations(database);
  return database;
}

function seedPlace(id = 100): void {
  db.prepare(
    `
    INSERT INTO public_hunting_places (
      id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
      bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, 'Dragon Lair', 'dragon lair', 'Venore', 80, 160, 3, 4, 2, 'medium', ?, ?, ?, '{}')
    `
  ).run(id, isoHoursAgo(8), isoHoursAgo(8), isoHoursAgo(8));
}

function seedCreature(id = 200): void {
  db.prepare(
    `
    INSERT INTO public_creatures (
      id, name, normalized_name, hitpoints, experience, bestiary_class, bestiary_category,
      bestiary_difficulty, charm_points, total_kills, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, 'Dragon', 'dragon', 1000, 700, 'Dragon', 'Reptile', 'Medium', 25, 1000, ?, ?, ?, '{}')
    `
  ).run(id, isoHoursAgo(6), isoHoursAgo(6), isoHoursAgo(6));
  db.prepare(
    `
    INSERT INTO public_hunting_place_creatures (
      hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
    ) VALUES (100, ?, 'Dragon', 'dragon', 'common', '{}')
    `
  ).run(id);
}

function seedMarket(itemId = 300): number {
  const inserted = db.prepare(
    `
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
    ) VALUES ('Antica', ?, ?, ?, ?, ?, 'test', 2, 1, 1, 'success')
    `
  ).run(isoHoursAgo(5), isoHoursAgo(4), isoHoursAgo(4), isoHoursAgo(4), isoHoursAgo(4));
  const runId = Number(inserted.lastInsertRowid);
  db.prepare(
    `
    INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
    VALUES (?, 'Dragon Ham', 'Dragon Ham', 'loot', '{}', ?)
    `
  ).run(itemId, isoHoursAgo(4));
  db.prepare(
    `
    INSERT INTO market_item_features (
      run_id, item_id, upstream_time, sell_offer, buy_offer, month_sold, day_sold,
      month_highest_sell, day_highest_sell, sell_offers, active_traders
    ) VALUES (?, ?, 1, 100, 80, 30, 2, 120, 110, 10, 4)
    `
  ).run(runId, itemId);
  db.prepare(
    `
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
      client_value, trend, trend_score, liquidity, confidence
    ) VALUES (?, ?, ?, 'test', 100, 110, 100, 'stable', 0, 0.8, 0.9)
    `
  ).run(runId, itemId, config.pricingModel);
  return runId;
}

function seedMarketItem(runId: number, itemId: number, name: string, price: number): void {
  db.prepare(
    `
    INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
    VALUES (?, ?, ?, 'loot', '{}', ?)
    `
  ).run(itemId, name, name, isoHoursAgo(4));
  db.prepare(
    `
    INSERT INTO market_item_features (
      run_id, item_id, upstream_time, sell_offer, buy_offer, month_sold, day_sold,
      month_highest_sell, day_highest_sell, sell_offers, active_traders
    ) VALUES (?, ?, 1, ?, ?, 30, 2, ?, ?, 10, 4)
    `
  ).run(runId, itemId, price, Math.max(1, price - 10), price, price);
  db.prepare(
    `
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
      client_value, trend, trend_score, liquidity, confidence
    ) VALUES (?, ?, ?, 'test', ?, ?, ?, 'stable', 0, 0.8, 0.9)
    `
  ).run(runId, itemId, config.pricingModel, price, price, price);
}

function seedLoot(itemId = 300): void {
  db.prepare(
    `
    INSERT INTO public_creature_loot (
      creature_id, item_id, item_name, normalized_item_name, chance_percent, min_count, max_count,
      rarity, amount_text, fetched_at, payload_json
    ) VALUES (200, ?, 'Dragon Ham', 'dragon ham', 50, 1, 2, 'common', '1-2', ?, '{}')
    `
  ).run(itemId, isoHoursAgo(5));
}

function seedLootItem(input: {
  creatureId?: number;
  itemId: number;
  name: string;
  normalizedName: string;
  chancePercent: number;
  minCount?: number;
  maxCount?: number;
  rarity?: string;
  amountText?: string;
}): void {
  db.prepare(
    `
    INSERT INTO public_creature_loot (
      creature_id, item_id, item_name, normalized_item_name, chance_percent, min_count, max_count,
      rarity, amount_text, fetched_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')
    `
  ).run(
    input.creatureId ?? 200,
    input.itemId,
    input.name,
    input.normalizedName,
    input.chancePercent,
    input.minCount ?? 1,
    input.maxCount ?? 1,
    input.rarity ?? "rare",
    input.amountText ?? "1",
    isoHoursAgo(5)
  );
}

function seedHunt(input: Partial<{
  id: number;
  label: string;
  duration: number;
  xp: number;
  loot: number;
  supplies: number;
  placeId: number | null;
  mode: string;
  status: string;
  confidence: number;
  startedAt: string;
}> = {}): void {
  db.prepare(
    `
    INSERT INTO hunt_uploads (
      id, label, duration_minutes, raw_total_xp, total_xp, total_loot_gold, total_supply_cost,
      started_at, ended_at, uploaded_at, tags_json, excluded_items_json, raw_text, processed_json,
      location_name, public_hunting_place_id, hunting_place_confidence, hunting_place_match_status,
      hunting_place_match_mode, hunting_place_match_readiness, hunting_place_match_manual
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', '', '{}', ?, ?, ?, ?, ?, 'matched', 0)
    `
  ).run(
    input.id ?? 1,
    input.label ?? "Saved Dragon Hunt",
    input.duration ?? 60,
    input.xp ?? 100000,
    input.xp ?? 100000,
    input.loot ?? 50000,
    input.supplies ?? 10000,
    input.startedAt ?? isoHoursAgo(2),
    input.startedAt ?? isoHoursAgo(1),
    input.startedAt ?? isoHoursAgo(1),
    input.placeId === null ? "Custom Route" : "Dragon Lair",
    input.placeId === undefined ? 100 : input.placeId,
    input.confidence ?? 0.9,
    input.status ?? "matched",
    input.mode ?? "auto"
  );
}

function seedPublicHunt(placeId = 100): void {
  db.prepare(
    `
    INSERT INTO public_hunt_sessions (
      source, source_session_id, source_url, title, imported_at, refreshed_at, raw_html,
      payload_fingerprint, parse_status, review_status, suspicious_status, parsed_confidence,
      duration_minutes, party_size, party_json, total_xp, raw_total_xp, xp_per_hour,
      raw_xp_per_hour, balance_gold, profit_per_hour, public_hunting_place_id,
      hunting_place_confidence, hunting_place_match_status, hunting_place_match_readiness
    ) VALUES (
      'hunt-analyser', 'session-1', 'https://example.test/session-1', 'Public Dragon Hunt',
      ?, ?, '<html></html>', 'fingerprint-1', 'parsed', 'accepted', 'clear', 0.9,
      60, 1, '[{"vocation":"Knight","level":120}]', 100000, 100000, 100000,
      100000, 50000, 50000, ?, 0.9, 'auto', 'auto'
    )
    `
  ).run(isoHoursAgo(2), isoHoursAgo(2), placeId);
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("hunting place intelligence", () => {
  it("aggregates canonical detail by public_hunting_place_id", () => {
    seedPlace();
    seedCreature();
    seedMarket();
    seedLoot();
    seedHunt();

    const detail = getHuntingPlaceDetail(db, 100);

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.place.public_hunting_place_id).toBe(100);
    expect(detail.reference.creatures[0]).toMatchObject({
      public_creature_id: 200,
      normalized_creature_name: "dragon"
    });
    expect(detail.reference.expected_loot[0]).toMatchObject({
      item_id: 300,
      normalized_item_name: "dragon ham",
      estimated_unit_value: 100
    });
    expect(detail.personal.summary).toMatchObject({
      hunt_count: 1,
      best_xp_per_hour: 100000,
      best_profit_per_hour: 40000
    });
  });

  it("keeps personal observed hunts separate from public expected loot", () => {
    seedPlace();
    seedCreature();
    seedMarket();
    seedLoot();
    seedHunt({ loot: 75000, supplies: 25000 });

    const detail = getHuntingPlaceDetail(db, 100);

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.reference.market_weighted_loot_value.total_estimated_value).toBe(75);
    expect(detail.personal.summary.total_profit).toBe(50000);
    expect(detail.reference.expected_loot[0].provenance.map((entry) => entry.type)).toContain("public_tibia_reference");
    expect(detail.personal.hunts[0].provenance.map((entry) => entry.type)).toEqual(["personal_hunt"]);
  });

  it("exposes market-weighted loot confidence and freshness", () => {
    seedPlace();
    seedCreature();
    seedMarket();
    seedLoot();

    const detail = getHuntingPlaceDetail(db, 100);

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.reference.market_weighted_loot_value).toMatchObject({
      priced_item_count: 1,
      total_item_count: 1,
      confidence: expect.objectContaining({ level: "high" }),
      freshness: expect.objectContaining({ status: "fresh" })
    });
    expect(detail.reference.expected_loot[0].confidence).toMatchObject({ level: "high" });
  });

  it("sorts expected loot by market-weighted value", () => {
    seedPlace();
    seedCreature();
    const runId = seedMarket();
    seedMarketItem(runId, 301, "Dragon Shield", 2000);
    seedLoot();
    seedLootItem({
      itemId: 301,
      name: "Dragon Shield",
      normalizedName: "dragon shield",
      chancePercent: 5
    });

    const detail = getHuntingPlaceDetail(db, 100);

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.reference.expected_loot.map((item) => item.normalized_item_name)).toEqual([
      "dragon shield",
      "dragon ham"
    ]);
    expect(detail.reference.expected_loot.map((item) => item.estimated_drop_value)).toEqual([100, 75]);
  });

  it("excludes custom and mixed-route hunts from personal place metrics", () => {
    seedPlace();
    seedCreature();
    seedHunt({ id: 1, placeId: 100, mode: "auto", xp: 120000 });
    seedHunt({ id: 2, placeId: null, status: "unmatched", xp: 900000 });
    seedHunt({ id: 3, placeId: 100, mode: "mixed_route", status: "mixed_route", xp: 800000 });

    const detail = getHuntingPlaceDetail(db, 100);

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.personal.hunts.map((hunt) => hunt.id)).toEqual([1]);
    expect(detail.personal.summary.best_xp_per_hour).toBe(120000);
  });

  it("returns stable empty and unenriched states", () => {
    seedPlace();

    const detail = getHuntingPlaceDetail(db, 100);

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      return;
    }
    expect(detail.reference.creatures).toEqual([]);
    expect(detail.reference.expected_loot).toEqual([]);
    expect(detail.reference.market_weighted_loot_value).toMatchObject({
      total_estimated_value: 0,
      priced_item_count: 0,
      total_item_count: 0,
      freshness: expect.objectContaining({ status: "missing" })
    });
    expect(detail.personal.summary).toMatchObject({
      hunt_count: 0,
      best_xp_per_hour: null
    });
    expect(detail.integrations.bestiary).toMatchObject({
      status: "available",
      available: true,
      summary: expect.objectContaining({ matching_creatures: 0 })
    });
    expect(detail.integrations.taskboard).toMatchObject({
      status: "available",
      available: true,
      summary: expect.objectContaining({ matching_tasks: 0 })
    });
    expect(detail.data_quality.explanations.map((entry) => entry.label)).toEqual(expect.arrayContaining([
      "loot not enriched",
      "no personal hunts",
      "creatures missing"
    ]));
  });

  it("lists hunting places with personal and public hunt filters", () => {
    seedPlace();
    seedCreature();
    seedLoot();
    seedHunt();
    seedPublicHunt();

    const all = listHuntingPlaces(db);
    expect(all.items[0]).toMatchObject({
      public_hunting_place_id: 100,
      name: "Dragon Lair",
      min_level: 80,
      max_level: 160,
      risk_level: "medium",
      personal_hunt_count: 1,
      public_hunt_count: 1,
      creature_count: 1,
      expected_loot_count: 1
    });

    expect(listHuntingPlaces(db, { q: "dragon", has_personal_hunts: true }).items).toHaveLength(1);
    expect(listHuntingPlaces(db, { q: "dragon", has_public_hunts: true }).items).toHaveLength(1);
    expect(listHuntingPlaces(db, { q: "missing", has_public_hunts: true }).items).toHaveLength(0);
  });
});
