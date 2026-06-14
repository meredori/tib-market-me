import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrations";
import { listBestiaryProgress, listHuntCharmRelevance, upsertBestiaryState } from "./index";

let db: Database.Database;

function createDb(): Database.Database {
  const database = new Database(":memory:");
  applyMigrations(database);
  return database;
}

function insertCreature(input: {
  id: number;
  name: string;
  totalKills: number;
  charmPoints?: number;
  difficulty?: string;
}): void {
  db.prepare(
    `
    INSERT INTO public_creatures (
      id, name, normalized_name, bestiary_class, bestiary_category, bestiary_difficulty,
      charm_points, total_kills, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (?, ?, ?, 'Beast', 'Tibia', ?, ?, ?, '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '{}')
    `
  ).run(input.id, input.name, input.name.toLowerCase(), input.difficulty ?? "Medium", input.charmPoints ?? 25, input.totalKills);
}

function insertHuntingPlace(id: number, name: string): void {
  db.prepare(
    `
    INSERT INTO public_hunting_places (id, name, normalized_name, fetched_at, payload_json)
    VALUES (?, ?, ?, '2026-06-01T00:00:00.000Z', '{}')
    `
  ).run(id, name, name.toLowerCase());
}

function insertHunt(input: {
  label: string;
  uploadedAt: string;
  durationMinutes: number;
  locationName?: string | null;
  huntingPlaceId?: number | null;
  characterName?: string | null;
  monsters: Array<{ name: string; count: number }>;
}): void {
  db.prepare(
    `
    INSERT INTO hunt_uploads (
      label, duration_minutes, total_xp, total_loot_gold, total_supply_cost,
      uploaded_at, location_name, character_name, public_hunting_place_id, processed_json
    ) VALUES (?, ?, 1, 1, 0, ?, ?, ?, ?, ?)
    `
  ).run(
    input.label,
    input.durationMinutes,
    input.uploadedAt,
    input.locationName ?? null,
    input.characterName ?? null,
    input.huntingPlaceId ?? null,
    JSON.stringify({ parsed: { monsters: input.monsters, loot_items: [] }, monsters: input.monsters })
  );
}

