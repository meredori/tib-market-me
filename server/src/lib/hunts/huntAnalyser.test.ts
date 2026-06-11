import { afterEach, describe, expect, it, vi } from "vitest";
import itemDetailFixture from "../../test/fixtures/item-detail-crystal-sword.json";
import {
  __huntAnalyserTestHooks,
  createHuntUpload,
  deleteHuntUpload,
  hydrateHuntItemDetails,
  parseHuntPreview,
  updateHuntUpload
} from "./huntAnalyser";
import { existingHuntsByImportIdentity } from "./repository";
import { matchHuntToHuntingPlaces } from "./huntingPlaceMatcher";
import { resetItemDetailFetchForTests, setItemDetailFetchForTests } from "./itemDetailCache";
import type { ItemDetailCacheRow, LootLookupRow } from "./types";

type Statement = {
  get?: (...args: unknown[]) => unknown;
  all?: (...args: unknown[]) => unknown;
  run?: (...args: unknown[]) => unknown;
};

function sampleHunt(lootLines: string): string {
  return [
    "Session data: From 2026-06-10, 10:00:00 to 2026-06-10, 10:30:00",
    "Session: 00:30h",
    "Raw XP Gain: 120,000",
    "XP Gain: 180,000",
    "Loot: 1,000",
    "Supplies: 250",
    "Killed Monsters:",
    "  20x dragon",
    "Looted Items:",
    lootLines
  ].join("\n");
}

function itemDetail(name: string, weightOz: number | null = null): ItemDetailCacheRow {
  return {
    normalized_name: name.toLowerCase(),
    requested_name: name,
    actual_name: name,
    plural: null,
    category_slug: null,
    category_name: null,
    stackable: null,
    marketable: null,
    npc_price: null,
    npc_value: null,
    value: null,
    weight_oz: weightOz,
    wiki_url: null,
    payload_json: JSON.stringify({ item: { name, weightOz } }),
    last_fetched_at: new Date().toISOString()
  };
}

function lootRow(name: string, price: number, weightName = name): LootLookupRow {
  return {
    item_id: Math.abs(name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)),
    name,
    wiki_name: weightName,
    client_value: price,
    suggested_list_price: price,
    fair_price: price,
    trend: "stable",
    liquidity: 1,
    confidence: 1,
    month_sold: 100,
    day_sold: 10,
    sell_offer: price,
    npc_buy: 0,
    npc_sell: 0,
    override_mode: "auto"
  };
}

function createMockDb(handler: (sql: string) => Statement): any {
  return {
    prepare: vi.fn((sql: string) => {
      const statement = handler(sql);
      return {
        get: statement.get ?? vi.fn(() => undefined),
        all: statement.all ?? vi.fn(() => []),
        run: statement.run ?? vi.fn(() => ({ changes: 1, lastInsertRowid: 1 }))
      };
    })
  };
}

function previewDb(options: {
  details?: Record<string, ItemDetailCacheRow | null>;
  loot?: Record<string, LootLookupRow>;
} = {}): any {
  return createMockDb((sql) => {
    if (sql.includes("FROM hunt_locations")) {
      return { all: vi.fn(() => []) };
    }
    if (sql.includes("FROM item_detail_cache")) {
      return {
        get: vi.fn((name: unknown) => options.details?.[String(name)] ?? null)
      };
    }
    if (sql.includes("FROM market_runs")) {
      return { get: vi.fn(() => (options.loot ? { id: 99 } : undefined)) };
    }
    if (sql.includes("FROM market_item_prices")) {
      return {
        get: vi.fn((_runId, _model, candidate: unknown) => options.loot?.[String(candidate)])
      };
    }
    if (sql.includes("FROM item_market_history")) {
      return { all: vi.fn(() => []) };
    }
    return {};
  });
}

function matcherDb(rows: Array<Record<string, unknown>>): any {
  return createMockDb((sql) => {
    if (sql.includes("FROM public_hunting_places")) {
      return { all: vi.fn(() => rows) };
    }
    return {};
  });
}

function place(
  id: number,
  name: string,
  creatures: string[],
  options: { location?: string; areaNames?: string[]; minLevel?: number; maxLevel?: number } = {}
): Record<string, unknown> {
  return {
    id,
    name,
    normalized_name: name.toLowerCase(),
    location: options.location ?? null,
    min_level: options.minLevel ?? null,
    max_level: options.maxLevel ?? null,
    area_names_json: JSON.stringify(options.areaNames ?? []),
    creatures_json: JSON.stringify(creatures.map((creature) => creature.toLowerCase()))
  };
}

