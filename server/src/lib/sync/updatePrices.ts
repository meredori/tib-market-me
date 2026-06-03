import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { config } from "../../config";
import { computeSnapshotPricing } from "../pricing/snapshotPricing";
import { TibiaMarketClient, type ItemMetadata, type MarketRow, type WorldDataRow } from "../tibiamarket/client";

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

type LootLogicPreview = {
  strategy: "market" | "npc_sell" | "npc_buy" | "ignore";
  trend_display: string;
  reason: string;
  market_allowed: boolean;
  list_price: number;
  min_list_price: number;
  price: number;
  min_price: number;
  market_sell_offer: number;
  undercut_price: number;
};

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
    prices: string;
    detail: string;
    meta: string;
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

function npcRowKey(row: Record<string, unknown>): string {
  return `${asText(row.npc_name).trim().toLowerCase()}|${asText(row.location).trim().toLowerCase()}`;
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

function buildLootLogicPreview(row: Record<string, unknown>): LootLogicPreview {
  const listPrice = asInt(row.suggested_list_price, -1);
  const marketSellOffer = asInt(row.sell_offer, -1);
  const trend = asText(row.trend) || "unknown";
  const liquidity = typeof row.liquidity === "number" ? row.liquidity : 0;
  const confidence = typeof row.confidence === "number" ? row.confidence : 0;
  const monthSold = asInt(row.month_sold, -1);
  const daySold = asInt(row.day_sold, -1);
  const npcBuy = asInt(row.npc_buy, 0);
  const npcSell = asInt(row.npc_sell, 0);

  const veryLowVolume = monthSold >= 0 && monthSold < 6;
  const staleAndThin = daySold === 0 && monthSold >= 0 && monthSold < 25 && liquidity < 0.2;
  const lowMarketQuality = liquidity < 0.1 || confidence < 0.6 || veryLowVolume || staleAndThin;
  const marketAllowed = listPrice > 0 && !lowMarketQuality;

  if (!marketAllowed) {
    if (npcSell > 0) {
      return {
        strategy: "npc_sell",
        trend_display: "n/a",
        reason: "Market ignored due to low volume/quality; using NPC sell reference.",
        market_allowed: false,
        list_price: listPrice,
        min_list_price: listPrice,
        price: npcSell,
        min_price: -1,
        market_sell_offer: marketSellOffer,
        undercut_price: -1
      };
    }

    if (npcBuy > 0) {
      return {
        strategy: "npc_buy",
        trend_display: "n/a",
        reason: "Market ignored due to low volume/quality; using NPC buy fallback.",
        market_allowed: false,
        list_price: listPrice,
        min_list_price: listPrice,
        price: npcBuy,
        min_price: -1,
        market_sell_offer: marketSellOffer,
        undercut_price: -1
      };
    }

    return {
      strategy: "ignore",
      trend_display: "n/a",
      reason: "Market ignored due to low volume/quality and no NPC fallback price.",
      market_allowed: false,
      list_price: listPrice,
      min_list_price: listPrice,
      price: -1,
      min_price: -1,
      market_sell_offer: marketSellOffer,
      undercut_price: -1
    };
  }

  const minListPrice = Math.max(1, Math.floor(listPrice * 0.9));

  let undercutPrice = listPrice;
  if (marketSellOffer > 0) {
    if (marketSellOffer >= listPrice) {
      undercutPrice = listPrice;
    } else if (marketSellOffer > minListPrice) {
      undercutPrice = marketSellOffer - 1;
    } else {
      undercutPrice = minListPrice;
    }
  }

  return {
    strategy: "market",
    trend_display: trend,
    reason: "Market has sufficient volume/quality; list at list price, undercut down to min price, then hold at min.",
    market_allowed: true,
    list_price: listPrice,
    min_list_price: minListPrice,
    price: listPrice,
    min_price: minListPrice,
    market_sell_offer: marketSellOffer,
    undercut_price: undercutPrice
  };
}

function exportJsonFiles(payload: {
  flatPrices: Record<string, number>;
  detailedRows: Array<Record<string, unknown>>;
  runStartedAt: string;
  runFinishedAt: string;
  worldRow: WorldDataRow | undefined;
  marketRowsCount: number;
}): void {
  ensureParentDir(config.outputFlatPath);
  ensureParentDir(config.outputDetailPath);
  ensureParentDir(config.outputMetaPath);

  const sortedFlatEntries = Object.entries(payload.flatPrices).sort((a, b) => Number(a[0]) - Number(b[0]));
  const sortedFlat = Object.fromEntries(sortedFlatEntries);

  fs.writeFileSync(config.outputFlatPath, `${JSON.stringify(sortedFlat, null, 2)}\n`, "utf-8");

  const detailPayload = {
    generated_at: payload.runFinishedAt,
    server: config.serverName,
    pricing_model: config.pricingModelVersion,
    sales_tax_pct: config.salesTaxPct,
    item_count: payload.detailedRows.length,
    items: payload.detailedRows
  };
  fs.writeFileSync(config.outputDetailPath, `${JSON.stringify(detailPayload, null, 2)}\n`, "utf-8");

  const metaPayload = {
    server: config.serverName,
    local_run: {
      started_at: payload.runStartedAt,
      finished_at: payload.runFinishedAt
    },
    world_data: {
      queried_at: payload.runFinishedAt,
      server: asText(payload.worldRow?.name) || config.serverName,
      last_update: asText(payload.worldRow?.last_update) || null
    },
    outputs: {
      flat_prices: config.outputFlatPath,
      detailed_prices: config.outputDetailPath
    },
    counts: {
      market_rows: payload.marketRowsCount,
      priced_items: Object.keys(sortedFlat).length
    }
  };
  fs.writeFileSync(config.outputMetaPath, `${JSON.stringify(metaPayload, null, 2)}\n`, "utf-8");
}

export async function runMarketSync(db: Database.Database): Promise<SyncResult> {
  const client = new TibiaMarketClient();
  const runStartedAt = nowIso();

  console.log(`[sync] starting market sync for ${config.serverName}`);

  const insertRun = db.prepare(`
    INSERT INTO market_runs (
      server, started_at, finished_at, pulled_at, world_last_update, world_queried_at,
      pricing_model_version, sales_tax_pct, page_limit, page_pause_sec,
      market_row_count, priced_item_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    0
  );

  const runId = Number(runInsertInfo.lastInsertRowid);

  console.log(`[sync] fetching market values, item metadata, and world data`);
  const [marketRows, metadataRows, worldRows] = await Promise.all([
    client.getAllMarketValues(config.serverName),
    client.getItemMetadata(),
    client.getWorldData(config.serverName)
  ]);

  console.log(
    `[sync] fetched ${marketRows.length} market rows, ${metadataRows.length} metadata rows, ${worldRows.length} world rows`
  );

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
          asText(row.npc_name),
          asText(row.location),
          asInt(row.price, 0),
          asInt(row.currency_object_type_id, 0),
          asText(row.currency_quest_flag_display_name),
          fetchedAt
        );
      }

      for (const row of npcSellByKey.values()) {
        insertNpcSell.run(
          meta.id,
          asText(row.npc_name),
          asText(row.location),
          asInt(row.price, 0),
          asInt(row.currency_object_type_id, 0),
          asText(row.currency_quest_flag_display_name),
          fetchedAt
        );
      }

      metadataCount += 1;
    }

    console.log(`[sync] stored metadata for ${metadataCount} items`);
  });
  storeMetadata();

  const worldFetchedAt = nowIso();
  const worldRow = selectedWorld(worldRows, config.serverName);
  if (worldRow) {
    console.log(`[sync] storing world freshness snapshot for ${asText(worldRow.name) || config.serverName}`);
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
      trend, trend_score, liquidity, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const flatPrices: Record<string, number> = {};
  const detailedRows: Array<Record<string, unknown>> = [];

  const storeMarketRows = db.transaction(() => {
    let processedCount = 0;
    let pricedCount = 0;
    for (const row of marketRows) {
      if (typeof row !== "object" || row === null || typeof row.id !== "number") {
        continue;
      }
      const itemId = row.id;
      const meta = metadataById.get(itemId);
      const pricing = computeSnapshotPricing(row);
      const npcBuy = bestNpcBuyPrice(meta);
      const expectedNet = Math.round(
        Math.max(pricing.suggested_list_price, pricing.fair_price, 0) * (1 - config.salesTaxPct / 100)
      );
      const clientValue = Math.max(expectedNet, npcBuy);

      if (clientValue > 0) {
        flatPrices[String(itemId)] = clientValue;
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
        pricing.confidence
      );

      detailedRows.push({
        id: itemId,
        name: asText(meta?.name) || null,
        wiki_name: asText(meta?.wiki_name) || null,
        npc_buy: npcBuy,
        pricing,
        market_snapshot: {
          month_sold: asInt(row.month_sold, -1),
          day_sold: asInt(row.day_sold, -1),
          month_average_sell: asInt(row.month_average_sell, -1),
          day_average_sell: asInt(row.day_average_sell, -1),
          sell_offer: asInt(row.sell_offer, -1),
          buy_offer: asInt(row.buy_offer, -1)
        },
        client_value: clientValue
      });

      processedCount += 1;
      if (processedCount % 250 === 0) {
        console.log(`[sync] processed ${processedCount}/${marketRows.length} market items (${pricedCount} priced)`);
      }
    }

    console.log(`[sync] processed ${processedCount} market items total (${pricedCount} priced)`);
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
      priced_item_count = ?
    WHERE id = ?
  `).run(
    runFinishedAt,
    runFinishedAt,
    worldLastUpdate,
    worldFetchedAt,
    marketRows.length,
    Object.keys(flatPrices).length,
    runId
  );

  exportJsonFiles({
    flatPrices,
    detailedRows,
    runStartedAt,
    runFinishedAt,
    worldRow,
    marketRowsCount: marketRows.length
  });

  console.log(`[sync] wrote JSON exports and finished market sync`);

  return {
    ok: true,
    refreshed_at: runFinishedAt,
    world_last_update: worldLastUpdate
  };
}

export function getStatus(db: Database.Database): LatestStatus {
  const run = db
    .prepare(
      `
      SELECT id, server, started_at, finished_at, world_last_update, world_queried_at, priced_item_count
      FROM market_runs
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
      prices: config.outputFlatPath,
      detail: config.outputDetailPath,
      meta: config.outputMetaPath
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
      latestRun: db.prepare("SELECT id FROM market_runs ORDER BY id DESC LIMIT 1") as Database.Statement<
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
          m.sell_offer
        FROM matched m
        LEFT JOIN npc_buy nb ON nb.item_id = m.id
        LEFT JOIN npc_sell ns ON ns.item_id = m.id
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
    const lootLogic = buildLootLogicPreview(row);
    return {
      ...row,
      trend: lootLogic.trend_display,
      loot_logic: lootLogic
    };
  });
}

export async function preflightRefresh(db: Database.Database): Promise<RefreshPreflight> {
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
  const latestRun = db.prepare("SELECT id FROM market_runs ORDER BY id DESC LIMIT 1").get() as
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
        mif.month_sold AS month_sold,
        mif.day_sold AS day_sold,
        mif.month_average_sell AS month_average_sell,
        mif.day_average_sell AS day_average_sell,
        mif.sell_offer AS sell_offer,
        mif.buy_offer AS buy_offer,
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

  const npcBuyRows = db
    .prepare(
      `
      SELECT npc_name, location, price
      FROM item_npc_buy
      WHERE item_id = ?
      ORDER BY price DESC, npc_name ASC
    `
    )
    .all(itemId) as Array<Record<string, unknown>>;

  const npcSellRows = db
    .prepare(
      `
      SELECT npc_name, location, price
      FROM item_npc_sell
      WHERE item_id = ?
      ORDER BY price ASC, npc_name ASC
    `
    )
    .all(itemId) as Array<Record<string, unknown>>;

  return {
    ...detail,
    trend: buildLootLogicPreview(detail).trend_display,
    loot_logic: buildLootLogicPreview(detail),
    npc_buy_rows: npcBuyRows,
    npc_sell_rows: npcSellRows
  };
}