import type Database from "better-sqlite3";
import { confidence as buildConfidence, entityRef, explanation, freshness as buildFreshness, provenance } from "../intelligence/metadata";
import type { Confidence, Freshness, InsightExplanation, Provenance } from "../intelligence/types";
import { sameTibiaLevelWindow, tibiaLevelWindow } from "../levelRanges";
import { asNumber, asNumberOrNull, asRecord, asText, normalizeLootItemName } from "./utils";

type HistoryRow = {
  id: number;
  label: string;
  duration_minutes: number;
  total_xp: number;
  raw_total_xp: number;
  total_loot_gold: number;
  total_supply_cost: number;
  uploaded_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  location_name: string | null;
  character_name: string | null;
  character_level: number | null;
  public_hunting_place_id: number | null;
  hunting_place_match_mode: string | null;
  processed_json?: string | null;
};

type CreatureRow = {
  id: number | null;
  name: string;
  normalized_name: string;
  experience: number | null;
  hitpoints: number | null;
  bestiary_class: string | null;
  bestiary_difficulty: string | null;
};

type PublicLootRow = {
  normalized_creature_name: string;
  normalized_item_name: string;
  item_name: string;
  chance_percent: number | null;
  rarity: string | null;
  min_count: number | null;
  max_count: number | null;
  payload_json: string | null;
  creature_total_kills: number | null;
};

type MarketRun = {
  id: number;
  finished_at: string | null;
};

type MetricValue = {
  key: string;
  label: string;
  value: number | string;
  raw_value: number | null;
  tone: string;
  delta_pct: number | null;
  delta_label: string | null;
  comparison: string | null;
};

function perHour(value: number, durationMinutes: number): number {
  return Math.round(value / Math.max(durationMinutes / 60, 1 / 60));
}

function percent(part: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Number(((part / total) * 100).toFixed(1));
}

function deltaPct(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return null;
  }
  return Number((((current - baseline) / Math.abs(baseline)) * 100).toFixed(1));
}

function deltaLabel(delta: number | null): string | null {
  if (delta === null) {
    return null;
  }
  const arrow = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return `${arrow} ${Math.abs(delta).toFixed(1)}%`;
}

function avg(values: number[]): number | null {
  const rows = values.filter((value) => Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
}

function median(values: number[]): number | null {
  const rows = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!rows.length) {
    return null;
  }
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function safeAll<T>(db: Database.Database, sql: string, ...args: unknown[]): T[] {
  try {
    return db.prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

function safeGet<T>(db: Database.Database, sql: string, ...args: unknown[]): T | null {
  try {
    return db.prepare(sql).get(...args) as T | undefined ?? null;
  } catch {
    return null;
  }
}

function previewParsed(preview: Record<string, unknown>): Record<string, unknown> {
  return asRecord(preview.parsed) ?? {};
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined || value === "" ? null : asNumberOrNull(value);
}

function receivedDamageFromParsed(parsed: Record<string, unknown>): {
  total: number | null;
  max_dps: number | null;
  damage_types: Array<{ type: string; amount: number; percent: number | null }>;
  damage_sources: Array<{ name: string; amount: number; percent: number | null }>;
} | null {
  const row = asRecord(parsed.received_damage);
  if (!row) {
    return null;
  }
  const damageTypes = Array.isArray(row.damage_types)
    ? row.damage_types
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        type: asText(entry.type),
        amount: Math.max(0, asNumber(entry.amount, 0)),
        percent: asNumberOrNull(entry.percent)
      }))
      .filter((entry) => entry.type && entry.amount > 0)
    : [];
  const damageSources = Array.isArray(row.damage_sources)
    ? row.damage_sources
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        name: asText(entry.name),
        amount: Math.max(0, asNumber(entry.amount, 0)),
        percent: asNumberOrNull(entry.percent)
      }))
      .filter((entry) => entry.name && entry.amount > 0)
    : [];
  const total = asNumberOrNull(row.total);
  const maxDps = asNumberOrNull(row.max_dps);
  if (total === null && maxDps === null && !damageTypes.length && !damageSources.length) {
    return null;
  }
  return {
    total,
    max_dps: maxDps,
    damage_types: damageTypes,
    damage_sources: damageSources
  };
}

