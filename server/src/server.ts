import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type Database from "better-sqlite3";
import { config } from "./config";
import {
  createHuntUpload,
  deleteHuntUpload,
  deleteHuntLogImportFile,
  getHuntUploadPreview,
  hydrateHuntItemDetails,
  ignoreHuntLogImport,
  listHuntingAreaSummaries,
  listHuntLogImportCandidates,
  listGlobalLootSummary,
  listHuntUploads,
  parseHuntPreview,
  updateHuntUpload
} from "./lib/hunts/huntAnalyser";
import {
  generateItemPricesFile,
  getItemDetails,
  getStatus,
  preflightRefresh,
  runMarketSync,
  searchLatestItems,
  setItemValueOverride,
  type ItemValueOverrideMode
} from "./lib/sync/updatePrices";
import {
  objectBody,
  parseHydrateItemsPayload,
  parseHuntPayload,
  parseItemOverrideMode,
  parseItemPriceMode,
  parsePositiveId
} from "./lib/http/validation";
import { ensureItemHistory, summarizeItemHistory } from "./lib/pricing/itemHistory";
import { setItemAlias } from "./lib/hunts/itemAliases";
import { lookupTibiaCharacter, searchKnownCharacters } from "./lib/tibiadata/characters";
import { getPublicReferenceStatus, startPublicReferenceEnrichment, syncPublicReferenceData } from "./lib/tibiadata/publicReference";
import {
  addMarketWatchlistItem,
  getMarketDashboardSummary,
  getMarketWatchlist,
  removeMarketWatchlistItem
} from "./lib/marketDashboard";