afterEach(() => {
  resetItemDetailFetchForTests();
});

describe("hunt analyser preview", () => {
  it("uses cached item details without remote fetches", async () => {
    const fetchMock = vi.fn();
    setItemDetailFetchForTests(fetchMock as unknown as typeof fetch);
    const db = previewDb({
      details: {
        "rare gem": itemDetail("rare gem", 2)
      }
    });

    const preview = await parseHuntPreview(db, { raw_text: sampleHunt("  1x rare gem") });

    expect(fetchMock).not.toHaveBeenCalled();
    expect((preview.loot_items as Array<Record<string, unknown>>)[0].item_detail_status).toBe("cached");
  });

  it("marks uncached and unpriced loot details as missing", async () => {
    const preview = await parseHuntPreview(previewDb(), { raw_text: sampleHunt("  3x strange shard") });

    expect((preview.loot_items as Array<Record<string, unknown>>)[0]).toMatchObject({
      normalized_name: "strange shard",
      item_detail_status: "missing",
      value_source: "unknown"
    });
  });

  it("keeps unknown value suggestions visible", async () => {
    const preview = await parseHuntPreview(previewDb(), { raw_text: sampleHunt("  3x strange shard") });

    expect(preview.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "strange shard",
        suggestion_type: "unknown_sell_value"
      })
    ]));
  });

  it("keeps low gp/oz suggestions visible for low impact inefficient loot", async () => {
    const preview = await parseHuntPreview(previewDb({
      loot: {
        "heavy junk": lootRow("heavy junk", 100),
        "light treasure": lootRow("light treasure", 10000)
      },
      details: {
        "heavy junk": itemDetail("heavy junk", 100),
        "light treasure": itemDetail("light treasure", 1)
      }
    }), {
      raw_text: sampleHunt(["  1x heavy junk", "  10x light treasure"].join("\n"))
    });

    expect(preview.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "heavy junk",
        suggestion_type: "low_gp_per_oz"
      })
    ]));
  });
});

describe("item detail hydration", () => {
  it("fetches, caches, and returns normalized item details from a recorded fixture", async () => {
    const saved: unknown[][] = [];
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => itemDetailFixture
    }));
    setItemDetailFetchForTests(fetchMock as unknown as typeof fetch);
    const db = createMockDb((sql) => {
      if (sql.includes("FROM item_detail_cache")) {
        return { get: vi.fn(() => null) };
      }
      if (sql.includes("INSERT INTO item_detail_cache")) {
        return {
          run: vi.fn((...args: unknown[]) => {
            saved.push(args);
            return { changes: 1 };
          })
        };
      }
      return {};
    });

    const result = await hydrateHuntItemDetails(db, ["Crystal Swords"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(saved).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: "Crystal Swords",
      normalized_name: "crystal swords",
      item_detail: expect.objectContaining({
        actual_name: "Crystal Sword",
        weight_oz: 48
      })
    });
  });
});

