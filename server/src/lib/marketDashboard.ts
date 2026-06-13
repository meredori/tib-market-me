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
const STALE_HOURS = 36;
const AGING_HOURS = 12;

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
  note?: string;
  priority?: number;
  looted_quantity?: number;
  looted_value?: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function asPositive(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : -1;
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
    warnings.push(explanation("stale snapshot", "warning", "Market data is old enough to treat as trend evidence instead of a current listing.", {
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
    favorite: favoriteIds.has(row.item_id)
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
    warningExplanations.push(explanation("market sync missing", "blocked", "No local market sync is available yet.", {
      missing_data_reason: "Run market refresh before market decisions are available.",
      provenance: [provenance("market_sync")]
    }));
    return {
      ok: true,
      freshness,
      watchlist: [],
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
    warningExplanations.push(explanation("stale snapshot", "warning", "Market data is a stale snapshot. Treat prices as trend evidence, not live listings.", {
      provenance: [provenance("market_sync")]
    }));
  }
  const ids = favoriteIds(db);
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
    historicallyCheap,
    notableMovers,
    hotLootedItems: hotLootedItems(db, run.id, runFreshness, ids),
    quietItems,
    warnings: warningExplanations.map((item) => item.reason),
    warning_explanations: warningExplanations
  };
}