function items(): Array<Record<string, unknown>> {
  return listBestiaryProgress(db).items as Array<Record<string, unknown>>;
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("bestiary progress", () => {
  it("persists manual state with account and character scope", () => {
    insertCreature({ id: 10, name: "Dragon", totalKills: 1000 });

    upsertBestiaryState(db, {
      public_creature_id: 10,
      creature_name: "Dragon",
      scope_type: "account",
      account_name: "Main Account",
      state: "in_progress",
      current_kill_count: 120,
      target_kill_count: 1000,
      notes: "finish during bonus"
    });
    upsertBestiaryState(db, {
      creature_name: "Dragon",
      scope_type: "character",
      character_name: "Knight One",
      state: "ignored",
      current_kill_count: 5
    });

    const accountItem = (listBestiaryProgress(db, { account_name: "Main Account" }).items as Array<Record<string, unknown>>)[0];
    expect(accountItem.state).toBe("in_progress");
    expect(accountItem.manual_current_kill_count).toBe(120);
    expect(accountItem.notes).toBe("finish during bonus");

    const characterItem = (listBestiaryProgress(db, { character_name: "Knight One" }).items as Array<Record<string, unknown>>)[0];
    expect(characterItem.state).toBe("ignored");
    expect(characterItem.scope).toMatchObject({ scope_type: "character", character_name: "Knight One" });
  });

  it("aggregates creature kills from saved hunt parsed monster data", () => {
    insertCreature({ id: 10, name: "Dragon", totalKills: 1000 });
    insertHunt({
      label: "Dragon Run",
      uploadedAt: "2026-06-10T10:00:00.000Z",
      durationMinutes: 60,
      monsters: [{ name: "Dragon", count: 80 }]
    });
    insertHunt({
      label: "Second Dragon Run",
      uploadedAt: "2026-06-11T10:00:00.000Z",
      durationMinutes: 60,
      monsters: [{ name: "dragon", count: 70 }]
    });

    const dragon = items().find((item) => item.normalized_creature_name === "dragon");
    expect(dragon).toMatchObject({
      hunt_kill_count: 150,
      effective_kill_count: 150,
      hunt_sessions: 2,
      average_kills_per_session: 75
    });
  });

  it("sorts close-to-completion creatures ahead of broader progress", () => {
    insertCreature({ id: 10, name: "Dragon", totalKills: 1000 });
    insertCreature({ id: 11, name: "Demon", totalKills: 2500 });
    upsertBestiaryState(db, { creature_name: "Dragon", current_kill_count: 960, target_kill_count: 1000, state: "in_progress" });
    upsertBestiaryState(db, { creature_name: "Demon", current_kill_count: 400, target_kill_count: 2500, state: "in_progress" });

    const result = listBestiaryProgress(db);
    const close = (result.groups as Record<string, unknown>).close_to_completion as Array<Record<string, unknown>>;
    expect(close[0].creature_name).toBe("Dragon");
    expect(close[0].remaining_kill_count).toBe(40);
  });

  it("estimates sessions remaining from personal hunt averages", () => {
    insertCreature({ id: 10, name: "Dragon", totalKills: 1000 });
    upsertBestiaryState(db, { creature_name: "Dragon", current_kill_count: 100, target_kill_count: 1000 });
    insertHunt({
      label: "Dragon Run",
      uploadedAt: "2026-06-10T10:00:00.000Z",
      durationMinutes: 60,
      monsters: [{ name: "Dragon", count: 100 }]
    });
    insertHunt({
      label: "Second Dragon Run",
      uploadedAt: "2026-06-11T10:00:00.000Z",
      durationMinutes: 60,
      monsters: [{ name: "Dragon", count: 200 }]
    });

    const dragon = items().find((item) => item.normalized_creature_name === "dragon");
    expect(dragon?.estimated_sessions_remaining).toBe(5);
  });

  it("selects the best personal spawn by kills per hour", () => {
    insertCreature({ id: 10, name: "Dragon", totalKills: 1000 });
    insertHuntingPlace(100, "Darashia Dragon Lair");
    insertHuntingPlace(101, "Yalahar Dragons");
    insertHunt({
      label: "Slow Spawn",
      uploadedAt: "2026-06-10T10:00:00.000Z",
      durationMinutes: 120,
      huntingPlaceId: 100,
      locationName: "Darashia Dragon Lair",
      monsters: [{ name: "Dragon", count: 100 }]
    });
    insertHunt({
      label: "Fast Spawn",
      uploadedAt: "2026-06-11T10:00:00.000Z",
      durationMinutes: 30,
      huntingPlaceId: 101,
      locationName: "Yalahar Dragons",
      monsters: [{ name: "Dragon", count: 80 }]
    });

    const dragon = items().find((item) => item.normalized_creature_name === "dragon");
    expect(dragon?.best_personal_spawn).toMatchObject({
      public_hunting_place_id: 101,
      hunting_place_name: "Yalahar Dragons",
      kills_per_hour: 160
    });
  });

  it("keeps hunt-derived creatures visible when public metadata is missing", () => {
    insertHunt({
      label: "Unknown Route",
      uploadedAt: "2026-06-10T10:00:00.000Z",
      durationMinutes: 60,
      monsters: [{ name: "Mystery Creature", count: 25 }]
    });

    const mystery = items().find((item) => item.normalized_creature_name === "mystery creature");
    expect(mystery).toMatchObject({
      creature_name: "Mystery Creature",
      metadata_available: false,
      charm_points: null,
      target_kill_count: null
    });
    expect((mystery?.explanations as Array<Record<string, unknown>>).map((entry) => entry.label)).toContain("missing public metadata");
  });

  it("summarizes hunt-level charm relevance", () => {
    insertCreature({ id: 10, name: "Dragon", totalKills: 1000, charmPoints: 25 });
    insertCreature({ id: 11, name: "Demon", totalKills: 2500, charmPoints: 50 });
    upsertBestiaryState(db, { creature_name: "Dragon", current_kill_count: 960, target_kill_count: 1000 });
    insertHunt({
      label: "Charm Push",
      uploadedAt: "2026-06-10T10:00:00.000Z",
      durationMinutes: 60,
      monsters: [
        { name: "Dragon", count: 20 },
        { name: "Demon", count: 5 }
      ]
    });

    const relevance = listHuntCharmRelevance(db).items as Array<Record<string, unknown>>;
    expect(relevance[0]).toMatchObject({
      label: "Charm Push",
      relevant_creature_count: 2,
      total_relevant_kills: 25,
      potential_charm_points: 75,
      close_to_completion_count: 1
    });
  });
});
