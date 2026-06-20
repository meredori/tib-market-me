import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations";
import {
  getKnownCharacter,
  lookupTibiaCharacter,
  normalizeTibiaCharacterResponse,
  resetCharacterFetchForTests,
  searchKnownCharacters,
  setCharacterFetchForTests,
  updateCharacterProfile
} from "./characters";

function sampleCharacterPayload() {
  return {
    character: {
      character: {
        name: "Goraca",
        vocation: "Master Sorcerer",
        level: 3053,
        world: "Bona",
        sex: "female",
        residence: "Venore",
        guild: { name: "Hill", rank: "King" },
        account_status: "Premium Account",
        achievement_points: 123,
        title: "Tibia's Topmodel",
        traded: false,
        unlocked_titles: 12,
        former_names: ["Old Goraca"],
        former_worlds: ["Secura"],
        last_login: "2026-06-11T06:40:27Z"
      },
      account_information: {
        created: "Nov 01 2006, 12:00:00 CET",
        loyalty_title: "Squire of Tibia",
        position: "Tutor"
      }
    },
    information: {
      timestamp: "2026-06-11T10:57:10Z"
    }
  };
}

function createMockDb(rows: Array<Record<string, unknown>> = []): any {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes("INSERT INTO tibia_characters")) {
        return { run: vi.fn(() => ({ changes: 1 })) };
      }
      if (sql.includes("FROM tibia_characters")) {
        return { all: vi.fn(() => rows), get: vi.fn(() => rows[0]) };
      }
      return { run: vi.fn(), all: vi.fn(() => []) };
    })
  };
}

afterEach(() => {
  resetCharacterFetchForTests();
});

describe("TibiaData character client", () => {
  it("normalizes the v4 character response into hunt context fields", () => {
    expect(normalizeTibiaCharacterResponse(sampleCharacterPayload())).toMatchObject({
      name: "Goraca",
      vocation: "Master Sorcerer",
      level: 3053,
      world: "Bona",
      guild_name: "Hill",
      account_created: "Nov 01 2006, 12:00:00 CET",
      loyalty_title: "Squire of Tibia",
      account_position: "Tutor",
      achievement_points: 123,
      character_title: "Tibia's Topmodel",
      traded: false,
      unlocked_titles: 12,
      former_names: ["Old Goraca"],
      former_worlds: ["Secura"],
      premium_hint: "premium",
      source_timestamp: "2026-06-11T10:57:10Z"
    });
  });

  it("looks up and caches a character by name", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => sampleCharacterPayload()
    }));
    setCharacterFetchForTests(fetchMock as unknown as typeof fetch);
    const db = createMockDb();

    const character = await lookupTibiaCharacter(db, "Goraca");

    expect(fetchMock).toHaveBeenCalledWith("https://api.tibiadata.com/v4/character/Goraca");
    expect(character).toMatchObject({ name: "Goraca", level: 3053, vocation: "Master Sorcerer" });
  });

  it("searches cached known characters", () => {
    const db = createMockDb([{
      name: "Goraca",
      vocation: "Master Sorcerer",
      level: 3053,
      world: "Bona",
      fetched_at: "2026-06-11T10:57:10Z",
      former_names_json: "[]",
      former_worlds_json: "[]"
    }]);

    expect(searchKnownCharacters(db, "gor")).toEqual([
      expect.objectContaining({ name: "Goraca", level: 3053 })
    ]);
  });

  it("preserves manual planner fields when TibiaData refreshes the profile", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    try {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => sampleCharacterPayload()
      }));
      setCharacterFetchForTests(fetchMock as unknown as typeof fetch);

      await lookupTibiaCharacter(db, "Goraca");
      const updated = updateCharacterProfile(db, "Goraca", {
        preferred_risk: "low",
        party_preference: "solo",
        short_walk_preference: "prefer",
        profile_notes: "Avoid long refills.",
        equipment_notes: "Carry fire protection.",
        charm_notes: "Dodge on heavy hitters.",
        unlock_notes: "Needs access checks."
      });
      expect(updated).toMatchObject({
        preferred_risk: "low",
        party_preference: "solo",
        short_walk_preference: "prefer",
        profile_notes: "Avoid long refills."
      });

      await lookupTibiaCharacter(db, "Goraca");
      expect(getKnownCharacter(db, "Goraca")).toMatchObject({
        name: "Goraca",
        level: 3053,
        achievement_points: 123,
        preferred_risk: "low",
        equipment_notes: "Carry fire protection.",
        charm_notes: "Dodge on heavy hitters.",
        unlock_notes: "Needs access checks."
      });
      const row = db.prepare("SELECT payload_json FROM tibia_characters WHERE normalized_name = 'goraca'").get() as { payload_json: string };
      expect(JSON.parse(row.payload_json).character.character.name).toBe("Goraca");
    } finally {
      db.close();
    }
  });
});
