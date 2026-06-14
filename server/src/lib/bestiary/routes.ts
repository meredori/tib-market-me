import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { objectBody } from "../http/validation";
import { listBestiaryProgress, listHuntCharmRelevance, upsertBestiaryState } from "./index";

function queryObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function registerBestiaryRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/bestiary", async (request, reply) => {
    try {
      return listBestiaryProgress(db, queryObject(request.query));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/bestiary/state", async (request, reply) => {
    try {
      return upsertBestiaryState(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/bestiary/hunt-relevance", async (request, reply) => {
    try {
      return listHuntCharmRelevance(db, queryObject(request.query));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });
}
