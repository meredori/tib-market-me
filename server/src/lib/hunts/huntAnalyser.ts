import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../../config";
import { summarizeItemHistory } from "../pricing/itemHistory";
import { getEffectiveLootLogicPreview, type LootLogicPreview } from "../sync/updatePrices";
import type {
  EnrichedLootItem,
  HuntInput,
  ItemDetailCacheRow,
  LootLookupRow,
  ParsedHuntText
} from "./types";

const ITEM_DETAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIBIA_DATA_ITEM_BASE_URL = "https://tibiadata.bytewizards.de/api/v1/items";

const HARD_CODED_ITEM_VALUES: Record<string, { unit_value: number; weight_oz: number | null; resolved_name: string }> = {
  "gold coin": { unit_value: 1, weight_oz: 0.1, resolved_name: "gold coin" },
  "gold coins": { unit_value: 1, weight_oz: 0.1, resolved_name: "gold coin" },
  "platinum coin": { unit_value: 100, weight_oz: 0.1, resolved_name: "platinum coin" },
  "platinum coins": { unit_value: 100, weight_oz: 0.1, resolved_name: "platinum coin" },
  "crystal coin": { unit_value: 10000, weight_oz: 0.1, resolved_name: "crystal coin" },
  "crystal coins": { unit_value: 10000, weight_oz: 0.1, resolved_name: "crystal coin" }
};

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBooleanInt(value: unknown): number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value ? 1 : 0;
  }
  return null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function isFreshIso(value: string | null, ttlMs: number): boolean {
  if (!value) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Date.now() - parsed < ttlMs;
}

function parseNumberToken(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function coerceTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asText(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
}

function parseLineValue(raw: string, label: string): number | null {
  const rx = new RegExp(`^\\s*${label}:\\s*([\\d,]+)\\s*$`, "im");
  const match = raw.match(rx);
  return parseNumberToken(match?.[1] ?? null);
}

function normalizeLootItemName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\s+/g, " ");
}

function singularizeSimple(name: string): string {
  if (name.endsWith("ies") && name.length > 3) {
    return `${name.slice(0, -3)}y`;
  }
  if (name.endsWith("s") && !name.endsWith("ss") && name.length > 1) {
    return name.slice(0, -1);
  }
  return name;
}

function parseCountedSection(raw: string, header: string): Array<{ name: string; count: number }> {
  const lines = raw.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === `${header.toLowerCase()}:`);
  if (startIndex < 0) {
    return [];
  }

  const out: Array<{ name: string; count: number }> = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    if (/^\S.+:\s*$/.test(line)) {
      break;
    }
    const match = line.match(/^\s*([\d,]+)x\s+(.+?)\s*$/i);
    if (!match) {
      continue;
    }
    const count = parseNumberToken(match[1]);
    const name = asText(match[2]).trim().toLowerCase();
    if (count === null || count <= 0 || !name) {
      continue;
    }
    out.push({ name, count });
  }
  return out;
}