describe("hunt to public hunting-place matching", () => {
  it("auto-matches exact monster overlap", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(201, "Dragon Lair", ["dragon", "dragon lord"], { minLevel: 80, maxLevel: 180 }),
      place(202, "Demon Forge", ["demon"])
    ]), {
      label: null,
      duration_minutes: 30,
      raw_total_xp: 1000,
      total_xp: 1000,
      total_loot_gold: 0,
      total_supply_cost: 0,
      started_at: null,
      ended_at: null,
      hunt_date: null,
      monsters: [{ name: "dragon", count: 50 }, { name: "dragon lord", count: 30 }],
      loot_items: []
    }, { characterLevel: 120 });

    expect(result).toMatchObject({
      selected_hunting_place_id: 201,
      status: "auto"
    });
  });

  it("keeps partial sub-area matches for review", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(301, "Roshamuul Prison", ["frazzlemaw", "guzzlemaw", "silencer"], { areaNames: ["Lower Roshamuul Prison"] })
    ]), {
      label: null,
      duration_minutes: 30,
      raw_total_xp: 1000,
      total_xp: 1000,
      total_loot_gold: 0,
      total_supply_cost: 0,
      started_at: null,
      ended_at: null,
      hunt_date: null,
      monsters: [{ name: "frazzlemaw", count: 100 }, { name: "guzzlemaw", count: 45 }, { name: "choking fear", count: 40 }],
      loot_items: []
    }, { locationName: "lower prison" });

    expect(result.status).toBe("review");
    expect(result.candidates[0]).toMatchObject({ id: 301 });
    expect(result.reasons).toContain("partial overlap, possible sub-area/floor variant");
  });

  it("ignores small travel-kill noise when scoring", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(401, "Werehyaena Cave", ["werehyaena", "werehyaena shaman"]),
      place(402, "Dragon Lair", ["dragon"])
    ]), {
      label: null,
      duration_minutes: 30,
      raw_total_xp: 1000,
      total_xp: 1000,
      total_loot_gold: 0,
      total_supply_cost: 0,
      started_at: null,
      ended_at: null,
      hunt_date: null,
      monsters: [{ name: "werehyaena", count: 140 }, { name: "werehyaena shaman", count: 60 }, { name: "dragon", count: 1 }],
      loot_items: []
    });

    expect(result.selected_hunting_place_id).toBe(401);
    expect(result.candidates[0].missing_monsters).not.toContain("dragon");
  });

  it("uses location aliases as review evidence", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(501, "Asura Palace", ["midnight asura"], { areaNames: ["Mirror"] })
    ]), {
      label: null,
      duration_minutes: 30,
      raw_total_xp: 1000,
      total_xp: 1000,
      total_loot_gold: 0,
      total_supply_cost: 0,
      started_at: null,
      ended_at: null,
      hunt_date: null,
      monsters: [{ name: "midnight asura", count: 20 }, { name: "frost flower asura", count: 20 }],
      loot_items: []
    }, { locationName: "mirror asuras" });

    expect(result.candidates[0]).toMatchObject({ id: 501 });
    expect(result.candidates[0].reasons).toContain("location text matches staged place or sub-area");
  });

  it("does not auto-match low-confidence hunts", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(601, "Dragon Lair", ["dragon"])
    ]), {
      label: null,
      duration_minutes: 30,
      raw_total_xp: 1000,
      total_xp: 1000,
      total_loot_gold: 0,
      total_supply_cost: 0,
      started_at: null,
      ended_at: null,
      hunt_date: null,
      monsters: [{ name: "rat", count: 80 }, { name: "cave rat", count: 40 }],
      loot_items: []
    });

    expect(result.selected_hunting_place_id).toBeNull();
    expect(result.status).toBe("unmatched");
  });
});

describe("hunt repository semantics", () => {
  it("keeps create, update, and delete semantics stable", () => {
    const inserted = {
      id: 7,
      label: "Dragons - 2026-06-10",
      uploaded_at: "2026-06-10T00:00:00.000Z",
      duration_minutes: 30,
      raw_total_xp: 120000,
      total_xp: 180000,
      total_loot_gold: 1000,
      total_supply_cost: 250,
      tags_json: "[]",
      excluded_items_json: "[]"
    };
    const db = createMockDb((sql) => {
      if (sql.includes("INSERT INTO hunt_uploads")) {
        return { run: vi.fn(() => ({ changes: 1, lastInsertRowid: 7 })) };
      }
      if (sql.includes("UPDATE hunt_uploads")) {
        return { run: vi.fn(() => ({ changes: 1 })) };
      }
      if (sql.includes("DELETE FROM hunt_uploads")) {
        return { run: vi.fn(() => ({ changes: 1 })) };
      }
      if (sql.includes("FROM hunt_uploads") && sql.includes("WHERE id = ?")) {
        return { get: vi.fn(() => inserted) };
      }
      if (sql.includes("INSERT INTO hunt_locations")) {
        return { run: vi.fn(() => ({ changes: 1 })) };
      }
      return {};
    });

    expect(createHuntUpload(db, { raw_text: sampleHunt("  1x gold coin") })).toMatchObject({ id: 7 });
    expect(updateHuntUpload(db, 7, { raw_text: sampleHunt("  2x gold coin") })).toMatchObject({ id: 7 });
    expect(deleteHuntUpload(db, 7)).toBe(true);
  });

  it("matches import identities by raw hash and parsed hunt signature", () => {
    const rawText = sampleHunt("  1x gold coin");
    const db = createMockDb((sql) => {
      if (sql.includes("FROM hunt_uploads")) {
        return {
          all: vi.fn(() => [{
            id: 42,
            label: "Imported hunt",
            uploaded_at: "2026-06-10T00:00:00.000Z",
            raw_text: rawText,
            raw_text_hash: ""
          }])
        };
      }
      return {};
    });

    const identity = existingHuntsByImportIdentity(db);

    expect(identity.byHash.size).toBe(1);
    expect(identity.bySignature.size).toBe(1);
    expect([...identity.byHash.values()][0]).toMatchObject({ id: 42 });
  });
});

describe("test hooks", () => {
  it("exposes a tiny facade hook without changing route exports", () => {
    expect(__huntAnalyserTestHooks.coercePreviewNumber("4", 0)).toBe(4);
  });
});
