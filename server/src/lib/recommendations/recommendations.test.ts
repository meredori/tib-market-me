import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../config";
import { applyMigrations } from "../db/migrations";
import { listHuntRecommendations, saveRecommendationFeedback } from "./index";
import type { RecommendationMode } from "./types";

let db: Database.Database;

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function createDb(): Database.Database {
  const database = new Database(":memory:");
  applyMigrations(database);
  return database;
}

function insertPlace(input: {
  id: number;
  name: string;
  creatureId: number;
  creature: string;
  risk: string;
  minLevel: number;
  maxLevel: number;
  exp: number;
  loot: number;
  itemId?: number;
  item?: string;
  itemChance?: number;
}): void {
  db.prepare(`
    INSERT INTO public_hunting_places (
      id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
      bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, 'Darashia', ?, ?, ?, ?, 3, ?, ?, ?, ?, '{}')
  `).run(
    input.id,
    input.name,
    input.name.toLowerCase(),
    input.minLevel,
    input.maxLevel,
    input.exp,
    input.loot,
    input.risk,
    isoHoursAgo(8),
    isoHoursAgo(8),
    isoHoursAgo(8)
  );
  db.prepare(`
    INSERT INTO public_creatures (
      id, name, normalized_name, hitpoints, experience, bestiary_class, bestiary_category,
      bestiary_difficulty, charm_points, total_kills, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, 1000, ?, 'Demon', 'Bestiary', 'Medium', 25, 1000, ?, ?, ?, '{}')
  `).run(input.creatureId, input.creature, input.creature.toLowerCase(), input.exp * 250, isoHoursAgo(8), isoHoursAgo(8), isoHoursAgo(8));
  db.prepare(`
    INSERT INTO public_hunting_place_creatures (
      hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
    ) VALUES (?, ?, ?, ?, 'common', '{}')
  `).run(input.id, input.creatureId, input.creature, input.creature.toLowerCase());
  if (input.itemId && input.item) {
    db.prepare(`
      INSERT INTO public_creature_loot (
        creature_id, item_id, item_name, normalized_item_name, chance_percent,
        min_count, max_count, rarity, fetched_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, 1, 1, 'common', ?, '{}')
    `).run(input.creatureId, input.itemId, input.item, input.item.toLowerCase(), input.itemChance ?? 10, isoHoursAgo(8));
  }
}

function insertMarket(items: Array<{ id: number; name: string; value: number; confidence?: number }>): void {
  const run = db.prepare(`
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, market_row_count, priced_item_count, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'test', 2, ?, ?, 'success')
  `).run(config.serverName, isoHoursAgo(2), isoHoursAgo(1), isoHoursAgo(1), isoHoursAgo(1), isoHoursAgo(1), items.length, items.length);
  const runId = Number(run.lastInsertRowid);
  for (const item of items) {
    db.prepare(`
      INSERT INTO item_metadata (item_id, name, wiki_name, category, raw_payload_json, fetched_at)
      VALUES (?, ?, ?, 'loot', '{}', ?)
    `).run(item.id, item.name, item.name, isoHoursAgo(1));
    db.prepare(`
      INSERT INTO market_item_prices (
        run_id, item_id, pricing_model, pricing_model_version, fair_price, suggested_list_price,
        client_value, trend, trend_score, liquidity, confidence
      ) VALUES (?, ?, ?, 'test', ?, ?, ?, 'stable', 0, 0.8, ?)
    `).run(runId, item.id, config.pricingModel, item.value, item.value, item.value, item.confidence ?? 0.85);
  }
}

function insertHunt(placeId: number, input: { label: string; duration: number; xp: number; loot: number; supplies: number; character?: string }): void {
  db.prepare(`
    INSERT INTO hunt_uploads (
      label, duration_minutes, total_xp, total_loot_gold, total_supply_cost, raw_text,
      processed_json, location_name, public_hunting_place_id, character_name
    ) VALUES (?, ?, ?, ?, ?, '', '{}', ?, ?, ?)
  `).run(input.label, input.duration, input.xp, input.loot, input.supplies, input.label, placeId, input.character ?? null);
}

