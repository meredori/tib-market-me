import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveAccessState } from "../access";
import { applyMigrations } from "../db/migrations";
import {
  createTaskboardEntry,
  deleteTaskboardEntry,
  listTaskboardEntries,
  updateTaskboardEntry
} from "./taskboard";

let db: Database.Database;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function createDb(): Database.Database {
  const database = new Database(":memory:");
  applyMigrations(database);
  return database;
}

function insertCreature(input: {
  id: number;
  name: string;
  placeId?: number;
  placeName?: string;
  chanceItem?: { id: number; name: string; chance: number; min?: number; max?: number };
}): void {
  const normalized = input.name.toLowerCase();
  db.prepare(`
    INSERT INTO public_creatures (
      id, name, normalized_name, bestiary_class, bestiary_category, bestiary_difficulty,
      last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, 'Demon', 'Bestiary', 'Medium', ?, ?, ?, '{}')
  `).run(input.id, input.name, normalized, isoHoursAgo(12), isoHoursAgo(12), isoHoursAgo(12));

  if (input.placeId && input.placeName) {
    db.prepare(`
      INSERT INTO public_hunting_places (
        id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
        bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
      ) VALUES (?, ?, ?, 'Darashia', 80, 200, 4, 3, 4, 'medium', ?, ?, ?, '{}')
    `).run(input.placeId, input.placeName, input.placeName.toLowerCase(), isoHoursAgo(12), isoHoursAgo(12), isoHoursAgo(12));
    db.prepare(`
      INSERT INTO public_hunting_place_creatures (
        hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
      ) VALUES (?, ?, ?, ?, 'common', '{}')
    `).run(input.placeId, input.id, input.name, normalized);
  }

  if (input.chanceItem) {
    db.prepare(`
      INSERT INTO public_creature_loot (
        creature_id, item_id, item_name, normalized_item_name, chance_percent,
        min_count, max_count, rarity, fetched_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'uncommon', ?, '{}')
    `).run(
      input.id,
      input.chanceItem.id,
      input.chanceItem.name,
      input.chanceItem.name.toLowerCase(),
      input.chanceItem.chance,
      input.chanceItem.min ?? 1,
      input.chanceItem.max ?? 1,
      isoHoursAgo(12)
    );
  }
}

function insertPlaceForCreature(input: {
  creatureId: number;
  creatureName: string;
  placeId: number;
  placeName: string;
  minLevel?: number;
  maxLevel?: number;
  risk?: string;
}): void {
  db.prepare(`
    INSERT INTO public_hunting_places (
      id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
      bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, 'Darashia', ?, ?, 4, 3, 4, ?, ?, ?, ?, '{}')
  `).run(
    input.placeId,
    input.placeName,
    input.placeName.toLowerCase(),
    input.minLevel ?? 80,
    input.maxLevel ?? 200,
    input.risk ?? "medium",
    isoHoursAgo(12),
    isoHoursAgo(12),
    isoHoursAgo(12)
  );
  db.prepare(`
    INSERT INTO public_hunting_place_creatures (
      hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
    ) VALUES (?, ?, ?, ?, 'common', '{}')
  `).run(input.placeId, input.creatureId, input.creatureName, input.creatureName.toLowerCase());
}

function insertHunt(input: {
  label: string;
  creature: string;
  count: number;
  duration: number;
  loot?: number;
  supplies?: number;
  placeId?: number;
  location?: string;
}): void {
  db.prepare(`
    INSERT INTO hunt_uploads (
      label, duration_minutes, total_xp, total_loot_gold, total_supply_cost, raw_text,
      processed_json, location_name, public_hunting_place_id
    ) VALUES (?, ?, 100000, ?, ?, '', ?, ?, ?)
  `).run(
    input.label,
    input.duration,
    input.loot ?? 10000,
    input.supplies ?? 0,
    JSON.stringify({ parsed: { monsters: [{ name: input.creature, count: input.count }] } }),
    input.location ?? null,
    input.placeId ?? null
  );
}

