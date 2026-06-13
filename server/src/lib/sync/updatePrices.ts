import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../../config";
import { confidence as buildConfidence, entityRef, explanation, freshness as buildFreshness, provenance } from "../intelligence/metadata";
import { applyHistoricalPricingAdjustment, computeSnapshotPricing } from "../pricing/snapshotPricing";
import { getHistoricalPricingContext, storeSyncSnapshotHistory, summarizeItemHistory } from "../pricing/itemHistory";
import { TibiaMarketClient, type ItemMetadata, type MarketRow, type WorldDataRow } from "../tibiamarket/client";
import {
  coerceOverrideMode,
  getEffectiveLootLogicPreview,
  type ItemValueOverrideMode,
  type LootLogicPreview
} from "./lootLogic";

export {
  buildLootLogicPreview,
  getEffectiveLootLogicPreview,
  type ItemValueOverrideMode,
  type LootLogicPreview
} from "./lootLogic";

type SyncResult = {
  ok: boolean;
  refreshed_at: string;
  world_last_update: string | null;
};

type RefreshPreflight = {
  should_refresh: boolean;
  message: string;
  remote_world_last_update: string | null;
};

type SyncLogger = {
  info(message: string): void;
  error?(dataOrMessage: unknown, message?: string): void;
};

type ItemPriceExportMode = "conservative_min" | "sell_offer";

type LatestStatus = {
  server: string;
  local_run: {
    started_at: string | null;
    finished_at: string | null;
  };
  world_data: {
    queried_at: string | null;
    server: string | null;
    last_update: string | null;
  };
  item_count: number;
  generated_at: string | null;
  files: {
    itemprices: string;
  };
};

type SearchStatements = {
  latestRun: Database.Statement<[], { id: number } | undefined>;
  search: Database.Statement<
    [number, string, string, string, string, number],
    Record<string, unknown>
  >;
};

const searchStatementsByDb = new WeakMap<Database.Database, SearchStatements>();
let marketSyncInProgress = false;

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function npcDisplayName(row: Record<string, unknown>): string {
  return asText(row.npc_name)
    || asText(row.name)
    || asText(row.npc)
    || asText(row.vendor_name)
    || asText(row.display_name);
}

function npcLocation(row: Record<string, unknown>): string {
  return asText(row.location)
    || asText(row.city)
    || asText(row.town)
    || asText(row.place);
}

function npcRowKey(row: Record<string, unknown>): string {
  return `${npcDisplayName(row).trim().toLowerCase()}|${npcLocation(row).trim().toLowerCase()}`;
}

function bestNpcBuyPrice(metaRow: ItemMetadata | undefined): number {
  const npcBuy = metaRow?.npc_buy;
  if (!Array.isArray(npcBuy)) {
    return 0;
  }
  let best = 0;
  for (const entry of npcBuy) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const price = (entry as Record<string, unknown>).price;
    if (typeof price === "number" && Number.isFinite(price) && price > best) {
      best = Math.trunc(price);
    }
  }
  return best;
}

function withNpcSaleFloor(value: number, npcBuy: number): number {
  return npcBuy > 0 ? Math.max(value, npcBuy) : value;
}

function normalizeNpcRows(value: unknown, preferHigherPrice: boolean): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  const rowsByKey = new Map<string, Record<string, unknown>>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    const normalized = {
      npc_name: npcDisplayName(row),
      location: npcLocation(row),
      price: asInt(row.price, 0),
      currency_object_type_id: asInt(row.currency_object_type_id, 0),
      currency_quest_flag_display_name: asText(row.currency_quest_flag_display_name)
    };
    if (!normalized.npc_name && !normalized.location && normalized.price <= 0) {
      continue;
    }
    const key = npcRowKey(normalized);
    const existing = rowsByKey.get(key);
    if (!existing) {
      rowsByKey.set(key, normalized);
      continue;
    }
    const existingPrice = asInt(existing.price, 0);
    if (preferHigherPrice ? normalized.price > existingPrice : normalized.price < existingPrice) {
      rowsByKey.set(key, normalized);
    }
  }
  return Array.from(rowsByKey.values())
    .sort((a, b) => {
      const priceDelta = preferHigherPrice
        ? asInt(b.price, 0) - asInt(a.price, 0)
        : asInt(a.price, 0) - asInt(b.price, 0);
      return priceDelta || npcDisplayName(a).localeCompare(npcDisplayName(b));
    });
}

