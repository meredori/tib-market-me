import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "./db/migrations";
import { getAppSettings, updateAppSettings } from "./appSettings";
import { resetCharacterFetchForTests, setCharacterFetchForTests } from "./tibiadata/characters";

function sampleCharacterPayload() {
  return {
    character: {
      character: {
        name: "Knight One",
        vocation: "Elite Knight",
        level: 420,
        world: "Antica",
        account_status: "Premium Account"
      }
    },
    information: {
      timestamp: "2026-06-20T10:00:00Z"
    }
  };
}

afterEach(() => {
  resetCharacterFetchForTests();
});

describe("app settings", () => {
  it("looks up and stores the default character setting", async () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    try {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => sampleCharacterPayload()
      }));
      setCharacterFetchForTests(fetchMock as unknown as typeof fetch);

      const saved = await updateAppSettings(db, { default_character_name: "Knight One" });

      expect(saved.default_character_name).toBe("Knight One");
      expect(saved.default_character).toMatchObject({ name: "Knight One", level: 420, vocation: "Elite Knight" });
      expect(getAppSettings(db).default_character_name).toBe("Knight One");
      expect(db.prepare("SELECT level FROM tibia_characters WHERE normalized_name = 'knight one'").get()).toEqual({ level: 420 });
    } finally {
      db.close();
    }
  });
});
