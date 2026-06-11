import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupTibiaCharacter,
  normalizeTibiaCharacterResponse,
  resetCharacterFetchForTests,
  searchKnownCharacters,
  setCharacterFetchForTests
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
        last_login: "2026-06-11T06:40:27Z"
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
        return { all: vi.fn(() => rows) };
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
      fetched_at: "2026-06-11T10:57:10Z"
    }]);

    expect(searchKnownCharacters(db, "gor")).toEqual([
      expect.objectContaining({ name: "Goraca", level: 3053 })
    ]);
  });
});