function insertMarketItem(input: { id: number; name: string; price: number; confidence?: number }): void {
  const run = db.prepare(`
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
    ) VALUES ('Antica', ?, ?, ?, ?, ?, 'test', 2, 1, 1, 'success')
  `).run(isoHoursAgo(2), isoHoursAgo(1), isoHoursAgo(1), isoHoursAgo(1), isoHoursAgo(1));
  const runId = Number(run.lastInsertRowid);
  db.prepare(`
    INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
    VALUES (?, ?, ?, 'creature product', '{}', ?)
  `).run(input.id, input.name, input.name, isoHoursAgo(1));
  db.prepare(`
    INSERT INTO market_item_features (run_id, item_id, upstream_time, sell_offer, buy_offer, month_sold, day_sold, sell_offers, active_traders)
    VALUES (?, ?, 1, ?, -1, 20, 2, 4, 2)
  `).run(runId, input.id, input.price);
  db.prepare(`
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
      client_value, confidence, source_run_count
    ) VALUES (?, ?, 'conservative_min', 'test', ?, ?, ?, ?, 5)
  `).run(runId, input.id, input.price, input.price, input.price, input.confidence ?? 0.8);
  db.prepare(`
    INSERT INTO item_market_history (item_id, server, source, snapshot_key, snapshot_at, payload_json, payload_hash, fetched_at)
    VALUES (?, 'Antica', 'sync', ?, ?, '{}', ?, ?)
  `).run(input.id, `snap-${input.id}`, isoHoursAgo(1), `hash-${input.id}`, isoHoursAgo(1));
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("weekly taskboard helper", () => {
  it("tracks creature entries by name and recommends a spawn", () => {
    insertCreature({ id: 10, name: "Dragon" });
    insertPlaceForCreature({ creatureId: 10, creatureName: "Dragon", placeId: 19, placeName: "Small Dragon Cave", minLevel: 30, maxLevel: 60, risk: "low" });
    insertPlaceForCreature({ creatureId: 10, creatureName: "Dragon", placeId: 20, placeName: "Dragon Lair", minLevel: 80, maxLevel: 200, risk: "medium" });
    insertPlaceForCreature({ creatureId: 10, creatureName: "Dragon", placeId: 21, placeName: "Ancient Dragon Peak", minLevel: 150, maxLevel: 300, risk: "high" });
    insertHunt({ label: "Fast Dragons", creature: "Dragon", count: 120, duration: 60, placeId: 20, location: "Dragon Lair" });

    const created = createTaskboardEntry(db, {
      entry_type: "creature",
      name: "Dragon"
    }).item as Record<string, any>;

    expect(created.required_quantity).toBeNull();
    expect(created.public_creature_id).toBe(10);
    expect(created.matched_name).toBe("Dragon");
    expect(created.guidance.recommendation).toBe("Hunt Dragon Lair");
    expect(created.guidance.best_spawn).toMatchObject({ id: 20, name: "Dragon Lair" });
    expect(created.guidance.personal_pace).toMatchObject({ kills_per_hour: 120, label: "Fast Dragons" });
    expect(created.guidance.known_hunting_places.map((place: Record<string, unknown>) => place.name)).toEqual([
      "Dragon Lair",
      "Ancient Dragon Peak",
      "Small Dragon Cave"
    ]);
    expect(created.guidance.known_hunting_places[0].personal_pace).toMatchObject({ kills_per_hour: 120 });
    expect(created.guidance.known_hunting_places[1]).toMatchObject({ floor_level: 150, difficulty_level: 300, personal_pace: null });
    expect(created.guidance.known_hunting_places[0].access).toMatchObject({ state: "unknown", label: "Access unknown" });
  });

  it("surfaces access labels on taskboard hunting-place suggestions", () => {
    insertCreature({ id: 10, name: "Dragon" });
    insertPlaceForCreature({ creatureId: 10, creatureName: "Dragon", placeId: 20, placeName: "Dragon Lair" });
    saveAccessState(db, {
      entity_type: "hunting_place",
      entity_id: 20,
      state: "unavailable"
    });

    const created = createTaskboardEntry(db, {
      entry_type: "creature",
      name: "Dragon"
    }).item as Record<string, any>;

    expect(created.guidance.best_spawn.access).toMatchObject({ state: "unavailable", label: "Access unavailable" });
    expect(created.guidance.known_hunting_places[0].access.blockers[0].label).toBe("access unavailable");
  });

  it("estimates buy-vs-farm for item entries from price and drop chance", () => {
    insertMarketItem({ id: 100, name: "Medicine Pouch", price: 400 });
    insertCreature({
      id: 12,
      name: "Nomad",
      placeId: 22,
      placeName: "Nomad Cave",
      chanceItem: { id: 100, name: "Medicine Pouch", chance: 2.5 }
    });

    const created = createTaskboardEntry(db, {
      entry_type: "item",
      name: "Medicine Pouch",
      required_quantity: 25
    }).item as Record<string, any>;

    expect(created.item_id).toBe(100);
    expect(created.matched_name).toBe("Medicine Pouch");
    expect(created.guidance.market_buy_cost).toBe(10000);
    expect(created.guidance.estimated_kills_needed).toBe(1000);
    expect(created.guidance.recommendation).toBe("Buy from market");
    expect(created.guidance.best_drop_creature).toMatchObject({ name: "Nomad", chance_percent: 2.5 });
    expect(created.guidance.hunting_places[0]).toMatchObject({ name: "Nomad Cave", access: expect.objectContaining({ state: "unknown" }) });
  });

  it("finds a rough farming break-even from personal profit per kill", () => {
    insertMarketItem({ id: 101, name: "Rare Token", price: 5000 });
    insertCreature({
      id: 13,
      name: "Cultist",
      placeId: 23,
      placeName: "Cults",
      chanceItem: { id: 101, name: "Rare Token", chance: 10 }
    });
    insertHunt({ label: "Cult profit", creature: "Cultist", count: 100, duration: 60, loot: 100000, supplies: 0, placeId: 23 });

    const created = createTaskboardEntry(db, {
      entry_type: "item",
      name: "Rare Token",
      required_quantity: 10
    }).item as Record<string, any>;

    expect(created.guidance.estimated_kills_needed).toBe(100);
    expect(created.guidance.break_even_unit_price).toBe(10000);
    expect(created.guidance.recommendation).toBe("Buy from market");
  });

  it("surfaces combine hints when an item drops from another weekly creature", () => {
    insertMarketItem({ id: 100, name: "Medicine Pouch", price: 400 });
    insertCreature({
      id: 12,
      name: "Nomad",
      placeId: 22,
      placeName: "Nomad Cave",
      chanceItem: { id: 100, name: "Medicine Pouch", chance: 2.5 }
    });
    createTaskboardEntry(db, { entry_type: "creature", name: "Nomad" });
    const item = createTaskboardEntry(db, { entry_type: "item", name: "Medicine Pouch", required_quantity: 10 }).item as Record<string, any>;

    expect(item.guidance.combine_hints[0]).toMatchObject({ name: "Nomad" });
  });

  it("updates and deletes weekly entries without status/history state", () => {
    const created = createTaskboardEntry(db, { entry_type: "item", name: "Old Item" }).item as Record<string, any>;
    const updated = updateTaskboardEntry(db, created.id, { entry_type: "item", name: "New Item", required_quantity: 12 }) as Record<string, any>;

    expect(updated.item).toMatchObject({ offer_text: "New Item", name: "New Item", required_quantity: 12 });
    expect(deleteTaskboardEntry(db, created.id)).toBe(true);
    expect((listTaskboardEntries(db).items as unknown[])).toHaveLength(0);
  });
});