export function buildServer(db: Database.Database) {
  const app = Fastify({ logger: true });

  app.register(fastifyStatic, {
    root: config.itemImagesDir,
    prefix: "/items/",
    cacheControl: true,
    maxAge: "7d",
    immutable: true,
    decorateReply: false
  });

  app.get("/api/status", async () => getStatus(db));

  app.get("/api/public-reference/status", async () => getPublicReferenceStatus(db));

  app.get("/api/market-dashboard/summary", async () => getMarketDashboardSummary(db));

  app.get("/api/market-watchlist", async () => getMarketWatchlist(db));

  app.post("/api/market-watchlist/:itemId", async (request, reply) => {
    try {
      const itemId = parsePositiveId((request.params as Record<string, string>).itemId, "item id");
      return { ok: true, item: addMarketWatchlistItem(db, itemId) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.delete("/api/market-watchlist/:itemId", async (request, reply) => {
    try {
      const itemId = parsePositiveId((request.params as Record<string, string>).itemId, "item id");
      removeMarketWatchlistItem(db, itemId);
      return { ok: true, deleted_id: itemId };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/search", async (request) => {
    const startedAt = Date.now();
    const q = typeof request.query === "object" && request.query !== null
      ? String((request.query as Record<string, unknown>).q ?? "")
      : "";
    const results = searchLatestItems(db, q, 80);
    return { results, elapsed_ms: Date.now() - startedAt };
  });

  app.get("/api/item/:id", async (request, reply) => {
    let itemId: number;
    try {
      itemId = parsePositiveId((request.params as Record<string, string>).id, "item id");
    } catch (error) {
      reply.code(400);
      return { error: String(error) };
    }

    const details = getItemDetails(db, itemId);
    if (!details) {
      reply.code(404);
      return { error: "Item not found in latest market run" };
    }

    return details;
  });

  app.get("/api/item/:id/history", async (request, reply) => {
    try {
      const itemId = parsePositiveId((request.params as Record<string, string>).id, "item id");
      const query = typeof request.query === "object" && request.query !== null
        ? (request.query as Record<string, unknown>)
        : {};
      const startDaysAgo = Number(query.start_days_ago ?? 30);
      const fetchRemote = query.fetch !== "0" && query.fetch !== "false";
      const history = fetchRemote
        ? await ensureItemHistory(db, itemId, Number.isFinite(startDaysAgo) ? Math.max(1, Math.trunc(startDaysAgo)) : 30)
        : summarizeItemHistory(db, itemId);
      return { ok: true, history };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/item/:id/override", async (request, reply) => {
    try {
      const itemId = parsePositiveId((request.params as Record<string, string>).id, "item id");
      const body = objectBody(request.body);
      const mode = parseItemOverrideMode(body.mode) as ItemValueOverrideMode;
      const override = setItemValueOverride(db, itemId, mode);
      const details = getItemDetails(db, itemId);
      return { ok: true, override, item: details };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/item-aliases", async (request, reply) => {
    try {
      const body = objectBody(request.body);
      const alias = setItemAlias(db, {
        raw_name: typeof body.raw_name === "string" ? body.raw_name : "",
        item_id: parsePositiveId(body.item_id, "item id")
      });
      return { ok: true, alias };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/refresh", async (request, reply) => {
    try {
      const preflight = await preflightRefresh(db, request.log);
      if (!preflight.should_refresh) {
        return {
          ok: true,
          skipped: true,
          message: preflight.message,
          world_last_update: preflight.remote_world_last_update,
          status: getStatus(db)
        };
      }

      const refresh = await runMarketSync(db, request.log);
      return {
        ...refresh,
        skipped: false,
        message: preflight.message,
        status: getStatus(db)
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: String(error)
      };
    }
  });

  app.post("/api/public-reference/sync", async (request, reply) => {
    try {
      const body = typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
      const creatureLimit = Number(body.creature_limit ?? body.creatureLimit);
      const huntingPlaceLimit = Number(body.hunting_place_limit ?? body.huntingPlaceLimit);
      return await syncPublicReferenceData(db, {
        creatureLimit: Number.isFinite(creatureLimit) ? Math.max(0, Math.trunc(creatureLimit)) : undefined,
        huntingPlaceLimit: Number.isFinite(huntingPlaceLimit) ? Math.max(0, Math.trunc(huntingPlaceLimit)) : undefined
      });
    } catch (error) {
      reply.code(String(error).includes("already running") ? 409 : 500);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/public-reference/enrich", async (request, reply) => {
    try {
      const body = typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};
      const creatureLimit = Number(body.creature_limit ?? body.creatureLimit);
      const huntingPlaceLimit = Number(body.hunting_place_limit ?? body.huntingPlaceLimit);
      const includeStale = body.include_stale ?? body.includeStale;
      const job = startPublicReferenceEnrichment(db, {
        creatureLimit: Number.isFinite(creatureLimit) ? Math.max(0, Math.trunc(creatureLimit)) : undefined,
        huntingPlaceLimit: Number.isFinite(huntingPlaceLimit) ? Math.max(0, Math.trunc(huntingPlaceLimit)) : undefined,
        includeStale: typeof includeStale === "boolean" ? includeStale : undefined
      });
      reply.code(202);
      return {
        ok: true,
        job,
        message: "Public reference enrichment started."
      };
    } catch (error) {
      reply.code(String(error).includes("already running") ? 409 : 500);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/hunts", async () => listHuntUploads(db));

  app.get("/api/characters", async (request, reply) => {
    try {
      const query = typeof request.query === "object" && request.query !== null
        ? (request.query as Record<string, unknown>)
        : {};
      const q = typeof query.q === "string" ? query.q : "";
      return { ok: true, items: searchKnownCharacters(db, q) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/characters/lookup", async (request, reply) => {
    try {
      const query = typeof request.query === "object" && request.query !== null
        ? (request.query as Record<string, unknown>)
        : {};
      const name = typeof query.name === "string" ? query.name : "";
      return { ok: true, item: await lookupTibiaCharacter(db, name) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/hunts/areas", async (request, reply) => {
    try {
      return await listHuntingAreaSummaries(db);
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/hunts/loot-summary", async (request, reply) => {
    try {
      return await listGlobalLootSummary(db);
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/hunts/import/logs", async (request, reply) => {
    try {
      return await listHuntLogImportCandidates(db);
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/hunts/import/logs/ignore", async (request, reply) => {
    try {
      return ignoreHuntLogImport(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/hunts/import/logs/delete-file", async (request, reply) => {
    try {
      return deleteHuntLogImportFile(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/hunts/:id", async (request, reply) => {
    let huntId: number;
    try {
      huntId = parsePositiveId((request.params as Record<string, string>).id, "hunt id");
    } catch (error) {
      reply.code(400);
      return { error: String(error) };
    }

    const preview = await getHuntUploadPreview(db, huntId);
    if (!preview) {
      reply.code(404);
      return { error: "Hunt not found" };
    }
    return preview;
  });

  app.post("/api/hunts/parse", async (request, reply) => {
    try {
      return await parseHuntPreview(db, parseHuntPayload(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/hunts/hydrate-items", async (request, reply) => {
    try {
      const payload = parseHydrateItemsPayload(request.body);
      return await hydrateHuntItemDetails(db, payload.item_names);
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/hunts", async (request, reply) => {
    try {
      const created = createHuntUpload(db, parseHuntPayload(request.body));
      return { ok: true, item: created };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/hunts/:id", async (request, reply) => {
    try {
      const huntId = parsePositiveId((request.params as Record<string, string>).id, "hunt id");
      const updated = updateHuntUpload(db, huntId, parseHuntPayload(request.body));
      if (!updated) {
        reply.code(404);
        return { ok: false, error: "Hunt not found" };
      }
      return { ok: true, item: updated };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.delete("/api/hunts/:id", async (request, reply) => {
    try {
      const huntId = parsePositiveId((request.params as Record<string, string>).id, "hunt id");
      const deleted = deleteHuntUpload(db, huntId);
      if (!deleted) {
        reply.code(404);
        return { ok: false, error: "Hunt not found" };
      }
      return { ok: true, deleted_id: Math.trunc(huntId) };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/itemprices/generate", async (request, reply) => {
    try {
      const mode = parseItemPriceMode(objectBody(request.body).mode);
      const out = generateItemPricesFile(db, mode);
      if (!out.ok) {
        reply.code(400);
      }
      return out;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/", async () => ({
    name: "tibia-market-server",
    server: config.serverName,
    status: "ok"
  }));

  return app;
}