function rawMetadataNpcRows(
  db: Database.Database,
  itemId: number,
  field: "npc_buy" | "npc_sell",
  preferHigherPrice: boolean
): Array<Record<string, unknown>> {
  const row = db
    .prepare("SELECT raw_payload_json FROM item_metadata WHERE item_id = ?")
    .get(itemId) as { raw_payload_json: string | null } | undefined;
  if (!row?.raw_payload_json) {
    return [];
  }
  try {
    const payload = JSON.parse(row.raw_payload_json) as Record<string, unknown>;
    return normalizeNpcRows(payload[field], preferHigherPrice);
  } catch {
    return [];
  }
}

function storedNpcRows(
  db: Database.Database,
  itemId: number,
  tableName: "item_npc_buy" | "item_npc_sell",
  preferHigherPrice: boolean
): Array<Record<string, unknown>> {
  const orderDirection = preferHigherPrice ? "DESC" : "ASC";
  return db
    .prepare(
      `
      SELECT npc_name, location, price, currency_object_type_id, currency_quest_flag_display_name
      FROM ${tableName}
      WHERE item_id = ?
      ORDER BY price ${orderDirection}, npc_name ASC
    `
    )
    .all(itemId) as Array<Record<string, unknown>>;
}

function itemNpcRows(
  db: Database.Database,
  itemId: number,
  tableName: "item_npc_buy" | "item_npc_sell",
  rawField: "npc_buy" | "npc_sell",
  preferHigherPrice: boolean
): Array<Record<string, unknown>> {
  const rawRows = rawMetadataNpcRows(db, itemId, rawField, preferHigherPrice);
  const storedRows = storedNpcRows(db, itemId, tableName, preferHigherPrice);
  if (!rawRows.length) {
    return storedRows;
  }
  if (!storedRows.length || storedRows.every((row) => !npcDisplayName(row))) {
    return rawRows;
  }
  const rawByLocationPrice = new Map(rawRows.map((row) => [
    `${npcLocation(row).toLowerCase()}|${asInt(row.price, 0)}`,
    row
  ]));
  return storedRows.map((row) => {
    if (npcDisplayName(row)) {
      return row;
    }
    const raw = rawByLocationPrice.get(`${npcLocation(row).toLowerCase()}|${asInt(row.price, 0)}`);
    return raw ? { ...row, npc_name: npcDisplayName(raw) } : row;
  });
}

function selectedWorld(worldRows: WorldDataRow[], serverName: string): WorldDataRow | undefined {
  const exact = worldRows.find((row) => asText(row.name).toLowerCase() === serverName.toLowerCase());
  if (exact) {
    return exact;
  }
  return worldRows[0];
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function setItemValueOverride(
  db: Database.Database,
  itemId: number,
  mode: ItemValueOverrideMode
): Record<string, unknown> {
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new Error("Invalid item id");
  }

  const normalizedMode = coerceOverrideMode(mode);
  const normalizedItemId = Math.trunc(itemId);

  if (normalizedMode === "auto") {
    db.prepare("DELETE FROM item_value_overrides WHERE item_id = ?").run(normalizedItemId);
  } else {
    db.prepare(
      `
      INSERT INTO item_value_overrides (item_id, override_mode, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        override_mode = excluded.override_mode,
        updated_at = excluded.updated_at
    `
    ).run(normalizedItemId, normalizedMode, nowIso());
  }

  return {
    item_id: normalizedItemId,
    override_mode: normalizedMode
  };
}

