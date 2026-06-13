import type Database from "better-sqlite3";
import {
  hydrateHuntItemDetails
} from "./itemDetailCache";
import { hydrateMissingHuntingPlaceDetailsForMatch, matchHuntToHuntingPlaces } from "./huntingPlaceMatcher";
import { enrichLootItems } from "./lootEnrichment";
import { parseHuntSessionText } from "./parser";
import {
  computeBoostFactor,
  createHuntUpload,
  deleteHuntLogImportFile,
  deleteHuntUpload,
  getHuntUploadPreview as getRepositoryHuntUploadPreview,
  ignoreHuntLogImport,
  listGlobalLootSummary as listRepositoryGlobalLootSummary,
  listHuntingAreaSummaries as listRepositoryHuntingAreaSummaries,
  listHuntLogImportCandidates as listRepositoryHuntLogImportCandidates,
  listHuntUploads,
  rematchHuntUpload,
  rematchHuntUploads,
  searchHuntingPlaces,
  suggestLocation,
  updateHuntUpload
} from "./repository";
import type { ParsedHuntText } from "./types";
import {
  asNumber,
  asRecord,
  asText,
  coerceExcludedItemNames
} from "./utils";

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
  const sortedMonsters = [...parsed.monsters].sort((a, b) => b.count - a.count);
  const locationSuggestion = explicitLocationName
    ? { name: explicitLocationName, confidence: 1, needs_setup: false }
    : suggestLocation(db, sortedMonsters);
  await hydrateMissingHuntingPlaceDetailsForMatch(db, parsed, explicitLocationName ?? locationSuggestion.name);
  const huntingPlaceMatch = matchHuntToHuntingPlaces(db, parsed, {
    locationName: explicitLocationName ?? locationSuggestion.name
  });
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
      needs_setup: locationSuggestion.needs_setup,
      hunting_place_match: huntingPlaceMatch
    },
    suggestions: enriched.suggestions,
    raw_text: rawText
  };
}

export async function parseHuntPreview(db: Database.Database, payload: unknown): Promise<Record<string, unknown>> {
  const row = asRecord(payload) ?? {};
  const rawText = asText(row.raw_text).replace(/<\/??hunt>/gi, "").trim();
  const excludedItemNames = coerceExcludedItemNames(row.excluded_item_names);
  const explicitLocationName = asText(row.location_name).trim() || null;

  if (!rawText) {
    throw new Error("No hunt text provided.");
  }

  return buildHuntPreviewFromParsed(
    db,
    parseHuntSessionText(rawText),
    rawText,
    excludedItemNames,
    explicitLocationName
  );
}

export async function listHuntLogImportCandidates(db: Database.Database): Promise<Record<string, unknown>> {
  return listRepositoryHuntLogImportCandidates(db, (payload) => parseHuntPreview(db, payload));
}

export async function listHuntingAreaSummaries(db: Database.Database): Promise<Record<string, unknown>> {
  return listRepositoryHuntingAreaSummaries(db, (payload) => parseHuntPreview(db, payload));
}

export async function listGlobalLootSummary(db: Database.Database): Promise<Record<string, unknown>> {
  return listRepositoryGlobalLootSummary(db, (payload) => parseHuntPreview(db, payload));
}

export async function getHuntUploadPreview(
  db: Database.Database,
  huntId: number
): Promise<Record<string, unknown> | null> {
  return getRepositoryHuntUploadPreview(
    db,
    huntId,
    (parsed, rawText, excludedItemNames, explicitLocationName) => buildHuntPreviewFromParsed(
      db,
      parsed,
      rawText,
      excludedItemNames,
      explicitLocationName
    ),
    (payload) => parseHuntPreview(db, payload)
  );
}

export {
  createHuntUpload,
  deleteHuntLogImportFile,
  deleteHuntUpload,
  hydrateHuntItemDetails,
  ignoreHuntLogImport,
  listHuntUploads,
  rematchHuntUpload,
  rematchHuntUploads,
  searchHuntingPlaces,
  updateHuntUpload
};

export const __huntAnalyserTestHooks = {
  buildHuntPreviewFromParsed,
  coercePreviewNumber: asNumber
};