function receivedDamageSummary(receivedDamage: ReturnType<typeof receivedDamageFromParsed>): string {
  if (!receivedDamage) {
    return "Incoming damage is not part of the current Hunt Analyser import. Safety is inferred from healing, supplies, place risk, and monster metadata.";
  }
  const topType = receivedDamage.damage_types[0];
  const topSource = receivedDamage.damage_sources[0];
  const parts = [
    receivedDamage.total !== null ? `${receivedDamage.total.toLocaleString("en-US")} received damage` : null,
    receivedDamage.max_dps !== null ? `${receivedDamage.max_dps.toLocaleString("en-US")} max DPS` : null,
    topType ? `${topType.type} ${topType.percent === null ? "" : `${topType.percent}%`}`.trim() : null,
    topSource ? `${topSource.name} ${topSource.percent === null ? "" : `${topSource.percent}%`}`.trim() : null
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : "Incoming damage was imported from Input Analyser text.";
}

function selectedPlaceId(preview: Record<string, unknown>, saved?: Record<string, unknown> | null): number | null {
  const savedMatch = asRecord(saved?.hunting_place_match);
  const location = asRecord(preview.location);
  const locationMatch = asRecord(location?.hunting_place_match);
  return asNumberOrNull(savedMatch?.selected_hunting_place_id)
    ?? asNumberOrNull(locationMatch?.selected_hunting_place_id)
    ?? null;
}

function selectedPlaceName(preview: Record<string, unknown>, saved?: Record<string, unknown> | null): string | null {
  const location = asRecord(preview.location);
  return asText(location?.selected_name).trim()
    || asText(location?.suggested_name).trim()
    || asText(saved?.location_name).trim()
    || null;
}

function readHistory(db: Database.Database): HistoryRow[] {
  return safeAll<HistoryRow>(db, `
    SELECT id, label, duration_minutes, total_xp, raw_total_xp, total_loot_gold, total_supply_cost,
           uploaded_at, started_at, ended_at, location_name, character_name, public_hunting_place_id,
           character_level, hunting_place_match_mode, processed_json
    FROM hunt_uploads
    ORDER BY COALESCE(ended_at, started_at, uploaded_at) DESC, id DESC
    LIMIT 250
  `).map((row) => ({
    ...row,
    id: asNumber(row.id, 0),
    duration_minutes: Math.max(1, asNumber(row.duration_minutes, 1)),
    total_xp: Math.max(0, asNumber(row.total_xp, 0)),
    raw_total_xp: Math.max(0, asNumber(row.raw_total_xp, row.total_xp)),
    total_loot_gold: Math.max(0, asNumber(row.total_loot_gold, 0)),
    total_supply_cost: Math.max(0, asNumber(row.total_supply_cost, 0)),
    character_level: asNumberOrNull(row.character_level),
    public_hunting_place_id: asNumberOrNull(row.public_hunting_place_id)
  }));
}

function readCreatures(db: Database.Database, names: string[]): Map<string, CreatureRow> {
  const unique = Array.from(new Set(names.map(normalizeLootItemName).filter(Boolean)));
  if (!unique.length) {
    return new Map();
  }
  const placeholders = unique.map(() => "?").join(",");
  const rows = safeAll<CreatureRow>(db, `
    SELECT id, name, normalized_name, experience, hitpoints, bestiary_class, bestiary_difficulty
    FROM public_creatures
    WHERE normalized_name IN (${placeholders})
  `, ...unique);
  return new Map(rows.map((row) => [row.normalized_name, {
    ...row,
    id: asNumberOrNull(row.id),
    experience: asNumberOrNull(row.experience),
    hitpoints: asNumberOrNull(row.hitpoints)
  }]));
}

function readPublicLoot(db: Database.Database, creatureNames: string[], itemNames: string[]): PublicLootRow[] {
  const creatures = Array.from(new Set(creatureNames.map(normalizeLootItemName).filter(Boolean)));
  const items = Array.from(new Set(itemNames.map(normalizeLootItemName).filter(Boolean)));
  if (!creatures.length || !items.length) {
    return [];
  }
  const creaturePlaceholders = creatures.map(() => "?").join(",");
  const itemPlaceholders = items.map(() => "?").join(",");
  return safeAll<PublicLootRow>(db, `
    SELECT pc.normalized_name AS normalized_creature_name, pcl.normalized_item_name, pcl.item_name,
           pcl.chance_percent, pcl.rarity, pcl.min_count, pcl.max_count, pcl.payload_json,
           pc.total_kills AS creature_total_kills
    FROM public_creature_loot pcl
    JOIN public_creatures pc ON pc.id = pcl.creature_id
    WHERE pc.normalized_name IN (${creaturePlaceholders})
      AND pcl.normalized_item_name IN (${itemPlaceholders})
  `, ...creatures, ...items).map((row) => ({
    ...row,
    chance_percent: asNumberOrNull(row.chance_percent),
    min_count: asNumberOrNull(row.min_count),
    max_count: asNumberOrNull(row.max_count),
    creature_total_kills: asNumberOrNull(row.creature_total_kills)
  }));
}

function readMarketRun(db: Database.Database): MarketRun | null {
  return safeGet<MarketRun>(db, `
    SELECT id, finished_at
    FROM market_runs
    WHERE status = 'success'
    ORDER BY finished_at DESC, id DESC
    LIMIT 1
  `);
}

function historyMetric(row: HistoryRow) {
  const profit = row.total_loot_gold - row.total_supply_cost;
  const kills = parsedTotalKills(row);
  return {
    id: row.id,
    label: row.label,
    profit,
    profit_per_hour: perHour(profit, row.duration_minutes),
    loot_per_hour: perHour(row.total_loot_gold, row.duration_minutes),
    xp_per_hour: perHour(row.total_xp, row.duration_minutes),
    supplies_per_hour: perHour(row.total_supply_cost, row.duration_minutes),
    kills_per_hour: kills === null ? null : perHour(kills, row.duration_minutes),
    profit_margin_pct: percent(profit, row.total_loot_gold),
    supply_ratio: percent(row.total_supply_cost, row.total_loot_gold),
    character_level: row.character_level,
    duration_minutes: row.duration_minutes,
    date: row.ended_at ?? row.started_at ?? row.uploaded_at
  };
}

function parsedTotalKills(row: HistoryRow): number | null {
  try {
    const processed = JSON.parse(asText(row.processed_json));
    const parsed = asRecord(processed.parsed);
    const monsters = Array.isArray(parsed?.monsters)
      ? parsed?.monsters
      : Array.isArray(processed.monsters)
        ? processed.monsters
        : [];
    const total = monsters.reduce((sum: number, monster: Record<string, unknown>) => sum + Math.max(0, asNumber(monster.count, 0)), 0);
    return total > 0 ? total : null;
  } catch {
    return null;
  }
}

function parsedMonsterSignature(row: HistoryRow): Map<string, number> {
  try {
    const processed = JSON.parse(asText(row.processed_json));
    const parsed = asRecord(processed.parsed);
    const monsters = Array.isArray(parsed?.monsters)
      ? parsed?.monsters
      : Array.isArray(processed.monsters)
        ? processed.monsters
        : [];
    const total = monsters.reduce((sum: number, monster: Record<string, unknown>) => sum + Math.max(0, asNumber(monster.count, 0)), 0);
    const out = new Map<string, number>();
    for (const monster of monsters) {
      const name = normalizeLootItemName(asText(monster.name));
      const count = Math.max(0, asNumber(monster.count, 0));
      if (name && count > 0 && total > 0) {
        out.set(name, count / total);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

function signatureOverlap(a: Map<string, number>, b: Map<string, number>): number {
  let overlap = 0;
  for (const [name, pct] of a.entries()) {
    overlap += Math.min(pct, b.get(name) ?? 0);
  }
  return Number(overlap.toFixed(4));
}

function comparisonSummary(label: string, rows: ReturnType<typeof historyMetric>[], current: { profit_per_hour: number; loot_per_hour: number; xp_per_hour: number; supplies_per_hour: number; kills_per_hour: number; profit_margin_pct: number | null }) {
  const profit = median(rows.map((row) => row.profit_per_hour));
  const loot = median(rows.map((row) => row.loot_per_hour));
  const xp = median(rows.map((row) => row.xp_per_hour));
  const supplies = median(rows.map((row) => row.supplies_per_hour));
  const kills = median(rows.map((row) => row.kills_per_hour ?? Number.NaN));
  const profitMargin = median(rows.map((row) => row.profit_margin_pct ?? Number.NaN));
  return {
    label,
    hunt_count: rows.length,
    profit_per_hour: Math.round(profit ?? 0),
    loot_per_hour: Math.round(loot ?? 0),
    xp_per_hour: Math.round(xp ?? 0),
    supplies_per_hour: Math.round(supplies ?? 0),
    kills_per_hour: Math.round(kills ?? 0),
    profit_margin_pct: profitMargin === null ? null : Number(profitMargin.toFixed(1)),
    profit_delta_pct: deltaPct(current.profit_per_hour, profit),
    loot_delta_pct: deltaPct(current.loot_per_hour, loot),
    xp_delta_pct: deltaPct(current.xp_per_hour, xp),
    supplies_delta_pct: deltaPct(current.supplies_per_hour, supplies),
    kills_delta_pct: deltaPct(current.kills_per_hour, kills),
    profit_margin_delta_pct: deltaPct(current.profit_margin_pct, profitMargin)
  };
}

function topComparisons(
  preview: Record<string, unknown>,
  saved: Record<string, unknown> | null,
  history: HistoryRow[],
  current: { profit_per_hour: number; loot_per_hour: number; xp_per_hour: number; supplies_per_hour: number; kills_per_hour: number; profit_margin_pct: number | null },
  placeId: number | null
) {
  const savedId = asNumberOrNull(saved?.id);
  const characterName = asText(saved?.character_name).trim();
  const currentLevel = asNumberOrNull(saved?.character_level);
  const currentRow: ReturnType<typeof historyMetric> = {
    id: savedId ?? 0,
    label: asText(saved?.label) || "Current hunt",
    profit: 0,
    profit_per_hour: current.profit_per_hour,
    loot_per_hour: current.loot_per_hour,
    xp_per_hour: current.xp_per_hour,
    supplies_per_hour: current.supplies_per_hour,
    kills_per_hour: current.kills_per_hour,
    profit_margin_pct: current.profit_margin_pct,
    supply_ratio: null,
    character_level: currentLevel,
    duration_minutes: 0,
    date: null
  };
  const historicalRows = history.filter((row) => row.id !== savedId);
  const rows = [currentRow, ...historicalRows.map(historyMetric)];
  const canonical = history.filter((row) => row.id !== savedId && asText(row.hunting_place_match_mode) !== "mixed_route");
  const samePlace = [currentRow, ...(placeId ? canonical.filter((row) => row.public_hunting_place_id === placeId).map(historyMetric) : [])];
  const sameCharacter = characterName
    ? [currentRow, ...historicalRows.filter((row) => asText(row.character_name).toLowerCase() === characterName.toLowerCase()).map(historyMetric)]
    : [currentRow];
  const last10 = rows.slice(0, 10);
  const currentSignature = new Map<string, number>();
  const monsters = Array.isArray(preview.monsters) ? preview.monsters as Array<Record<string, unknown>> : [];
  const totalKills = monsters.reduce((sum, monster) => sum + Math.max(0, asNumber(monster.count, 0)), 0);
  for (const monster of monsters) {
    const name = normalizeLootItemName(asText(monster.name));
    const count = Math.max(0, asNumber(monster.count, 0));
    if (name && count > 0 && totalKills > 0) {
      currentSignature.set(name, count / totalKills);
    }
  }
  const similar = historicalRows
    .map((row) => ({ row, overlap: signatureOverlap(currentSignature, parsedMonsterSignature(row)) }))
    .filter((entry) => entry.overlap >= 0.5)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 9)
    .map((entry) => historyMetric(entry.row));
  const similarWithCurrent = [currentRow, ...similar];
  const similarLevelRange = [
    currentRow,
    ...historicalRows.map(historyMetric).filter((row) => sameTibiaLevelWindow(currentLevel, row.character_level))
  ];
  const levelWindow = tibiaLevelWindow(currentLevel);

  return [
    comparisonSummary("All saved hunts", rows, current),
    { ...comparisonSummary("Similar level range", similarLevelRange, current), level_window: levelWindow },
    comparisonSummary("Same linked place", samePlace, current),
    comparisonSummary("Same character", sameCharacter, current),
    comparisonSummary("Last 10 hunts", last10, current),
    comparisonSummary("Similar monster mix", similarWithCurrent, current)
  ];
}

function metric(
  key: string,
  label: string,
  value: number | string,
  rawValue: number | null,
  tone: string,
  baseline: number | null,
  comparison: string | null
): MetricValue {
  const delta = typeof rawValue === "number" ? deltaPct(rawValue, baseline) : null;
  return {
    key,
    label,
    value,
    raw_value: rawValue,
    tone,
    delta_pct: delta,
    delta_label: deltaLabel(delta),
    comparison
  };
}

function verdictFor(input: {
  profitPerHour: number;
  xpPerHour: number;
  supplyRatio: number | null;
  profitDelta: number | null;
  xpDelta: number | null;
  supplyDelta: number | null;
  hasHistory: boolean;
}) {
  if (input.profitPerHour < 0 || (input.supplyRatio !== null && input.supplyRatio > 85)) {
    return {
      label: "Expensive hunt",
      tone: "danger",
      score: 0.32,
      summary: "This hunt was supply-heavy relative to its loot and should be treated as a loss or tuning candidate."
    };
  }
  if (input.hasHistory && input.profitDelta !== null && input.profitDelta >= 20 && (input.supplyDelta === null || input.supplyDelta <= 10)) {
    return {
      label: "Excellent profit hunt",
      tone: "positive",
      score: 0.9,
      summary: "Profit performance was meaningfully above your saved-hunt baseline without a matching supply spike."
    };
  }
  if (input.hasHistory && input.xpDelta !== null && input.xpDelta >= 20) {
    return {
      label: "Strong XP hunt",
      tone: "xp",
      score: 0.82,
      summary: "XP pace was the strongest signal in this session compared with your recent personal history."
    };
  }
  if ((input.supplyRatio !== null && input.supplyRatio <= 25) && input.profitPerHour >= 0 && (!input.hasHistory || (input.xpDelta ?? 0) < -10)) {
    return {
      label: "Safe but slow hunt",
      tone: "teal",
      score: 0.68,
      summary: "Supply pressure was low, but the session does not stand out as an XP route."
    };
  }
  if (input.profitPerHour > 0 && input.xpPerHour > 0) {
    return {
      label: "Balanced hunt",
      tone: "blue",
      score: 0.72,
      summary: "The hunt produced positive profit and XP without a clear warning signal."
    };
  }
  return {
    label: "Inefficient hunt",
    tone: "warning",
    score: 0.45,
    summary: "The current data does not show a strong profit, XP, or safety advantage."
  };
}

function band(value: number | null, low: number, high: number): "low" | "medium" | "high" {
  if (value === null || !Number.isFinite(value)) {
    return "medium";
  }
  if (value <= low) return "low";
  if (value >= high) return "high";
  return "medium";
}

function verdictTags(input: {
  safetyScore: number;
  supplyRatio: number | null;
  profitPerHour: number;
  profitDelta: number | null;
  profitMargin: number | null;
  xpDelta: number | null;
}) {
  const riskLevel = input.safetyScore >= 0.75 ? "low" : input.safetyScore >= 0.45 ? "medium" : "high";
  const supplyLevel = band(input.supplyRatio, 25, 60);
  const profitLevel = input.profitPerHour < 0
    ? "low"
    : input.profitDelta !== null && input.profitDelta >= 15
      ? "high"
      : input.profitMargin !== null && input.profitMargin >= 50
        ? "high"
        : input.profitPerHour > 0
          ? "medium"
          : "low";

  const tags = [
    { key: "risk", label: "Risk", value: riskLevel, tone: riskLevel === "low" ? "good" : riskLevel === "medium" ? "neutral" : "bad" },
    { key: "supply", label: "Supply", value: supplyLevel, tone: supplyLevel === "low" ? "good" : supplyLevel === "medium" ? "neutral" : "bad" },
    { key: "profit", label: "Profit", value: profitLevel, tone: profitLevel === "high" ? "good" : profitLevel === "medium" ? "neutral" : "bad" }
  ];

  if (input.xpDelta !== null && Math.abs(input.xpDelta) >= 15) {
    tags.push({
      key: "xp",
      label: "XP",
      value: input.xpDelta > 0 ? "high" : "low",
      tone: input.xpDelta > 0 ? "good" : "bad"
    });
  }

  return tags;
}

function repeatRecommendation(input: {
  profitPerHour: number;
  profitDelta: number | null;
  xpDelta: number | null;
  suppliesDelta: number | null;
  safetyScore: number;
  similarHunts: number;
}) {
  const profitable = input.profitPerHour >= 0;
  const beatsLevelRange = (input.profitDelta !== null && input.profitDelta >= 0)
    || (input.xpDelta !== null && input.xpDelta >= 0)
    || (input.suppliesDelta !== null && input.suppliesDelta <= 0);
  const worthRepeating = profitable && input.safetyScore >= 0.45 && (beatsLevelRange || input.similarHunts <= 1);

  if (worthRepeating) {
    return {
      label: "Repeat this hunt",
      reason: input.similarHunts > 1
        ? "It held up against your comparable hunts in this level range."
        : "It was profitable and safe enough to repeat while you collect more samples.",
      tone: "positive"
    };
  }

  return {
    label: "Do not repeat yet",
    reason: input.similarHunts > 1
      ? "Comparable hunts in this level range performed better."
      : "The result needs better profit, safety, or comparison evidence before repeating.",
    tone: "warning"
  };
}

function makeRecommendations(input: {
  verdictLabel: string;
  profitPerHour: number;
  xpDelta: number | null;
  profitDelta: number | null;
  supplyRatio: number | null;
  unknownPrices: number;
  lowConfidencePrices: number;
  overrides: number;
  samePlaceHunts: number;
  riskLabel: string;
  hasDamage: boolean;
  hasHealing: boolean;
  rareDependency: number | null;
}) {
  const out: Array<{ label: string; reason: string; tone: string }> = [];
  if (input.verdictLabel.includes("profit") || (input.profitDelta !== null && input.profitDelta > 15)) {
    out.push({ label: "Repeat for profit", reason: "Profit pace beat the available personal comparison.", tone: "positive" });
  }
  if (input.xpDelta !== null && input.xpDelta < -10) {
    out.push({ label: "Do not pick this for XP", reason: "XP pace trailed the available comparison set.", tone: "warning" });
  }
  if (input.supplyRatio !== null && input.supplyRatio > 60) {
    out.push({ label: "Tune supply usage", reason: "Supplies consumed a large share of loot value.", tone: "warning" });
  }
  if (input.riskLabel.toLowerCase().includes("high")) {
    out.push({ label: "Treat as risky", reason: "Public place risk or combat proxy suggests extra caution.", tone: "warning" });
  }
  if (input.rareDependency !== null && input.rareDependency >= 45) {
    out.push({ label: "Check repeatability", reason: "A large share of loot value came from one item, so repeat runs may vary.", tone: "warning" });
  }
  if (input.unknownPrices > 0) {
    out.push({ label: "Refresh pricing before judging", reason: `${input.unknownPrices} looted item(s) lack a resolved price.`, tone: "warning" });
  }
  if (input.lowConfidencePrices > 0 || input.overrides > 0) {
    out.push({ label: "Review price confidence", reason: "Low-confidence prices or overrides affect the profit verdict.", tone: "warning" });
  }
  if (!input.hasDamage && !input.hasHealing) {
    out.push({ label: "Import combat totals", reason: "Damage and healing totals would improve safety analysis for this hunt.", tone: "neutral" });
  }
  if (input.samePlaceHunts < 2) {
    out.push({ label: "Needs more personal samples", reason: "Same-place comparisons are still thin, so recommendations are provisional.", tone: "neutral" });
  }
  return out.slice(0, 6);
}

export function buildHuntIntelligence(
  db: Database.Database,
  preview: Record<string, unknown>,
  savedHunt: Record<string, unknown> | null = null
): Record<string, unknown> {
  const parsed = previewParsed(preview);
  const durationMinutes = Math.max(1, asNumber(parsed.duration_minutes, 1));
  const xp = Math.max(0, asNumber(parsed.total_xp, 0));
  const loot = Math.max(0, asNumber(parsed.adjusted_loot_gold ?? parsed.total_loot_gold, 0));
  const supplies = Math.max(0, asNumber(parsed.total_supply_cost, 0));
  const profit = loot - supplies;
  const profitPerHour = perHour(profit, durationMinutes);
  const lootPerHour = perHour(loot, durationMinutes);
  const xpPerHour = perHour(xp, durationMinutes);
  const suppliesPerHour = perHour(supplies, durationMinutes);
  const supplyRatio = percent(supplies, loot);
  const profitMargin = percent(profit, loot);
  const monsters = Array.isArray(preview.monsters) ? preview.monsters as Array<Record<string, unknown>> : [];
  const lootItems = Array.isArray(preview.loot_items) ? preview.loot_items as Array<Record<string, unknown>> : [];
  const visibleLoot = lootItems.filter((item) => !item.excluded);
  const placeId = selectedPlaceId(preview, savedHunt);
  const placeName = selectedPlaceName(preview, savedHunt);
  const history = readHistory(db);
  const totalKills = monsters.reduce((sum, monster) => sum + Math.max(0, asNumber(monster.count, 0)), 0);
  const killsPerHour = perHour(totalKills, durationMinutes);
  const current = { profit_per_hour: profitPerHour, loot_per_hour: lootPerHour, xp_per_hour: xpPerHour, supplies_per_hour: suppliesPerHour, kills_per_hour: killsPerHour, profit_margin_pct: profitMargin };
  const comparisons = topComparisons(preview, savedHunt, history, current, placeId);
  const allComparison = comparisons[0];
  const similarLevelComparison = comparisons.find((item) => item.label === "Similar level range") ?? allComparison;
  const samePlaceComparison = comparisons.find((item) => item.label === "Same linked place") ?? similarLevelComparison;
  const savedIdForHistory = asNumberOrNull(savedHunt?.id);
  const historyAvailable = history.some((row) => row.id !== savedIdForHistory);
  const monsterNames = monsters.map((monster) => asText(monster.name));
  const creatureByName = readCreatures(db, monsterNames);
  const publicLootRows = readPublicLoot(db, monsterNames, visibleLoot.map((item) => asText(item.name)));
  const publicLootByItem = new Map(publicLootRows.map((row) => [row.normalized_item_name, row]));
  const marketRun = readMarketRun(db);
  const placeRiskRow = placeId ? safeGet<{ risk_level: string | null; min_level: number | null; max_level: number | null }>(db, `
    SELECT risk_level, min_level, max_level
    FROM public_hunting_places
    WHERE id = ?
    LIMIT 1
  `, placeId) : null;
  const riskLabel = asText(placeRiskRow?.risk_level) || (supplyRatio !== null && supplyRatio < 25 ? "low observed cost" : "unknown");

  const topItems = visibleLoot
    .map((item) => {
      const totalValue = Math.max(0, asNumber(item.total_value, 0));
      const contribution = percent(totalValue, loot) ?? 0;
      const publicLoot = publicLootByItem.get(normalizeLootItemName(asText(item.normalized_name || item.name)));
      const lookup = asRecord(item.lookup);
      const lootLogic = asRecord(item.loot_logic);
      return {
        item_id: asNumberOrNull(item.item_id),
        name: asText(item.resolved_name || item.name),
        quantity: asNumber(item.quantity, 0),
        total_value: totalValue,
        contribution_pct: contribution,
        unit_value: asNumberOrNull(item.unit_value),
        rarity: asText(publicLoot?.rarity) || null,
        chance_percent: publicLoot?.chance_percent ?? null,
        price_confidence: buildConfidence(asNumberOrNull(lookup?.confidence), {
          estimated: true,
          missingDataReason: item.value_source === "unknown" ? "No local market or NPC value." : null
        }),
        value_source: asText(item.value_source) || "unknown",
        override_mode: asText(lookup?.override_mode || lootLogic?.override_mode || "auto")
      };
    })
    .sort((a, b) => b.total_value - a.total_value)
    .slice(0, 8);
  const notableDrops = [...topItems]
    .filter((item) => (item.unit_value ?? 0) > 0 && item.name.toLowerCase() !== "gold coin")
    .sort((a, b) => (b.unit_value ?? 0) - (a.unit_value ?? 0) || b.total_value - a.total_value)
    .slice(0, 4);
  const topItem = topItems[0] ?? null;
  const rareDependency = topItem ? topItem.contribution_pct : null;
  const profitWithoutTop = topItem ? profit - topItem.total_value : profit;
  const topLootSegments = topItems.slice(0, 4);
  const topLootSegmentValue = topLootSegments.reduce((sum, item) => sum + item.total_value, 0);
  const otherLootValue = Math.max(0, loot - topLootSegmentValue);
  const unknownPrices = visibleLoot.filter((item) => item.value_source === "unknown" || item.unit_value === null || item.unit_value === undefined).length;
  const lowConfidencePrices = visibleLoot.filter((item) => asNumber(asRecord(item.lookup)?.confidence, 1) < 0.55).length;
  const overrides = visibleLoot.filter((item) => {
    const lookup = asRecord(item.lookup);
    const mode = asText(lookup?.override_mode);
    return mode && mode !== "auto";
  }).length;

  const allocatedLootValueByCreature = new Map<string, number>();
  for (const monster of monsters) {
    allocatedLootValueByCreature.set(normalizeLootItemName(asText(monster.name)), 0);
  }

  for (const item of visibleLoot) {
    const itemName = asText(item.resolved_name || item.name);
    const normalizedItemName = normalizeLootItemName(asText(item.normalized_name || item.name));
    const qtyLooted = Math.max(0, asNumber(item.quantity, 0));
    const totalValue = Math.max(0, asNumber(item.total_value, 0));
    if (qtyLooted <= 0 || totalValue <= 0) {
      continue;
    }

    const candidates = publicLootRows.filter((row) => row.normalized_item_name === normalizedItemName);
    
    if (candidates.length === 0) {
      let highestKillMonsterName = "";
      let highestKills = -1;
      for (const monster of monsters) {
        const name = normalizeLootItemName(asText(monster.name));
        const count = Math.max(0, asNumber(monster.count, 0));
        if (count > highestKills) {
          highestKills = count;
          highestKillMonsterName = name;
        }
      }
      if (highestKillMonsterName) {
        allocatedLootValueByCreature.set(
          highestKillMonsterName,
          (allocatedLootValueByCreature.get(highestKillMonsterName) ?? 0) + totalValue
        );
      }
      continue;
    }

    if (candidates.length === 1) {
      const creatureName = candidates[0].normalized_creature_name;
      allocatedLootValueByCreature.set(
        creatureName,
        (allocatedLootValueByCreature.get(creatureName) ?? 0) + totalValue
      );
      continue;
    }

    let sumLikelihood = 0;
    const likelihoods = candidates.map((candidate) => {
      const creatureName = candidate.normalized_creature_name;
      const monsterObj = monsters.find((m) => normalizeLootItemName(asText(m.name)) === creatureName);
      const killsInHunt = monsterObj ? Math.max(0, asNumber(monsterObj.count, 0)) : 0;

      let yieldPerKill = 0;
      try {
        const payload = JSON.parse(candidate.payload_json || "{}");
        const totalDrops = Number(payload.total || 0);
        const totalKills = candidate.creature_total_kills ? Number(candidate.creature_total_kills) : 0;
        if (totalKills > 0 && totalDrops > 0) {
          yieldPerKill = totalDrops / totalKills;
        }
      } catch {}

      if (yieldPerKill <= 0) {
        const chance = candidate.chance_percent ?? 0;
        const min = candidate.min_count ?? 1;
        const max = candidate.max_count ?? 1;
        yieldPerKill = (chance / 100) * ((min + max) / 2);
      }

      const likelihood = yieldPerKill * killsInHunt;
      sumLikelihood += likelihood;

      return {
        creatureName,
        likelihood
      };
    });

    if (sumLikelihood === 0) {
      const equalShare = totalValue / candidates.length;
      for (const candidate of candidates) {
        const name = candidate.normalized_creature_name;
        allocatedLootValueByCreature.set(
          name,
          (allocatedLootValueByCreature.get(name) ?? 0) + equalShare
        );
      }
    } else if (qtyLooted === 1) {
      let highestLikelihood = -1;
      let selectedCreature = "";
      for (const entry of likelihoods) {
        if (entry.likelihood > highestLikelihood) {
          highestLikelihood = entry.likelihood;
          selectedCreature = entry.creatureName;
        }
      }
      if (selectedCreature) {
        allocatedLootValueByCreature.set(
          selectedCreature,
          (allocatedLootValueByCreature.get(selectedCreature) ?? 0) + totalValue
        );
      }
    } else {
      for (const entry of likelihoods) {
        const share = totalValue * (entry.likelihood / sumLikelihood);
        allocatedLootValueByCreature.set(
          entry.creatureName,
          (allocatedLootValueByCreature.get(entry.creatureName) ?? 0) + share
        );
      }
    }
  }

  const totalEstimatedLoot = Array.from(allocatedLootValueByCreature.values()).reduce((sum, val) => sum + val, 0);

  const creatureRows = monsters.map((monster) => {
    const count = Math.max(0, asNumber(monster.count, 0));
    const normalized = normalizeLootItemName(asText(monster.name));
    const creature = creatureByName.get(normalized);
    const estimatedXp = creature?.experience ? creature.experience * count : null;
    const estimatedLoot = allocatedLootValueByCreature.get(normalized) ?? 0;
    const lootPct = totalEstimatedLoot > 0 ? (estimatedLoot / totalEstimatedLoot) * 100 : 0;
    return {
      id: creature?.id ?? null,
      name: asText(monster.name),
      count,
      kill_pct: percent(count, monsters.reduce((sum, row) => sum + Math.max(0, asNumber(row.count, 0)), 0)) ?? 0,
      experience: creature?.experience ?? null,
      hitpoints: creature?.hitpoints ?? null,
      estimated_xp: estimatedXp,
      xp_pct: null,
      estimated_loot: Math.round(estimatedLoot),
      loot_pct: lootPct,
      bestiary_class: creature?.bestiary_class ?? null,
      bestiary_difficulty: creature?.bestiary_difficulty ?? null,
      confidence: buildConfidence(creature ? 0.8 : null, { missingDataReason: creature ? null : "Public creature metadata missing." })
    };
  }).sort((a, b) => b.count - a.count);

  const estimatedMonsterXpTotal = creatureRows.reduce((sum, row) => sum + (row.estimated_xp ?? 0), 0);
  const creatureRowsWithMetrics = creatureRows.map((row) => ({
    ...row,
    xp_pct: row.estimated_xp && estimatedMonsterXpTotal > 0 ? percent(row.estimated_xp, estimatedMonsterXpTotal) : null
  }));

  const avgHitpoints = avg(creatureRows.map((row) => row.hitpoints ?? Number.NaN));
  const healing = nullableNumber(parsed.total_healing);
  const damage = nullableNumber(parsed.total_damage);
  const receivedDamage = receivedDamageFromParsed(parsed);
  const safetyScore = Math.max(0, Math.min(1,
    (supplyRatio === null ? 0.4 : supplyRatio <= 25 ? 0.85 : supplyRatio <= 55 ? 0.55 : 0.25)
    + (riskLabel.toLowerCase().includes("high") ? -0.25 : riskLabel.toLowerCase().includes("low") ? 0.1 : 0)
    + (avgHitpoints !== null && avgHitpoints > 2500 ? -0.1 : 0)
  ));
  const combatLabel = safetyScore >= 0.75 ? "Very safe hunt" : safetyScore >= 0.45 ? "Moderate incoming pressure" : "High-risk hunting session";

  const keyMetrics = [
    metric("profit", "Profit", profit, profit, profit >= 0 ? "positive" : "danger", null, null),
    metric("profit_per_hour", "Profit/hr", profitPerHour, profitPerHour, profitPerHour >= 0 ? "positive" : "danger", allComparison.profit_per_hour || null, "vs all hunts"),
    metric("xp_per_hour", "XP/hr", xpPerHour, xpPerHour, "xp", allComparison.xp_per_hour || null, "vs all hunts"),
    metric("loot", "Loot", loot, loot, "loot", null, null),
    metric("supplies", "Supplies", supplies, supplies, supplies > loot * 0.6 ? "danger" : "teal", null, null),
    metric("duration", "Duration", `${durationMinutes}m`, durationMinutes, "blue", null, null),
    metric("kills", "Kills", totalKills, totalKills, "teal", null, null),
    metric("profit_margin", "Profit margin", profitMargin === null ? "n/a" : `${profitMargin.toFixed(1)}%`, profitMargin, profitMargin !== null && profitMargin >= 50 ? "positive" : "warning", null, null)
  ];

  const verdict = verdictFor({
    profitPerHour,
    xpPerHour,
    supplyRatio,
    profitDelta: similarLevelComparison.profit_delta_pct,
    xpDelta: similarLevelComparison.xp_delta_pct,
    supplyDelta: similarLevelComparison.supplies_delta_pct,
    hasHistory: historyAvailable
  });
  const simpleTags = verdictTags({
    safetyScore,
    supplyRatio,
    profitPerHour,
    profitDelta: similarLevelComparison.profit_delta_pct,
    profitMargin,
    xpDelta: similarLevelComparison.xp_delta_pct
  });
  const repeat = repeatRecommendation({
    profitPerHour,
    profitDelta: similarLevelComparison.profit_delta_pct,
    xpDelta: similarLevelComparison.xp_delta_pct,
    suppliesDelta: similarLevelComparison.supplies_delta_pct,
    safetyScore,
    similarHunts: similarLevelComparison.hunt_count
  });

  const explanations: InsightExplanation[] = [];
  if (topItem && topItem.contribution_pct >= 35) {
    explanations.push(explanation("rare or high-impact drop", "positive", `${topItem.name} contributed ${topItem.contribution_pct.toFixed(1)}% of visible loot value.`, {
      source_refs: [entityRef("item", { id: topItem.item_id, name: topItem.name })],
      provenance: [provenance("derived_calculation", { label: "loot contribution" })]
    }));
  }
  if (supplyRatio !== null && supplyRatio <= 25) {
    explanations.push(explanation("low supply pressure", "positive", `Supplies used ${supplyRatio.toFixed(1)}% of loot value.`, {
      provenance: [provenance("personal_hunt", { label: "imported hunt supplies" })]
    }));
  } else if (supplyRatio !== null && supplyRatio > 60) {
    explanations.push(explanation("high supply pressure", "warning", `Supplies used ${supplyRatio.toFixed(1)}% of loot value.`, {
      provenance: [provenance("personal_hunt", { label: "imported hunt supplies" })]
    }));
  }
  if (allComparison.profit_delta_pct !== null && Math.abs(allComparison.profit_delta_pct) >= 10) {
    explanations.push(explanation("profit comparison", allComparison.profit_delta_pct > 0 ? "positive" : "warning", `Profit/hr was ${deltaLabel(allComparison.profit_delta_pct)} versus all saved hunts.`, {
      provenance: [provenance("personal_hunt", { label: "saved hunt history" })]
    }));
  }
  if (xpPerHour > 0 && allComparison.xp_delta_pct !== null && Math.abs(allComparison.xp_delta_pct) >= 10) {
    explanations.push(explanation("XP comparison", allComparison.xp_delta_pct > 0 ? "positive" : "warning", `XP/hr was ${deltaLabel(allComparison.xp_delta_pct)} versus all saved hunts.`, {
      provenance: [provenance("personal_hunt", { label: "saved hunt history" })]
    }));
  }
  if (!explanations.length) {
    explanations.push(explanation("limited comparison", "neutral", "This hunt is being judged mostly from the imported session because there is not enough matching history yet.", {
      missing_data_reason: "Save more hunts with linked places to improve comparison quality."
    }));
  }

  const dataQualityWarnings: string[] = [];
  if (unknownPrices) dataQualityWarnings.push(`${unknownPrices} item(s) missing resolved prices`);
  if (lowConfidencePrices) dataQualityWarnings.push(`${lowConfidencePrices} item(s) have low price confidence`);
  if (overrides) dataQualityWarnings.push(`${overrides} price override(s) active`);
  if (!marketRun?.finished_at) dataQualityWarnings.push("No successful market snapshot found");
  if (!placeId) dataQualityWarnings.push("Hunt is not linked to a public hunting place");
  if (!creatureRows.some((row) => row.experience !== null)) dataQualityWarnings.push("Creature XP metadata is missing");

  const dataConfidenceParts = [
    unknownPrices ? 0.1 : 0.25,
    marketRun?.finished_at ? 0.2 : 0,
    placeId ? 0.2 : 0,
    historyAvailable ? 0.2 : 0,
    creatureRows.some((row) => row.experience !== null) ? 0.15 : 0
  ];
  const dataConfidence = dataConfidenceParts.reduce((sum, value) => sum + value, 0);

  return {
    verdict: {
      ...verdict,
      tags: simpleTags,
      repeat_recommendation: repeat,
      confidence: buildConfidence(dataConfidence, { estimated: true, missingDataReason: dataQualityWarnings[0] ?? null }),
      provenance: [provenance("derived_calculation", { label: "hunt verdict" })]
    },
    key_metrics: keyMetrics,
    performance_reasons: explanations,
    loot_analysis: {
      total_loot_value: loot,
      loot_per_hour: lootPerHour,
      summary: visibleLoot.length ? "Loot value breakdown, notable drops, and price quality." : "No priced loot contributors were available.",
      top_value_items: topItems,
      value_segments: [
        ...topLootSegments.map((item, index) => ({
          name: item.name,
          item_id: item.item_id,
          quantity: item.quantity,
          value: item.total_value,
          contribution_pct: item.contribution_pct,
          color_index: index,
          color_key: item.value_source === "unknown" ? "unknown" : item.rarity ? "rare" : "market"
        })),
        ...(otherLootValue > 0 ? [{
          name: "Other items",
          item_id: null,
          quantity: null,
          value: otherLootValue,
          contribution_pct: percent(otherLootValue, loot) ?? 0,
          color_index: 4,
          color_key: "other"
        }] : [])
      ],
      notable_drops: notableDrops,
      rare_drop_dependency_pct: rareDependency,
      profit_without_top_drop: profitWithoutTop,
      unknown_price_count: unknownPrices,
      low_confidence_price_count: lowConfidencePrices,
      override_count: overrides,
      confidence: buildConfidence(visibleLoot.length ? (visibleLoot.length - unknownPrices) / visibleLoot.length : null, {
        estimated: true,
        missingDataReason: visibleLoot.length ? null : "No visible loot items."
      })
    },
    cost_analysis: {
      total_supplies: supplies,
      supplies_per_hour: suppliesPerHour,
      supply_to_loot_pct: supplyRatio,
      profit_margin_pct: profitMargin,
      comparison_delta_pct: allComparison.supplies_delta_pct,
      summary: supplyRatio === null
        ? "Supply impact cannot be judged without loot value."
        : supplyRatio <= 25
          ? "Supplies were a low share of loot value."
          : supplyRatio > 60
            ? "Supplies consumed a large share of loot value."
            : "Supply spend was moderate for the loot returned."
    },
    combat_analysis: {
      label: combatLabel,
      safety_score: Number(safetyScore.toFixed(2)),
      damage_recorded: damage !== null,
      healing_recorded: healing !== null,
      incoming_damage_recorded: Boolean(receivedDamage),
      incoming_damage_summary: receivedDamageSummary(receivedDamage),
      received_damage: receivedDamage,
      total_incoming_damage: receivedDamage?.total ?? null,
      max_incoming_dps: receivedDamage?.max_dps ?? null,
      incoming_damage_types: receivedDamage?.damage_types ?? [],
      incoming_damage_sources: receivedDamage?.damage_sources ?? [],
      total_damage: damage,
      total_healing: healing,
      healing_per_kill: healing !== null && totalKills > 0 ? Math.round(healing / totalKills) : null,
      damage_per_kill: damage !== null && totalKills > 0 ? Math.round(damage / totalKills) : null,
      healing_per_hour: healing !== null ? perHour(healing, durationMinutes) : null,
      damage_per_hour: damage !== null ? perHour(damage, durationMinutes) : null,
      risk_label: riskLabel,
      avg_monster_hitpoints: avgHitpoints === null ? null : Math.round(avgHitpoints),
      summary: damage !== null || healing !== null || receivedDamage
        ? (receivedDamage ? "Combat pressure uses parsed damage, healing, and received damage from imported analyser text." : "Combat pressure uses parsed damage and healing from the Hunt Analyser text.")
        : "Combat pressure is estimated from supplies, place risk, and monster metadata."
    },
    monster_analysis: {
      total_kills: totalKills,
      kills_per_hour: killsPerHour,
      estimated_xp_from_creatures: estimatedMonsterXpTotal || null,
      xp_metadata_coverage_pct: percent(creatureRows.filter((row) => row.experience !== null).length, Math.max(1, creatureRows.length)),
      top_monsters: creatureRowsWithMetrics.slice(0, 8),
      total_estimated_loot: Math.round(totalEstimatedLoot),
      summary: (() => {
        let maxDelta = 0;
        let notableMonsterRow: typeof creatureRows[0] | null = null;
        for (const row of creatureRowsWithMetrics) {
          const delta = (row.loot_pct ?? 0) - (row.kill_pct ?? 0);
          if (delta > maxDelta) {
            maxDelta = delta;
            notableMonsterRow = row;
          }
        }
        if (notableMonsterRow && maxDelta >= 2) {
          return `${notableMonsterRow.name}s represent only ${Math.round(notableMonsterRow.kill_pct)}% of kills but provide ${Math.round(notableMonsterRow.loot_pct)}% of the loot value.`;
        }
        if (creatureRowsWithMetrics[0]) {
          return `${creatureRowsWithMetrics[0].name} made up ${creatureRowsWithMetrics[0].kill_pct.toFixed(1)}% of kills.`;
        }
        return "No monster kills were parsed.";
      })()
    },
    comparisons,
    recommendations: makeRecommendations({
      verdictLabel: verdict.label,
      profitPerHour,
      xpDelta: similarLevelComparison.xp_delta_pct,
      profitDelta: similarLevelComparison.profit_delta_pct,
      supplyRatio,
      unknownPrices,
      lowConfidencePrices,
      overrides,
      samePlaceHunts: samePlaceComparison.hunt_count,
      riskLabel,
      hasDamage: damage !== null,
      hasHealing: healing !== null,
      rareDependency
    }),
    data_quality: {
      confidence: buildConfidence(dataConfidence, { estimated: true, missingDataReason: dataQualityWarnings[0] ?? null }) as Confidence,
      freshness: buildFreshness(marketRun?.finished_at ?? null, {
        staleAfterHours: 36,
        agingAfterHours: 12,
        missingDataReason: marketRun?.finished_at ? null : "No successful market run."
      }) as Freshness,
      warnings: dataQualityWarnings,
      missing_prices: unknownPrices,
      low_confidence_prices: lowConfidencePrices,
      price_overrides: overrides,
      market_snapshot_at: marketRun?.finished_at ?? null,
      monster_metadata_coverage_pct: percent(creatureRows.filter((row) => row.experience !== null || row.hitpoints !== null).length, Math.max(1, creatureRows.length)),
      received_damage_imported: Boolean(receivedDamage),
      damage_totals_imported: damage !== null || healing !== null,
      linked_place: placeId ? { id: placeId, name: placeName } : null,
      provenance: [
        provenance("personal_hunt", { label: "hunt analyser import" }),
        provenance("derived_calculation", { label: "hunt intelligence" }),
        ...(marketRun?.finished_at ? [provenance("market_sync", { observed_at: marketRun.finished_at })] : []),
        ...(placeId ? [provenance("public_tibia_reference", { source_ref: entityRef("hunting_place", { id: placeId, name: placeName }) })] : [])
      ] as Provenance[]
    }
  };
}