function readItemWeightsByName(): Record<string, number> {
  const weightsPath = path.resolve(config.workspaceRoot, "item_weights.json");
  if (!fs.existsSync(weightsPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(weightsPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const weight = asNumberOrNull(value);
      if (weight !== null && weight > 0) {
        out[key.toLowerCase().trim()] = weight;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asText(value).trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = asNumberOrNull(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function weightFromText(value: unknown): number | null {
  const text = asText(value);
  if (!text) {
    return null;
  }

  const patterns = [
    /\bweight\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:oz)?\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*oz\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = asNumberOrNull(match?.[1]);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function coerceExcludedItemNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeLootItemName(asText(entry)))
        .filter(Boolean)
    )
  ).slice(0, 100);
}

function computeBoostFactor(rawTotalXp: number, totalXp: number): number | null {
  if (rawTotalXp <= 0 || totalXp <= 0) {
    return null;
  }
  return Number((totalXp / rawTotalXp).toFixed(4));
}

function monsterSignature(monsters: Array<{ name: string; count: number }>): Array<{ name: string; pct: number }> {
  const total = monsters.reduce((acc, monster) => acc + Math.max(0, monster.count), 0);
  if (total <= 0) {
    return [];
  }
  return monsters
    .map((monster) => ({
      name: normalizeLootItemName(monster.name),
      pct: Math.max(0, monster.count) / total
    }))
    .filter((monster) => monster.name && monster.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);
}

function signatureSimilarity(
  a: Array<{ name: string; pct: number }>,
  b: Array<{ name: string; pct: number }>
): number {
  const bByName = new Map(b.map((entry) => [entry.name, entry.pct]));
  let overlap = 0;
  for (const entry of a) {
    overlap += Math.min(entry.pct, bByName.get(entry.name) ?? 0);
  }
  return Number(overlap.toFixed(4));
}

function suggestLocation(
  db: Database.Database,
  monsters: Array<{ name: string; count: number }>
): { name: string | null; confidence: number; needs_setup: boolean } {
  const signature = monsterSignature(monsters);
  if (!signature.length) {
    return { name: null, confidence: 0, needs_setup: true };
  }

  const rows = db
    .prepare("SELECT name, monster_signature_json FROM hunt_locations ORDER BY updated_at DESC")
    .all() as Array<Record<string, unknown>>;

  let best = { name: null as string | null, confidence: 0 };
  for (const row of rows) {
    try {
      const stored = JSON.parse(asText(row.monster_signature_json)) as Array<{ name: string; pct: number }>;
      const confidence = signatureSimilarity(signature, stored);
      if (confidence > best.confidence) {
        best = { name: asText(row.name), confidence };
      }
    } catch {
      // Ignore malformed learned signatures.
    }
  }

  return best.confidence >= 0.72
    ? { ...best, needs_setup: false }
    : { name: null, confidence: best.confidence, needs_setup: true };
}

function saveLocationSignature(
  db: Database.Database,
  locationName: string | null,
  monsters: Array<{ name: string; count: number }>
): void {
  const name = asText(locationName).trim();
  const signature = monsterSignature(monsters);
  if (!name || !signature.length) {
    return;
  }
  db.prepare(
    `
    INSERT INTO hunt_locations (name, monster_signature_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      monster_signature_json = excluded.monster_signature_json,
      updated_at = excluded.updated_at
  `
  ).run(name, JSON.stringify(signature), nowIso());
}

function getCachedItemDetail(db: Database.Database, normalizedName: string): ItemDetailCacheRow | null {
  try {
    return db
      .prepare(
        `
        SELECT
          normalized_name,
          requested_name,
          actual_name,
          plural,
          category_slug,
          category_name,
          stackable,
          marketable,
          npc_price,
          npc_value,
          value,
          weight_oz,
          wiki_url,
          payload_json,
          last_fetched_at
        FROM item_detail_cache
        WHERE normalized_name = ?
      `
      )
      .get(normalizedName) as ItemDetailCacheRow | undefined ?? null;
  } catch {
    return null;
  }
}

function itemPayloadFromResponse(payload: Record<string, unknown>): Record<string, unknown> {
  return asRecord(payload.item)
    ?? asRecord(payload.data)
    ?? asRecord(payload.result)
    ?? payload;
}

function infoboxFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const itemPayload = itemPayloadFromResponse(payload);
  return asRecord(itemPayload.structuredData)?.infobox
    ? asRecord(asRecord(itemPayload.structuredData)?.infobox) ?? {}
    : asRecord(itemPayload.infobox) ?? {};
}

function infoboxFieldsFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const infobox = infoboxFromPayload(payload);
  return asRecord(infobox.fields) ?? {};
}

function extractItemWeightOz(payload: Record<string, unknown>): number | null {
  const itemPayload = itemPayloadFromResponse(payload);
  const infobox = infoboxFromPayload(payload);
  const fields = infoboxFieldsFromPayload(payload);

  return firstNumber(
    itemPayload.weight,
    itemPayload.weightOz,
    itemPayload.weight_oz,
    itemPayload.Weight,
    infobox.weight,
    infobox.Weight,
    fields.weight,
    fields.Weight,
    weightFromText(itemPayload.plainTextContent),
    weightFromText(itemPayload.rawWikiText),
    weightFromText(infobox.plainTextContent),
    weightFromText(infobox.rawWikiText)
  );
}

function extractItemDetailRow(requestedName: string, payload: Record<string, unknown>): ItemDetailCacheRow {
  const normalizedName = normalizeLootItemName(requestedName);
  const itemPayload = itemPayloadFromResponse(payload);
  const infobox = infoboxFromPayload(payload);
  const fields = infoboxFieldsFromPayload(payload);

  return {
    normalized_name: normalizedName,
    requested_name: requestedName,
    actual_name: firstText(
      itemPayload.actualName,
      itemPayload.name,
      infobox.actualName,
      infobox.name,
      fields.actualName,
      fields.name
    ),
    plural: firstText(itemPayload.plural, infobox.plural, fields.plural),
    category_slug: firstText(itemPayload.categorySlug, itemPayload.category_slug),
    category_name: firstText(itemPayload.categoryName, itemPayload.category_name, infobox.category, fields.category),
    stackable: asBooleanInt(itemPayload.stackable ?? infobox.stackable ?? fields.stackable),
    marketable: asBooleanInt(itemPayload.marketable ?? infobox.marketable ?? fields.marketable),
    npc_price: firstNumber(itemPayload.npcPrice, itemPayload.npc_price, infobox.npcPrice, fields.npcPrice),
    npc_value: firstNumber(itemPayload.npcValue, itemPayload.npc_value, infobox.npcValue, fields.npcValue),
    value: firstNumber(itemPayload.value, infobox.value, fields.value),
    weight_oz: extractItemWeightOz(payload),
    wiki_url: firstText(itemPayload.wikiUrl, itemPayload.wiki_url, payload.wikiUrl, payload.wiki_url),
    payload_json: JSON.stringify(payload),
    last_fetched_at: nowIso()
  };
}

function refreshCachedItemDetailFromPayload(
  db: Database.Database,
  cached: ItemDetailCacheRow
): ItemDetailCacheRow | null {
  try {
    const payload = JSON.parse(cached.payload_json) as Record<string, unknown>;
    const refreshed = extractItemDetailRow(cached.requested_name || cached.normalized_name, payload);
    if (
      refreshed.weight_oz !== cached.weight_oz
      || refreshed.actual_name !== cached.actual_name
      || refreshed.wiki_url !== cached.wiki_url
    ) {
      return saveItemDetail(db, cached.requested_name || cached.normalized_name, payload);
    }
    return cached;
  } catch {
    return cached;
  }
}

function saveItemDetail(db: Database.Database, requestedName: string, payload: Record<string, unknown>): ItemDetailCacheRow {
  const row = extractItemDetailRow(requestedName, payload);

  db.prepare(
    `
    INSERT INTO item_detail_cache (
      normalized_name,
      requested_name,
      actual_name,
      plural,
      category_slug,
      category_name,
      stackable,
      marketable,
      npc_price,
      npc_value,
      value,
      weight_oz,
      wiki_url,
      payload_json,
      last_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET
      requested_name = excluded.requested_name,
      actual_name = excluded.actual_name,
      plural = excluded.plural,
      category_slug = excluded.category_slug,
      category_name = excluded.category_name,
      stackable = excluded.stackable,
      marketable = excluded.marketable,
      npc_price = excluded.npc_price,
      npc_value = excluded.npc_value,
      value = excluded.value,
      weight_oz = excluded.weight_oz,
      wiki_url = excluded.wiki_url,
      payload_json = excluded.payload_json,
      last_fetched_at = excluded.last_fetched_at
  `
  ).run(
    row.normalized_name,
    row.requested_name,
    row.actual_name,
    row.plural,
    row.category_slug,
    row.category_name,
    row.stackable,
    row.marketable,
    row.npc_price,
    row.npc_value,
    row.value,
    row.weight_oz,
    row.wiki_url,
    row.payload_json,
    row.last_fetched_at
  );

  return row;
}

async function fetchItemDetail(db: Database.Database, itemName: string): Promise<ItemDetailCacheRow | null> {
  const normalizedName = normalizeLootItemName(itemName);
  const cached = getCachedItemDetail(db, normalizedName);
  if (cached) {
    const refreshedCached = cached.weight_oz === null
      ? refreshCachedItemDetailFromPayload(db, cached)
      : cached;
    if (
      refreshedCached
      && refreshedCached.weight_oz !== null
      && isFreshIso(refreshedCached.last_fetched_at, ITEM_DETAIL_CACHE_TTL_MS)
    ) {
      return refreshedCached;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const candidates = Array.from(new Set([normalizedName, singularizeSimple(normalizedName)].filter(Boolean)));
    for (const candidate of candidates) {
      const response = await fetch(`${TIBIA_DATA_ITEM_BASE_URL}/${encodeURIComponent(candidate)}`, {
        signal: controller.signal
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json() as Record<string, unknown>;
      return saveItemDetail(db, normalizedName, payload);
    }
    return cached;
  } catch {
    return cached;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAndCacheItemDetail(db: Database.Database, itemName: string): Promise<ItemDetailCacheRow | null> {
  return fetchItemDetail(db, itemName);
}

function lookupLootItem(db: Database.Database, name: string): LootLookupRow | null {
  const latestRun = db.prepare("SELECT id FROM market_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (!latestRun) {
    return null;
  }

  const normalized = normalizeLootItemName(name);
  const singular = singularizeSimple(normalized);
  const candidates = Array.from(new Set([normalized, singular].filter(Boolean)));

  for (const candidate of candidates) {
    const row = db
      .prepare(
        `
        SELECT
          mip.item_id AS item_id,
          im.name AS name,
          im.wiki_name AS wiki_name,
          mip.client_value AS client_value,
          mip.suggested_list_price AS suggested_list_price,
          mip.fair_price AS fair_price,
          mip.trend AS trend,
          mip.liquidity AS liquidity,
          mip.confidence AS confidence,
          mif.month_sold AS month_sold,
          mif.day_sold AS day_sold,
          mif.sell_offer AS sell_offer,
          COALESCE((
            SELECT MAX(nb.price)
            FROM item_npc_buy nb
            WHERE nb.item_id = mip.item_id
          ), 0) AS npc_buy,
          COALESCE((
            SELECT MIN(ns.price)
            FROM item_npc_sell ns
            WHERE ns.item_id = mip.item_id
          ), 0) AS npc_sell,
          COALESCE(ivo.override_mode, 'auto') AS override_mode
        FROM market_item_prices mip
        LEFT JOIN item_metadata im ON im.item_id = mip.item_id
        LEFT JOIN market_item_features mif
          ON mif.run_id = mip.run_id
         AND mif.item_id = mip.item_id
        LEFT JOIN item_value_overrides ivo
          ON ivo.item_id = mip.item_id
        WHERE mip.run_id = ?
          AND mip.pricing_model = ?
          AND (
            LOWER(COALESCE(im.name, '')) = ?
            OR LOWER(COALESCE(im.wiki_name, '')) = ?
          )
        ORDER BY mip.client_value DESC
        LIMIT 1
      `
      )
      .get(latestRun.id, config.pricingModel, candidate, candidate) as LootLookupRow | undefined;

    if (row) {
      return row;
    }
  }

  return null;
}

async function enrichLootItems(
  db: Database.Database,
  lootItems: Array<{ name: string; quantity: number; normalized_name: string }>,
  _referenceLootTotal: number | null,
  excludedItemNames: string[] = [],
  options: { hydrateMissingDetails?: boolean } = {}
): Promise<{ items: EnrichedLootItem[]; total_resolved_value: number; suggestions: Array<Record<string, unknown>> }> {
  const weights = readItemWeightsByName();
  const excludedSet = new Set(excludedItemNames.map((name) => normalizeLootItemName(name)));
  const enriched: EnrichedLootItem[] = [];

  for (const item of lootItems) {
    const hardCoded = HARD_CODED_ITEM_VALUES[item.normalized_name] ?? null;
    const lookup = lookupLootItem(db, item.name);
    const lootLogic = lookup ? getEffectiveLootLogicPreview(lookup as unknown as Record<string, unknown>) : null;
    const lookupPrice = lootLogic?.price && lootLogic.price > 0 ? lootLogic.price : null;
    const unitValue = hardCoded?.unit_value ?? (lookupPrice !== null ? Math.round(lookupPrice) : null);
    const excluded = excludedSet.has(item.normalized_name);
    const rawTotalValue = unitValue !== null ? unitValue * item.quantity : 0;
    const totalValue = excluded ? 0 : rawTotalValue;
    const cachedDetail = hardCoded ? null : getCachedItemDetail(db, item.normalized_name);
    const itemDetail = cachedDetail ?? (
      hardCoded || !options.hydrateMissingDetails
        ? null
        : await fetchAndCacheItemDetail(db, item.name)
    );
    const itemDetailStatus = itemDetail
      ? "cached"
      : hardCoded
        ? "unavailable"
        : "missing";
    const weightOz = hardCoded?.weight_oz ?? weights[item.normalized_name] ?? itemDetail?.weight_oz ?? null;
    const gpPerOz = unitValue !== null && weightOz !== null && weightOz > 0
      ? Number((unitValue / weightOz).toFixed(2))
      : null;
    const history = lookup?.item_id ? summarizeItemHistory(db, lookup.item_id) : null;

    enriched.push({
      name: item.name,
      normalized_name: item.normalized_name,
      quantity: item.quantity,
      item_id: lookup?.item_id ?? null,
      resolved_name: hardCoded?.resolved_name ?? lookup?.name ?? lookup?.wiki_name ?? itemDetail?.actual_name ?? null,
      unit_value: unitValue,
      excluded,
      excluded_value: excluded ? rawTotalValue : 0,
      total_value: totalValue,
      weight_oz: weightOz,
      gp_per_oz: gpPerOz,
      contribution_pct: 0,
      gp_oz_efficiency: "unknown",
      trend: lootLogic?.trend_display ?? lookup?.trend ?? null,
      loot_logic: lootLogic,
      history,
      lookup,
      item_detail: itemDetail,
      item_detail_status: itemDetailStatus,
      value_source: hardCoded ? "coin" : lookupPrice !== null ? "loot_logic" : "unknown"
    });
  }

  const totalResolvedValue = enriched.reduce((acc, item) => acc + item.total_value, 0);
  const comparisonTotal = totalResolvedValue;

  for (const item of enriched) {
    item.contribution_pct = comparisonTotal > 0
      ? Number(((item.total_value / comparisonTotal) * 100).toFixed(2))
      : 0;
  }

  const gpOzValues = enriched
    .map((item) => item.gp_per_oz)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const medianGpOz = gpOzValues.length
    ? gpOzValues[Math.floor(gpOzValues.length / 2)]
    : 0;
  const inefficientGpOzThreshold = medianGpOz > 0 ? Math.max(10, medianGpOz * 0.35) : 0;

  for (const item of enriched) {
    if (item.gp_per_oz === null || medianGpOz <= 0) {
      item.gp_oz_efficiency = "unknown";
    } else if (item.gp_per_oz < inefficientGpOzThreshold) {
      item.gp_oz_efficiency = "low";
    } else if (item.gp_per_oz >= medianGpOz * 1.5) {
      item.gp_oz_efficiency = "high";
    } else {
      item.gp_oz_efficiency = "normal";
    }
  }

  const lowGpOzSuggestions = enriched
    .filter((item) => item.gp_per_oz !== null)
    .filter((item) => !item.excluded)
    .filter((item) => {
      const lowContribution = item.contribution_pct <= 1.2;
      const lowGpOz = item.gp_oz_efficiency === "low";
      const lowTotalImpact = item.total_value < Math.max(300, comparisonTotal * 0.01);
      return lowContribution && lowGpOz && lowTotalImpact;
    })
    .sort((a, b) => (a.gp_per_oz ?? 0) - (b.gp_per_oz ?? 0))
    .slice(0, 5)
    .map((item) => ({
      name: item.name,
      quantity: item.quantity,
      total_value: item.total_value,
      gp_per_oz: item.gp_per_oz,
      gp_oz_efficiency: item.gp_oz_efficiency,
      contribution_pct: item.contribution_pct,
      suggestion_type: "low_gp_per_oz",
      reason: `Poor gp/oz compared to this hunt's median (${Number(medianGpOz.toFixed(2))} gp/oz).`
    }));

  const unknownValueSuggestions = enriched
    .filter((item) => !item.excluded)
    .filter((item) => item.unit_value === null || item.value_source === "unknown" || item.loot_logic?.strategy === "ignore")
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, 10)
    .map((item) => ({
      name: item.name,
      quantity: item.quantity,
      total_value: item.total_value,
      gp_per_oz: item.gp_per_oz,
      gp_oz_efficiency: item.gp_oz_efficiency,
      contribution_pct: item.contribution_pct,
      suggestion_type: "unknown_sell_value",
      reason: "No known sell value. Review as supply, player-useful item, or junk to ignore."
    }));

  const suggestions = [...unknownValueSuggestions, ...lowGpOzSuggestions]
    .filter((item, index, rows) => rows.findIndex((other) => other.name === item.name) === index)
    .slice(0, 15);

  return {
    items: enriched.sort((a, b) => b.total_value - a.total_value),
    total_resolved_value: totalResolvedValue,
    suggestions
  };
}

function toIsoFromDateTimeParts(datePart: string, timePart: string): string | null {
  const raw = `${datePart}T${timePart}`;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function pluralizeMonster(name: string, count: number): string {
  if (count <= 1) {
    return name;
  }
  if (name.endsWith("s")) {
    return name;
  }
  if (name.endsWith("y") && name.length > 1) {
    const beforeY = name[name.length - 2].toLowerCase();
    const vowel = beforeY === "a" || beforeY === "e" || beforeY === "i" || beforeY === "o" || beforeY === "u";
    if (!vowel) {
      return `${name.slice(0, -1)}ies`;
    }
  }
  return `${name}s`;
}

function detectTopMonsterName(raw: string): string | null {
  const kills = parseCountedSection(raw, "Killed Monsters");
  if (!kills.length) {
    return null;
  }
  let bestName: string | null = null;
  let bestCount = -1;
  for (const kill of kills) {
    if (kill.count > bestCount) {
      bestCount = kill.count;
      bestName = pluralizeMonster(kill.name, kill.count);
    }
  }
  return bestName;
}

function parseHuntSessionText(rawText: string): ParsedHuntText {
  const cleaned = rawText.replace(/<\/?hunt>/gi, "").trim();

  const sessionMatch = cleaned.match(
    /Session data:\s*From\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2}:\d{2})\s*to\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2}:\d{2})/i
  );

  const startedAt = sessionMatch ? toIsoFromDateTimeParts(sessionMatch[1], sessionMatch[2]) : null;
  const endedAt = sessionMatch ? toIsoFromDateTimeParts(sessionMatch[3], sessionMatch[4]) : null;
  const huntDate = sessionMatch?.[1] ?? null;

  let durationMinutes: number | null = null;
  const durationMatch = cleaned.match(/^\s*Session:\s*(\d{1,2}):(\d{2})h\s*$/im);
  if (durationMatch) {
    durationMinutes = Number(durationMatch[1]) * 60 + Number(durationMatch[2]);
  }

  const rawXpGain = parseLineValue(cleaned, "Raw XP Gain");
  const xpGain = parseLineValue(cleaned, "XP Gain");
  const loot = parseLineValue(cleaned, "Loot");
  const supplies = parseLineValue(cleaned, "Supplies");
  const monsters = parseCountedSection(cleaned, "Killed Monsters");
  const lootItemsRaw = parseCountedSection(cleaned, "Looted Items");
  const lootItems = lootItemsRaw.map((entry) => ({
    name: entry.name,
    quantity: entry.count,
    normalized_name: normalizeLootItemName(entry.name)
  }));

  const topMonster = detectTopMonsterName(cleaned);
  const fallbackDate = huntDate ?? new Date().toISOString().slice(0, 10);
  const generatedLabel = topMonster ? `${topMonster} - ${fallbackDate}` : null;

  return {
    label: generatedLabel,
    duration_minutes: durationMinutes,
    raw_total_xp: rawXpGain,
    total_xp: xpGain,
    total_loot_gold: loot,
    total_supply_cost: supplies,
    started_at: startedAt,
    ended_at: endedAt,
    hunt_date: huntDate,
    monsters,
    loot_items: lootItems
  };
}

async function buildHuntPreviewFromParsed(
  db: Database.Database,
  parsed: ParsedHuntText,
  rawText: string,
  excludedItemNames: string[],
  explicitLocationName: string | null = null
): Promise<Record<string, unknown>> {
  const durationMinutes = Math.max(1, Math.round(parsed.duration_minutes ?? 1));
  const totalXp = Math.max(0, Math.round(parsed.total_xp ?? 0));
  const rawTotalXp = Math.max(0, Math.round(parsed.raw_total_xp ?? totalXp));
  const totalLoot = Math.max(0, Math.round(parsed.total_loot_gold ?? 0));
  const totalSupply = Math.max(0, Math.round(parsed.total_supply_cost ?? 0));
  const netProfit = totalLoot - totalSupply;
  const hours = durationMinutes / 60;

  const enriched = await enrichLootItems(db, parsed.loot_items, totalLoot > 0 ? totalLoot : null, excludedItemNames);
  const adjustedLoot = Math.round(enriched.total_resolved_value);
  const adjustedNetProfit = adjustedLoot - totalSupply;
  const sortedMonsters = parsed.monsters.sort((a, b) => b.count - a.count);
  const locationSuggestion = explicitLocationName
    ? { name: explicitLocationName, confidence: 1, needs_setup: false }
    : suggestLocation(db, sortedMonsters);
  const boostFactor = computeBoostFactor(rawTotalXp, totalXp);

  return {
    suggested_label: parsed.label ?? "Untitled Hunt",
    parsed: {
      duration_minutes: durationMinutes,
      raw_total_xp: rawTotalXp,
      total_xp: totalXp,
      total_loot_gold: totalLoot,
      adjusted_loot_gold: adjustedLoot,
      total_supply_cost: totalSupply,
      net_profit: netProfit,
      adjusted_net_profit: adjustedNetProfit,
      xp_per_hour: Math.round(totalXp / hours),
      gold_per_hour: Math.round(netProfit / hours),
      adjusted_gold_per_hour: Math.round(adjustedNetProfit / hours),
      raw_xp_per_hour: Math.round(rawTotalXp / hours),
      boost_factor: boostFactor,
      started_at: parsed.started_at,
      ended_at: parsed.ended_at,
      hunt_date: parsed.hunt_date
    },
    monsters: sortedMonsters,
    loot_items: enriched.items,
    loot_summary: {
      parsed_total_loot: totalLoot,
      adjusted_total_loot: adjustedLoot,
      resolved_total_loot: enriched.total_resolved_value,
      excluded_item_names: excludedItemNames
    },
    location: {
      selected_name: explicitLocationName,
      suggested_name: locationSuggestion.name,
      confidence: locationSuggestion.confidence,
      needs_setup: locationSuggestion.needs_setup
    },
    suggestions: enriched.suggestions,
    raw_text: rawText
  };
}

export async function parseHuntPreview(db: Database.Database, payload: unknown): Promise<Record<string, unknown>> {
  const row = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const rawText = asText(row.raw_text).replace(/<\/??hunt>/gi, "").trim();
  const excludedItemNames = coerceExcludedItemNames(row.excluded_item_names);

  if (!rawText) {
    throw new Error("No hunt text provided.");
  }

  return buildHuntPreviewFromParsed(
    db,
    parseHuntSessionText(rawText),
    rawText,
    excludedItemNames,
    asText(row.location_name).trim() || null
  );
}

export async function hydrateHuntItemDetails(
  db: Database.Database,
  itemNames: string[]
): Promise<{ ok: true; items: Array<{ name: string; normalized_name: string; item_detail: ItemDetailCacheRow | null }> }> {
  const uniqueNames = Array.from(
    new Map(
      itemNames
        .map((name) => asText(name).trim())
        .filter(Boolean)
        .map((name) => [normalizeLootItemName(name), name])
    ).values()
  );
  const items: Array<{ name: string; normalized_name: string; item_detail: ItemDetailCacheRow | null }> = [];
  let cursor = 0;
  const concurrency = 3;

  async function worker(): Promise<void> {
    while (cursor < uniqueNames.length) {
      const name = uniqueNames[cursor];
      cursor += 1;
      const normalizedName = normalizeLootItemName(name);
      const itemDetail = await fetchAndCacheItemDetail(db, name);
      items.push({
        name,
        normalized_name: normalizedName,
        item_detail: itemDetail
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueNames.length) }, () => worker()));
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, items };
}

export function createHuntUpload(db: Database.Database, payload: unknown): Record<string, unknown> {
  const input = buildHuntInput(payload);

  const inserted = db
    .prepare(
      `
      INSERT INTO hunt_uploads (
        label,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        tags_json,
        excluded_items_json,
        raw_text,
        processed_json,
        raw_text_hash,
        location_name,
        boost_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.label,
      input.duration_minutes,
      input.raw_total_xp,
      input.total_xp,
      input.total_loot_gold,
      input.total_supply_cost,
      input.started_at,
      input.ended_at,
      JSON.stringify(input.tags),
      JSON.stringify(input.excluded_item_names),
      input.raw_text,
      input.processed_json,
      input.raw_text_hash,
      input.location_name,
      computeBoostFactor(input.raw_total_xp, input.total_xp)
    );
  saveLocationSignature(db, input.location_name, JSON.parse(input.processed_json).monsters ?? []);

  return getHuntUploadRow(db, Number(inserted.lastInsertRowid)) ?? normalizeHuntRow({});
}

function buildHuntInput(payload: unknown): HuntInput {
  const row = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const rawText = asText(row.raw_text).replace(/<\/??hunt>/gi, "").trim();
  const parsedText = rawText.trim() ? parseHuntSessionText(rawText) : null;
  const fallbackTotalXp = asNumber(row.total_xp, parsedText?.total_xp ?? 0);
  const fallbackRawTotalXp = parsedText?.raw_total_xp ?? fallbackTotalXp;
  const monsters = parsedText?.monsters ?? [];
  const lootItems = parsedText?.loot_items ?? [];
  const processedJson = JSON.stringify({
    parsed: parsedText,
    monsters,
    loot_items: lootItems,
    processed_at: nowIso()
  });

  return {
    label: asText(row.label).trim() || parsedText?.label || "Untitled Hunt",
    duration_minutes: Math.max(1, Math.round(asNumber(row.duration_minutes, parsedText?.duration_minutes ?? 1))),
    raw_total_xp: Math.max(0, Math.round(asNumber(row.raw_total_xp, fallbackRawTotalXp))),
    total_xp: Math.max(0, Math.round(fallbackTotalXp)),
    total_loot_gold: Math.max(0, Math.round(asNumber(row.total_loot_gold, parsedText?.total_loot_gold ?? 0))),
    total_supply_cost: Math.max(0, Math.round(asNumber(row.total_supply_cost, parsedText?.total_supply_cost ?? 0))),
    started_at: parsedText?.started_at ?? toIsoOrNull(row.started_at),
    ended_at: parsedText?.ended_at ?? toIsoOrNull(row.ended_at),
    location_name: asText(row.location_name).trim() || null,
    tags: coerceTags(row.tags),
    excluded_item_names: coerceExcludedItemNames(row.excluded_item_names),
    raw_text: rawText,
    processed_json: processedJson,
    raw_text_hash: sha256(rawText)
  };
}

export function updateHuntUpload(
  db: Database.Database,
  huntId: number,
  payload: unknown
): Record<string, unknown> | null {
  if (!Number.isFinite(huntId) || huntId <= 0) {
    throw new Error("Invalid hunt id");
  }

  const input = buildHuntInput(payload);
  const updated = db
    .prepare(
      `
      UPDATE hunt_uploads
      SET
        label = ?,
        duration_minutes = ?,
        raw_total_xp = ?,
        total_xp = ?,
        total_loot_gold = ?,
        total_supply_cost = ?,
        started_at = ?,
        ended_at = ?,
        tags_json = ?,
        excluded_items_json = ?,
        raw_text = ?,
        processed_json = ?,
        raw_text_hash = ?,
        location_name = ?,
        boost_factor = ?
      WHERE id = ?
    `
    )
    .run(
      input.label,
      input.duration_minutes,
      input.raw_total_xp,
      input.total_xp,
      input.total_loot_gold,
      input.total_supply_cost,
      input.started_at,
      input.ended_at,
      JSON.stringify(input.tags),
      JSON.stringify(input.excluded_item_names),
      input.raw_text,
      input.processed_json,
      input.raw_text_hash,
      input.location_name,
      computeBoostFactor(input.raw_total_xp, input.total_xp),
      Math.trunc(huntId)
    );

  if (updated.changes === 0) {
    return null;
  }

  saveLocationSignature(db, input.location_name, JSON.parse(input.processed_json).monsters ?? []);
  return getHuntUploadRow(db, Math.trunc(huntId));
}

export function deleteHuntUpload(db: Database.Database, huntId: number): boolean {
  if (!Number.isFinite(huntId) || huntId <= 0) {
    throw new Error("Invalid hunt id");
  }

  const deleted = db.prepare("DELETE FROM hunt_uploads WHERE id = ?").run(Math.trunc(huntId));
  return deleted.changes > 0;
}

function getHuntUploadRow(db: Database.Database, huntId: number): Record<string, unknown> | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        label,
        uploaded_at,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        tags_json,
        excluded_items_json,
        location_name,
        location_confidence,
        boost_factor
      FROM hunt_uploads
      WHERE id = ?
    `
    )
    .get(huntId) as Record<string, unknown> | undefined;

  return row ? normalizeHuntRow(row) : null;
}

function normalizeHuntRow(row: Record<string, unknown>): Record<string, unknown> {
  const durationMinutes = Math.max(1, asNumber(row.duration_minutes, 1));
  const totalXp = Math.max(0, asNumber(row.total_xp, 0));
  const rawTotalXp = Math.max(0, asNumber(row.raw_total_xp, totalXp));
  const totalLoot = Math.max(0, asNumber(row.total_loot_gold, 0));
  const totalSupply = Math.max(0, asNumber(row.total_supply_cost, 0));
  const netProfit = totalLoot - totalSupply;
  const hours = durationMinutes / 60;

  let tags: string[] = [];
  if (typeof row.tags_json === "string") {
    try {
      const parsed = JSON.parse(row.tags_json);
      if (Array.isArray(parsed)) {
        tags = parsed.map((entry) => asText(entry)).filter(Boolean);
      }
    } catch {
      tags = [];
    }
  }

  let excludedItemNames: string[] = [];
  if (typeof row.excluded_items_json === "string") {
    try {
      excludedItemNames = coerceExcludedItemNames(JSON.parse(row.excluded_items_json));
    } catch {
      excludedItemNames = [];
    }
  }

  return {
    id: asNumber(row.id, 0),
    label: asText(row.label),
    uploaded_at: asText(row.uploaded_at),
    duration_minutes: durationMinutes,
    raw_total_xp: rawTotalXp,
    total_xp: totalXp,
    total_loot_gold: totalLoot,
    total_supply_cost: totalSupply,
    net_profit: netProfit,
    xp_per_hour: Math.round(totalXp / hours),
    raw_xp_per_hour: Math.round(rawTotalXp / hours),
    gold_per_hour: Math.round(netProfit / hours),
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    location_name: row.location_name ?? null,
    location_confidence: asNumber(row.location_confidence, 0),
    boost_factor: row.boost_factor ?? computeBoostFactor(rawTotalXp, totalXp),
    tags,
    excluded_item_names: excludedItemNames
  };
}

export function listHuntUploads(db: Database.Database): Record<string, unknown> {
  const rows = db
    .prepare(
      `
      SELECT
        id,
        label,
        uploaded_at,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        tags_json,
        excluded_items_json,
        location_name,
        location_confidence,
        boost_factor
      FROM hunt_uploads
      ORDER BY uploaded_at DESC, id DESC
    `
    )
    .all() as Array<Record<string, unknown>>;

  const items = rows.map(normalizeHuntRow);
  const topByXpm = [...items].sort((a, b) => Number(b.xp_per_hour) - Number(a.xp_per_hour))[0] ?? null;
  const topByGpm = [...items].sort((a, b) => Number(b.gold_per_hour) - Number(a.gold_per_hour))[0] ?? null;

  return {
    items,
    summary: {
      total_hunts: items.length,
      top_xpm: topByXpm,
      top_gpm: topByGpm
    }
  };
}

export async function getHuntUploadPreview(
  db: Database.Database,
  huntId: number
): Promise<Record<string, unknown> | null> {
  const row = db
    .prepare(
      `
      SELECT
        id,
        label,
        uploaded_at,
        raw_text,
        processed_json,
        location_name,
        tags_json,
        excluded_items_json
      FROM hunt_uploads
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(Math.trunc(huntId)) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  let excludedItemNames: string[] = [];
  if (typeof row.excluded_items_json === "string") {
    try {
      excludedItemNames = coerceExcludedItemNames(JSON.parse(row.excluded_items_json));
    } catch {
      excludedItemNames = [];
    }
  }
  let parsed: ParsedHuntText | null = null;
  if (typeof row.processed_json === "string" && row.processed_json.trim()) {
    try {
      const processed = JSON.parse(row.processed_json) as Record<string, unknown>;
      const processedParsed = asRecord(processed.parsed);
      if (processedParsed) {
        parsed = {
          label: firstText(processedParsed.label),
          duration_minutes: asNumberOrNull(processedParsed.duration_minutes),
          raw_total_xp: asNumberOrNull(processedParsed.raw_total_xp),
          total_xp: asNumberOrNull(processedParsed.total_xp),
          total_loot_gold: asNumberOrNull(processedParsed.total_loot_gold),
          total_supply_cost: asNumberOrNull(processedParsed.total_supply_cost),
          started_at: firstText(processedParsed.started_at),
          ended_at: firstText(processedParsed.ended_at),
          hunt_date: firstText(processedParsed.hunt_date),
          monsters: Array.isArray(processedParsed.monsters)
            ? processedParsed.monsters as Array<{ name: string; count: number }>
            : Array.isArray(processed.monsters)
              ? processed.monsters as Array<{ name: string; count: number }>
              : [],
          loot_items: Array.isArray(processedParsed.loot_items)
            ? processedParsed.loot_items as Array<{ name: string; quantity: number; normalized_name: string }>
            : Array.isArray(processed.loot_items)
              ? processed.loot_items as Array<{ name: string; quantity: number; normalized_name: string }>
              : []
        };
      }
    } catch {
      parsed = null;
    }
  }

  const rawText = asText(row.raw_text);
  const preview = parsed
    ? await buildHuntPreviewFromParsed(db, parsed, rawText, excludedItemNames, asText(row.location_name).trim() || null)
    : await parseHuntPreview(db, {
      raw_text: rawText,
      excluded_item_names: excludedItemNames,
      location_name: row.location_name
    });

  return {
    ...preview,
    saved_hunt: {
      id: asNumber(row.id, 0),
      label: asText(row.label),
      uploaded_at: asText(row.uploaded_at)
    }
  };
}
