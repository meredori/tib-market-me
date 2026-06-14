import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrations";
import {
  createTaskboardTask,
  listTaskboardTasks,
  updateTaskboardTask
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
  chanceItem?: { id: number; name: string; chance: number };
}): void {
  const normalized = input.name.toLowerCase();
  db.prepare(
    `
    INSERT INTO public_creatures (
      id, name, normalized_name, bestiary_class, bestiary_category, bestiary_difficulty,
      last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, 'Demon', 'Bestiary', 'Medium', ?, ?, ?, '{}')
    `
  ).run(input.id, input.name, normalized, isoHoursAgo(12), isoHoursAgo(12), isoHoursAgo(12));

  if (input.placeId && input.placeName) {
    db.prepare(
      `
      INSERT INTO public_hunting_places (
        id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
        bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
      ) VALUES (?, ?, ?, 'Darashia', 80, 200, 3, 2, 4, 'medium', ?, ?, ?, '{}')
      `
    ).run(input.placeId, input.placeName, input.placeName.toLowerCase(), isoHoursAgo(12), isoHoursAgo(12), isoHoursAgo(12));
    db.prepare(
      `
      INSERT INTO public_hunting_place_creatures (
        hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
      ) VALUES (?, ?, ?, ?, 'common', '{}')
      `
    ).run(input.placeId, input.id, input.name, normalized);
  }

  if (input.chanceItem) {
    db.prepare(
      `
      INSERT INTO public_creature_loot (
        creature_id, item_id, item_name, normalized_item_name, chance_percent, rarity, fetched_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, 'uncommon', ?, '{}')
      `
    ).run(
      input.id,
      input.chanceItem.id,
      input.chanceItem.name,
      input.chanceItem.name.toLowerCase(),
      input.chanceItem.chance,
      isoHoursAgo(12)
    );
  }
}

function insertHunt(input: {
  label: string;
  creature: string;
  count: number;
  duration: number;
  placeId?: number;
  location?: string;
}): number {
  const result = db.prepare(
    `
    INSERT INTO hunt_uploads (
      label, duration_minutes, total_xp, total_loot_gold, total_supply_cost, raw_text,
      processed_json, location_name, public_hunting_place_id
    ) VALUES (?, ?, 1000, 100, 0, '', ?, ?, ?)
    `
  ).run(
    input.label,
    input.duration,
    JSON.stringify({
      parsed: { monsters: [{ name: input.creature, count: input.count }] },
      monsters: []
    }),
    input.location ?? null,
    input.placeId ?? null
  );
  return Number(result.lastInsertRowid);
}

