import { afterEach, describe, expect, it, vi } from "vitest";
import itemDetailFixture from "../../test/fixtures/item-detail-crystal-sword.json";
import {
  __huntAnalyserTestHooks,
  createHuntUpload,
  deleteHuntUpload,
  hydrateHuntItemDetails,
  parseHuntPreview,
  searchHuntingPlaces,
  updateHuntUpload
} from "./huntAnalyser";
import { parseReceivedDamageText } from "./parser";
import { existingHuntsByImportIdentity, getHuntUploadPreview } from "./repository";
import { rematchHuntUpload, rematchHuntUploads } from "./repository";
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

function customHunt(input: {
  rawXp?: number;
  xp?: number;
  loot?: number;
  supplies?: number;
  damage?: number;
  healing?: number;
  monsters?: string[];
  lootLines?: string;
} = {}): string {
  return [
    "Session data: From 2026-06-10, 10:00:00 to 2026-06-10, 10:30:00",
    "Session: 00:30h",
    `Raw XP Gain: ${(input.rawXp ?? 120_000).toLocaleString("en-US")}`,
    `XP Gain: ${(input.xp ?? 180_000).toLocaleString("en-US")}`,
    `Loot: ${(input.loot ?? 1_000).toLocaleString("en-US")}`,
    `Supplies: ${(input.supplies ?? 250).toLocaleString("en-US")}`,
    ...(input.damage !== undefined ? [`Damage: ${input.damage.toLocaleString("en-US")}`] : []),
    ...(input.healing !== undefined ? [`Healing: ${input.healing.toLocaleString("en-US")}`] : []),
    "Killed Monsters:",
    ...(input.monsters ?? ["  20x dragon"]),
    "Looted Items:",
    input.lootLines ?? "  1x gold coin"
  ].join("\n");
}

function magicianQuarterHunt(): string {
  return [
    "Session data: From 2026-06-20, 11:26:13 to 2026-06-20, 12:16:44",
    "Session: 00:50h",
    "Raw XP Gain: 57,944",
    "XP Gain: 100,469",
    "Raw XP/h: 68,823",
    "XP/h: 119,332",
    "Loot: 13,872",
    "Supplies: 3,920",
    "Balance: 9,952",
    "Damage: 111,010",
    "Damage/h: 141,759",
    "Healing: 4,551",
    "Healing/h: 5,811",
    "Killed Monsters:",
    "  259x dark apprentice",
    "  118x dark magician",
    "  39x mad scientist",
    "Looted Items:",
    "  5x a strong health potion",
    "  3x a strong mana potion",
    "  27x a health potion",
    "  25x a mana potion",
    "  8056x a gold coin",
    "  2x a magic light wand",
    "  1x a life crystal",
    "  1x a necrotic rod",
    "  1x a wand of decay",
    "  8x a wand of dragonbreath",
    "  54x a blank rune",
    "  5x a cookie",
    "  9x a white mushroom",
    "  1x a powder herb",
    "  4x a dead frog"
  ].join("\n");
}