export async function runMarketSync(db: Database.Database, logger: SyncLogger = console): Promise<SyncResult> {
  if (marketSyncInProgress) {
    throw new Error("Market sync is already running.");
  }
  marketSyncInProgress = true;

  const client = new TibiaMarketClient();
  const runStartedAt = nowIso();
  let runId: number | null = null;

  logger.info(`[sync] starting market sync for ${config.serverName}`);

  const insertRun = db.prepare(`
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, page_limit, page_pause_sec,
      market_row_count, priced_item_count, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runInsertInfo = insertRun.run(
    config.serverName,
    runStartedAt,
    runStartedAt,
    runStartedAt,
    null,
    runStartedAt,
    config.pricingModelVersion,
    config.salesTaxPct,
    config.pageLimit,
    config.pagePauseMs / 1000,
    0,
    0,
    "running"
  );

  runId = Number(runInsertInfo.lastInsertRowid);

  try {

  logger.info(`[sync] fetching market values, item metadata, and world data`);
  const [marketRows, metadataRows, worldRows] = await Promise.all([
    client.getAllMarketValues(config.serverName),
    client.getItemMetadata(),
    client.getWorldData(config.serverName)
  ]);

  logger.info(
    `[sync] fetched ${marketRows.length} market rows, ${metadataRows.length} metadata rows, ${worldRows.length} world rows`
  );
  storeSyncSnapshotHistory(db, marketRows);

  const metadataById = new Map<number, ItemMetadata>();
  for (const row of metadataRows) {
    const itemId = typeof row.id === "number" ? row.id : null;
    if (itemId !== null) {
      metadataById.set(itemId, row);
    }
  }

  const metadataUpsert = db.prepare(`
    INSERT INTO item_metadata (
      item_id, name, wiki_name, category, tier, raw_payload_json, payload_hash, fetched_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      name = excluded.name,
      wiki_name = excluded.wiki_name,
      category = excluded.category,
      tier = excluded.tier,
      raw_payload_json = excluded.raw_payload_json,
      payload_hash = excluded.payload_hash,
      fetched_at = excluded.fetched_at,
      updated_at = excluded.updated_at
  `);
  const deleteNpcBuy = db.prepare("DELETE FROM item_npc_buy WHERE item_id = ?");
  const deleteNpcSell = db.prepare("DELETE FROM item_npc_sell WHERE item_id = ?");
  const insertNpcBuy = db.prepare(`
    INSERT INTO item_npc_buy (
      item_id, npc_name, location, price, currency_object_type_id, currency_quest_flag_display_name, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNpcSell = db.prepare(`
    INSERT INTO item_npc_sell (
      item_id, npc_name, location, price, currency_object_type_id, currency_quest_flag_display_name, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const storeMetadata = db.transaction(() => {
    const fetchedAt = nowIso();
    let metadataCount = 0;
    for (const meta of metadataRows) {
      if (typeof meta !== "object" || meta === null || typeof meta.id !== "number") {
        continue;
      }
      const rawJson = JSON.stringify(meta);
      metadataUpsert.run(
        meta.id,
        asText(meta.name) || null,
        asText(meta.wiki_name) || null,
        asText(meta.category) || null,
        asInt(meta.tier, -1),
        rawJson,
        sha256(rawJson),
        fetchedAt,
        fetchedAt
      );

      deleteNpcBuy.run(meta.id);
      deleteNpcSell.run(meta.id);

      const npcBuyByKey = new Map<string, Record<string, unknown>>();
      const npcSellByKey = new Map<string, Record<string, unknown>>();

      if (Array.isArray(meta.npc_buy)) {
        for (const npc of meta.npc_buy) {
          if (typeof npc !== "object" || npc === null) {
            continue;
          }
          const row = npc as Record<string, unknown>;
          const key = npcRowKey(row);
          const existing = npcBuyByKey.get(key);
          if (!existing || asInt(row.price, 0) > asInt(existing.price, 0)) {
            npcBuyByKey.set(key, row);
          }
        }
      }

      if (Array.isArray(meta.npc_sell)) {
        for (const npc of meta.npc_sell) {
          if (typeof npc !== "object" || npc === null) {
            continue;
          }
          const row = npc as Record<string, unknown>;
          const key = npcRowKey(row);
          const existing = npcSellByKey.get(key);
          if (!existing || asInt(row.price, 0) > asInt(existing.price, 0)) {
            npcSellByKey.set(key, row);
          }
        }
      }

      for (const row of npcBuyByKey.values()) {
        insertNpcBuy.run(
          meta.id,
          npcDisplayName(row),
          npcLocation(row),
          asInt(row.price, 0),
          asInt(row.currency_object_type_id, 0),
          asText(row.currency_quest_flag_display_name),
          fetchedAt
        );
      }

      for (const row of npcSellByKey.values()) {
        insertNpcSell.run(
          meta.id,
          npcDisplayName(row),
          npcLocation(row),
          asInt(row.price, 0),
          asInt(row.currency_object_type_id, 0),
          asText(row.currency_quest_flag_display_name),
          fetchedAt
        );
      }

      metadataCount += 1;
    }

    logger.info(`[sync] stored metadata for ${metadataCount} items`);
  });
  storeMetadata();

  const worldFetchedAt = nowIso();
  const worldRow = selectedWorld(worldRows, config.serverName);
  if (worldRow) {
    logger.info(`[sync] storing world freshness snapshot for ${asText(worldRow.name) || config.serverName}`);
    db.prepare(
      "INSERT INTO world_data_snapshots(server, last_update, fetched_at) VALUES (?, ?, ?)"
    ).run(asText(worldRow.name) || config.serverName, asText(worldRow.last_update), worldFetchedAt);
  }

  const insertRaw = db.prepare(`
    INSERT INTO market_item_raw (
      run_id, item_id, payload_json, payload_hash, upstream_time, is_full_data
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertFeatures = db.prepare(`
    INSERT INTO market_item_features (
      run_id, item_id, upstream_time, is_full_data,
      buy_offer, sell_offer,
      month_average_sell, month_average_buy, month_sold, month_bought, active_traders,
      month_highest_sell, month_lowest_buy, month_lowest_sell, month_highest_buy,
      buy_offers, sell_offers,
      day_average_sell, day_average_buy, day_sold, day_bought,
      day_highest_sell, day_lowest_sell, day_highest_buy, day_lowest_buy,
      total_immediate_profit, total_immediate_profit_info
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPrice = db.prepare(`
    INSERT INTO market_item_prices (
      run_id, item_id, pricing_model, pricing_model_version,
      fair_price, suggested_list_price, client_value,
      trend, trend_score, liquidity, confidence,
      historical_reference_price, final_adjusted_price, divergence_pct, adjustment_reason, source_run_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pricedItemIds = new Set<number>();

  const storeMarketRows = db.transaction(() => {
    let processedCount = 0;
    let pricedCount = 0;
    for (const row of marketRows) {
      if (typeof row !== "object" || row === null || typeof row.id !== "number") {
        continue;
      }
      const itemId = row.id;
      const meta = metadataById.get(itemId);
      const snapshotPricing = computeSnapshotPricing(row);
      const historicalAdjustment = applyHistoricalPricingAdjustment(
        snapshotPricing,
        row,
        getHistoricalPricingContext(db, itemId)
      );
      const adjustedSuggestedListPrice = historicalAdjustment.final_adjusted_price && historicalAdjustment.final_adjusted_price > 0
        ? historicalAdjustment.final_adjusted_price
        : snapshotPricing.suggested_list_price;
      const adjustedFairPrice = historicalAdjustment.final_adjusted_price && historicalAdjustment.final_adjusted_price > 0
        ? Math.min(snapshotPricing.fair_price > 0 ? snapshotPricing.fair_price : historicalAdjustment.final_adjusted_price, historicalAdjustment.final_adjusted_price)
        : snapshotPricing.fair_price;
      const pricing = {
        ...snapshotPricing,
        fair_price: adjustedFairPrice,
        suggested_list_price: adjustedSuggestedListPrice
      };
      const npcBuy = bestNpcBuyPrice(meta);
      const expectedNet = Math.round(
        Math.max(pricing.suggested_list_price, pricing.fair_price, 0) * (1 - config.salesTaxPct / 100)
      );
      const clientValue = Math.max(expectedNet, npcBuy);

      if (clientValue > 0) {
        pricedItemIds.add(itemId);
        pricedCount += 1;
      }

      const rawJson = JSON.stringify(row);
      const upstreamTime = asInt(row.time, 0);
      const isFullData = row.is_full_data ? 1 : 0;

      insertRaw.run(runId, itemId, rawJson, sha256(rawJson), upstreamTime, isFullData);
      insertFeatures.run(
        runId,
        itemId,
        upstreamTime,
        isFullData,
        asInt(row.buy_offer, -1),
        asInt(row.sell_offer, -1),
        asInt(row.month_average_sell, -1),
        asInt(row.month_average_buy, -1),
        asInt(row.month_sold, -1),
        asInt(row.month_bought, -1),
        asInt(row.active_traders, -1),
        asInt(row.month_highest_sell, -1),
        asInt(row.month_lowest_buy, -1),
        asInt(row.month_lowest_sell, -1),
        asInt(row.month_highest_buy, -1),
        asInt(row.buy_offers, -1),
        asInt(row.sell_offers, -1),
        asInt(row.day_average_sell, -1),
        asInt(row.day_average_buy, -1),
        asInt(row.day_sold, -1),
        asInt(row.day_bought, -1),
        asInt(row.day_highest_sell, -1),
        asInt(row.day_lowest_sell, -1),
        asInt(row.day_highest_buy, -1),
        asInt(row.day_lowest_buy, -1),
        asInt(row.total_immediate_profit, -1),
        asText(row.total_immediate_profit_info)
      );

      insertPrice.run(
        runId,
        itemId,
        config.pricingModel,
        config.pricingModelVersion,
        pricing.fair_price,
        pricing.suggested_list_price,
        clientValue,
        pricing.trend,
        pricing.trend_score,
        pricing.liquidity,
        pricing.confidence,
        historicalAdjustment.historical_reference_price,
        historicalAdjustment.final_adjusted_price,
        historicalAdjustment.divergence_pct,
        historicalAdjustment.adjustment_reason,
        historicalAdjustment.source_run_count
      );

      processedCount += 1;
      if (processedCount % 250 === 0) {
        logger.info(`[sync] processed ${processedCount}/${marketRows.length} market items (${pricedCount} priced)`);
      }
    }

    logger.info(`[sync] processed ${processedCount} market items total (${pricedCount} priced)`);
  });

  storeMarketRows();

  const runFinishedAt = nowIso();
  const worldLastUpdate = asText(worldRow?.last_update) || null;
  db.prepare(`
    UPDATE market_runs
    SET
      finished_at = ?,
      pulled_at = ?,
      world_last_update = ?,
      world_queried_at = ?,
      market_row_count = ?,
      priced_item_count = ?,
      status = ?,
      error_message = NULL
    WHERE id = ?
  `).run(
    runFinishedAt,
    runFinishedAt,
    worldLastUpdate,
    worldFetchedAt,
    marketRows.length,
    pricedItemIds.size,
    "success",
    runId
  );

  logger.info(`[sync] stored market sync results`);

  return {
    ok: true,
    refreshed_at: runFinishedAt,
    world_last_update: worldLastUpdate
  };
  } catch (error) {
    if (runId !== null) {
      db.prepare(`
        UPDATE market_runs
        SET finished_at = ?, status = ?, error_message = ?
        WHERE id = ?
      `).run(nowIso(), "failed", String(error), runId);
    }
    throw error;
  } finally {
    marketSyncInProgress = false;
  }
}

export function getStatus(db: Database.Database): LatestStatus {
  const run = db
    .prepare(
      `
      SELECT id, server, started_at, finished_at, world_last_update, world_queried_at, priced_item_count
      FROM market_runs
      WHERE status = 'success'
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get() as
    | {
        id: number;
        server: string;
        started_at: string;
        finished_at: string;
        world_last_update: string | null;
        world_queried_at: string | null;
        priced_item_count: number;
      }
    | undefined;

  return {
    server: run?.server ?? config.serverName,
    local_run: {
      started_at: run?.started_at ?? null,
      finished_at: run?.finished_at ?? null
    },
    world_data: {
      queried_at: run?.world_queried_at ?? null,
      server: run?.server ?? null,
      last_update: run?.world_last_update ?? null
    },
    item_count: run?.priced_item_count ?? 0,
    generated_at: run?.finished_at ?? null,
    files: {
      itemprices: config.outputItemPricesPath
    }
  };
}

export function searchLatestItems(db: Database.Database, query: string, limit = 80): Array<Record<string, unknown>> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  let statements = searchStatementsByDb.get(db);
  if (!statements) {
    statements = {
      latestRun: db.prepare("SELECT id FROM market_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1") as Database.Statement<
        [],
        { id: number } | undefined
      >,
      search: db.prepare(
        `
        WITH matched AS (
          SELECT
            mip.item_id AS id,
            '/items/' || mip.item_id || '.png' AS image_path,
            im.name AS name,
            im.wiki_name AS wiki_name,
            mip.client_value AS client_value,
            mip.fair_price AS fair_price,
            mip.suggested_list_price AS suggested_list_price,
            mip.trend AS trend,
            mip.liquidity AS liquidity,
            mip.confidence AS confidence,
            mif.month_sold AS month_sold,
            mif.day_sold AS day_sold,
            mif.sell_offer AS sell_offer
          FROM market_item_prices mip
          LEFT JOIN item_metadata im ON im.item_id = mip.item_id
          LEFT JOIN market_item_features mif
            ON mif.run_id = mip.run_id
           AND mif.item_id = mip.item_id
          WHERE mip.run_id = ?
            AND mip.pricing_model = ?
            AND (
              COALESCE(im.name, '') LIKE ? COLLATE NOCASE
              OR COALESCE(im.wiki_name, '') LIKE ? COLLATE NOCASE
              OR CAST(mip.item_id AS TEXT) LIKE ?
            )
          ORDER BY mip.client_value DESC
          LIMIT ?
        ),
        npc_buy AS (
          SELECT nb.item_id, MAX(nb.price) AS npc_buy
          FROM item_npc_buy nb
          INNER JOIN matched m ON m.id = nb.item_id
          GROUP BY nb.item_id
        ),
        npc_sell AS (
          SELECT ns.item_id, MIN(ns.price) AS npc_sell
          FROM item_npc_sell ns
          INNER JOIN matched m ON m.id = ns.item_id
          GROUP BY ns.item_id
        )
        SELECT
          m.id,
          m.image_path,
          m.name,
          m.wiki_name,
          COALESCE(nb.npc_buy, 0) AS npc_buy,
          COALESCE(ns.npc_sell, 0) AS npc_sell,
          m.client_value,
          m.fair_price,
          m.suggested_list_price,
          m.trend,
          m.liquidity,
          m.confidence,
          m.month_sold,
          m.day_sold,
          m.sell_offer,
          COALESCE(ivo.override_mode, 'auto') AS override_mode
        FROM matched m
        LEFT JOIN npc_buy nb ON nb.item_id = m.id
        LEFT JOIN npc_sell ns ON ns.item_id = m.id
        LEFT JOIN item_value_overrides ivo ON ivo.item_id = m.id
        ORDER BY m.client_value DESC
      `
      ) as Database.Statement<[number, string, string, string, string, number], Record<string, unknown>>
    };
    searchStatementsByDb.set(db, statements);
  }

  const latestRun = statements.latestRun.get();
  if (!latestRun) {
    return [];
  }

  const likePattern = `%${trimmed}%`;
  const rows = statements.search.all(
    latestRun.id,
    config.pricingModel,
    likePattern,
    likePattern,
    likePattern,
    limit
  ) as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const lootLogic = getEffectiveLootLogicPreview(row);
    return {
      ...row,
      trend: lootLogic.trend_display,
      loot_logic: lootLogic
    };
  });
}

export function generateItemPricesFile(
  db: Database.Database,
  mode: ItemPriceExportMode = "conservative_min"
): Record<string, unknown> {
  const latestRun = db.prepare("SELECT id FROM market_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;

  if (!latestRun) {
    return {
      ok: false,
      error: "No market run available. Run a sync first."
    };
  }

  const rows = db
    .prepare(
      `
      SELECT
        mip.item_id AS id,
        mip.client_value AS client_value,
        mip.fair_price AS fair_price,
        mip.suggested_list_price AS suggested_list_price,
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
      LEFT JOIN market_item_features mif
        ON mif.run_id = mip.run_id
       AND mif.item_id = mip.item_id
      LEFT JOIN item_value_overrides ivo
        ON ivo.item_id = mip.item_id
      WHERE mip.run_id = ?
        AND mip.pricing_model = ?
      ORDER BY mip.item_id ASC
    `
    )
    .all(latestRun.id, config.pricingModel) as Array<Record<string, unknown>>;

  const itemPrices: Record<string, number> = {};
  for (const row of rows) {
    const id = asInt(row.id, -1);
    if (id <= 0) {
      continue;
    }

    const lootLogic = getEffectiveLootLogicPreview(row);
    const clientValue = asInt(row.client_value, -1);

    const selectedValue = lootLogic.strategy === "ignore"
      ? Math.max(0, asInt(config.ignoredItemExportValue, 1))
      : mode === "sell_offer"
        ? (lootLogic.fair_sale_price > 0 ? lootLogic.fair_sale_price : clientValue)
        : (lootLogic.min_list_price > 0 ? lootLogic.min_list_price : (lootLogic.fair_sale_price > 0 ? lootLogic.fair_sale_price : clientValue));
    const exportValue = lootLogic.strategy === "ignore"
      ? selectedValue
      : withNpcSaleFloor(selectedValue, asInt(row.npc_buy, 0));

    if (exportValue > 0) {
      itemPrices[String(id)] = exportValue;
    }
  }

  const sortedEntries = Object.entries(itemPrices).sort((a, b) => Number(a[0]) - Number(b[0]));
  const payload = {
    customSalePrices: Object.fromEntries(sortedEntries),
    primaryLootValueSources: {}
  };
  fs.writeFileSync(config.outputItemPricesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");

  return {
    ok: true,
    path: config.outputItemPricesPath,
    mode,
    item_count: sortedEntries.length,
    generated_at: nowIso()
  };
}

export async function preflightRefresh(db: Database.Database, _logger: SyncLogger = console): Promise<RefreshPreflight> {
  const status = getStatus(db);
  const currentLastUpdate = status.world_data.last_update;

  const client = new TibiaMarketClient();
  const worldRows = await client.getWorldData(config.serverName);
  const remoteWorld = selectedWorld(worldRows, config.serverName);
  const remoteLastUpdate = asText(remoteWorld?.last_update) || null;

  if (!remoteLastUpdate) {
    return {
      should_refresh: true,
      message: "Refresh run because remote world last_update was unavailable.",
      remote_world_last_update: null
    };
  }

  if (!currentLastUpdate) {
    return {
      should_refresh: true,
      message: "Refresh run because no previous world last_update exists locally.",
      remote_world_last_update: remoteLastUpdate
    };
  }

  const remoteTs = parseTimestamp(remoteLastUpdate);
  const currentTs = parseTimestamp(currentLastUpdate);

  const isNewer =
    remoteTs !== null && currentTs !== null
      ? remoteTs > currentTs
      : remoteLastUpdate > currentLastUpdate;

  if (!isNewer) {
    return {
      should_refresh: false,
      message: "Refresh not run as no new data to fetch",
      remote_world_last_update: remoteLastUpdate
    };
  }

  return {
    should_refresh: true,
    message: "Refresh run because remote world last_update is newer.",
    remote_world_last_update: remoteLastUpdate
  };
}

export function getItemDetails(db: Database.Database, itemId: number): Record<string, unknown> | null {
  const latestRun = db.prepare("SELECT id FROM market_runs WHERE status = 'success' ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (!latestRun) {
    return null;
  }

  const detail = db
    .prepare(
      `
      SELECT
        mip.item_id AS id,
        '/items/' || mip.item_id || '.png' AS image_path,
        im.name AS name,
        im.wiki_name AS wiki_name,
        im.category AS category,
        im.tier AS tier,
        mip.client_value AS client_value,
        mip.fair_price AS fair_price,
        mip.suggested_list_price AS suggested_list_price,
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
        mip.trend AS trend,
        mip.trend_score AS trend_score,
        mip.liquidity AS liquidity,
        mip.confidence AS confidence,
        mip.historical_reference_price AS historical_reference_price,
        mip.final_adjusted_price AS final_adjusted_price,
        mip.divergence_pct AS divergence_pct,
        mip.adjustment_reason AS adjustment_reason,
        mip.source_run_count AS source_run_count,
        mif.month_sold AS month_sold,
        mif.day_sold AS day_sold,
        mif.month_average_sell AS month_average_sell,
        mif.month_highest_sell AS month_highest_sell,
        mif.month_lowest_sell AS month_lowest_sell,
        mif.day_average_sell AS day_average_sell,
        mif.sell_offer AS sell_offer,
        mif.buy_offer AS buy_offer,
        COALESCE(ivo.override_mode, 'auto') AS override_mode,
        mr.finished_at AS run_finished_at,
        mr.world_last_update AS world_last_update
      FROM market_item_prices mip
      LEFT JOIN item_metadata im
        ON im.item_id = mip.item_id
      LEFT JOIN market_item_features mif
        ON mif.run_id = mip.run_id
       AND mif.item_id = mip.item_id
      LEFT JOIN market_runs mr
        ON mr.id = mip.run_id
      LEFT JOIN item_value_overrides ivo
        ON ivo.item_id = mip.item_id
      WHERE mip.run_id = ?
        AND mip.pricing_model = ?
        AND mip.item_id = ?
      LIMIT 1
    `
    )
    .get(latestRun.id, config.pricingModel, itemId) as Record<string, unknown> | undefined;

  if (!detail) {
    return null;
  }

  const npcBuyRows = itemNpcRows(db, itemId, "item_npc_buy", "npc_buy", true);
  const npcSellRows = itemNpcRows(db, itemId, "item_npc_sell", "npc_sell", false);

  const lootLogic = getEffectiveLootLogicPreview(detail);
  const itemEntity = entityRef("item", {
    id: asInt(detail.id, itemId),
    name: asText(detail.name) || asText(detail.wiki_name) || `Item ${itemId}`
  });
  const marketProvenance = provenance("market_sync", {
    source_ref: entityRef("market_observation", { id: latestRun.id, name: config.serverName }),
    observed_at: asText(detail.run_finished_at) || null
  });
  const overrideMode = asText(detail.override_mode) || "auto";
  const itemFreshness = buildFreshness(asText(detail.run_finished_at) || null, {
    staleAfterHours: 36,
    agingAfterHours: 12,
    lastVerified: asText(detail.world_last_update) || null
  });
  const itemConfidence = buildConfidence(Number(detail.confidence), {
    estimated: true,
    missingDataReason: Number(detail.confidence) < 0.45 ? "Market activity or historical evidence is thin." : null
  });
  const reasons = [
    explanation(lootLogic.strategy.replace(/_/g, " "), "neutral", lootLogic.reason, {
      source_refs: [itemEntity],
      provenance: [
        marketProvenance,
        provenance("derived_calculation", { source_ref: itemEntity })
      ]
    })
  ];
  const warnings = [];
  if (itemFreshness.stale) {
    warnings.push(explanation("stale snapshot", "warning", "Item pricing comes from an old local market snapshot.", {
      source_refs: [itemEntity],
      provenance: [marketProvenance]
    }));
  }
  if (itemConfidence.level === "low" || itemConfidence.level === "unknown") {
    warnings.push(explanation(itemConfidence.label, "warning", "Item pricing confidence is limited.", {
      source_refs: [itemEntity],
      provenance: [marketProvenance],
      missing_data_reason: itemConfidence.missing_data_reason
    }));
  }
  if (overrideMode !== "auto") {
    reasons.push(explanation("manual override", "neutral", `Manual override is set to ${overrideMode}.`, {
      source_refs: [itemEntity],
      provenance: [provenance("manual_override", { source_ref: itemEntity, manual: true })]
    }));
  }
  const normalizedNames = [
    asText(detail.name).toLowerCase().trim(),
    asText(detail.wiki_name).toLowerCase().trim()
  ].filter(Boolean);
  const itemDetail = normalizedNames.length
    ? db
      .prepare(
        `
        SELECT
          normalized_name,
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
          last_fetched_at
        FROM item_detail_cache
        WHERE normalized_name IN (${normalizedNames.map(() => "?").join(", ")})
        ORDER BY last_fetched_at DESC
        LIMIT 1
      `
      )
      .get(...normalizedNames) as Record<string, unknown> | undefined
    : undefined;

  return {
    ...detail,
    trend: lootLogic.trend_display,
    loot_logic: lootLogic,
    confidence_detail: itemConfidence,
    freshness: itemFreshness,
    provenance: [
      marketProvenance,
      provenance("derived_calculation", { source_ref: itemEntity }),
      ...(overrideMode === "auto" ? [] : [provenance("manual_override", { source_ref: itemEntity, manual: true })])
    ],
    reasons,
    warnings,
    history: summarizeItemHistory(db, itemId),
    item_detail: itemDetail ?? null,
    npc_buy_rows: npcBuyRows,
    npc_sell_rows: npcSellRows
  };
}
