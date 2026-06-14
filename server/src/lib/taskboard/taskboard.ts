import type Database from "better-sqlite3";
import { config } from "../../config";
import {
  confidence as buildConfidence,
  entityRef,
  explanation,
  freshness as buildFreshness,
  labelsFromExplanations,
  provenance
} from "../intelligence/metadata";
import type { Confidence, Freshness, InsightExplanation, Provenance } from "../intelligence/types";
import { asNumber, asNumberOrNull, asRecord, asText, normalizeLootItemName, nowIso } from "../hunts/utils";

export type TaskType = "creature" | "delivery_item";
export type TaskStatus = "planned" | "accepted" | "active" | "completed" | "skipped" | "rerolled";
export type PracticalLabel =
  | "good task"
  | "easy completion"
  | "buy item instead of farming"
  | "farm item instead of buying"
  | "skip/reroll"
  | "unknown";

type TaskRow = {
  id: number;
  task_type: TaskType;
  title: string;
  desired_quantity: number;
  completed_quantity: number;
  status: TaskStatus;
  difficulty: string | null;
  category: string | null;
  character_name: string | null;
  level_override: number | null;
  vocation_override: string | null;
  notes: string | null;
  public_creature_id: number | null;
  normalized_creature_name: string | null;
  item_id: number | null;
  item_name: string | null;
  normalized_item_name: string | null;
  final_cost: number | null;
  final_reward: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
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

type PersonalKph = {
  hunt_id: number;
  label: string;
  location_name: string | null;
  public_hunting_place_id: number | null;
  duration_minutes: number;
  kills: number;
  kills_per_hour: number;
  xp_per_hour: number | null;
  profit_per_hour: number | null;
  uploaded_at: string;
};

type DropCreature = {
  creature_id: number | null;
  name: string;
  normalized_name: string;
  chance_percent: number | null;
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

type NpcValue = {
  item_id: number;
  npc_name: string;
  location: string;
  price: number;
  fetched_at: string;
};

export type TaskboardTask = ReturnType<typeof normalizeTaskRow>;

function normalizeName(value: unknown): string {
  return normalizeLootItemName(asText(value));
}

function positiveInteger(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : fallback;
}

function nullablePositiveInteger(value: unknown): number | null {
  const parsed = asNumberOrNull(value);
  return parsed && parsed > 0 ? Math.trunc(parsed) : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = asText(value).trim();
  return allowed.includes(text as T) ? text as T : fallback;
}

function latestMarketRun(db: Database.Database): { id: number; finished_at: string | null } | null {
  return db
    .prepare("SELECT id, finished_at FROM market_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1")
    .get() as { id: number; finished_at: string | null } | undefined ?? null;
}

function normalizeTaskRow(row: TaskRow) {
  return {
    id: asNumber(row.id, 0),
    task_type: row.task_type,
    title: row.title,
    desired_quantity: Math.max(0, asNumber(row.desired_quantity, 0)),
    completed_quantity: Math.max(0, asNumber(row.completed_quantity, 0)),
    status: row.status,
    difficulty: row.difficulty,
    category: row.category,
    character_name: row.character_name,
    level_override: row.level_override,
    vocation_override: row.vocation_override,
    notes: row.notes,
    creature: row.task_type === "creature"
      ? {
        public_creature_id: row.public_creature_id,
        normalized_creature_name: row.normalized_creature_name,
        name: row.title
      }
      : null,
    delivery_item: row.task_type === "delivery_item"
      ? {
        item_id: row.item_id,
        item_name: row.item_name ?? row.title,
        normalized_item_name: row.normalized_item_name
      }
      : null,
    final_cost: row.final_cost,
    final_reward: row.final_reward,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at
  };
}

function eventRows(db: Database.Database, taskId: number): Array<Record<string, unknown>> {
  return db
    .prepare(
      `
      SELECT id, task_id, event_type, status_from, status_to, quantity_delta, linked_hunt_id, notes, payload_json, created_at
      FROM taskboard_task_events
      WHERE task_id = ?
      ORDER BY created_at DESC, id DESC
      `
    )
    .all(taskId) as Array<Record<string, unknown>>;
}

function parsePayloadJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(asText(value) || "{}");
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function addEvent(
  db: Database.Database,
  input: {
    taskId: number;
    eventType: string;
    statusFrom?: string | null;
    statusTo?: string | null;
    quantityDelta?: number | null;
    linkedHuntId?: number | null;
    notes?: string | null;
    payload?: Record<string, unknown>;
  }
): void {
  const linkedHuntId = input.linkedHuntId && input.linkedHuntId > 0 ? Math.trunc(input.linkedHuntId) : null;
  db.prepare(
    `
    INSERT INTO taskboard_task_events (
      task_id, event_type, status_from, status_to, quantity_delta, linked_hunt_id, notes, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    Math.trunc(input.taskId),
    input.eventType,
    input.statusFrom ?? null,
    input.statusTo ?? null,
    input.quantityDelta ?? null,
    linkedHuntId,
    input.notes ?? null,
    JSON.stringify(input.payload ?? {}),
    nowIso()
  );

  if (linkedHuntId) {
    db.prepare(
      `
      INSERT INTO taskboard_task_hunts (task_id, hunt_id, linked_at, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(task_id, hunt_id) DO UPDATE SET notes = COALESCE(excluded.notes, taskboard_task_hunts.notes)
      `
    ).run(Math.trunc(input.taskId), linkedHuntId, nowIso(), input.notes ?? null);
  }
}

function buildTaskInput(payload: unknown, existing?: TaskRow | null): TaskRow {
  const row = asRecord(payload) ?? {};
  const taskType = oneOf(row.task_type ?? row.taskType ?? existing?.task_type, ["creature", "delivery_item"] as const, existing?.task_type ?? "creature");
  const desiredQuantity = positiveInteger(row.desired_quantity ?? row.desiredQuantity, existing?.desired_quantity ?? (taskType === "creature" ? 100 : 1));
  const completedQuantity = positiveInteger(row.completed_quantity ?? row.completedQuantity, existing?.completed_quantity ?? 0);
  const itemName = asText(row.item_name ?? row.itemName).trim() || existing?.item_name || null;
  const creatureName = asText(row.creature_name ?? row.creatureName).trim() || existing?.title || "";
  const explicitTitle = asText(row.title).trim();
  const title = explicitTitle
    || (taskType === "delivery_item" ? itemName : creatureName)
    || existing?.title
    || "Untitled task";
  const normalizedCreatureName = taskType === "creature"
    ? normalizeName((row.normalized_creature_name ?? row.normalizedCreatureName) ?? (creatureName || title))
    : null;
  const normalizedItemName = taskType === "delivery_item"
    ? normalizeName((row.normalized_item_name ?? row.normalizedItemName) ?? (itemName || title))
    : null;
  const status = oneOf(row.status ?? existing?.status, ["planned", "accepted", "active", "completed", "skipped", "rerolled"] as const, existing?.status ?? "planned");

  return {
    id: existing?.id ?? 0,
    task_type: taskType,
    title,
    desired_quantity: desiredQuantity,
    completed_quantity: completedQuantity,
    status,
    difficulty: asText(row.difficulty).trim() || existing?.difficulty || null,
    category: asText(row.category).trim() || existing?.category || null,
    character_name: asText(row.character_name ?? row.characterName).trim() || existing?.character_name || null,
    level_override: nullablePositiveInteger(row.level_override ?? row.levelOverride) ?? existing?.level_override ?? null,
    vocation_override: asText(row.vocation_override ?? row.vocationOverride).trim() || existing?.vocation_override || null,
    notes: asText(row.notes).trim() || existing?.notes || null,
    public_creature_id: taskType === "creature"
      ? nullablePositiveInteger(row.public_creature_id ?? row.publicCreatureId) ?? existing?.public_creature_id ?? null
      : null,
    normalized_creature_name: normalizedCreatureName,
    item_id: taskType === "delivery_item"
      ? nullablePositiveInteger(row.item_id ?? row.itemId) ?? existing?.item_id ?? null
      : null,
    item_name: taskType === "delivery_item" ? itemName ?? title : null,
    normalized_item_name: normalizedItemName,
    final_cost: nullablePositiveInteger(row.final_cost ?? row.finalCost) ?? existing?.final_cost ?? null,
    final_reward: nullablePositiveInteger(row.final_reward ?? row.finalReward) ?? existing?.final_reward ?? null,
    created_at: existing?.created_at ?? nowIso(),
    updated_at: nowIso(),
    completed_at: status === "completed" ? existing?.completed_at ?? nowIso() : null
  };
}

function getTaskRow(db: Database.Database, taskId: number): TaskRow | null {
  return db.prepare("SELECT * FROM taskboard_tasks WHERE id = ?").get(Math.trunc(taskId)) as TaskRow | undefined ?? null;
}

function listCreaturePlaces(db: Database.Database, task: TaskRow): CreaturePlace[] {
  if (!task.normalized_creature_name && !task.public_creature_id) {
    return [];
  }
  return db
    .prepare(
      `
      SELECT hp.id, hp.name, hp.location, hp.min_level, hp.max_level, hp.risk_level,
             hpc.occurrence, hp.exp_stars, hp.loot_stars, hp.bestiary_stars
      FROM public_hunting_place_creatures hpc
      JOIN public_hunting_places hp ON hp.id = hpc.hunting_place_id
      WHERE (? IS NOT NULL AND hpc.creature_id = ?)
         OR (? != '' AND hpc.normalized_creature_name = ?)
      ORDER BY COALESCE(hp.bestiary_stars, 0) DESC, COALESCE(hp.exp_stars, 0) DESC, hp.name
      LIMIT 8
      `
    )
    .all(task.public_creature_id, task.public_creature_id, task.normalized_creature_name ?? "", task.normalized_creature_name ?? "") as CreaturePlace[];
}

function extractMonsterKills(processedJson: unknown, normalizedCreatureName: string | null): number {
  if (!normalizedCreatureName) {
    return 0;
  }
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

function personalKphRows(db: Database.Database, task: TaskRow): PersonalKph[] {
  const rows = db
    .prepare(
      `
      SELECT id, label, location_name, public_hunting_place_id, duration_minutes, processed_json, uploaded_at,
             total_xp, total_loot_gold, total_supply_cost
      FROM hunt_uploads
      WHERE processed_json IS NOT NULL AND processed_json != ''
      ORDER BY uploaded_at DESC, id DESC
      LIMIT 200
      `
    )
    .all() as Array<Record<string, unknown>>;

  return rows
    .map((row) => {
      const duration = Math.max(1, asNumber(row.duration_minutes, 1));
      const kills = extractMonsterKills(row.processed_json, task.normalized_creature_name);
      const hours = duration / 60;
      const totalXp = asNumber(row.total_xp, 0);
      const profit = asNumber(row.total_loot_gold, 0) - asNumber(row.total_supply_cost, 0);
      return {
        hunt_id: asNumber(row.id, 0),
        label: asText(row.label),
        location_name: asText(row.location_name).trim() || null,
        public_hunting_place_id: nullablePositiveInteger(row.public_hunting_place_id),
        duration_minutes: duration,
        kills,
        kills_per_hour: Math.round(kills / hours),
        xp_per_hour: totalXp > 0 ? Math.round(totalXp / hours) : null,
        profit_per_hour: profit !== 0 ? Math.round(profit / hours) : null,
        uploaded_at: asText(row.uploaded_at)
      };
    })
    .filter((row) => row.kills > 0)
    .sort((a, b) => b.kills_per_hour - a.kills_per_hour || b.kills - a.kills)
    .slice(0, 6);
}

function marketItemForTask(db: Database.Database, task: TaskRow): MarketItem | null {
  const run = latestMarketRun(db);
  if (!run || (!task.item_id && !task.normalized_item_name)) {
    return null;
  }
  return db
    .prepare(
      `
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
        AND mip.pricing_model = 'conservative_min'
        AND ((? IS NOT NULL AND mip.item_id = ?)
          OR (? != '' AND (LOWER(im.name) = ? OR LOWER(im.wiki_name) = ?)))
      LIMIT 1
      `
    )
    .get(
      config.serverName,
      run.id,
      task.item_id,
      task.item_id,
      task.normalized_item_name ?? "",
      task.normalized_item_name ?? "",
      task.normalized_item_name ?? ""
    ) as MarketItem | undefined ?? null;
}

function npcValueForItem(db: Database.Database, itemId: number | null): NpcValue | null {
  if (!itemId) {
    return null;
  }
  return db
    .prepare(
      `
      SELECT item_id, npc_name, location, price, fetched_at
      FROM item_npc_buy
      WHERE item_id = ?
      ORDER BY price DESC, fetched_at DESC
      LIMIT 1
      `
    )
    .get(itemId) as NpcValue | undefined ?? null;
}

function droppingCreatures(db: Database.Database, task: TaskRow): DropCreature[] {
  if (!task.normalized_item_name && !task.item_id) {
    return [];
  }
  return db
    .prepare(
      `
      SELECT pcl.creature_id, COALESCE(pc.name, pcl.item_name) AS name, pc.normalized_name,
             pcl.chance_percent, pcl.rarity
      FROM public_creature_loot pcl
      LEFT JOIN public_creatures pc ON pc.id = pcl.creature_id
      WHERE (? IS NOT NULL AND pcl.item_id = ?)
         OR (? != '' AND pcl.normalized_item_name = ?)
      ORDER BY COALESCE(pcl.chance_percent, 0) DESC, COALESCE(pc.name, pcl.item_name)
      LIMIT 8
      `
    )
    .all(task.item_id, task.item_id, task.normalized_item_name ?? "", task.normalized_item_name ?? "") as DropCreature[];
}

function placesForDropCreatures(db: Database.Database, creatures: DropCreature[]): CreaturePlace[] {
  const names = Array.from(new Set(creatures.map((creature) => creature.normalized_name).filter(Boolean))).slice(0, 8);
  if (!names.length) {
    return [];
  }
  const placeholders = names.map(() => "?").join(", ");
  return db
    .prepare(
      `
      SELECT DISTINCT hp.id, hp.name, hp.location, hp.min_level, hp.max_level, hp.risk_level,
             hpc.occurrence, hp.exp_stars, hp.loot_stars, hp.bestiary_stars
      FROM public_hunting_place_creatures hpc
      JOIN public_hunting_places hp ON hp.id = hpc.hunting_place_id
      WHERE hpc.normalized_creature_name IN (${placeholders})
      ORDER BY COALESCE(hp.loot_stars, 0) DESC, hp.name
      LIMIT 8
      `
    )
    .all(...names) as CreaturePlace[];
}

function completionRange(quantity: number, kph: number | null): { low_hours: number | null; high_hours: number | null; label: string } {
  if (!kph || kph <= 0 || quantity <= 0) {
    return { low_hours: null, high_hours: null, label: "Unknown time" };
  }
  const expected = quantity / kph;
  const low = Math.max(0.1, expected * 0.8);
  const high = Math.max(low, expected * 1.35);
  return {
    low_hours: Number(low.toFixed(1)),
    high_hours: Number(high.toFixed(1)),
    label: `${low.toFixed(1)}-${high.toFixed(1)}h`
  };
}

function riskRank(place: CreaturePlace): number {
  const text = asText(place.risk_level).toLowerCase();
  if (text.includes("safe") || text.includes("low")) {
    return 0;
  }
  if (text.includes("medium") || text.includes("moderate")) {
    return 1;
  }
  if (text.includes("high") || text.includes("danger")) {
    return 3;
  }
  return 2;
}

function safestPlace(places: CreaturePlace[], characterLevel: number | null): CreaturePlace | null {
  if (!places.length) {
    return null;
  }
  return [...places].sort((a, b) => {
    const aLevelGap = characterLevel && a.min_level ? Math.max(0, a.min_level - characterLevel) : 0;
    const bLevelGap = characterLevel && b.min_level ? Math.max(0, b.min_level - characterLevel) : 0;
    return riskRank(a) - riskRank(b)
      || aLevelGap - bLevelGap
      || (Number(b.exp_stars || 0) + Number(b.loot_stars || 0)) - (Number(a.exp_stars || 0) + Number(a.loot_stars || 0))
      || a.name.localeCompare(b.name);
  })[0] ?? null;
}

function uniqueExplanations(items: InsightExplanation[]): InsightExplanation[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.severity}:${item.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function guidanceConfidence(score: number | null, missing: string | null): Confidence {
  return buildConfidence(score, { estimated: true, missingDataReason: missing });
}

function labelsFrom(reasons: InsightExplanation[], warnings: InsightExplanation[]): PracticalLabel[] {
  const labels = [
    ...labelsFromExplanations(reasons, "positive"),
    ...labelsFromExplanations(reasons, "neutral"),
    ...labelsFromExplanations(warnings, "warning"),
    ...labelsFromExplanations(warnings, "blocked")
  ] as PracticalLabel[];
  return Array.from(new Set(labels)).filter(Boolean);
}

function creatureGuidance(db: Database.Database, task: TaskRow) {
  const places = listCreaturePlaces(db, task);
  const kphRows = personalKphRows(db, task);
  const bestKph = kphRows[0] ?? null;
  const safePlace = safestPlace(places, task.level_override);
  const range = completionRange(Math.max(1, task.desired_quantity - task.completed_quantity), bestKph?.kills_per_hour ?? null);
  const reasons: InsightExplanation[] = [];
  const warnings: InsightExplanation[] = [];
  const creatureRef = entityRef("creature", {
    id: task.public_creature_id,
    name: task.title,
    normalized_name: task.normalized_creature_name
  });

  if (places.length) {
    reasons.push(explanation("good task", "positive", "Known hunting-place data has places containing this creature.", {
      source_refs: [creatureRef],
      provenance: [provenance("public_tibia_reference", { source_ref: creatureRef })]
    }));
    if (safePlace) {
      reasons.push(explanation("safer option", "neutral", "A plausible lower-risk hunting place is available from local public reference data.", {
        source_refs: [creatureRef, entityRef("hunting_place", { id: safePlace.id, name: safePlace.name })],
        provenance: [provenance("public_tibia_reference", { source_ref: entityRef("hunting_place", { id: safePlace.id, name: safePlace.name }) })]
      }));
    }
  } else {
    warnings.push(explanation("unknown", "warning", "No local hunting-place reference currently contains this creature.", {
      source_refs: [creatureRef],
      provenance: [provenance("public_tibia_reference")],
      missing_data_reason: "Run or enrich public reference data for more hunting-place coverage."
    }));
  }

  if (bestKph) {
    reasons.push(explanation(range.high_hours !== null && range.high_hours <= 2 ? "easy completion" : "good task", "positive", "Personal hunt history provides a rough kills/hour estimate.", {
      source_refs: [creatureRef, entityRef("hunt", { id: bestKph.hunt_id, name: bestKph.label })],
      provenance: [provenance("personal_hunt", { source_id: bestKph.hunt_id, source_ref: entityRef("hunt", { id: bestKph.hunt_id, name: bestKph.label }) }), provenance("derived_calculation")]
    }));
  } else {
    warnings.push(explanation(places.length ? "unknown" : "skip/reroll", places.length ? "warning" : "blocked", "No saved hunt has personal kills/hour data for this creature yet.", {
      source_refs: [creatureRef],
      provenance: [provenance("personal_hunt")],
      missing_data_reason: "Save a hunt with this creature to estimate completion time."
    }));
  }

  const confidenceScore = bestKph && places.length ? 0.82 : places.length || bestKph ? 0.55 : 0.2;
  const missing = !places.length
    ? "Missing local hunting-place reference data for this creature."
    : !bestKph
      ? "Missing personal kills/hour history for this creature."
      : null;
  const freshness = buildFreshness(bestKph?.uploaded_at ?? null, {
    staleAfterHours: 24 * 90,
    agingAfterHours: 24 * 30,
    missingDataReason: "No personal hunt timestamp is available for this creature."
  });

  return {
    type: "creature",
    practical_labels: labelsFrom(uniqueExplanations(reasons), uniqueExplanations(warnings)),
    confidence: guidanceConfidence(confidenceScore, missing),
    freshness,
    provenance: [
      provenance("public_tibia_reference", { source_ref: creatureRef }),
      ...(bestKph ? [provenance("personal_hunt", { source_id: bestKph.hunt_id })] : []),
      provenance("derived_calculation")
    ] as Provenance[],
    reasons: uniqueExplanations(reasons),
    warnings: uniqueExplanations(warnings),
    known_hunting_places: places,
    safest_plausible_place: safePlace,
    personal_hunts: kphRows,
    best_personal_place: bestKph,
    expected_personal_performance: bestKph
      ? {
          xp_per_hour: bestKph.xp_per_hour,
          profit_per_hour: bestKph.profit_per_hour,
          source_hunt_id: bestKph.hunt_id,
          label: "Estimated from your best matching saved hunt."
        }
      : null,
    expected_completion: range
  };
}

function deliveryGuidance(db: Database.Database, task: TaskRow) {
  const market = marketItemForTask(db, task);
  const npc = npcValueForItem(db, market?.item_id ?? task.item_id);
  const drops = droppingCreatures(db, { ...task, item_id: market?.item_id ?? task.item_id });
  const places = placesForDropCreatures(db, drops);
  const reasons: InsightExplanation[] = [];
  const warnings: InsightExplanation[] = [];
  const itemRef = entityRef("item", {
    id: market?.item_id ?? task.item_id,
    name: market?.name ?? market?.wiki_name ?? task.item_name ?? task.title,
    normalized_name: task.normalized_item_name
  });
  const unitCost = Math.max(0, asNumber(market?.client_value, 0));
  const totalCost = unitCost > 0 ? unitCost * Math.max(1, task.desired_quantity - task.completed_quantity) : null;

  if (totalCost !== null) {
    reasons.push(explanation(totalCost <= 50000 ? "buy item instead of farming" : "farm item instead of buying", totalCost <= 50000 ? "positive" : "neutral", "Local market data can price the delivery quantity.", {
      source_refs: [itemRef],
      provenance: [provenance("market_sync", { source_ref: itemRef, observed_at: market?.last_seen_at ?? null })]
    }));
  } else {
    warnings.push(explanation("unknown", "warning", "No local market price is available for this delivery item.", {
      source_refs: [itemRef],
      provenance: [provenance("market_sync")],
      missing_data_reason: "Run market refresh or link the task to a known item id."
    }));
  }

  if (drops.length) {
    reasons.push(explanation(totalCost !== null && totalCost <= 50000 ? "buy item instead of farming" : "farm item instead of buying", "neutral", "Public creature loot data has dropping creatures for this item.", {
      source_refs: [itemRef],
      provenance: [provenance("public_tibia_reference", { source_ref: itemRef })]
    }));
  } else {
    warnings.push(explanation("unknown", "warning", "No dropping creatures are available in local public reference data.", {
      source_refs: [itemRef],
      provenance: [provenance("public_tibia_reference")],
      missing_data_reason: "Run or enrich public reference data for creature loot coverage."
    }));
  }

  if (totalCost !== null && totalCost <= 10000 && task.desired_quantity <= 25) {
    reasons.push(explanation("easy completion", "positive", "Quantity and market cost look low enough for a quick completion.", {
      source_refs: [itemRef],
      provenance: [provenance("derived_calculation")]
    }));
  }

  const confidenceScore = market && drops.length ? 0.8 : market || drops.length ? 0.52 : 0.18;
  const missing = !market
    ? "Missing local market price for this item."
    : !drops.length
      ? "Missing public loot source data for this item."
      : null;
  const freshness = buildFreshness(market?.last_seen_at ?? null, {
    staleAfterHours: 24 * 14,
    agingAfterHours: 24 * 7,
    missingDataReason: "No local market timestamp is available for this delivery item."
  });

  return {
    type: "delivery_item",
    required_quantity: task.desired_quantity,
    market_buy_cost: totalCost,
    unit_market_price: unitCost || null,
    npc_vendor_value: npc ? npc.price * Math.max(1, task.desired_quantity) : null,
    npc_vendor: npc,
    practical_labels: labelsFrom(uniqueExplanations(reasons), uniqueExplanations(warnings)),
    confidence: guidanceConfidence(confidenceScore, missing),
    freshness,
    provenance: [
      ...(market ? [provenance("market_sync", { source_ref: itemRef, observed_at: market.last_seen_at })] : []),
      provenance("public_tibia_reference", { source_ref: itemRef }),
      provenance("derived_calculation")
    ] as Provenance[],
    reasons: uniqueExplanations(reasons),
    warnings: uniqueExplanations(warnings),
    dropping_creatures: drops,
    hunting_places: places
  };
}

export function getTaskGuidance(db: Database.Database, task: TaskRow) {
  return task.task_type === "creature" ? creatureGuidance(db, task) : deliveryGuidance(db, task);
}

function taskWithGuidance(db: Database.Database, row: TaskRow) {
  const task = normalizeTaskRow(row);
  return {
    ...task,
    guidance: getTaskGuidance(db, row),
    events: eventRows(db, row.id).map((event) => ({
      ...event,
      payload: parsePayloadJson(event.payload_json)
    }))
  };
}

export function listTaskboardTasks(db: Database.Database): Record<string, unknown> {
  const rows = db
    .prepare("SELECT * FROM taskboard_tasks ORDER BY status = 'completed', updated_at DESC, id DESC")
    .all() as TaskRow[];
  const items = rows.map((row) => taskWithGuidance(db, row));
  return {
    ok: true,
    items,
    summary: {
      total: items.length,
      active: items.filter((item) => item.status === "active").length,
      accepted: items.filter((item) => item.status === "accepted").length,
      planned: items.filter((item) => item.status === "planned").length,
      completed: items.filter((item) => item.status === "completed").length,
      skipped: items.filter((item) => item.status === "skipped").length,
      rerolled: items.filter((item) => item.status === "rerolled").length
    }
  };
}

export function createTaskboardTask(db: Database.Database, payload: unknown): Record<string, unknown> {
  const input = buildTaskInput(payload);
  const insert = db.transaction(() => {
    const inserted = db.prepare(
      `
      INSERT INTO taskboard_tasks (
        task_type, title, desired_quantity, completed_quantity, status, difficulty, category,
        character_name, level_override, vocation_override, notes, public_creature_id,
        normalized_creature_name, item_id, item_name, normalized_item_name, final_cost,
        final_reward, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      input.task_type,
      input.title,
      input.desired_quantity,
      input.completed_quantity,
      input.status,
      input.difficulty,
      input.category,
      input.character_name,
      input.level_override,
      input.vocation_override,
      input.notes,
      input.public_creature_id,
      input.normalized_creature_name,
      input.item_id,
      input.item_name,
      input.normalized_item_name,
      input.final_cost,
      input.final_reward,
      input.created_at,
      input.updated_at,
      input.completed_at
    );
    const taskId = Number(inserted.lastInsertRowid);
    addEvent(db, { taskId, eventType: "created", statusTo: input.status, payload: { desired_quantity: input.desired_quantity } });
    const linkedHuntId = nullablePositiveInteger((asRecord(payload) ?? {}).linked_hunt_id ?? (asRecord(payload) ?? {}).linkedHuntId);
    if (linkedHuntId) {
      addEvent(db, { taskId, eventType: "linked_hunt", linkedHuntId });
    }
    return taskId;
  });
  const taskId = insert();
  const row = getTaskRow(db, taskId);
  return { ok: true, item: row ? taskWithGuidance(db, row) : null };
}

export function updateTaskboardTask(db: Database.Database, taskId: number, payload: unknown): Record<string, unknown> | null {
  const existing = getTaskRow(db, taskId);
  if (!existing) {
    return null;
  }
  const input = buildTaskInput(payload, existing);
  const quantityDelta = input.completed_quantity - existing.completed_quantity;
  const linkedHuntId = nullablePositiveInteger((asRecord(payload) ?? {}).linked_hunt_id ?? (asRecord(payload) ?? {}).linkedHuntId);

  const update = db.transaction(() => {
    db.prepare(
      `
      UPDATE taskboard_tasks
      SET task_type = ?, title = ?, desired_quantity = ?, completed_quantity = ?, status = ?,
          difficulty = ?, category = ?, character_name = ?, level_override = ?, vocation_override = ?,
          notes = ?, public_creature_id = ?, normalized_creature_name = ?, item_id = ?, item_name = ?,
          normalized_item_name = ?, final_cost = ?, final_reward = ?, updated_at = ?, completed_at = ?
      WHERE id = ?
      `
    ).run(
      input.task_type,
      input.title,
      input.desired_quantity,
      input.completed_quantity,
      input.status,
      input.difficulty,
      input.category,
      input.character_name,
      input.level_override,
      input.vocation_override,
      input.notes,
      input.public_creature_id,
      input.normalized_creature_name,
      input.item_id,
      input.item_name,
      input.normalized_item_name,
      input.final_cost,
      input.final_reward,
      input.updated_at,
      input.completed_at,
      existing.id
    );
    const statusChanged = existing.status !== input.status;
    if (statusChanged || quantityDelta !== 0 || linkedHuntId) {
      addEvent(db, {
        taskId: existing.id,
        eventType: statusChanged ? "status_changed" : quantityDelta !== 0 ? "progress_updated" : "linked_hunt",
        statusFrom: statusChanged ? existing.status : null,
        statusTo: statusChanged ? input.status : null,
        quantityDelta: quantityDelta || null,
        linkedHuntId,
        notes: asText((asRecord(payload) ?? {}).event_notes ?? (asRecord(payload) ?? {}).eventNotes).trim() || null,
        payload: { completed_quantity: input.completed_quantity, desired_quantity: input.desired_quantity }
      });
    }
  });
  update();
  const row = getTaskRow(db, taskId);
  return row ? { ok: true, item: taskWithGuidance(db, row) } : null;
}

export function getTaskboardTask(db: Database.Database, taskId: number): Record<string, unknown> | null {
  const row = getTaskRow(db, taskId);
  return row ? { ok: true, item: taskWithGuidance(db, row) } : null;
}