function receivedDamageSample(): string {
  return [
    "Received Damage",
    "Total: 14,426",
    "Max-DPS: 903",
    "Damage Types",
    "  Physical 10,606 (73.5%)",
    "  Earth 3,820 (26.5%)",
    "Damage Sources",
    "  exotic cave spider 8,283 (57.4%)",
    "  exotic bat 5,795 (40.2%)",
    "  (other) 348 (2.4%)"
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
  history?: Array<Record<string, unknown>>;
  creatures?: Array<Record<string, unknown>>;
  publicLoot?: Array<Record<string, unknown>>;
  marketRun?: Record<string, unknown>;
  place?: Record<string, unknown>;
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
    if (sql.includes("FROM hunt_uploads") && sql.includes("processed_json")) {
      return { all: vi.fn(() => options.history ?? []) };
    }
    if (sql.includes("FROM market_runs")) {
      return { get: vi.fn(() => (options.marketRun ?? (options.loot ? { id: 99, finished_at: "2026-06-10T12:00:00.000Z" } : undefined))) };
    }
    if (sql.includes("FROM market_item_prices")) {
      return {
        get: vi.fn((_runId, _model, candidate: unknown) => options.loot?.[String(candidate)])
      };
    }
    if (sql.includes("FROM item_market_history")) {
      return { all: vi.fn(() => []) };
    }
    if (sql.includes("FROM public_creatures") && sql.includes("WHERE normalized_name IN")) {
      return { all: vi.fn(() => options.creatures ?? []) };
    }
    if (sql.includes("FROM public_creature_loot")) {
      return { all: vi.fn(() => options.publicLoot ?? []) };
    }
    if (sql.includes("FROM public_hunting_places") && sql.includes("WHERE id = ?")) {
      return { get: vi.fn(() => options.place ?? undefined) };
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
  it("parses received damage input analyser text", () => {
    expect(parseReceivedDamageText(receivedDamageSample())).toEqual({
      total: 14_426,
      max_dps: 903,
      damage_types: [
        { type: "Physical", amount: 10_606, percent: 73.5 },
        { type: "Earth", amount: 3_820, percent: 26.5 }
      ],
      damage_sources: [
        { name: "exotic cave spider", amount: 8_283, percent: 57.4 },
        { name: "exotic bat", amount: 5_795, percent: 40.2 },
        { name: "(other)", amount: 348, percent: 2.4 }
      ]
    });
  });

  it("surfaces received damage in preview combat intelligence", async () => {
    const preview = await parseHuntPreview(previewDb(), {
      raw_text: customHunt(),
      input_analyser_text: receivedDamageSample()
    });
    const intelligence = preview.hunt_intelligence as Record<string, any>;

    expect(preview.parsed).toEqual(expect.objectContaining({
      received_damage: expect.objectContaining({ total: 14_426, max_dps: 903 })
    }));
    expect(intelligence.combat_analysis).toEqual(expect.objectContaining({
      incoming_damage_recorded: true,
      total_incoming_damage: 14_426,
      max_incoming_dps: 903,
      incoming_damage_types: expect.arrayContaining([
        expect.objectContaining({ type: "Physical", amount: 10_606, percent: 73.5 })
      ])
    }));
    expect(intelligence.data_quality.received_damage_imported).toBe(true);
  });

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

  it("does not let ignored market prices inflate hunt loot totals", async () => {
    const ignoredMarketLoot = {
      ...lootRow("dusty trinket", 2500),
      sell_offer: -1,
      month_sold: 2,
      day_sold: 0,
      liquidity: 0.02,
      confidence: 0.4,
      npc_buy: 0
    };

    const preview = await parseHuntPreview(previewDb({
      loot: {
        "dusty trinket": ignoredMarketLoot
      }
    }), {
      raw_text: sampleHunt("  3x dusty trinket")
    });

    expect((preview.loot_items as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: "dusty trinket",
      unit_value: 0,
      total_value: 0,
      value_source: "loot_logic",
      loot_logic: expect.objectContaining({
        strategy: "ignore",
        fair_sale_price: 0
      })
    });
  });

  it("uses NPC value for manually ignored loot when available", async () => {
    const ignoredNpcLoot = {
      ...lootRow("npc trinket", 2500),
      npc_buy: 800,
      override_mode: "ignore"
    };

    const preview = await parseHuntPreview(previewDb({
      loot: {
        "npc trinket": ignoredNpcLoot
      }
    }), {
      raw_text: sampleHunt("  3x npc trinket")
    });

    expect((preview.loot_items as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: "npc trinket",
      unit_value: 800,
      total_value: 2400,
      value_source: "loot_logic",
      loot_logic: expect.objectContaining({
        strategy: "ignore",
        fair_sale_price: 800
      })
    });
  });

  it("classifies strong profit hunts from personal comparisons", async () => {
    const preview = await parseHuntPreview(previewDb({
      loot: { "rare gem": lootRow("rare gem", 100_000) },
      history: [
        { id: 1, label: "Older", duration_minutes: 30, total_xp: 100_000, raw_total_xp: 100_000, total_loot_gold: 10_000, total_supply_cost: 5_000, uploaded_at: "2026-06-09T00:00:00.000Z" }
      ]
    }), { raw_text: customHunt({ lootLines: "  1x rare gem" }) });

    expect((preview.hunt_intelligence as Record<string, any>).verdict.label).toBe("Excellent profit hunt");
    expect((preview.hunt_intelligence as Record<string, any>).verdict.repeat_recommendation.label).toBe("Repeat this hunt");
    expect((preview.hunt_intelligence as Record<string, any>).verdict.tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "risk", value: "low", tone: "good" }),
      expect.objectContaining({ key: "supply", value: "low", tone: "good" }),
      expect.objectContaining({ key: "profit", value: "high", tone: "good" })
    ]));
    expect((preview.hunt_intelligence as Record<string, any>).key_metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "profit_per_hour", delta_pct: expect.any(Number) })
    ]));
  });

  it("classifies strong XP, expensive, and safe slow hunts", async () => {
    const xpPreview = await parseHuntPreview(previewDb({
      history: [
        { id: 1, label: "Low XP", duration_minutes: 30, total_xp: 20_000, raw_total_xp: 20_000, total_loot_gold: 20_000, total_supply_cost: 250, uploaded_at: "2026-06-09T00:00:00.000Z" }
      ]
    }), { raw_text: customHunt({ xp: 300_000, loot: 10_000, supplies: 250, lootLines: "  10000x gold coin" }) });
    const expensivePreview = await parseHuntPreview(previewDb(), { raw_text: customHunt({ loot: 1_000, supplies: 3_000 }) });
    const safePreview = await parseHuntPreview(previewDb(), { raw_text: customHunt({ loot: 10_000, supplies: 500, lootLines: "  10000x gold coin" }) });

    expect((xpPreview.hunt_intelligence as Record<string, any>).verdict.label).toBe("Strong XP hunt");
    expect((expensivePreview.hunt_intelligence as Record<string, any>).verdict.label).toBe("Expensive hunt");
    expect((safePreview.hunt_intelligence as Record<string, any>).verdict.label).toBe("Safe but slow hunt");
  });

  it("preserves parsed damage and healing totals in combat intelligence", async () => {
    const preview = await parseHuntPreview(previewDb(), {
      raw_text: customHunt({
        damage: 31_886,
        healing: 1_512,
        monsters: [
          "  83x elf",
          "  29x elf arcanist",
          "  107x elf scout"
        ]
      })
    });
    const intelligence = preview.hunt_intelligence as Record<string, any>;

    expect(preview.parsed.total_damage).toBe(31_886);
    expect(preview.parsed.total_healing).toBe(1_512);
    expect(intelligence.combat_analysis).toEqual(expect.objectContaining({
      damage_recorded: true,
      healing_recorded: true,
      incoming_damage_recorded: false,
      total_damage: 31_886,
      total_healing: 1_512,
      damage_per_kill: 146,
      healing_per_kill: 7
    }));
  });

  it("parses default Hunt Analyser damage and healing as done totals", async () => {
    const preview = await parseHuntPreview(previewDb(), {
      raw_text: magicianQuarterHunt()
    });
    const intelligence = preview.hunt_intelligence as Record<string, any>;

    expect(preview.parsed.total_damage).toBe(111_010);
    expect(preview.parsed.total_healing).toBe(4_551);
    expect(intelligence.combat_analysis).toEqual(expect.objectContaining({
      damage_recorded: true,
      healing_recorded: true,
      incoming_damage_recorded: false,
      total_damage: 111_010,
      total_healing: 4_551,
      damage_per_kill: 267,
      healing_per_kill: 11
    }));
  });

  it("fills saved hunt damage and healing from raw text when processed JSON is older", async () => {
    const rawText = magicianQuarterHunt();
    const oldProcessed = {
      parsed: {
        label: "dark apprentices - 2026-06-20",
        duration_minutes: 50,
        raw_total_xp: 57_944,
        total_xp: 100_469,
        total_loot_gold: 13_872,
        total_supply_cost: 3_920,
        started_at: "2026-06-20T11:26:13.000Z",
        ended_at: "2026-06-20T12:16:44.000Z",
        hunt_date: "2026-06-20",
        monsters: [
          { name: "dark apprentice", count: 259 },
          { name: "dark magician", count: 118 },
          { name: "mad scientist", count: 39 }
        ],
        loot_items: [
          { name: "a gold coin", quantity: 8056, normalized_name: "gold coin" }
        ]
      }
    };
    const db = createMockDb((sql) => {
      if (sql.includes("FROM hunt_uploads") && sql.includes("WHERE id = ?")) {
        return {
          get: vi.fn(() => ({
            id: 19,
            label: "dark apprentices - 2026-06-20",
            uploaded_at: "2026-06-20T12:16:44.000Z",
            raw_text: rawText,
            processed_json: JSON.stringify(oldProcessed),
            location_name: "Magician Quarter/Academy of Magic",
            tags_json: "[]",
            excluded_items_json: "[]",
            hunting_place_match_status: "manual",
            hunting_place_match_manual: 1
          }))
        };
      }
      return {};
    });
    const preview = await getHuntUploadPreview(
      db,
      19,
      async (parsed) => ({ parsed }),
      async () => ({ parsed: null })
    );

    expect(preview?.parsed).toEqual(expect.objectContaining({
      total_damage: 111_010,
      total_healing: 4_551
    }));
  });

  it("fills saved hunt received damage from input analyser text when processed JSON is older", async () => {
    const rawText = magicianQuarterHunt();
    const oldProcessed = {
      parsed: {
        label: "dark apprentices - 2026-06-20",
        duration_minutes: 50,
        raw_total_xp: 57_944,
        total_xp: 100_469,
        total_loot_gold: 13_872,
        total_supply_cost: 3_920,
        monsters: [
          { name: "dark apprentice", count: 259 }
        ],
        loot_items: [
          { name: "a gold coin", quantity: 8056, normalized_name: "gold coin" }
        ]
      }
    };
    const db = createMockDb((sql) => {
      if (sql.includes("FROM hunt_uploads") && sql.includes("WHERE id = ?")) {
        return {
          get: vi.fn(() => ({
            id: 20,
            label: "dark apprentices - 2026-06-20",
            uploaded_at: "2026-06-20T12:16:44.000Z",
            raw_text: rawText,
            input_analyser_text: receivedDamageSample(),
            processed_json: JSON.stringify(oldProcessed),
            location_name: "Magician Quarter/Academy of Magic",
            hunting_place_area_names_json: JSON.stringify(["Basement"]),
            tags_json: "[]",
            excluded_items_json: "[]",
            hunting_place_match_status: "manual",
            hunting_place_match_manual: 1
          }))
        };
      }
      return {};
    });
    const preview = await getHuntUploadPreview(
      db,
      20,
      async (parsed, _raw, _excluded, _location, inputAnalyserText) => ({ parsed, input_analyser_text: inputAnalyserText }),
      async () => ({ parsed: null })
    );

    expect(preview?.parsed).toEqual(expect.objectContaining({
      received_damage: expect.objectContaining({ total: 14_426, max_dps: 903 })
    }));
    expect(preview?.input_analyser_text).toBe(receivedDamageSample());
    expect(preview?.saved_hunt).toEqual(expect.objectContaining({
      hunting_place_area_names: ["Basement"]
    }));
  });

  it("surfaces rare-drop dependency, data quality, and monster XP contribution", async () => {
    const preview = await parseHuntPreview(previewDb({
      loot: {
        "rare gem": { ...lootRow("rare gem", 80_000), confidence: 0.4, override_mode: "market" }
      },
      creatures: [
        { id: 10, name: "dragon", normalized_name: "dragon", experience: 700, hitpoints: 1000, bestiary_class: "Reptile", bestiary_difficulty: "Medium" }
      ],
      publicLoot: [
        { normalized_creature_name: "dragon", normalized_item_name: "rare gem", item_name: "rare gem", chance_percent: 0.5, rarity: "rare" }
      ],
      marketRun: { id: 99, finished_at: "2026-06-10T12:00:00.000Z" }
    }), { raw_text: customHunt({ lootLines: ["  1x rare gem", "  2x mystery dust"].join("\n") }) });
    const intelligence = preview.hunt_intelligence as Record<string, any>;

    expect(intelligence.loot_analysis.rare_drop_dependency_pct).toBeGreaterThan(35);
    expect(intelligence.loot_analysis.profit_without_top_drop).toBeLessThan(intelligence.key_metrics.find((item: Record<string, unknown>) => item.key === "profit")?.raw_value as number);
    expect(intelligence.data_quality.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("missing resolved prices"),
      expect.stringContaining("low price confidence"),
      expect.stringContaining("override")
    ]));
    expect(intelligence.monster_analysis.estimated_xp_from_creatures).toBe(14_000);
    expect(intelligence.combat_analysis.summary).toContain("estimated");
    expect(intelligence.recommendations.map((item: Record<string, string>) => item.label)).not.toContain("Check profit without rare drops");
  });

  it("keeps sparse preview intelligence graceful", async () => {
    const preview = await parseHuntPreview(previewDb(), { raw_text: customHunt({ lootLines: "  1x unknown pebble" }) });
    const intelligence = preview.hunt_intelligence as Record<string, any>;

    expect(intelligence.verdict.label).toBeTruthy();
    expect(intelligence.data_quality.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("missing resolved prices")
    ]));
    expect(intelligence.performance_reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "limited comparison" })
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
    expect(result.confidence_detail).toMatchObject({ level: "high" });
    expect(result.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "public_tibia_reference" }),
      expect.objectContaining({ type: "personal_hunt" }),
      expect.objectContaining({ type: "derived_calculation" })
    ]));
    expect(result.explanations).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "2 matching monsters" })
    ]));
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

  it("uses hunt title as a lighter ordering signal than monster overlap", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(551, "Guzzlemaw Valley", ["guzzlemaw", "frazzlemaw", "silencer"]),
      place(552, "Upper Roshamuul", ["guzzlemaw", "frazzlemaw", "silencer"], { areaNames: ["Rosha West"] })
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
      monsters: [{ name: "guzzlemaw", count: 90 }, { name: "frazzlemaw", count: 60 }, { name: "silencer", count: 20 }],
      loot_items: []
    }, { locationName: "Rosha West" });

    expect(result.candidates[0]).toMatchObject({ id: 552, name: "Upper Roshamuul" });
    expect(result.candidates[1]).toMatchObject({ id: 551, name: "Guzzlemaw Valley" });
  });

  it("auto-matches one high-confidence candidate when the runner-up drops to medium", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(561, "Best Spawn", ["guzzlemaw", "frazzlemaw", "silencer"], { areaNames: ["Rosha West"] }),
      place(562, "Partial Spawn", ["guzzlemaw", "frazzlemaw"])
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
      monsters: [{ name: "guzzlemaw", count: 80 }, { name: "frazzlemaw", count: 60 }, { name: "silencer", count: 30 }],
      loot_items: []
    }, { locationName: "Rosha West" });

    expect(result).toMatchObject({
      selected_hunting_place_id: 561,
      status: "auto"
    });
    expect(result.candidates[0].confidence_detail.level).toBe("high");
    expect(result.candidates[1].confidence_detail.level).toBe("medium");
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

  it("blocks matching when hunting places are staged but not enriched", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(701, "Dragon Lair", [])
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
      monsters: [{ name: "dragon", count: 50 }],
      loot_items: []
    });

    expect(result).toMatchObject({
      status: "blocked",
      readiness: "blocked",
      readiness_reason: "Run public reference enrichment before matching can compare hunt monsters to hunting places."
    });
  });

  it("keeps an explicitly selected hunting spot matched even before enrichment", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(702, "Dragon Lair", [])
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
      monsters: [{ name: "dragon", count: 50 }],
      loot_items: []
    }, { manualHuntingPlaceId: 702 });

    expect(result).toMatchObject({
      selected_hunting_place_id: 702,
      selected_hunting_place_name: "Dragon Lair",
      status: "manual",
      readiness: "manual"
    });
  });

  it("can mark a hunt as a mixed route while retaining candidates", () => {
    const result = matchHuntToHuntingPlaces(matcherDb([
      place(801, "Dragon Lair", ["dragon"])
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
      monsters: [{ name: "dragon", count: 50 }],
      loot_items: []
    }, { mode: "mixed_route" });

    expect(result).toMatchObject({
      selected_hunting_place_id: null,
      status: "mixed_route",
      readiness: "mixed_route"
    });
    expect(result.candidates[0]).toMatchObject({ id: 801 });
  });
});

