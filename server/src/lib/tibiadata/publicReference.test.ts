import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPublicReferenceStatus,
  resetPublicReferenceFetchForTests,
  setPublicReferenceFetchForTests,
  syncPublicReferenceData,
  upsertPublicCreature,
  upsertPublicHuntingPlace
} from "./publicReference";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE public_reference_sync_runs (
      id INTEGER PRIMARY KEY,
      resource TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );
    CREATE TABLE public_creatures (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      hitpoints INTEGER,
      experience INTEGER,
      bestiary_class TEXT,
      bestiary_category TEXT,
      bestiary_difficulty TEXT,
      charm_points INTEGER,
      total_kills INTEGER,
      last_updated TEXT,
      last_seen TEXT,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE public_creature_loot (
      creature_id INTEGER NOT NULL,
      item_id INTEGER,
      item_name TEXT NOT NULL,
      normalized_item_name TEXT NOT NULL,
      chance_percent REAL,
      min_count INTEGER,
      max_count INTEGER,
      rarity TEXT,
      amount_text TEXT,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (creature_id, normalized_item_name),
      FOREIGN KEY (creature_id) REFERENCES public_creatures(id) ON DELETE CASCADE
    );
    CREATE TABLE public_hunting_places (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      location TEXT,
      min_level INTEGER,
      max_level INTEGER,
      exp_stars REAL,
      loot_stars REAL,
      bestiary_stars REAL,
      risk_level TEXT,
      last_updated TEXT,
      last_seen TEXT,
      fetched_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE public_hunting_place_creatures (
      hunting_place_id INTEGER NOT NULL,
      creature_id INTEGER,
      creature_name TEXT NOT NULL,
      normalized_creature_name TEXT NOT NULL,
      occurrence TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (hunting_place_id, normalized_creature_name),
      FOREIGN KEY (hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
    );
    CREATE TABLE public_hunting_place_area_summaries (
      hunting_place_id INTEGER NOT NULL,
      area_name TEXT NOT NULL,
      creature_count INTEGER,
      exp_stars REAL,
      loot_stars REAL,
      bestiary_stars REAL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (hunting_place_id, area_name),
      FOREIGN KEY (hunting_place_id) REFERENCES public_hunting_places(id) ON DELETE CASCADE
    );
  `);
  return db;
}

function creaturePayload() {
  return {
    id: 101,
    name: "Dragon",
    hitpoints: 1000,
    experience: 700,
    bestiaryClass: "Reptile",
    bestiaryCategory: "Dragon",
    bestiaryDifficulty: "Medium",
    charmPoints: 25,
    totalKills: 1000,
    lastUpdated: "2026-06-10T00:00:00Z"
  };
}

function huntingPlacePayload() {
  return {
    id: 201,
    name: "Dragon Lair",
    location: "Venore",
    minLevel: 40,
    maxLevel: 90,
    expStars: 3,
    lootStars: 2,
    bestiaryStars: 4,
    riskLevel: "medium",
    lastUpdated: "2026-06-09T00:00:00Z",
    creatures: [
      { creatureId: 101, creatureName: "Dragon", occurrence: "common" },
      { creatureId: 102, creatureName: "Dragon Lord", occurrence: "rare" }
    ],
    structuredData: {
      areaCreatureSummaries: [
        {
          areaName: "Main floor",
          creatureCount: 2,
          expStars: 3,
          lootStars: 2,
          bestiaryStars: 4,
          creatures: [{ creatureId: 101, creatureName: "Dragon" }]
        }
      ]
    }
  };
}

let db: Database.Database;

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  resetPublicReferenceFetchForTests();
  db.close();
});

describe("public Tibia reference data", () => {
  it("normalizes and upserts creature details with source timestamps", () => {
    const creature = upsertPublicCreature(db, creaturePayload(), "2026-06-11T00:00:00Z");

    expect(creature).toMatchObject({ id: 101, name: "Dragon", last_updated: "2026-06-10T00:00:00Z" });
    expect(db.prepare("SELECT name, normalized_name, hitpoints, experience FROM public_creatures").get()).toMatchObject({
      name: "Dragon",
      normalized_name: "dragon",
      hitpoints: 1000,
      experience: 700
    });
  });

  it("normalizes and upserts hunting places", () => {
    const place = upsertPublicHuntingPlace(db, huntingPlacePayload(), "2026-06-11T00:00:00Z");

    expect(place).toMatchObject({ id: 201, name: "Dragon Lair", min_level: 40, risk_level: "medium" });
    expect(db.prepare("SELECT last_updated FROM public_hunting_places WHERE id = 201").get()).toEqual({
      last_updated: "2026-06-09T00:00:00Z"
    });
  });

  it("syncs creatures, loot, hunting places, and children idempotently", async () => {
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures", { page: 1, pageSize: 250, totalCount: 1, items: [{ id: 101, name: "Dragon" }] }],
      ["/api/v1/creatures/list", { creatures: [{ id: 101, name: "Dragon" }] }],
      ["/api/v1/creatures/101", creaturePayload()],
      ["/api/v1/creatures/101/loot", { loot: [{ itemId: 301, itemName: "Dragon Ham", chancePercent: "12.5%", minCount: 1, maxCount: 2 }] }],
      ["/api/v1/hunting-places/list", { huntingPlaces: [{ id: 201, name: "Dragon Lair" }] }],
      ["/api/v1/hunting-places/201", huntingPlacePayload()]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    await syncPublicReferenceData(db, {
      creatureLimit: 1,
      huntingPlaceLimit: 1,
      hydrateCreatureDetails: true,
      hydrateHuntingPlaceDetails: true,
      fetchCreatureLoot: true
    });
    const second = await syncPublicReferenceData(db, {
      creatureLimit: 1,
      huntingPlaceLimit: 1,
      hydrateCreatureDetails: true,
      hydrateHuntingPlaceDetails: true,
      fetchCreatureLoot: true
    });
    const status = getPublicReferenceStatus(db);

    expect(second).toMatchObject({
      ok: true,
      creatures: 1,
      creature_loot_rows: 1,
      hunting_places: 1,
      hunting_place_creatures: 2,
      hunting_place_area_summaries: 1
    });
    expect(status).toMatchObject({
      counts: {
        creatures: 1,
        creature_loot_rows: 1,
        hunting_places: 1,
        hunting_place_creatures: 2,
        hunting_place_area_summaries: 1
      }
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM public_reference_sync_runs WHERE status = 'success'").get()).toEqual({ count: 2 });
  });

  it("can run a catalog-first sync without hydrating details or loot", async () => {
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures", { page: 1, pageSize: 250, totalCount: 1, items: [creaturePayload()] }],
      ["/api/v1/hunting-places/list", { huntingPlaces: [huntingPlacePayload()] }]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      const path = parsed.pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    const result = await syncPublicReferenceData(db, { creatureLimit: 1, huntingPlaceLimit: 1 });

    expect(result).toMatchObject({
      creatures: 1,
      creature_loot_rows: 0,
      hunting_places: 1,
      hunting_place_creatures: 0
    });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101/loot"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/201"), expect.anything());
  });

  it("prioritizes never-synced creatures and hunting places before existing local rows", async () => {
    upsertPublicCreature(db, creaturePayload(), "2026-06-11T00:00:00Z");
    upsertPublicHuntingPlace(db, huntingPlacePayload(), "2026-06-11T00:00:00Z");

    const demonPayload = {
      id: 102,
      name: "Demon",
      hitpoints: 8200,
      experience: 6000,
      lastUpdated: "2026-06-10T00:00:00Z"
    };
    const demonLairPayload = {
      id: 202,
      name: "Demon Lair",
      location: "Edron",
      minLevel: 100,
      creatures: [{ creatureId: 102, creatureName: "Demon" }],
      lastUpdated: "2026-06-10T00:00:00Z"
    };
    const routes = new Map<string, unknown>([
      ["/api/v1/creatures", { page: 1, pageSize: 250, totalCount: 2, items: [{ id: 101, name: "Dragon" }, { id: 102, name: "Demon" }] }],
      ["/api/v1/creatures/list", { creatures: [{ id: 101, name: "Dragon" }, { id: 102, name: "Demon" }] }],
      ["/api/v1/creatures/102", demonPayload],
      ["/api/v1/creatures/102/loot", { loot: [{ itemId: 302, itemName: "Demon Horn", chancePercent: "1%" }] }],
      ["/api/v1/hunting-places/list", { huntingPlaces: [{ id: 201, name: "Dragon Lair" }, { id: 202, name: "Demon Lair" }] }],
      ["/api/v1/hunting-places/202", demonLairPayload]
    ]);
    const fetchMock = vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return {
        ok: routes.has(path),
        status: routes.has(path) ? 200 : 404,
        json: async () => routes.get(path)
      };
    });
    setPublicReferenceFetchForTests(fetchMock as unknown as typeof fetch);

    await syncPublicReferenceData(db, {
      creatureLimit: 1,
      huntingPlaceLimit: 1,
      hydrateCreatureDetails: true,
      hydrateHuntingPlaceDetails: true,
      fetchCreatureLoot: true
    });

    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/creatures/101"), expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/hunting-places/201"), expect.anything());
    expect(db.prepare("SELECT name FROM public_creatures WHERE id = 102").get()).toEqual({ name: "Demon" });
    expect(db.prepare("SELECT name FROM public_hunting_places WHERE id = 202").get()).toEqual({ name: "Demon Lair" });
  });
});
