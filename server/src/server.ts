import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type Database from "better-sqlite3";
import { config } from "./config";
import { getItemDetails, getStatus, preflightRefresh, runMarketSync, searchLatestItems } from "./lib/sync/updatePrices";

export function buildServer(db: Database.Database) {
  const app = Fastify({ logger: false });

  app.register(fastifyStatic, {
    root: config.itemImagesDir,
    prefix: "/items/",
    cacheControl: true,
    maxAge: "7d",
    immutable: true,
    decorateReply: false
  });

  app.get("/api/status", async () => getStatus(db));

  app.get("/api/search", async (request) => {
    const startedAt = Date.now();
    const q = typeof request.query === "object" && request.query !== null
      ? String((request.query as Record<string, unknown>).q ?? "")
      : "";
    const results = searchLatestItems(db, q, 80);
    return { results, elapsed_ms: Date.now() - startedAt };
  });

  app.get("/api/item/:id", async (request, reply) => {
    const rawId = (request.params as Record<string, string>).id;
    const itemId = Number(rawId);
    if (!Number.isFinite(itemId)) {
      reply.code(400);
      return { error: "Invalid item id" };
    }

    const details = getItemDetails(db, itemId);
    if (!details) {
      reply.code(404);
      return { error: "Item not found in latest market run" };
    }

    return details;
  });

  app.post("/api/refresh", async (request, reply) => {
    try {
      const preflight = await preflightRefresh(db);
      if (!preflight.should_refresh) {
        return {
          ok: true,
          skipped: true,
          message: preflight.message,
          world_last_update: preflight.remote_world_last_update,
          status: getStatus(db)
        };
      }

      const refresh = await runMarketSync(db);
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

  app.get("/", async () => ({
    name: "tibia-market-server",
    server: config.serverName,
    status: "ok"
  }));

  return app;
}