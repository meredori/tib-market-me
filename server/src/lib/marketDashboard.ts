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

const PRICING_MODEL = "conservative_min";
const ONE_HOUR_MS = 60 * 60 * 1000;
const STALE_HOURS = 24 * 14;
const AGING_HOURS = 24 * 7;

type LatestRun = {
  id: number;
  server: string;
  started_at: string;
  finished_at: string;
  pulled_at: string | null;
  world_last_update: string | null;
  world_queried_at: string | null;
  market_row_count: number;
  priced_item_count: number;
};

type MarketRow = {
  item_id: number;
  name: string | null;
  wiki_name: string | null;
  category: string | null;
  client_value: number;
  fair_price: number;
  suggested_list_price: number;
  trend: string;
  trend_score: number;
  liquidity: number;
  confidence: number;
  historical_reference_price: number | null;
  final_adjusted_price: number | null;
  divergence_pct: number | null;
  adjustment_reason: string | null;
  source_run_count: number | null;
  sell_offer: number;
  buy_offer: number;
  month_sold: number;
  day_sold: number;
  sell_offers: number;
  active_traders: number;
  last_seen_at: string | null;
  favorite_created_at?: string | null;
  favorite_note?: string | null;
  favorite_priority?: number | null;
};

type DashboardItem = {
  item_id: number;
  id: number;
  name: string;
  category: string | null;
  latest_price: number;
  client_value: number;
  sell_offer: number;
  fair_price: number;
  historical_reference_price: number | null;
  low_band: number | null;
  high_band: number | null;
  divergence_pct: number | null;
  trend: string;
  trend_score: number;
  liquidity: number;
  confidence: number;
  month_sold: number;
  day_sold: number;
  sell_offers: number;
  active_traders: number;
  source_run_count: number;
  last_seen_at: string | null;
  reasons: InsightExplanation[];
  warnings: InsightExplanation[];
  reason_labels: string[];
  warning_labels: string[];
  confidence_detail: Confidence;
  freshness: Freshness;
  provenance: Provenance[];
  favorite: boolean;
  spread: number | null;
  quality_labels: string[];
  note?: string;
  priority?: number;
  looted_quantity?: number;
  looted_value?: number;
};

type WatchRuleType =
  | "price_below"
  | "price_above"
  | "outside_historical_band"
  | "low_volume"
  | "stale_data"
  | "significant_move";

type WatchRuleRow = {
  id: number;
  item_id: number;
  rule_type: WatchRuleType;
  threshold_value: number | null;
  enabled: number;
  note: string;
  created_at: string;
  updated_at: string;
};

type TradeLogRow = {
  id: number;
  item_id: number;
  item_name: string | null;
  quantity: number;
  listed_price: number | null;
  sold_price: number | null;
  listed_at: string | null;
  sold_at: string | null;
  linked_hunt_id: number | null;
  notes: string;
  source: string;
  created_at: string;
  updated_at: string;
};

const WATCH_RULE_TYPES = new Set<WatchRuleType>([
  "price_below",
  "price_above",
  "outside_historical_band",
  "low_volume",
  "stale_data",
  "significant_move"
]);

const RULE_LABELS: Record<WatchRuleType, string> = {
  price_below: "Price below threshold",
  price_above: "Price above threshold",
  outside_historical_band: "Outside historical band",
  low_volume: "Low recent volume",
  stale_data: "Stale market data",
  significant_move: "Significant movement"
};

function nowIso(): string {
  return new Date().toISOString();
}

