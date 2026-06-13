import type Database from "better-sqlite3";
import { config } from "../config";
import {
  confidence as buildConfidence,
  entityRef,
  explanation,
  freshness as buildFreshness,
  labelsFromExplanations,
  provenance
} from "./intelligence/metadata";
import type { Confidence, Freshness, InsightExplanation, Provenance } from "./intelligence/types";
import { lookupLootItem } from "./hunts/lootEnrichment";
import { normalizeLootItemName } from "./hunts/utils";
import { buildLootLogicPreview, getEffectiveLootLogicPreview, type LootLogicPreview } from "./sync/updatePrices";

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 250;
const STALE_HOURS = 36;
const AGING_HOURS = 12;
const OVERRIDE_REVIEW_DAYS = 30;
const OVERRIDE_DISAGREEMENT_PCT = 0.35;

type LatestRun = {
  id: number;
  server: string;
  finished_at: string;
  world_last_update: string | null;
  world_queried_at: string | null;
};

type LootAggregate = {
  name: string;
  normalized_name: string;
  quantity: number;
  excluded_quantity: number;
  hunt_ids: Set<number>;
  hunts: Array<{ id: number; label: string; looted_at: string | null; quantity: number }>;
  latest_looted_at: string | null;
};

type MarketLootRow = {
  item_id: number;
  name: string | null;
  wiki_name: string | null;
  category: string | null;
  client_value: number;
  fair_price: number;
  suggested_list_price: number;
  historical_reference_price: number | null;
  divergence_pct: number | null;
  source_run_count: number | null;
  trend: string;
  trend_score: number;
  liquidity: number;
  confidence: number;
  month_sold: number;
  day_sold: number;
  sell_offers: number;
  active_traders: number;
  sell_offer: number;
  npc_buy: number;
  npc_sell: number;
  override_mode: string;
  override_updated_at: string | null;
};

type LootInboxItem = {
  item_id: number | null;
  name: string;
  normalized_name: string;
  image_path: string | null;
  quantity: number;
  excluded_quantity: number;
  hunt_count: number;
  hunts: Array<{ id: number; label: string; looted_at: string | null; quantity: number }>;
  latest_looted_at: string | null;
  unit_value: number;
  total_estimated_value: number;
  current_market_value: number;
  historical_reference_price: number | null;
  low_band: number | null;
  high_band: number | null;
  npc_value: number;
  override_mode: string;
  override_updated_at: string | null;
  market: Record<string, unknown>;
  loot_logic: LootLogicPreview | null;
  action: string;
  action_label: string;
  reasons: InsightExplanation[];
  warnings: InsightExplanation[];
  reason_labels: string[];
  warning_labels: string[];
  confidence_detail: Confidence;
  freshness: Freshness;
  provenance: Provenance[];
};

function asNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, (Date.now() - parsed) / (24 * 60 * 60 * 1000));
}

function disagreementPct(a: number, b: number): number {
  const high = Math.max(Math.abs(a), Math.abs(b));
  if (high <= 0) {
    return 0;
  }
  return Math.abs(a - b) / high;
}

function latestRun(db: Database.Database): LatestRun | null {
  return db
    .prepare(
      `
      SELECT id, server, finished_at, world_last_update, world_queried_at
      FROM market_runs
      WHERE status = 'success'
      ORDER BY id DESC
      LIMIT 1
      `
    )
    .get() as LatestRun | undefined ?? null;
}

function marketFreshness(run: LatestRun | null): Freshness {
  return buildFreshness(run?.finished_at ?? null, {
    staleAfterHours: STALE_HOURS,
    agingAfterHours: AGING_HOURS,
    lastVerified: run?.world_queried_at ?? run?.world_last_update ?? null,
    missingDataReason: "No local market sync is available for loot selling decisions."
  });
}

function lowBand(row: MarketLootRow | null): number | null {
  if (!row?.historical_reference_price || row.historical_reference_price <= 0 || !row.source_run_count || row.source_run_count < 4) {
    return null;
  }
  const bandPct = row.source_run_count >= 10 ? 0.25 : 0.35;
  return Math.max(1, Math.round(row.historical_reference_price * (1 - bandPct)));
}

function highBand(row: MarketLootRow | null): number | null {
  if (!row?.historical_reference_price || row.historical_reference_price <= 0 || !row.source_run_count || row.source_run_count < 4) {
    return null;
  }
  const bandPct = row.source_run_count >= 10 ? 0.25 : 0.35;
  return Math.max(1, Math.round(row.historical_reference_price * (1 + bandPct)));
}