function seedBaseline(): void {
  insertPlace({ id: 10, name: "Dragon Lair", creatureId: 100, creature: "Dragon", risk: "medium", minLevel: 80, maxLevel: 180, exp: 3, loot: 4, itemId: 300, item: "Dragon Shield", itemChance: 12 });
  insertPlace({ id: 20, name: "Quiet Rotworm Cave", creatureId: 200, creature: "Rotworm", risk: "low", minLevel: 20, maxLevel: 60, exp: 1, loot: 1, itemId: 301, item: "Worm Pearl", itemChance: 15 });
  insertPlace({ id: 30, name: "Demon Forge", creatureId: 300, creature: "Demon", risk: "high", minLevel: 180, maxLevel: 350, exp: 5, loot: 5, itemId: 302, item: "Magic Plate Armor", itemChance: 8 });
  insertMarket([
    { id: 300, name: "Dragon Shield", value: 1200, confidence: 0.8 },
    { id: 301, name: "Worm Pearl", value: 60, confidence: 0.8 },
    { id: 302, name: "Magic Plate Armor", value: 90000, confidence: 0.9 }
  ]);
  insertHunt(10, { label: "Dragon Lair", duration: 60, xp: 360000, loot: 60000, supplies: 10000, character: "Knight One" });
  insertHunt(20, { label: "Quiet Rotworm Cave", duration: 25, xp: 40000, loot: 6000, supplies: 500, character: "Knight One" });
  db.prepare(`
    INSERT INTO taskboard_entries (
      entry_type, offer_text, normalized_offer_text, matched_name, normalized_name, public_creature_id
    ) VALUES ('creature', 'Dragon', 'dragon', 'Dragon', 'dragon', 100)
  `).run();
  db.prepare(`
    INSERT INTO bestiary_states (
      public_creature_id, normalized_creature_name, creature_name, state, current_kill_count, target_kill_count
    ) VALUES (100, 'dragon', 'Dragon', 'in_progress', 500, 1000)
  `).run();
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("hunt recommendations", () => {
  it("returns explainable recommendations for every mode", () => {
    seedBaseline();
    const modes: RecommendationMode[] = ["profit", "xp", "balanced", "bestiary", "taskboard", "safe", "short_session", "revisit", "new"];

    for (const mode of modes) {
      const result = listHuntRecommendations(db, { mode, character_level: 120, character_name: "Knight One" }) as Record<string, any>;
      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items[0]).toMatchObject({
        mode,
        confidence: expect.objectContaining({ level: expect.any(String) }),
        freshness: expect.objectContaining({ status: expect.any(String) }),
        explanations: expect.objectContaining({ reasons: expect.any(Array), warnings: expect.any(Array) })
      });
      expect(result.items[0].expected_profit.label || result.items[0].expected_profit.missing_data_reason).toBeTruthy();
      expect(result.items[0].expected_xp.label || result.items[0].expected_xp.missing_data_reason).toBeTruthy();
    }
  });

  it("changes ranking by mode without hiding missing data", () => {
    seedBaseline();

    const safe = listHuntRecommendations(db, { mode: "safe", character_level: 45 }) as Record<string, any>;
    expect(safe.items[0].place.name).toBe("Quiet Rotworm Cave");

    const taskboard = listHuntRecommendations(db, { mode: "taskboard", character_level: 120 }) as Record<string, any>;
    expect(taskboard.items[0].place.name).toBe("Dragon Lair");
    expect(taskboard.items[0].taskboard_relevance.entries).toContain("Dragon");

    const profit = listHuntRecommendations(db, { mode: "profit", character_level: 220 }) as Record<string, any>;
    expect(profit.items[0].place.name).toBe("Demon Forge");

    db.prepare("DELETE FROM market_item_prices").run();
    const missingMarket = listHuntRecommendations(db, { mode: "profit", character_level: 120 }) as Record<string, any>;
    expect(missingMarket.items.some((item: Record<string, any>) => item.missing_data.includes("No priced loot estimate."))).toBe(true);
  });

  it("stores feedback and uses it to reduce or block future recommendations", () => {
    seedBaseline();
    const before = listHuntRecommendations(db, { mode: "profit", character_level: 220 }) as Record<string, any>;
    expect(before.items[0].place.name).toBe("Demon Forge");

    const saved = saveRecommendationFeedback(db, {
      recommendation_signature: before.items[0].signature,
      public_hunting_place_id: 30,
      mode: "profit",
      action: "access_unavailable",
      character_level: 220
    });
    expect(saved).toMatchObject({ ok: true });

    const after = listHuntRecommendations(db, { mode: "profit", character_level: 220 }) as Record<string, any>;
    const demon = after.items.find((item: Record<string, any>) => item.place.name === "Demon Forge");
    expect(demon.access_warning).toBe("unavailable");
    expect(after.items[0].place.name).not.toBe("Demon Forge");
  });
});