describe("hunt repository semantics", () => {
  it("returns ordered area summaries in hunting place search", () => {
    const db = createMockDb((sql) => {
      if (sql.includes("FROM public_hunting_places place")) {
        return {
          all: vi.fn(() => [{
            id: 88,
            name: "Exotic Cave",
            normalized_name: "exotic cave",
            location: "Issavi",
            min_level: 150,
            max_level: 250,
            detail_status: "enriched",
            creature_count: 2,
            area_summaries_json: JSON.stringify([
              { area_name: "Upper Floor", display_order: 0, creature_count: 2 },
              { area_name: "Lower Floor", display_order: 1, creature_count: 3 }
            ])
          }])
        };
      }
      return {};
    });

    const result = searchHuntingPlaces(db, "lower floor") as Record<string, any>;

    expect(result.items[0]).toMatchObject({
      id: 88,
      area_summaries: [
        { area_name: "Upper Floor", display_order: 0, creature_count: 2 },
        { area_name: "Lower Floor", display_order: 1, creature_count: 3 }
      ]
    });
  });

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

  it("preserves manual hunting-place matches during single rematch", () => {
    const update = vi.fn();
    const db = createMockDb((sql) => {
      if (sql.includes("FROM hunt_uploads") && sql.includes("LIMIT 1")) {
        return {
          get: vi.fn(() => ({
            id: 7,
            raw_text: sampleHunt("  1x gold coin"),
            location_name: "Manual Place",
            public_hunting_place_id: 201,
            hunting_place_match_manual: 1,
            hunting_place_match_status: "manual"
          }))
        };
      }
      if (sql.includes("UPDATE hunt_uploads")) {
        return { run: update };
      }
      if (sql.includes("FROM hunt_uploads") && sql.includes("WHERE id = ?")) {
        return {
          get: vi.fn(() => ({
            id: 7,
            label: "Manual hunt",
            uploaded_at: "2026-06-10T00:00:00.000Z",
            duration_minutes: 30,
            raw_total_xp: 120000,
            total_xp: 180000,
            total_loot_gold: 1000,
            total_supply_cost: 250,
            tags_json: "[]",
            excluded_items_json: "[]",
            location_name: "Manual Place",
            public_hunting_place_id: 201,
            hunting_place_match_manual: 1,
            hunting_place_match_status: "manual"
          }))
        };
      }
      return {};
    });

    const result = rematchHuntUpload(db, 7, "auto_apply");

    expect(result).toMatchObject({ skipped: true, reason: "existing match preserved" });
    expect(update).not.toHaveBeenCalled();
  });

  it("stores suggestions without assigning a place in suggest-only rematch", () => {
    const updates: unknown[][] = [];
    const db = createMockDb((sql) => {
      if (sql.includes("FROM hunt_uploads") && sql.includes("LIMIT 1")) {
        return {
          get: vi.fn(() => ({
            id: 8,
            raw_text: sampleHunt("  1x gold coin"),
            location_name: "Dragon Lair",
            public_hunting_place_id: null,
            character_level: 120,
            hunting_place_match_manual: 0,
            hunting_place_match_status: "unmatched"
          }))
        };
      }
      if (sql.includes("FROM public_hunting_places")) {
        return {
          all: vi.fn(() => [
            place(201, "Dragon Lair", ["dragon"], { location: "Darashia", minLevel: 80, maxLevel: 180 })
          ])
        };
      }
      if (sql.includes("UPDATE hunt_uploads")) {
        return {
          run: vi.fn((...args: unknown[]) => {
            updates.push(args);
            return { changes: 1 };
          })
        };
      }
      if (sql.includes("FROM hunt_uploads") && sql.includes("WHERE id = ?")) {
        return { get: vi.fn(() => ({ id: 8, duration_minutes: 30, total_xp: 1, raw_total_xp: 1, total_loot_gold: 0, total_supply_cost: 0 })) };
      }
      return {};
    });

    rematchHuntUpload(db, 8, "suggest_only");

    expect(updates[0][0]).toBeNull();
    expect(updates[0][2]).toBe("review");
    expect(updates[0][8]).toBe("suggest_only");
    expect(updates[0][9]).toBe("review");
  });

  it("auto-applies high-confidence matches in bulk rematch", () => {
    const updates: unknown[][] = [];
    const db = createMockDb((sql) => {
      if (sql.includes("SELECT id") && sql.includes("hunting_place_match_manual = 0")) {
        return { all: vi.fn(() => [{ id: 9 }]) };
      }
      if (sql.includes("FROM hunt_uploads") && sql.includes("LIMIT 1")) {
        return {
          get: vi.fn(() => ({
            id: 9,
            raw_text: sampleHunt("  1x gold coin"),
            location_name: "Dragon Lair",
            public_hunting_place_id: null,
            character_level: 120,
            hunting_place_match_manual: 0,
            hunting_place_match_status: "unmatched"
          }))
        };
      }
      if (sql.includes("FROM public_hunting_places")) {
        return {
          all: vi.fn(() => [
            place(201, "Dragon Lair", ["dragon"], { location: "Darashia", minLevel: 80, maxLevel: 180 })
          ])
        };
      }
      if (sql.includes("UPDATE hunt_uploads")) {
        return {
          run: vi.fn((...args: unknown[]) => {
            updates.push(args);
            return { changes: 1 };
          })
        };
      }
      if (sql.includes("FROM hunt_uploads") && sql.includes("WHERE id = ?")) {
        return { get: vi.fn(() => ({ id: 9, duration_minutes: 30, total_xp: 1, raw_total_xp: 1, total_loot_gold: 0, total_supply_cost: 0 })) };
      }
      return {};
    });

    const result = rematchHuntUploads(db, "auto_apply");

    expect(result).toMatchObject({ summary: { candidates: 1, processed: 1, failed: 0 } });
    expect(updates[0][0]).toBe(201);
    expect(updates[0][2]).toBe("auto");
    expect(updates[0][8]).toBe("auto_apply");
  });
});

describe("test hooks", () => {
  it("exposes a tiny facade hook without changing route exports", () => {
    expect(__huntAnalyserTestHooks.coercePreviewNumber("4", 0)).toBe(4);
  });
});