function marketRowForItem(db: Database.Database, runId: number, itemId: number): MarketLootRow | null {
  return db
    .prepare(
      `
      SELECT
        mip.item_id,
        im.name,
        im.wiki_name,
        im.category,
        mip.client_value,
        mip.fair_price,
        mip.suggested_list_price,
        mip.historical_reference_price,
        mip.divergence_pct,
        mip.source_run_count,
        mip.trend,
        mip.trend_score,
        mip.liquidity,
        mip.confidence,
        mif.month_sold,
        mif.day_sold,
        mif.sell_offers,
        mif.active_traders,
        mif.sell_offer,
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
        COALESCE(ivo.override_mode, 'auto') AS override_mode,
        ivo.updated_at AS override_updated_at
      FROM market_item_prices mip
      LEFT JOIN item_metadata im ON im.item_id = mip.item_id
      LEFT JOIN market_item_features mif
        ON mif.run_id = mip.run_id
       AND mif.item_id = mip.item_id
      LEFT JOIN item_value_overrides ivo ON ivo.item_id = mip.item_id
      WHERE mip.run_id = ?
        AND mip.pricing_model = ?
        AND mip.item_id = ?
      LIMIT 1
      `
    )
    .get(runId, config.pricingModel, itemId) as MarketLootRow | undefined ?? null;
}

