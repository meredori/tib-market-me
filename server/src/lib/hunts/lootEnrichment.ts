import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../../config";
import { summarizeItemHistory } from "../pricing/itemHistory";
import { getEffectiveLootLogicPreview } from "../sync/updatePrices";
import { fetchAndCacheItemDetail, getCachedItemDetail } from "./itemDetailCache";
import type { EnrichedLootItem, LootLookupRow } from "./types";
import {
  asNumberOrNull,
  normalizeLootItemName
} from "./utils";

const HARD_CODED_ITEM_VALUES: Record<string, { unit_value: number; weight_oz: number | null; resolved_name: string }> = {
  "gold coin": { unit_value: 1, weight_oz: 0.1, resolved_name: "gold coin" },
  "gold coins": { unit_value: 1, weight_oz: 0.1, resolved_name: "gold coin" },
  "platinum coin": { unit_value: 100, weight_oz: 0.1, resolved_name: "platinum coin" },
  "platinum coins": { unit_value: 100, weight_oz: 0.1, resolved_name: "platinum coin" },
  "crystal coin": { unit_value: 10000, weight_oz: 0.1, resolved_name: "crystal coin" },
  "crystal coins": { unit_value: 10000, weight_oz: 0.1, resolved_name: "crystal coin" }
};

function singularizeSimple(name: string): string {
  if (name.endsWith("ies") && name.length > 3) {
    return `${name.slice(0, -3)}y`;
  }
  if (name.endsWith("s") && !name.endsWith("ss") && name.length > 1) {
    return name.slice(0, -1);
  }
  return name;
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

export function lookupLootItem(db: Database.Database, name: string): LootLookupRow | null {
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

export async function enrichLootItems(
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