function insertMarketItem(input: { id: number; name: string; price: number; confidence?: number }): void {
  const run = db.prepare(
    `
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
    ) VALUES ('Antica', ?, ?, ?, ?, ?, 'test', 2, 1, 1, 'success')
    `
  ).run(isoHoursAgo(2), isoHoursAgo(1), isoHoursAgo(1), isoHoursAgo(1), isoHoursAgo(1));
  const runId = Number(run.lastInsertRowid);
  db.prepare(
    `
    INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
    VALUES (?, ?, ?, 'creature product', '{}', ?)
    `
  ).run(input.id, input.name, input.name, isoHoursAgo(1));
  db.prepare(
    `
    INSERT INTO market_item_features (run_id, item_id, upstream_time, sell_offer, buy_offer, month_sold, day_sold, sell_offers, active_traders)
    VALUES (?, ?, 1, ?, -1, 20, 2, 4, 2)
    `
  ).run(runId, input.id, input.price);
  db.prepare(
    `
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
      client_value, confidence, source_run_count
    ) VALUES (?, ?, 'conservative_min', 'test', ?, ?, ?, ?, 5)
    `
  ).run(runId, input.id, input.price, input.price, input.price, input.confidence ?? 0.8);
  db.prepare(
    `
    INSERT INTO item_market_history (item_id, server, source, snapshot_key, snapshot_at, payload_json, payload_hash, fetched_at)
    VALUES (?, 'Antica', 'sync', ?, ?, '{}', ?, ?)
    `
  ).run(input.id, `snap-${input.id}`, isoHoursAgo(1), `hash-${input.id}`, isoHoursAgo(1));
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("taskboard helper", () => {
  it("classifies creature tasks with public places and personal kills/hour", () => {
    insertCreature({ id: 10, name: "Dragon", placeId: 20, placeName: "Dragon Lair" });
    insertHunt({ label: "Fast Dragons", creature: "Dragon", count: 120, duration: 60, placeId: 20, location: "Dragon Lair" });

    const created = createTaskboardTask(db, {
      task_type: "creature",
      title: "Dragon",
      public_creature_id: 10,
      desired_quantity: 120,
      difficulty: "medium",
      category: "bestiary"
    }).item as Record<string, any>;

    expect(created.guidance.practical_labels).toContain("good task");
    expect(created.guidance.practical_labels).toContain("easy completion");
    expect(created.guidance.known_hunting_places[0]).toMatchObject({ id: 20, name: "Dragon Lair" });
    expect(created.guidance.best_personal_place).toMatchObject({ kills_per_hour: 120, label: "Fast Dragons" });
    expect(created.guidance.expected_completion.label).toBe("0.8-1.4h");
    expect(created.guidance.confidence.level).toBe("high");
  });

  it("uses personal KPH and falls back to public place guidance when history is missing", () => {
    insertCreature({ id: 11, name: "Werehyaena", placeId: 21, placeName: "Werehyaena Cave" });

    const withoutHistory = createTaskboardTask(db, {
      task_type: "creature",
      title: "Werehyaena",
      public_creature_id: 11,
      desired_quantity: 240
    }).item as Record<string, any>;
    expect(withoutHistory.guidance.practical_labels).toContain("unknown");
    expect(withoutHistory.guidance.confidence.missing_data_reason).toContain("kills/hour");

    insertHunt({ label: "Hyena route", creature: "Werehyaena", count: 180, duration: 90, placeId: 21, location: "Werehyaena Cave" });
    const listed = listTaskboardTasks(db).items as Array<Record<string, any>>;
    expect(listed[0].guidance.best_personal_place.kills_per_hour).toBe(120);
    expect(listed[0].guidance.expected_completion.label).toBe("1.6-2.7h");
  });

  it("labels cheap delivery tasks as buy instead of farming", () => {
    insertMarketItem({ id: 100, name: "Medicine Pouch", price: 400 });
    insertCreature({
      id: 12,
      name: "Nomad",
      placeId: 22,
      placeName: "Nomad Cave",
      chanceItem: { id: 100, name: "Medicine Pouch", chance: 2.5 }
    });

    const created = createTaskboardTask(db, {
      task_type: "delivery_item",
      title: "Medicine Pouch",
      item_id: 100,
      item_name: "Medicine Pouch",
      desired_quantity: 25
    }).item as Record<string, any>;

    expect(created.guidance.market_buy_cost).toBe(10000);
    expect(created.guidance.practical_labels).toContain("buy item instead of farming");
    expect(created.guidance.practical_labels).toContain("easy completion");
    expect(created.guidance.dropping_creatures[0]).toMatchObject({ name: "Nomad", chance_percent: 2.5 });
    expect(created.guidance.hunting_places[0]).toMatchObject({ name: "Nomad Cave" });
  });

  it("labels expensive delivery tasks as farm candidates when drop data exists", () => {
    insertMarketItem({ id: 101, name: "Rare Token", price: 15000 });
    insertCreature({
      id: 13,
      name: "Cultist",
      placeId: 23,
      placeName: "Cults",
      chanceItem: { id: 101, name: "Rare Token", chance: 8 }
    });

    const created = createTaskboardTask(db, {
      task_type: "delivery_item",
      title: "Rare Token",
      item_id: 101,
      item_name: "Rare Token",
      desired_quantity: 10
    }).item as Record<string, any>;

    expect(created.guidance.market_buy_cost).toBe(150000);
    expect(created.guidance.practical_labels).toContain("farm item instead of buying");
    expect(created.guidance.confidence.level).toBe("high");
  });

  it("surfaces missing-data states and persists task history", () => {
    const created = createTaskboardTask(db, {
      task_type: "creature",
      title: "Mystery Beast",
      desired_quantity: 100,
      character_name: "Knight Tester",
      notes: "Check after data enrichment"
    }).item as Record<string, any>;

    expect(created.guidance.practical_labels).toContain("unknown");
    expect(created.guidance.practical_labels).toContain("skip/reroll");
    expect(created.guidance.confidence.level).toBe("low");
    expect(created.events).toHaveLength(1);
    expect(created.events[0]).toMatchObject({ event_type: "created", status_to: "planned" });

    const huntId = insertHunt({ label: "Manual follow-up", creature: "Mystery Beast", count: 10, duration: 30 });
    const updated = updateTaskboardTask(db, created.id, {
      status: "active",
      completed_quantity: 10,
      linked_hunt_id: huntId,
      event_notes: "Started it"
    }) as Record<string, any>;

    expect(updated.item.status).toBe("active");
    expect(updated.item.completed_quantity).toBe(10);
    expect(updated.item.events[0]).toMatchObject({
      event_type: "status_changed",
      status_from: "planned",
      status_to: "active",
      quantity_delta: 10,
      linked_hunt_id: huntId
    });
  });
});