function aggregateSavedLoot(db: Database.Database, days: number): { rows: LootAggregate[]; huntCount: number } {
  const cutoffMs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null;
  const rows = db
    .prepare(
      `
      SELECT id, label, uploaded_at, started_at, processed_json, excluded_items_json
      FROM hunt_uploads
      ORDER BY uploaded_at DESC, id DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  const byName = new Map<string, LootAggregate>();
  let includedHunts = 0;

  for (const row of rows) {
    const lootedAt = asText(row.started_at) || asText(row.uploaded_at) || null;
    const lootedMs = lootedAt ? Date.parse(lootedAt) : Number.NaN;
    if (cutoffMs !== null && Number.isFinite(lootedMs) && lootedMs < cutoffMs) {
      continue;
    }

    const processed = parseJsonObject(row.processed_json);
    const parsed = typeof processed.parsed === "object" && processed.parsed !== null
      ? processed.parsed as Record<string, unknown>
      : {};
    const lootItems = Array.isArray(parsed.loot_items)
      ? parsed.loot_items
      : Array.isArray(processed.loot_items)
        ? processed.loot_items
        : [];
    if (!lootItems.length) {
      continue;
    }

    includedHunts += 1;
    const excluded = new Set(parseJsonArray(row.excluded_items_json).map((entry) => normalizeLootItemName(String(entry))));
    const huntId = Math.trunc(asNumber(row.id));
    const label = asText(row.label) || `Hunt ${huntId}`;

    for (const entry of lootItems as Array<Record<string, unknown>>) {
      const rawName = asText(entry.name).trim();
      const normalized = normalizeLootItemName(asText(entry.normalized_name) || rawName);
      const quantity = Math.max(0, asNumber(entry.quantity));
      if (!rawName || !normalized || quantity <= 0) {
        continue;
      }
      const aggregate = byName.get(normalized) ?? {
        name: rawName,
        normalized_name: normalized,
        quantity: 0,
        excluded_quantity: 0,
        hunt_ids: new Set<number>(),
        hunts: [],
        latest_looted_at: null
      };
      if (excluded.has(normalized)) {
        aggregate.excluded_quantity += quantity;
      } else {
        aggregate.quantity += quantity;
      }
      aggregate.hunt_ids.add(huntId);
      const huntRef = aggregate.hunts.find((hunt) => hunt.id === huntId);
      if (huntRef) {
        huntRef.quantity += quantity;
      } else if (aggregate.hunts.length < 5) {
        aggregate.hunts.push({ id: huntId, label, looted_at: lootedAt, quantity });
      }
      if (!aggregate.latest_looted_at || (lootedAt && lootedAt > aggregate.latest_looted_at)) {
        aggregate.latest_looted_at = lootedAt;
      }
      byName.set(normalized, aggregate);
    }
  }

  return {
    rows: Array.from(byName.values()).filter((row) => row.quantity > 0 || row.excluded_quantity > 0),
    huntCount: includedHunts
  };
}

function classifyLootItem(input: {
  aggregate: LootAggregate;
  row: MarketLootRow | null;
  lootLogic: LootLogicPreview | null;
  baseLootLogic: LootLogicPreview | null;
  freshness: Freshness;
  confidence: Confidence;
  itemProvenance: Provenance[];
  unitValue: number;
  low: number | null;
  high: number | null;
}): { action: string; actionLabel: string; reasons: InsightExplanation[]; warnings: InsightExplanation[] } {
  const itemRef = entityRef("item", {
    id: input.row?.item_id ?? null,
    name: input.row?.name || input.row?.wiki_name || input.aggregate.name,
    normalized_name: input.aggregate.normalized_name
  });
  const reasons: InsightExplanation[] = [];
  const warnings: InsightExplanation[] = [];
  const hasManualOverride = Boolean(input.row?.override_mode && input.row.override_mode !== "auto");

  if (hasManualOverride && input.row) {
    reasons.push(explanation("manual override", "neutral", `Manual override is set to ${input.row.override_mode}.`, {
      source_refs: [itemRef],
      provenance: [provenance("manual_override", { source_ref: itemRef, manual: true })]
    }));

    const ageDays = daysSince(input.row.override_updated_at);
    if (ageDays !== null && ageDays >= OVERRIDE_REVIEW_DAYS) {
      warnings.push(explanation("old override", "warning", "This manual override is old enough to review against recent market data.", {
        source_refs: [itemRef],
        provenance: [provenance("manual_override", { source_ref: itemRef, manual: true })]
      }));
    }

    const baseValue = Math.max(0, Math.round(input.baseLootLogic?.fair_sale_price ?? 0));
    const overrideValue = Math.max(0, Math.round(input.lootLogic?.fair_sale_price ?? 0));
    const strategyChanged = input.baseLootLogic && input.lootLogic && input.baseLootLogic.strategy !== input.lootLogic.strategy;
    const valueDisagrees = baseValue > 0 && disagreementPct(baseValue, overrideValue) >= OVERRIDE_DISAGREEMENT_PCT;
    if (strategyChanged || valueDisagrees) {
      warnings.push(explanation("override disagrees", "warning", "Manual override differs strongly from the automatic pricing decision.", {
        source_refs: [itemRef],
        provenance: [
          provenance("manual_override", { source_ref: itemRef, manual: true }),
          provenance("derived_calculation", { source_ref: itemRef })
        ]
      }));
    }

    if (input.unitValue * input.aggregate.quantity >= 50_000) {
      warnings.push(explanation("review override", "warning", "This override affects high-value looted items.", {
        source_refs: [itemRef],
        provenance: [provenance("manual_override", { source_ref: itemRef, manual: true })]
      }));
    }

    if (baseValue > 0 || overrideValue > 0) {
      warnings.push(explanation("itemprices impact", "warning", "This override can change the generated itemprices export value.", {
        source_refs: [itemRef],
        provenance: [provenance("manual_override", { source_ref: itemRef, manual: true })]
      }));
    }
  }

  if (!input.row || !input.lootLogic) {
    warnings.push(explanation("unknown price", "blocked", "No usable market, NPC, or override value is available for this looted item.", {
      source_refs: [itemRef],
      provenance: [provenance("personal_hunt")]
    }));
    return { action: "unknown_price", actionLabel: "Unknown price", reasons, warnings };
  }

  if (input.unitValue <= 0 && !hasManualOverride) {
    warnings.push(explanation("unknown price", "blocked", "No usable market, NPC, or override value is available for this looted item.", {
      source_refs: [itemRef],
      provenance: [provenance("personal_hunt")]
    }));
    return { action: "unknown_price", actionLabel: "Unknown price", reasons, warnings };
  }

  if (input.freshness.stale) {
    warnings.push(explanation("stale data", "warning", "Market data is old enough to review before listing.", {
      source_refs: [itemRef],
      provenance: input.itemProvenance
    }));
  }
  if (input.confidence.level === "low" || input.confidence.level === "unknown") {
    warnings.push(explanation("low confidence", "warning", "Pricing confidence is limited for this item.", {
      source_refs: [itemRef],
      provenance: input.itemProvenance,
      missing_data_reason: input.confidence.missing_data_reason
    }));
  }
  const lowLiquidity = Number(input.row.month_sold ?? -1) >= 0 && Number(input.row.month_sold) < 5;
  const thinMarket = Number(input.row.liquidity ?? 0) < 0.1 || lowLiquidity;
  if (thinMarket) {
    warnings.push(explanation("low liquidity", "warning", "Recent market activity is thin.", {
      source_refs: [itemRef],
      provenance: input.itemProvenance
    }));
  }

  if (input.lootLogic.strategy === "npc_buy") {
    reasons.push(explanation("NPC/vendor", "positive", "NPC sale value is the clearest sale path.", {
      source_refs: [itemRef],
      provenance: input.itemProvenance
    }));
    return { action: "npc_vendor", actionLabel: "NPC/vendor", reasons, warnings };
  }

  if (input.lootLogic.strategy === "ignore") {
    warnings.push(explanation("review price", "warning", input.lootLogic.reason, {
      source_refs: [itemRef],
      provenance: input.itemProvenance
    }));
    return { action: "review_price", actionLabel: "Review price", reasons, warnings };
  }

  if (input.low !== null && input.unitValue < input.low) {
    reasons.push(explanation("below historical band", "neutral", "Current value is below the historical band; holding may be better.", {
      source_refs: [itemRef],
      provenance: input.itemProvenance
    }));
    return { action: "hold", actionLabel: "Hold", reasons, warnings };
  }

  if (input.high !== null && input.unitValue >= input.high) {
    reasons.push(explanation("above historical band", "positive", "Current value is above the historical band.", {
      source_refs: [itemRef],
      provenance: input.itemProvenance
    }));
    return { action: "sell_now", actionLabel: "Sell now", reasons, warnings };
  }

  if (input.freshness.stale || input.confidence.level === "low" || input.confidence.level === "unknown") {
    return { action: "review_price", actionLabel: "Review price", reasons, warnings };
  }

  if (thinMarket) {
    return { action: "watch", actionLabel: "Watch", reasons, warnings };
  }

  reasons.push(explanation("sellable loot", "positive", "Market quality is good enough to list this item.", {
    source_refs: [itemRef],
    provenance: input.itemProvenance
  }));
  return { action: "sell_now", actionLabel: "Sell now", reasons, warnings };
}

function toInboxItem(db: Database.Database, run: LatestRun | null, runFreshness: Freshness, aggregate: LootAggregate): LootInboxItem {
  const lookup = lookupLootItem(db, aggregate.name);
  const itemId = lookup?.item_id && lookup.item_id > 0 ? Math.trunc(lookup.item_id) : null;
  const row = run && itemId ? marketRowForItem(db, run.id, itemId) : null;
  const logicInput = row ?? (lookup ? lookup as unknown as MarketLootRow : null);
  const baseLootLogic = logicInput ? buildLootLogicPreview(logicInput as unknown as Record<string, unknown>) : null;
  const lootLogic = logicInput ? getEffectiveLootLogicPreview(logicInput as unknown as Record<string, unknown>) : null;
  const unitValue = Math.max(0, Math.round(lootLogic?.fair_sale_price ?? 0));
  const totalEstimatedValue = unitValue * Math.max(0, aggregate.quantity);
  const itemFreshness = run ? runFreshness : buildFreshness(null, { missingDataReason: "No market run is available." });
  const itemConfidence = buildConfidence(row?.confidence ?? lookup?.confidence ?? null, {
    estimated: true,
    missingDataReason: !row && !lookup
      ? "No item identity or market row could be resolved."
      : Number(row?.confidence ?? lookup?.confidence ?? 0) < 0.45
        ? "Market activity or historical evidence is thin."
        : null
  });
  const itemRef = entityRef("item", {
    id: itemId,
    name: row?.name || row?.wiki_name || lookup?.name || lookup?.wiki_name || aggregate.name,
    normalized_name: aggregate.normalized_name
  });
  const itemProvenance = [
    provenance("personal_hunt", { source_ref: entityRef("hunt", { name: "Saved hunts" }) }),
    ...(run ? [provenance("market_sync", { source_ref: entityRef("market_observation", { id: run.id, name: run.server }), observed_at: run.finished_at })] : []),
    provenance("derived_calculation", { source_ref: itemRef }),
    ...((row?.override_mode && row.override_mode !== "auto")
      ? [provenance("manual_override", { source_ref: itemRef, manual: true })]
      : [])
  ];
  const low = lowBand(row);
  const high = highBand(row);
  const classified = classifyLootItem({
    aggregate,
    row,
    lootLogic,
    baseLootLogic,
    freshness: itemFreshness,
    confidence: itemConfidence,
    itemProvenance,
    unitValue,
    low,
    high
  });

  return {
    item_id: itemId,
    name: row?.name || row?.wiki_name || lookup?.name || lookup?.wiki_name || aggregate.name,
    normalized_name: aggregate.normalized_name,
    image_path: itemId ? `/items/${itemId}.png` : null,
    quantity: aggregate.quantity,
    excluded_quantity: aggregate.excluded_quantity,
    hunt_count: aggregate.hunt_ids.size,
    hunts: aggregate.hunts,
    latest_looted_at: aggregate.latest_looted_at,
    unit_value: unitValue,
    total_estimated_value: totalEstimatedValue,
    current_market_value: Math.max(0, Math.round(row?.client_value ?? lookup?.client_value ?? 0)),
    historical_reference_price: row?.historical_reference_price ?? null,
    low_band: low,
    high_band: high,
    npc_value: Math.max(0, Math.round(row?.npc_buy ?? lookup?.npc_buy ?? 0)),
    override_mode: row?.override_mode ?? lookup?.override_mode ?? "auto",
    override_updated_at: row?.override_updated_at ?? null,
    market: {
      trend: lootLogic?.trend_display ?? row?.trend ?? lookup?.trend ?? "unknown",
      liquidity: row?.liquidity ?? lookup?.liquidity ?? 0,
      month_sold: row?.month_sold ?? lookup?.month_sold ?? -1,
      day_sold: row?.day_sold ?? lookup?.day_sold ?? -1,
      sell_offers: row?.sell_offers ?? -1,
      active_traders: row?.active_traders ?? -1,
      sell_offer: row?.sell_offer ?? lookup?.sell_offer ?? -1
    },
    loot_logic: lootLogic,
    action: classified.action,
    action_label: classified.actionLabel,
    reasons: classified.reasons,
    warnings: classified.warnings,
    reason_labels: [
      ...labelsFromExplanations(classified.reasons, "positive"),
      ...labelsFromExplanations(classified.reasons, "neutral")
    ],
    warning_labels: [
      ...labelsFromExplanations(classified.warnings, "warning"),
      ...labelsFromExplanations(classified.warnings, "blocked")
    ],
    confidence_detail: itemConfidence,
    freshness: itemFreshness,
    provenance: itemProvenance
  };
}

function clampLimit(limit: unknown): number {
  const numeric = Math.trunc(asNumber(limit, DEFAULT_LIMIT));
  return Math.max(1, Math.min(MAX_LIMIT, numeric));
}

function normalizeDays(days: unknown): number {
  const numeric = Math.trunc(asNumber(days, DEFAULT_DAYS));
  return Math.max(0, numeric);
}

export function getLootInbox(db: Database.Database, options: { days?: unknown; limit?: unknown } = {}): Record<string, unknown> {
  const days = normalizeDays(options.days);
  const limit = clampLimit(options.limit);
  const run = latestRun(db);
  const freshness = marketFreshness(run);
  const aggregate = aggregateSavedLoot(db, days);
  const items = aggregate.rows
    .map((row) => toInboxItem(db, run, freshness, row))
    .sort((a, b) => {
      const actionWeight: Record<string, number> = {
        sell_now: 1,
        npc_vendor: 2,
        review_price: 3,
        hold: 4,
        watch: 5,
        unknown_price: 6
      };
      return (actionWeight[a.action] ?? 99) - (actionWeight[b.action] ?? 99)
        || b.total_estimated_value - a.total_estimated_value
        || b.quantity - a.quantity
        || a.name.localeCompare(b.name);
    })
    .slice(0, limit);

  const buckets: Record<string, LootInboxItem[]> = {
    sell_now: [],
    hold: [],
    npc_vendor: [],
    watch: [],
    review_price: [],
    unknown_price: [],
    low_liquidity: [],
    stale_data: [],
    override_review: []
  };
  for (const item of items) {
    if (buckets[item.action]) {
      buckets[item.action].push(item);
    }
    if (item.warning_labels.includes("low liquidity")) {
      buckets.low_liquidity.push(item);
    }
    if (item.warning_labels.includes("stale data")) {
      buckets.stale_data.push(item);
    }
    if (
      item.warning_labels.includes("review override")
      || item.warning_labels.includes("old override")
      || item.warning_labels.includes("override disagrees")
      || item.warning_labels.includes("itemprices impact")
    ) {
      buckets.override_review.push(item);
    }
  }

  return {
    ok: true,
    filters: { days, limit },
    freshness,
    summary: {
      item_count: items.length,
      hunt_count: aggregate.huntCount,
      total_quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      total_estimated_value: items.reduce((sum, item) => sum + item.total_estimated_value, 0),
      buckets: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length]))
    },
    buckets,
    items
  };
}