function asPositive(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : -1;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, maxLength = 500): string {
  return asText(value).slice(0, maxLength);
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionalPositiveInteger(value: unknown): number | null {
  const numeric = optionalNumber(value);
  if (numeric === null) {
    return null;
  }
  return numeric > 0 ? Math.trunc(numeric) : null;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(value: string | null | undefined): number | null {
  const parsed = parseDateMs(value);
  if (parsed === null) {
    return null;
  }
  return Math.max(0, (Date.now() - parsed) / ONE_HOUR_MS);
}

function latestRun(db: Database.Database): LatestRun | null {
  return db
    .prepare(
      `
      SELECT id, server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
             market_row_count, priced_item_count
      FROM market_runs
      WHERE status = 'success'
      ORDER BY id DESC
      LIMIT 1
      `
    )
    .get() as LatestRun | undefined ?? null;
}

function freshnessFromRun(run: LatestRun | null): Record<string, unknown> {
  if (!run) {
    const missing = buildFreshness(null, { missingDataReason: "No local market sync is available yet." });
    return {
      ...missing,
      server: config.serverName,
      status: "missing",
      label: "no local sync",
      finished_at: null,
      pulled_at: null,
      world_last_update: null,
      world_queried_at: null,
      market_row_count: 0,
      priced_item_count: 0
    };
  }

  const baseFreshness = buildFreshness(run.finished_at, {
    staleAfterHours: STALE_HOURS,
    agingAfterHours: AGING_HOURS,
    lastVerified: run.world_queried_at
  });
  return {
    ...baseFreshness,
    server: run.server,
    label: baseFreshness.status === "fresh" ? "latest sync" : `${baseFreshness.status} snapshot`,
    finished_at: run.finished_at,
    pulled_at: run.pulled_at,
    world_last_update: run.world_last_update,
    world_queried_at: run.world_queried_at,
    market_row_count: run.market_row_count,
    priced_item_count: run.priced_item_count
  };
}

function marketRows(db: Database.Database, runId: number, where = "", order = "", limit = 10): MarketRow[] {
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
        mip.trend,
        mip.trend_score,
        mip.liquidity,
        mip.confidence,
        mip.historical_reference_price,
        mip.final_adjusted_price,
        mip.divergence_pct,
        mip.adjustment_reason,
        mip.source_run_count,
        mif.sell_offer,
        mif.buy_offer,
        mif.month_sold,
        mif.day_sold,
        mif.sell_offers,
        mif.active_traders,
        (
          SELECT COALESCE(MAX(snapshot_at), MAX(fetched_at))
          FROM item_market_history imh
          WHERE imh.item_id = mip.item_id
            AND imh.server = ?
        ) AS last_seen_at
      FROM market_item_prices mip
      LEFT JOIN item_metadata im ON im.item_id = mip.item_id
      LEFT JOIN market_item_features mif
        ON mif.run_id = mip.run_id
       AND mif.item_id = mip.item_id
      WHERE mip.run_id = ?
        AND mip.pricing_model = ?
        ${where}
      ${order}
      LIMIT ?
      `
    )
    .all(config.serverName, runId, PRICING_MODEL, limit) as MarketRow[];
}

function lowBand(row: MarketRow): number | null {
  if (!row.historical_reference_price || row.historical_reference_price <= 0 || !row.source_run_count || row.source_run_count < 4) {
    return null;
  }
  const bandPct = row.source_run_count >= 10 ? 0.25 : 0.35;
  return Math.max(1, Math.round(row.historical_reference_price * (1 - bandPct)));
}

function highBand(row: MarketRow): number | null {
  if (!row.historical_reference_price || row.historical_reference_price <= 0 || !row.source_run_count || row.source_run_count < 4) {
    return null;
  }
  const bandPct = row.source_run_count >= 10 ? 0.25 : 0.35;
  return Math.max(1, Math.round(row.historical_reference_price * (1 + bandPct)));
}

function spreadFor(row: MarketRow): number | null {
  const sellOffer = asPositive(row.sell_offer);
  const buyOffer = asPositive(row.buy_offer);
  if (sellOffer <= 0 || buyOffer <= 0 || sellOffer < buyOffer) {
    return null;
  }
  return sellOffer - buyOffer;
}

function qualityLabels(row: MarketRow): string[] {
  const labels: string[] = [];
  const spread = spreadFor(row);
  const sellOffer = asPositive(row.sell_offer);
  if (row.liquidity >= 0.7 || row.month_sold >= 25 || row.day_sold >= 5) {
    labels.push("active market");
  }
  if (row.liquidity < 0.35 || (row.month_sold >= 0 && row.month_sold < 5)) {
    labels.push("thin volume");
  }
  if (spread !== null && sellOffer > 0 && spread / sellOffer >= 0.25) {
    labels.push("wide spread");
  }
  if (row.confidence < 0.45) {
    labels.push("low confidence");
  }
  return Array.from(new Set(labels));
}

function explanationsFor(row: MarketRow, runFreshness: Freshness): { reasons: InsightExplanation[]; warnings: InsightExplanation[] } {
  const reasons: InsightExplanation[] = [];
  const warnings: InsightExplanation[] = [];
  const price = asPositive(row.client_value);
  const low = lowBand(row);
  const high = highBand(row);
  const item = entityRef("item", { id: row.item_id, name: row.name || row.wiki_name || `Item ${row.item_id}` });
  const marketSource = provenance("market_sync", {
    source_ref: entityRef("market_observation", { id: row.item_id, name: row.name || row.wiki_name || null }),
    observed_at: row.last_seen_at ?? runFreshness.last_updated
  });

  if (runFreshness.stale) {
    warnings.push(explanation("older snapshot", "warning", "Market data is older than the normal scan window; use it as price guidance rather than a live listing.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  if (!row.source_run_count || row.source_run_count < 4 || !row.historical_reference_price) {
    warnings.push(explanation("needs more snapshots", "warning", "Historical-band decisions need more local market snapshots.", {
      source_refs: [item],
      provenance: [marketSource],
      missing_data_reason: "Fewer than four historical snapshots are available."
    }));
  }
  if (row.confidence < 0.45) {
    warnings.push(explanation("low confidence", "warning", "Market pricing quality is low for this item.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  if (row.month_sold >= 0 && row.month_sold < 5) {
    warnings.push(explanation("low recent volume", "warning", "Recent monthly sales volume is thin.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  if (low !== null && price > 0 && price < low) {
    reasons.push(explanation("below historical band", "positive", "Latest local price is below its historical band.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  if (high !== null && price > high) {
    reasons.push(explanation("above usual range", "neutral", "Latest local price is above its usual range.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  if (row.liquidity >= 0.7 || row.month_sold >= 25 || row.day_sold >= 5) {
    reasons.push(explanation("active market", "positive", "Recent local market activity suggests this item is easier to move.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  if (row.trend && row.trend !== "unknown") {
    reasons.push(explanation(row.trend.replace(/_/g, " "), "neutral", "Local market trend signal is available.", {
      source_refs: [item],
      provenance: [marketSource]
    }));
  }
  return { reasons: uniqueExplanations(reasons), warnings: uniqueExplanations(warnings) };
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

function toDashboardItem(row: MarketRow, runFreshness: Freshness, favoriteIds: Set<number>): DashboardItem {
  const labels = explanationsFor(row, runFreshness);
  const confidenceDetail = buildConfidence(row.confidence, {
    estimated: true,
    missingDataReason: row.confidence < 0.45 ? "Market activity or snapshot history is thin." : null
  });
  const itemFreshness = buildFreshness(row.last_seen_at ?? runFreshness.last_updated, {
    staleAfterHours: STALE_HOURS,
    agingAfterHours: AGING_HOURS,
    lastVerified: runFreshness.last_verified
  });
  const itemProvenance = [
    provenance("market_sync", {
      source_ref: entityRef("market_observation", { id: row.item_id, name: row.name || row.wiki_name || null }),
      observed_at: row.last_seen_at ?? runFreshness.last_updated
    }),
    provenance("derived_calculation", {
      source_ref: entityRef("item", { id: row.item_id, name: row.name || row.wiki_name || null })
    })
  ];
  const item: DashboardItem = {
    item_id: row.item_id,
    id: row.item_id,
    name: row.name || row.wiki_name || `Item ${row.item_id}`,
    category: row.category,
    latest_price: asPositive(row.client_value),
    client_value: asPositive(row.client_value),
    sell_offer: asPositive(row.sell_offer),
    fair_price: asPositive(row.fair_price),
    historical_reference_price: row.historical_reference_price,
    low_band: lowBand(row),
    high_band: highBand(row),
    divergence_pct: row.divergence_pct,
    trend: row.trend || "unknown",
    trend_score: Number(row.trend_score || 0),
    liquidity: Number(row.liquidity || 0),
    confidence: Number(row.confidence || 0),
    month_sold: Number(row.month_sold ?? -1),
    day_sold: Number(row.day_sold ?? -1),
    sell_offers: Number(row.sell_offers ?? -1),
    active_traders: Number(row.active_traders ?? -1),
    source_run_count: Number(row.source_run_count ?? 0),
    last_seen_at: row.last_seen_at,
    reasons: labels.reasons,
    warnings: labels.warnings,
    reason_labels: [
      ...labelsFromExplanations(labels.reasons, "positive"),
      ...labelsFromExplanations(labels.reasons, "neutral")
    ],
    warning_labels: labelsFromExplanations(labels.warnings, "warning"),
    confidence_detail: confidenceDetail,
    freshness: itemFreshness,
    provenance: itemProvenance,
    favorite: favoriteIds.has(row.item_id),
    spread: spreadFor(row),
    quality_labels: qualityLabels(row)
  };
  if (row.favorite_note) {
    item.note = row.favorite_note;
  }
  if (typeof row.favorite_priority === "number") {
    item.priority = row.favorite_priority;
  }
  return item;
}

function favoriteIds(db: Database.Database): Set<number> {
  const rows = db.prepare("SELECT item_id FROM market_watchlist_items").all() as Array<{ item_id: number }>;
  return new Set(rows.map((row) => row.item_id));
}

export function addMarketWatchlistItem(db: Database.Database, itemId: number): DashboardItem | Record<string, unknown> {
  const normalizedId = Math.trunc(itemId);
  const now = nowIso();
  db.prepare(
    `
    INSERT INTO market_watchlist_items (item_id, created_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET updated_at = excluded.updated_at
    `
  ).run(normalizedId, now, now);
  return getMarketWatchlist(db).items.find((item) => item.item_id === normalizedId) ?? { item_id: normalizedId };
}

export function removeMarketWatchlistItem(db: Database.Database, itemId: number): boolean {
  db.prepare("DELETE FROM market_watchlist_items WHERE item_id = ?").run(Math.trunc(itemId));
  return true;
}

export function getMarketWatchlist(db: Database.Database): { ok: true; items: DashboardItem[] } {
  const run = latestRun(db);
  if (!run) {
    return { ok: true, items: [] };
  }
  const runFreshness = freshnessFromRun(run) as Freshness;
  const ids = favoriteIds(db);
  const rows = db
    .prepare(
      `
      SELECT
        mw.item_id,
        mw.note AS favorite_note,
        mw.priority AS favorite_priority,
        mw.created_at AS favorite_created_at,
        im.name,
        im.wiki_name,
        im.category,
        mip.client_value,
        mip.fair_price,
        mip.suggested_list_price,
        mip.trend,
        mip.trend_score,
        mip.liquidity,
        mip.confidence,
        mip.historical_reference_price,
        mip.final_adjusted_price,
        mip.divergence_pct,
        mip.adjustment_reason,
        mip.source_run_count,
        mif.sell_offer,
        mif.buy_offer,
        mif.month_sold,
        mif.day_sold,
        mif.sell_offers,
        mif.active_traders,
        (
          SELECT COALESCE(MAX(snapshot_at), MAX(fetched_at))
          FROM item_market_history imh
          WHERE imh.item_id = mw.item_id
            AND imh.server = ?
        ) AS last_seen_at
      FROM market_watchlist_items mw
      LEFT JOIN item_metadata im ON im.item_id = mw.item_id
      LEFT JOIN market_item_prices mip
        ON mip.run_id = ?
       AND mip.item_id = mw.item_id
       AND mip.pricing_model = ?
      LEFT JOIN market_item_features mif
        ON mif.run_id = mip.run_id
       AND mif.item_id = mip.item_id
      ORDER BY mw.priority DESC, mw.updated_at DESC
      `
    )
    .all(config.serverName, run.id, PRICING_MODEL) as MarketRow[];
  return { ok: true, items: rows.map((row) => toDashboardItem(row, runFreshness, ids)) };
}

function latestMarketRowForItem(db: Database.Database, itemId: number, run: LatestRun | null = latestRun(db)): MarketRow | null {
  if (!run) {
    return null;
  }
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
        mip.trend,
        mip.trend_score,
        mip.liquidity,
        mip.confidence,
        mip.historical_reference_price,
        mip.final_adjusted_price,
        mip.divergence_pct,
        mip.adjustment_reason,
        mip.source_run_count,
        mif.sell_offer,
        mif.buy_offer,
        mif.month_sold,
        mif.day_sold,
        mif.sell_offers,
        mif.active_traders,
        (
          SELECT COALESCE(MAX(snapshot_at), MAX(fetched_at))
          FROM item_market_history imh
          WHERE imh.item_id = mip.item_id
            AND imh.server = ?
        ) AS last_seen_at
      FROM market_item_prices mip
      LEFT JOIN item_metadata im ON im.item_id = mip.item_id
      LEFT JOIN market_item_features mif
        ON mif.run_id = mip.run_id
       AND mif.item_id = mip.item_id
      WHERE mip.run_id = ?
        AND mip.pricing_model = ?
        AND mip.item_id = ?
      LIMIT 1
      `
    )
    .get(config.serverName, run.id, PRICING_MODEL, Math.trunc(itemId)) as MarketRow | undefined ?? null;
}

function readWatchRule(db: Database.Database, id: number): WatchRuleRow | null {
  return db.prepare("SELECT * FROM market_watch_rules WHERE id = ?").get(Math.trunc(id)) as WatchRuleRow | undefined ?? null;
}

function parseRuleType(value: unknown): WatchRuleType {
  if (typeof value === "string" && WATCH_RULE_TYPES.has(value as WatchRuleType)) {
    return value as WatchRuleType;
  }
  throw new Error("Invalid watch rule type");
}

function watchRulePayload(input: Record<string, unknown>, existing?: WatchRuleRow): {
  item_id: number;
  rule_type: WatchRuleType;
  threshold_value: number | null;
  enabled: number;
  note: string;
} {
  const itemId = optionalPositiveInteger(input.item_id ?? input.itemId) ?? existing?.item_id;
  if (!itemId) {
    throw new Error("Invalid watch rule item_id");
  }
  const ruleType = input.rule_type === undefined && existing
    ? existing.rule_type
    : parseRuleType(input.rule_type);
  const thresholdValue = input.threshold_value === undefined && existing
    ? existing.threshold_value
    : optionalNumber(input.threshold_value);
  const enabled = input.enabled === undefined && existing
    ? existing.enabled
    : input.enabled === false || input.enabled === 0 || input.enabled === "0"
      ? 0
      : 1;
  return {
    item_id: itemId,
    rule_type: ruleType,
    threshold_value: thresholdValue,
    enabled,
    note: input.note === undefined && existing ? existing.note : optionalText(input.note, 500)
  };
}

export function createMarketWatchRule(db: Database.Database, input: Record<string, unknown>): { ok: true; rule: Record<string, unknown> } {
  const payload = watchRulePayload(input);
  const now = nowIso();
  const result = db.prepare(
    `
    INSERT INTO market_watch_rules (item_id, rule_type, threshold_value, enabled, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(payload.item_id, payload.rule_type, payload.threshold_value, payload.enabled, payload.note, now, now);
  addMarketWatchlistItem(db, payload.item_id);
  return { ok: true, rule: watchRuleToResponse(db, readWatchRule(db, Number(result.lastInsertRowid)) as WatchRuleRow) };
}

export function updateMarketWatchRule(db: Database.Database, id: number, input: Record<string, unknown>): { ok: true; rule: Record<string, unknown> } {
  const existing = readWatchRule(db, id);
  if (!existing) {
    throw new Error("Watch rule not found");
  }
  const payload = watchRulePayload(input, existing);
  db.prepare(
    `
    UPDATE market_watch_rules
    SET item_id = ?, rule_type = ?, threshold_value = ?, enabled = ?, note = ?, updated_at = ?
    WHERE id = ?
    `
  ).run(payload.item_id, payload.rule_type, payload.threshold_value, payload.enabled, payload.note, nowIso(), Math.trunc(id));
  addMarketWatchlistItem(db, payload.item_id);
  return { ok: true, rule: watchRuleToResponse(db, readWatchRule(db, id) as WatchRuleRow) };
}

export function deleteMarketWatchRule(db: Database.Database, id: number): { ok: true; deleted_id: number } {
  db.prepare("DELETE FROM market_watch_rules WHERE id = ?").run(Math.trunc(id));
  return { ok: true, deleted_id: Math.trunc(id) };
}

function watchRuleToResponse(db: Database.Database, row: WatchRuleRow): Record<string, unknown> {
  const run = latestRun(db);
  const runFreshness = freshnessFromRun(run) as Freshness;
  const marketRow = latestMarketRowForItem(db, row.item_id, run);
  const item = marketRow ? toDashboardItem(marketRow, runFreshness, favoriteIds(db)) : null;
  const alert = marketRow || row.rule_type === "stale_data" ? evaluateWatchRule(row, marketRow, item, runFreshness) : null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    label: RULE_LABELS[row.rule_type],
    item,
    alert: alert?.triggered ? alert : null
  };
}

export function listMarketWatchRules(db: Database.Database): { ok: true; rules: Record<string, unknown>[]; alerts: Record<string, unknown>[] } {
  const rows = db.prepare("SELECT * FROM market_watch_rules ORDER BY enabled DESC, updated_at DESC, id DESC").all() as WatchRuleRow[];
  const rules = rows.map((row) => watchRuleToResponse(db, row));
  return {
    ok: true,
    rules,
    alerts: rules.map((rule) => rule.alert).filter(Boolean) as Record<string, unknown>[]
  };
}

function readTradeLogRow(db: Database.Database, id: number): TradeLogRow | null {
  return db.prepare("SELECT * FROM market_trade_log WHERE id = ?").get(Math.trunc(id)) as TradeLogRow | undefined ?? null;
}

function tradeLogPayload(input: Record<string, unknown>, existing?: TradeLogRow): {
  item_id: number;
  item_name: string | null;
  quantity: number;
  listed_price: number | null;
  sold_price: number | null;
  listed_at: string | null;
  sold_at: string | null;
  linked_hunt_id: number | null;
  notes: string;
  source: string;
} {
  const itemId = optionalPositiveInteger(input.item_id ?? input.itemId) ?? existing?.item_id;
  if (!itemId) {
    throw new Error("Invalid trade item_id");
  }
  const quantity = optionalPositiveInteger(input.quantity) ?? existing?.quantity ?? 1;
  const itemName = input.item_name === undefined && existing ? existing.item_name : optionalText(input.item_name, 120) || null;
  return {
    item_id: itemId,
    item_name: itemName,
    quantity,
    listed_price: input.listed_price === undefined && existing ? existing.listed_price : optionalPositiveInteger(input.listed_price),
    sold_price: input.sold_price === undefined && existing ? existing.sold_price : optionalPositiveInteger(input.sold_price),
    listed_at: input.listed_at === undefined && existing ? existing.listed_at : optionalText(input.listed_at, 40) || null,
    sold_at: input.sold_at === undefined && existing ? existing.sold_at : optionalText(input.sold_at, 40) || null,
    linked_hunt_id: input.linked_hunt_id === undefined && existing ? existing.linked_hunt_id : optionalPositiveInteger(input.linked_hunt_id),
    notes: input.notes === undefined && existing ? existing.notes : optionalText(input.notes, 500),
    source: input.source === undefined && existing ? existing.source : optionalText(input.source, 60) || "manual_input"
  };
}

function tradeLogToResponse(db: Database.Database, row: TradeLogRow): Record<string, unknown> {
  const run = latestRun(db);
  const marketRow = latestMarketRowForItem(db, row.item_id, run);
  const itemName = row.item_name || marketRow?.name || marketRow?.wiki_name || `Item ${row.item_id}`;
  const latestSnapshotPrice = marketRow ? asPositive(marketRow.client_value) : null;
  const quantity = Math.max(1, Number(row.quantity || 1));
  const listedTotal = row.listed_price !== null ? row.listed_price * quantity : null;
  const soldTotal = row.sold_price !== null ? row.sold_price * quantity : null;
  const snapshotTotal = latestSnapshotPrice !== null && latestSnapshotPrice > 0 ? latestSnapshotPrice * quantity : null;
  return {
    ...row,
    item_name: itemName,
    latest_snapshot_price: latestSnapshotPrice,
    listed_total: listedTotal,
    sold_total: soldTotal,
    snapshot_total: snapshotTotal,
    realized_vs_listed: soldTotal !== null && listedTotal !== null ? soldTotal - listedTotal : null,
    realized_vs_snapshot: soldTotal !== null && snapshotTotal !== null ? soldTotal - snapshotTotal : null,
    status: row.sold_price !== null || row.sold_at ? "sold" : "listed",
    provenance: [provenance("manual_input", { label: "trade log", manual: true })]
  };
}

export function listMarketTradeLog(db: Database.Database): { ok: true; items: Record<string, unknown>[]; summary: Record<string, unknown> } {
  const rows = db.prepare("SELECT * FROM market_trade_log ORDER BY COALESCE(sold_at, listed_at, created_at) DESC, id DESC LIMIT 200").all() as TradeLogRow[];
  const items = rows.map((row) => tradeLogToResponse(db, row));
  const sold = items.filter((item) => item.status === "sold");
  const soldTotal = sold.reduce((sum, item) => sum + Number(item.sold_total || 0), 0);
  const listedTotal = sold.reduce((sum, item) => sum + Number(item.listed_total || 0), 0);
  const snapshotTotal = sold.reduce((sum, item) => sum + Number(item.snapshot_total || 0), 0);
  return {
    ok: true,
    items,
    summary: {
      entry_count: items.length,
      sold_count: sold.length,
      sold_total: soldTotal,
      listed_total: listedTotal || null,
      snapshot_total: snapshotTotal || null,
      realized_vs_listed: listedTotal ? soldTotal - listedTotal : null,
      realized_vs_snapshot: snapshotTotal ? soldTotal - snapshotTotal : null,
      provenance: [provenance("manual_input", { label: "trade log", manual: true }), provenance("derived_calculation")]
    }
  };
}

export function createMarketTradeLogEntry(db: Database.Database, input: Record<string, unknown>): { ok: true; item: Record<string, unknown> } {
  const payload = tradeLogPayload(input);
  const now = nowIso();
  const result = db.prepare(
    `
    INSERT INTO market_trade_log (
      item_id, item_name, quantity, listed_price, sold_price, listed_at, sold_at,
      linked_hunt_id, notes, source, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    payload.item_id,
    payload.item_name,
    payload.quantity,
    payload.listed_price,
    payload.sold_price,
    payload.listed_at,
    payload.sold_at,
    payload.linked_hunt_id,
    payload.notes,
    payload.source,
    now,
    now
  );
  return { ok: true, item: tradeLogToResponse(db, readTradeLogRow(db, Number(result.lastInsertRowid)) as TradeLogRow) };
}

export function updateMarketTradeLogEntry(db: Database.Database, id: number, input: Record<string, unknown>): { ok: true; item: Record<string, unknown> } {
  const existing = readTradeLogRow(db, id);
  if (!existing) {
    throw new Error("Trade log entry not found");
  }
  const payload = tradeLogPayload(input, existing);
  db.prepare(
    `
    UPDATE market_trade_log
    SET item_id = ?, item_name = ?, quantity = ?, listed_price = ?, sold_price = ?, listed_at = ?,
        sold_at = ?, linked_hunt_id = ?, notes = ?, source = ?, updated_at = ?
    WHERE id = ?
    `
  ).run(
    payload.item_id,
    payload.item_name,
    payload.quantity,
    payload.listed_price,
    payload.sold_price,
    payload.listed_at,
    payload.sold_at,
    payload.linked_hunt_id,
    payload.notes,
    payload.source,
    nowIso(),
    Math.trunc(id)
  );
  return { ok: true, item: tradeLogToResponse(db, readTradeLogRow(db, id) as TradeLogRow) };
}

export function deleteMarketTradeLogEntry(db: Database.Database, id: number): { ok: true; deleted_id: number } {
  db.prepare("DELETE FROM market_trade_log WHERE id = ?").run(Math.trunc(id));
  return { ok: true, deleted_id: Math.trunc(id) };
}

function evaluateWatchRule(
  rule: WatchRuleRow,
  row: MarketRow | null,
  item: DashboardItem | null,
  runFreshness: Freshness
): (Record<string, unknown> & { triggered: boolean }) | null {
  if (!rule.enabled) {
    return null;
  }
  const price = item?.latest_price ?? -1;
  const threshold = rule.threshold_value;
  const age = Number(item?.freshness?.age_hours ?? runFreshness.age_hours ?? 0);
  let triggered = false;
  let currentValue: number | null = null;
  let detail = "";
  switch (rule.rule_type) {
    case "price_below":
      currentValue = price > 0 ? price : null;
      triggered = threshold !== null && currentValue !== null && currentValue <= threshold;
      detail = `Latest snapshot price ${currentValue ?? "n/a"} is at or below ${threshold ?? "n/a"}.`;
      break;
    case "price_above":
      currentValue = price > 0 ? price : null;
      triggered = threshold !== null && currentValue !== null && currentValue >= threshold;
      detail = `Latest snapshot price ${currentValue ?? "n/a"} is at or above ${threshold ?? "n/a"}.`;
      break;
    case "outside_historical_band":
      currentValue = price > 0 ? price : null;
      triggered = currentValue !== null && item !== null && (
        (item.low_band !== null && currentValue < item.low_band)
        || (item.high_band !== null && currentValue > item.high_band)
      );
      detail = `Latest snapshot price ${currentValue ?? "n/a"} is outside the historical band.`;
      break;
    case "low_volume":
      currentValue = row?.month_sold ?? null;
      triggered = currentValue !== null && currentValue >= 0 && currentValue <= (threshold ?? 5);
      detail = `Monthly sold count ${currentValue ?? "n/a"} is at or below ${threshold ?? 5}.`;
      break;
    case "stale_data":
      currentValue = Number.isFinite(age) ? Number(age.toFixed(1)) : null;
      triggered = !row || runFreshness.stale || (currentValue !== null && currentValue >= (threshold ?? STALE_HOURS));
      detail = `Snapshot age ${currentValue ?? "n/a"}h is at or above ${threshold ?? STALE_HOURS}h.`;
      break;
    case "significant_move":
      currentValue = row?.divergence_pct === null || row?.divergence_pct === undefined ? null : Number(row.divergence_pct);
      triggered = currentValue !== null && Math.abs(currentValue) >= (threshold ?? 20);
      detail = `Historical-band movement ${currentValue ?? "n/a"}% is at least ${threshold ?? 20}%.`;
      break;
  }
  if (!triggered) {
    return { triggered: false };
  }
  return {
    id: `${rule.id}:${rule.item_id}:${rule.rule_type}`,
    rule_id: rule.id,
    item_id: rule.item_id,
    name: item?.name ?? `Item ${rule.item_id}`,
    rule_type: rule.rule_type,
    label: RULE_LABELS[rule.rule_type],
    detail,
    note: rule.note,
    threshold_value: threshold,
    current_value: currentValue,
    item,
    triggered: true,
    explanation: explanation(RULE_LABELS[rule.rule_type].toLowerCase(), "warning", detail, {
      source_refs: [entityRef("item", { id: rule.item_id, name: item?.name ?? null })],
      provenance: [provenance("market_sync"), provenance("derived_calculation")]
    })
  };
}

function hotLootedItems(db: Database.Database, runId: number, runFreshness: Freshness, ids: Set<number>): DashboardItem[] {
  const rows = db
    .prepare("SELECT processed_json FROM hunt_uploads ORDER BY uploaded_at DESC LIMIT 100")
    .all() as Array<{ processed_json: string }>;
  const lootByName = new Map<string, { name: string; quantity: number }>();
  for (const row of rows) {
    try {
      const processed = JSON.parse(row.processed_json || "{}") as Record<string, unknown>;
      const parsed = typeof processed.parsed === "object" && processed.parsed !== null ? processed.parsed as Record<string, unknown> : {};
      const lootItems = Array.isArray(parsed.loot_items)
        ? parsed.loot_items
        : Array.isArray(processed.loot_items)
          ? processed.loot_items
          : [];
      for (const item of lootItems as Array<Record<string, unknown>>) {
        const name = String(item.name ?? "").trim();
        const normalized = String(item.normalized_name ?? name).trim().toLowerCase();
        const quantity = Number(item.quantity ?? 0);
        if (!normalized || !Number.isFinite(quantity) || quantity <= 0) {
          continue;
        }
        const existing = lootByName.get(normalized) ?? { name, quantity: 0 };
        existing.quantity += quantity;
        lootByName.set(normalized, existing);
      }
    } catch {
      // A malformed historical row should not block the dashboard.
    }
  }

  const ranked: DashboardItem[] = [];
  for (const loot of lootByName.values()) {
    const row = db
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
          mip.trend,
          mip.trend_score,
          mip.liquidity,
          mip.confidence,
          mip.historical_reference_price,
          mip.final_adjusted_price,
          mip.divergence_pct,
          mip.adjustment_reason,
          mip.source_run_count,
          mif.sell_offer,
          mif.buy_offer,
          mif.month_sold,
          mif.day_sold,
          mif.sell_offers,
          mif.active_traders,
          (
            SELECT COALESCE(MAX(snapshot_at), MAX(fetched_at))
            FROM item_market_history imh
            WHERE imh.item_id = mip.item_id
              AND imh.server = ?
          ) AS last_seen_at
        FROM market_item_prices mip
        LEFT JOIN item_metadata im ON im.item_id = mip.item_id
        LEFT JOIN market_item_features mif
          ON mif.run_id = mip.run_id
         AND mif.item_id = mip.item_id
        WHERE mip.run_id = ?
          AND mip.pricing_model = ?
          AND (LOWER(im.name) = LOWER(?) OR LOWER(im.wiki_name) = LOWER(?))
        LIMIT 1
        `
      )
      .get(config.serverName, runId, PRICING_MODEL, loot.name, loot.name) as MarketRow | undefined;
    if (!row) {
      continue;
    }
    const item = toDashboardItem(row, runFreshness, ids);
    item.looted_quantity = loot.quantity;
    item.looted_value = loot.quantity * Math.max(0, item.latest_price);
    const hotLootExplanation = explanation("high looted value", "positive", "This item appears often enough in saved hunts to matter for selling decisions.", {
      source_refs: [entityRef("item", { id: item.item_id, name: item.name })],
      provenance: [provenance("personal_hunt"), provenance("derived_calculation")]
    });
    item.reasons = uniqueExplanations([...item.reasons, hotLootExplanation]);
    item.reason_labels = Array.from(new Set([...item.reason_labels, hotLootExplanation.label]));
    ranked.push(item);
  }

  return ranked
    .filter((item) => Number(item.looted_value || 0) > 0)
    .sort((a, b) => Number(b.looted_value || 0) - Number(a.looted_value || 0))
    .slice(0, 10);
}

export function getMarketDashboardSummary(db: Database.Database): Record<string, unknown> {
  const run = latestRun(db);
  const freshness = freshnessFromRun(run);
  const warningExplanations: InsightExplanation[] = [];
  if (!run) {
    const watchRules = listMarketWatchRules(db);
    const tradeLog = listMarketTradeLog(db);
    warningExplanations.push(explanation("market sync missing", "blocked", "No local market sync is available yet.", {
      missing_data_reason: "Run market refresh before market decisions are available.",
      provenance: [provenance("market_sync")]
    }));
    return {
      ok: true,
      freshness,
      watchlist: [],
      watchRules: watchRules.rules,
      watchAlerts: watchRules.alerts,
      tradeLog: tradeLog.items,
      realizedProfit: tradeLog.summary,
      historicallyCheap: [],
      notableMovers: [],
      hotLootedItems: [],
      quietItems: [],
      warnings: warningExplanations.map((item) => item.reason),
      warning_explanations: warningExplanations
    };
  }

  const runFreshness = freshness as Freshness;
  if (runFreshness.stale) {
    warningExplanations.push(explanation("older snapshot", "warning", "Market data is older than the normal scan window. Treat it as price guidance, not a live listing.", {
      provenance: [provenance("market_sync")]
    }));
  }
  const ids = favoriteIds(db);
  const watchRules = listMarketWatchRules(db);
  const tradeLog = listMarketTradeLog(db);
  const historicallyCheap = marketRows(
    db,
    run.id,
    "AND mip.historical_reference_price IS NOT NULL AND mip.source_run_count >= 4 AND mip.client_value > 0 AND mip.client_value < mip.historical_reference_price",
    "ORDER BY COALESCE(mip.divergence_pct, -999) ASC, mip.confidence DESC",
    10
  ).map((row) => toDashboardItem(row, runFreshness, ids));
  const notableMovers = marketRows(
    db,
    run.id,
    "AND mip.historical_reference_price IS NOT NULL AND mip.source_run_count >= 4 AND ABS(COALESCE(mip.divergence_pct, 0)) >= 20",
    "ORDER BY ABS(COALESCE(mip.divergence_pct, 0)) DESC, mip.confidence DESC",
    10
  ).map((row) => toDashboardItem(row, runFreshness, ids));
  const quietItems = marketRows(
    db,
    run.id,
    "AND (COALESCE(mif.month_sold, -1) BETWEEN 0 AND 4 OR COALESCE(mif.sell_offers, -1) BETWEEN 0 AND 2 OR mip.confidence < 0.45)",
    "ORDER BY mip.confidence ASC, COALESCE(mif.month_sold, 999) ASC",
    10
  ).map((row) => toDashboardItem(row, runFreshness, ids));

  return {
    ok: true,
    freshness,
    watchlist: getMarketWatchlist(db).items,
    watchRules: watchRules.rules,
    watchAlerts: watchRules.alerts,
    tradeLog: tradeLog.items,
    realizedProfit: tradeLog.summary,
    historicallyCheap,
    notableMovers,
    hotLootedItems: hotLootedItems(db, run.id, runFreshness, ids),
    quietItems,
    warnings: warningExplanations.map((item) => item.reason),
    warning_explanations: warningExplanations
  };
}
