import type Database from "better-sqlite3";
import { config } from "../../config";
import { confidence, entityRef, explanation, freshness, provenance } from "../intelligence/metadata";
import type { InsightExplanation, Provenance } from "../intelligence/types";
import { asNumber, asNumberOrNull, asRecord, asText, normalizeLootItemName, nowIso } from "../hunts/utils";

export type TaskboardEntryType = "creature" | "item";

type TaskboardEntryRow = {
  id: number;
  entry_type: TaskboardEntryType;
  offer_text: string;
  normalized_offer_text: string;
  matched_name: string | null;
  normalized_name: string;
  required_quantity: number | null;
  public_creature_id: number | null;
  item_id: number | null;
  created_at: string;
  updated_at: string;
};

type ReferenceMatch = {
  id: number;
  name: string;
  normalized_name: string;
};

type CreaturePlace = {
  id: number;
  name: string;
  location: string | null;
  min_level: number | null;
  max_level: number | null;
  risk_level: string | null;
  occurrence: string | null;
  exp_stars: number | null;
  loot_stars: number | null;
  bestiary_stars: number | null;
};

type CreaturePlaceOption = CreaturePlace & {
  floor_level: number | null;
  difficulty_level: number | null;
  personal_pace: PersonalCreaturePace | null;
  sort_basis: "personal_hunt" | "reference_level";
};

type PersonalCreaturePace = {
  hunt_id: number;
  label: string;
  location_name: string | null;
  public_hunting_place_id: number | null;
  duration_minutes: number;
  kills: number;
  kills_per_hour: number;
  xp_per_hour: number | null;
  profit_per_hour: number | null;
  profit_per_kill: number | null;
  uploaded_at: string;
};

type DropCreature = {
  creature_id: number | null;
  name: string;
  normalized_name: string;
  chance_percent: number | null;
  min_count: number | null;
  max_count: number | null;
  rarity: string | null;
};

type MarketItem = {
  item_id: number;
  name: string | null;
  wiki_name: string | null;
  client_value: number | null;
  fair_price: number | null;
  confidence: number | null;
  sell_offer: number | null;
  last_seen_at: string | null;
};

function normalizeName(value: unknown): string {
  return normalizeLootItemName(asText(value));
}

function nullablePositiveInteger(value: unknown): number | null {
  const parsed = asNumberOrNull(value);
  return parsed && parsed > 0 ? Math.trunc(parsed) : null;
}

function entryDisplayName(entry: TaskboardEntryRow): string {
  return entry.matched_name || entry.offer_text;
}

function latestMarketRun(db: Database.Database): { id: number; finished_at: string | null } | null {
  return db
    .prepare("SELECT id, finished_at FROM market_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1")
    .get() as { id: number; finished_at: string | null } | undefined ?? null;
}

function normalizeEntryRow(row: TaskboardEntryRow) {
  return {
    id: asNumber(row.id, 0),
    entry_type: row.entry_type,
    offer_text: row.offer_text,
    matched_name: row.matched_name,
    name: row.matched_name || row.offer_text,
    normalized_offer_text: row.normalized_offer_text,
    normalized_name: row.normalized_name,
    required_quantity: row.required_quantity,
    public_creature_id: row.public_creature_id,
    item_id: row.item_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function findCreatureMatch(db: Database.Database, text: string): ReferenceMatch | null {
  const normalized = normalizeName(text);
  return db.prepare(`
    SELECT id, name, normalized_name
    FROM public_creatures
    WHERE normalized_name = ?
       OR LOWER(name) = ?
       OR normalized_name LIKE ?
    ORDER BY normalized_name = ? DESC, LOWER(name) = ? DESC, LENGTH(name), name
    LIMIT 1
  `).get(normalized, normalized, `${normalized}%`, normalized, normalized) as ReferenceMatch | undefined ?? null;
}

function findItemMatch(db: Database.Database, text: string): ReferenceMatch | null {
  const normalized = normalizeName(text);
  return db.prepare(`
    WITH candidates AS (
      SELECT item_id AS id, name, LOWER(name) AS normalized_name
      FROM item_metadata
      WHERE LOWER(name) = ?
         OR LOWER(COALESCE(wiki_name, '')) = ?
         OR LOWER(name) LIKE ?
         OR LOWER(COALESCE(wiki_name, '')) LIKE ?
      UNION
      SELECT item_id AS id, item_name AS name, normalized_item_name AS normalized_name
      FROM public_creature_loot
      WHERE normalized_item_name = ?
         OR normalized_item_name LIKE ?
    )
    SELECT id, name, normalized_name
    FROM candidates
    WHERE id IS NOT NULL AND name IS NOT NULL
    ORDER BY normalized_name = ? DESC, LENGTH(name), name
    LIMIT 1
  `).get(normalized, normalized, `${normalized}%`, `${normalized}%`, normalized, `${normalized}%`, normalized) as ReferenceMatch | undefined ?? null;
}

function buildEntryInput(db: Database.Database, payload: unknown, existing?: TaskboardEntryRow | null): TaskboardEntryRow {
  const row = asRecord(payload) ?? {};
  const entryType = asText(row.entry_type ?? row.entryType ?? existing?.entry_type).trim() === "item" ? "item" : "creature";
  const offerText = asText(row.offer_text ?? row.offerText ?? row.name ?? existing?.offer_text).trim();
  if (!offerText) {
    throw new Error("Taskboard entry name is required.");
  }
  const match = entryType === "creature" ? findCreatureMatch(db, offerText) : findItemMatch(db, offerText);
  const quantity = entryType === "item"
    ? nullablePositiveInteger(row.required_quantity ?? row.requiredQuantity ?? existing?.required_quantity)
    : null;
  const normalizedOfferText = normalizeName(offerText);
  return {
    id: existing?.id ?? 0,
    entry_type: entryType,
    offer_text: offerText,
    normalized_offer_text: normalizedOfferText,
    matched_name: match?.name ?? null,
    normalized_name: match?.normalized_name ?? normalizedOfferText,
    required_quantity: quantity,
    public_creature_id: entryType === "creature" ? match?.id ?? null : null,
    item_id: entryType === "item" ? match?.id ?? null : null,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso()
  };
}

function listCreaturePlaces(db: Database.Database, creatureId: number | null, normalizedName: string): CreaturePlace[] {
  return db.prepare(`
    SELECT hp.id, hp.name, hp.location, hp.min_level, hp.max_level, hp.risk_level,
           hpc.occurrence, hp.exp_stars, hp.loot_stars, hp.bestiary_stars
    FROM public_hunting_place_creatures hpc
    JOIN public_hunting_places hp ON hp.id = hpc.hunting_place_id
    WHERE (? IS NOT NULL AND hpc.creature_id = ?)
       OR (? != '' AND hpc.normalized_creature_name = ?)
    ORDER BY COALESCE(hp.max_level, hp.min_level, 0) DESC, COALESCE(hp.min_level, 0) DESC, hp.name
  `).all(creatureId, creatureId, normalizedName, normalizedName) as CreaturePlace[];
}

function extractMonsterKills(processedJson: unknown, normalizedCreatureName: string): number {
  try {
    const processed = JSON.parse(asText(processedJson) || "{}") as Record<string, unknown>;
    const parsed = asRecord(processed.parsed);
    const monsters = Array.isArray(parsed?.monsters)
      ? parsed.monsters
      : Array.isArray(processed.monsters)
        ? processed.monsters
        : [];
    return monsters.reduce((sum, entry) => {
      const monster = asRecord(entry) ?? {};
      return normalizeName(monster.name) === normalizedCreatureName
        ? sum + Math.max(0, asNumber(monster.count, 0))
        : sum;
    }, 0);
  } catch {
    return 0;
  }
}

function personalPaceRows(db: Database.Database, normalizedCreatureName: string): PersonalCreaturePace[] {
  const rows = db.prepare(`
    SELECT id, label, location_name, public_hunting_place_id, duration_minutes, processed_json, uploaded_at,
           total_xp, total_loot_gold, total_supply_cost
    FROM hunt_uploads
    WHERE processed_json IS NOT NULL AND processed_json != ''
    ORDER BY uploaded_at DESC, id DESC
    LIMIT 200
  `).all() as Array<Record<string, unknown>>;

  return rows
    .map((row) => {
      const duration = Math.max(1, asNumber(row.duration_minutes, 1));
      const hours = duration / 60;
      const kills = extractMonsterKills(row.processed_json, normalizedCreatureName);
      const profit = asNumber(row.total_loot_gold, 0) - asNumber(row.total_supply_cost, 0);
      return {
        hunt_id: asNumber(row.id, 0),
        label: asText(row.label),
        location_name: asText(row.location_name).trim() || null,
        public_hunting_place_id: nullablePositiveInteger(row.public_hunting_place_id),
        duration_minutes: duration,
        kills,
        kills_per_hour: Math.round(kills / hours),
        xp_per_hour: asNumber(row.total_xp, 0) > 0 ? Math.round(asNumber(row.total_xp, 0) / hours) : null,
        profit_per_hour: profit !== 0 ? Math.round(profit / hours) : null,
        profit_per_kill: kills > 0 && profit > 0 ? Math.round(profit / kills) : null,
        uploaded_at: asText(row.uploaded_at)
      };
    })
    .filter((row) => row.kills > 0)
    .sort((a, b) => b.kills_per_hour - a.kills_per_hour || b.kills - a.kills)
    .slice(0, 6);
}

function marketItemForEntry(db: Database.Database, entry: TaskboardEntryRow): MarketItem | null {
  const run = latestMarketRun(db);
  if (!run || (!entry.item_id && !entry.normalized_name)) {
    return null;
  }
  return db.prepare(`
    SELECT mip.item_id, im.name, im.wiki_name, mip.client_value, mip.fair_price, mip.confidence,
           mif.sell_offer,
           (
             SELECT COALESCE(MAX(snapshot_at), MAX(fetched_at))
             FROM item_market_history imh
             WHERE imh.item_id = mip.item_id
               AND imh.server = ?
           ) AS last_seen_at
    FROM market_item_prices mip
    LEFT JOIN item_metadata im ON im.item_id = mip.item_id
    LEFT JOIN market_item_features mif ON mif.run_id = mip.run_id AND mif.item_id = mip.item_id
    WHERE mip.run_id = ?
      AND mip.pricing_model IN (?, 'conservative_min')
      AND ((? IS NOT NULL AND mip.item_id = ?)
        OR (? != '' AND (LOWER(im.name) = ? OR LOWER(im.wiki_name) = ?)))
    LIMIT 1
  `).get(
    config.serverName,
    run.id,
    config.pricingModel,
    entry.item_id,
    entry.item_id,
    entry.normalized_name,
    entry.normalized_name,
    entry.normalized_name
  ) as MarketItem | undefined ?? null;
}

function droppingCreatures(db: Database.Database, entry: TaskboardEntryRow, itemId: number | null): DropCreature[] {
  return db.prepare(`
    SELECT pcl.creature_id, COALESCE(pc.name, pcl.item_name) AS name, COALESCE(pc.normalized_name, pcl.normalized_item_name) AS normalized_name,
           pcl.chance_percent, pcl.min_count, pcl.max_count, pcl.rarity
    FROM public_creature_loot pcl
    LEFT JOIN public_creatures pc ON pc.id = pcl.creature_id
    WHERE (? IS NOT NULL AND pcl.item_id = ?)
       OR (? != '' AND pcl.normalized_item_name = ?)
    ORDER BY COALESCE(pcl.chance_percent, 0) DESC, COALESCE(pc.name, pcl.item_name)
    LIMIT 8
  `).all(itemId, itemId, entry.normalized_name, entry.normalized_name) as DropCreature[];
}

function placesForDropCreatures(db: Database.Database, creatures: DropCreature[]): CreaturePlace[] {
  const names = Array.from(new Set(creatures.map((creature) => creature.normalized_name).filter(Boolean))).slice(0, 8);
  if (!names.length) {
    return [];
  }
  const placeholders = names.map(() => "?").join(", ");
  return db.prepare(`
    SELECT DISTINCT hp.id, hp.name, hp.location, hp.min_level, hp.max_level, hp.risk_level,
           hpc.occurrence, hp.exp_stars, hp.loot_stars, hp.bestiary_stars
    FROM public_hunting_place_creatures hpc
    JOIN public_hunting_places hp ON hp.id = hpc.hunting_place_id
    WHERE hpc.normalized_creature_name IN (${placeholders})
    ORDER BY COALESCE(hp.loot_stars, 0) DESC, COALESCE(hp.exp_stars, 0) DESC, hp.name
    LIMIT 8
  `).all(...names) as CreaturePlace[];
}

function averageDropCount(creature: DropCreature): number {
  const min = creature.min_count && creature.min_count > 0 ? creature.min_count : 1;
  const max = creature.max_count && creature.max_count > 0 ? creature.max_count : min;
  return (min + max) / 2;
}

function estimatedKillsForQuantity(quantity: number, creature: DropCreature | null): number | null {
  if (!creature?.chance_percent || creature.chance_percent <= 0) {
    return null;
  }
  const expectedPerKill = (creature.chance_percent / 100) * averageDropCount(creature);
  return expectedPerKill > 0 ? Math.ceil(quantity / expectedPerKill) : null;
}

function riskRank(place: CreaturePlace): number {
  const text = asText(place.risk_level).toLowerCase();
  if (text.includes("safe") || text.includes("low")) return 0;
  if (text.includes("medium") || text.includes("moderate")) return 1;
  if (text.includes("high") || text.includes("danger")) return 3;
  return 2;
}

function bestSpawn(places: CreaturePlace[], paceRows: PersonalCreaturePace[]): CreaturePlace | null {
  const personalPlaceIds = new Set(paceRows.map((row) => row.public_hunting_place_id).filter(Boolean));
  return [...places].sort((a, b) => {
    const aPersonal = personalPlaceIds.has(a.id) ? 1 : 0;
    const bPersonal = personalPlaceIds.has(b.id) ? 1 : 0;
    return bPersonal - aPersonal
      || (Number(b.exp_stars || 0) + Number(b.loot_stars || 0)) - (Number(a.exp_stars || 0) + Number(a.loot_stars || 0))
      || riskRank(a) - riskRank(b)
      || a.name.localeCompare(b.name);
  })[0] ?? null;
}

function creaturePlaceOptions(places: CreaturePlace[], paceRows: PersonalCreaturePace[]): CreaturePlaceOption[] {
  const paceByPlace = new Map<number, PersonalCreaturePace>();
  for (const row of paceRows) {
    if (row.public_hunting_place_id && !paceByPlace.has(row.public_hunting_place_id)) {
      paceByPlace.set(row.public_hunting_place_id, row);
    }
  }

  return places
    .map((place) => {
      const personalPace = paceByPlace.get(place.id) ?? null;
      return {
        ...place,
        floor_level: place.min_level,
        difficulty_level: place.max_level ?? place.min_level,
        personal_pace: personalPace,
        sort_basis: personalPace ? "personal_hunt" as const : "reference_level" as const
      };
    })
    .sort((a, b) => {
      const aHasPace = a.personal_pace ? 1 : 0;
      const bHasPace = b.personal_pace ? 1 : 0;
      return bHasPace - aHasPace
        || Number(b.personal_pace?.kills_per_hour || 0) - Number(a.personal_pace?.kills_per_hour || 0)
        || Number(b.difficulty_level || 0) - Number(a.difficulty_level || 0)
        || Number(b.floor_level || 0) - Number(a.floor_level || 0)
        || riskRank(b) - riskRank(a)
        || a.name.localeCompare(b.name);
    });
}

function combineHints(entry: TaskboardEntryRow, allEntries: TaskboardEntryRow[], places: CreaturePlace[], dropCreatures: DropCreature[] = []) {
  const placeIds = new Set(places.map((place) => place.id));
  const dropNames = new Set(dropCreatures.map((creature) => creature.normalized_name));
  const hints = allEntries
    .filter((other) => other.id !== entry.id)
    .map((other) => {
      if (entry.entry_type === "item" && other.entry_type === "creature" && dropNames.has(other.normalized_name)) {
        return {
          entry_id: other.id,
          name: entryDisplayName(other),
          reason: `${entryDisplayName(other)} can drop ${entryDisplayName(entry)}.`
        };
      }
      if (entry.entry_type === "creature" && other.entry_type === "item") {
        return null;
      }
      const shared = places.find((place) => placeIds.has(place.id));
      return shared && other.entry_type === entry.entry_type
        ? { entry_id: other.id, name: entryDisplayName(other), reason: `May share hunting route around ${shared.name}.` }
        : null;
    })
    .filter((hint): hint is { entry_id: number; name: string; reason: string } => Boolean(hint));
  return Array.from(new Map(hints.map((hint) => [hint.entry_id, hint])).values()).slice(0, 4);
}

function creatureGuidance(db: Database.Database, entry: TaskboardEntryRow, allEntries: TaskboardEntryRow[]) {
  const places = listCreaturePlaces(db, entry.public_creature_id, entry.normalized_name);
  const paceRows = personalPaceRows(db, entry.normalized_name);
  const placeOptions = creaturePlaceOptions(places, paceRows);
  const bestPersonal = paceRows[0] ?? null;
  const best = placeOptions[0] ?? bestSpawn(places, paceRows);
  const sourceRef = entityRef("creature", { id: entry.public_creature_id, name: entryDisplayName(entry), normalized_name: entry.normalized_name });
  const reasons: InsightExplanation[] = [];
  const warnings: InsightExplanation[] = [];

  if (best) {
    reasons.push(explanation("best spawn found", "positive", "Local hunting-place data has plausible spawns for this weekly creature.", {
      source_refs: [sourceRef, entityRef("hunting_place", { id: best.id, name: best.name })],
      provenance: [provenance("public_tibia_reference", { source_ref: sourceRef })]
    }));
  } else {
    warnings.push(explanation("spawn unknown", "warning", "No local hunting-place data currently contains this creature.", {
      source_refs: [sourceRef],
      provenance: [provenance("public_tibia_reference")],
      missing_data_reason: "Enrich public hunting-place data or enter a creature id/name that matches the local reference."
    }));
  }

  if (bestPersonal) {
    reasons.push(explanation("personal pace known", "positive", "Saved hunt history gives a rough kills/hour estimate.", {
      source_refs: [sourceRef, entityRef("hunt", { id: bestPersonal.hunt_id, name: bestPersonal.label })],
      provenance: [provenance("personal_hunt", { source_id: bestPersonal.hunt_id }), provenance("derived_calculation")]
    }));
  }

  const score = best && bestPersonal ? 0.85 : best || bestPersonal ? 0.58 : 0.25;
  return {
    mode: "hunt",
    recommendation: best ? `Hunt ${best.name}` : "Need spawn data",
    best_spawn: best,
    known_hunting_places: placeOptions,
    personal_pace: bestPersonal,
    combine_hints: combineHints(entry, allEntries, places),
    confidence: confidence(score, {
      estimated: true,
      missingDataReason: best ? null : "Missing local hunting-place match for this creature."
    }),
    freshness: freshness(bestPersonal?.uploaded_at ?? null, {
      staleAfterHours: 24 * 90,
      agingAfterHours: 24 * 30,
      missingDataReason: bestPersonal ? null : "No saved hunt pace for this creature."
    }),
    provenance: [provenance("public_tibia_reference", { source_ref: sourceRef }), provenance("derived_calculation")] as Provenance[],
    reasons,
    warnings
  };
}

function itemGuidance(db: Database.Database, entry: TaskboardEntryRow, allEntries: TaskboardEntryRow[]) {
  const market = marketItemForEntry(db, entry);
  const itemId = market?.item_id ?? entry.item_id;
  const drops = droppingCreatures(db, entry, itemId);
  const bestDrop = drops[0] ?? null;
  const places = placesForDropCreatures(db, drops);
  const quantity = Math.max(1, entry.required_quantity ?? 1);
  const unitPrice = Math.max(0, asNumber(market?.client_value, 0));
  const buyCost = unitPrice > 0 ? unitPrice * quantity : null;
  const estimatedKills = estimatedKillsForQuantity(quantity, bestDrop);
  const bestDropPace = bestDrop ? personalPaceRows(db, bestDrop.normalized_name)[0] ?? null : null;
  const farmValuePerItem = bestDropPace?.profit_per_kill && estimatedKills
    ? Math.round(bestDropPace.profit_per_kill * (estimatedKills / quantity))
    : null;
  const breakEvenUnitPrice = farmValuePerItem;
  const sourceRef = entityRef("item", { id: itemId, name: market?.name ?? entryDisplayName(entry), normalized_name: entry.normalized_name });
  const reasons: InsightExplanation[] = [];
  const warnings: InsightExplanation[] = [];
  const recommendation = buyCost !== null && breakEvenUnitPrice !== null
    ? unitPrice <= breakEvenUnitPrice ? "buy" : "farm"
    : buyCost !== null && estimatedKills !== null
      ? buyCost <= 50000 ? "buy" : "farm"
      : "unknown";

  if (buyCost !== null) {
    reasons.push(explanation(recommendation === "buy" ? "buy item" : "price check", "neutral", "Local market data can price this weekly item quantity.", {
      source_refs: [sourceRef],
      provenance: [provenance("market_sync", { source_ref: sourceRef, observed_at: market?.last_seen_at ?? null })]
    }));
  } else {
    warnings.push(explanation("market unknown", "warning", "No local market price is available for this item.", {
      source_refs: [sourceRef],
      provenance: [provenance("market_sync")],
      missing_data_reason: "Run market refresh or enter a known item id."
    }));
  }

  if (estimatedKills !== null) {
    reasons.push(explanation("farm estimate", "neutral", "Public loot chance data can estimate rough kills needed.", {
      source_refs: [sourceRef],
      provenance: [provenance("public_tibia_reference", { source_ref: sourceRef }), provenance("derived_calculation")]
    }));
  } else {
    warnings.push(explanation("drop data unknown", "warning", "No usable drop chance is available for this item.", {
      source_refs: [sourceRef],
      provenance: [provenance("public_tibia_reference")],
      missing_data_reason: "Enrich creature loot data for this item."
    }));
  }

  return {
    mode: recommendation,
    recommendation: recommendation === "buy"
      ? "Buy from market"
      : recommendation === "farm"
        ? "Farm instead"
        : "Need price or drop data",
    required_quantity: quantity,
    unit_market_price: unitPrice || null,
    market_buy_cost: buyCost,
    estimated_kills_needed: estimatedKills,
    best_drop_creature: bestDrop,
    break_even_unit_price: breakEvenUnitPrice,
    dropping_creatures: drops,
    hunting_places: places,
    combine_hints: combineHints(entry, allEntries, places, drops),
    confidence: confidence(market && estimatedKills !== null ? 0.82 : market || estimatedKills !== null ? 0.55 : 0.2, {
      estimated: true,
      missingDataReason: market && estimatedKills !== null ? null : "Missing price or drop chance data."
    }),
    freshness: freshness(market?.last_seen_at ?? null, {
      staleAfterHours: 24 * 21,
      agingAfterHours: 24 * 10,
      missingDataReason: market ? null : "No local market timestamp is available."
    }),
    provenance: [
      ...(market ? [provenance("market_sync", { source_ref: sourceRef, observed_at: market.last_seen_at })] : []),
      provenance("public_tibia_reference", { source_ref: sourceRef }),
      provenance("derived_calculation")
    ] as Provenance[],
    reasons,
    warnings
  };
}

function getEntryGuidance(db: Database.Database, entry: TaskboardEntryRow, allEntries: TaskboardEntryRow[]) {
  return entry.entry_type === "creature"
    ? creatureGuidance(db, entry, allEntries)
    : itemGuidance(db, entry, allEntries);
}

function entryWithGuidance(db: Database.Database, row: TaskboardEntryRow, allRows: TaskboardEntryRow[]) {
  return {
    ...normalizeEntryRow(row),
    guidance: getEntryGuidance(db, row, allRows)
  };
}

function getEntryRow(db: Database.Database, entryId: number): TaskboardEntryRow | null {
  return db.prepare("SELECT * FROM taskboard_entries WHERE id = ?").get(Math.trunc(entryId)) as TaskboardEntryRow | undefined ?? null;
}

export function listTaskboardEntries(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare("SELECT * FROM taskboard_entries ORDER BY created_at, id").all() as TaskboardEntryRow[];
  const items = rows.map((row) => entryWithGuidance(db, row, rows));
  return {
    ok: true,
    items,
    summary: {
      total: items.length,
      creatures: items.filter((item) => item.entry_type === "creature").length,
      delivery_items: items.filter((item) => item.entry_type === "item").length,
      combine_hints: items.reduce((sum, item) => sum + (Array.isArray(item.guidance.combine_hints) ? item.guidance.combine_hints.length : 0), 0)
    }
  };
}

export function createTaskboardEntry(db: Database.Database, payload: unknown): Record<string, unknown> {
  const input = buildEntryInput(db, payload);
  const result = db.prepare(`
    INSERT INTO taskboard_entries (
      entry_type, offer_text, normalized_offer_text, matched_name, normalized_name,
      required_quantity, public_creature_id, item_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.entry_type,
    input.offer_text,
    input.normalized_offer_text,
    input.matched_name,
    input.normalized_name,
    input.required_quantity,
    input.public_creature_id,
    input.item_id,
    input.created_at,
    input.updated_at
  );
  const row = getEntryRow(db, Number(result.lastInsertRowid));
  const rows = db.prepare("SELECT * FROM taskboard_entries ORDER BY created_at, id").all() as TaskboardEntryRow[];
  return { ok: true, item: row ? entryWithGuidance(db, row, rows) : null };
}

export function updateTaskboardEntry(db: Database.Database, entryId: number, payload: unknown): Record<string, unknown> | null {
  const existing = getEntryRow(db, entryId);
  if (!existing) {
    return null;
  }
  const input = buildEntryInput(db, payload, existing);
  db.prepare(`
    UPDATE taskboard_entries
    SET entry_type = ?, offer_text = ?, normalized_offer_text = ?, matched_name = ?, normalized_name = ?,
        required_quantity = ?, public_creature_id = ?, item_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.entry_type,
    input.offer_text,
    input.normalized_offer_text,
    input.matched_name,
    input.normalized_name,
    input.required_quantity,
    input.public_creature_id,
    input.item_id,
    input.updated_at,
    existing.id
  );
  const row = getEntryRow(db, entryId);
  const rows = db.prepare("SELECT * FROM taskboard_entries ORDER BY created_at, id").all() as TaskboardEntryRow[];
  return row ? { ok: true, item: entryWithGuidance(db, row, rows) } : null;
}

export function deleteTaskboardEntry(db: Database.Database, entryId: number): boolean {
  const result = db.prepare("DELETE FROM taskboard_entries WHERE id = ?").run(Math.trunc(entryId));
  return result.changes > 0;
}

export function getTaskboardEntry(db: Database.Database, entryId: number): Record<string, unknown> | null {
  const row = getEntryRow(db, entryId);
  if (!row) {
    return null;
  }
  const rows = db.prepare("SELECT * FROM taskboard_entries ORDER BY created_at, id").all() as TaskboardEntryRow[];
  return { ok: true, item: entryWithGuidance(db, row, rows) };
}
