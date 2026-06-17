import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getHuntingPlaceDetail, listHuntingPlaces, updateHuntingPlaceAreaOrder } from "./intelligence";

function queryObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function bodyObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function registerHuntingPlaceRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/hunting-places", async (request, reply) => {
    try {
      return listHuntingPlaces(db, queryObject(request.query));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/hunting-places/:id", async (request, reply) => {
    const result = getHuntingPlaceDetail(db, (request.params as Record<string, string>).id);
    if (!result.ok) {
      reply.code(result.error.includes("not found") ? 404 : 400);
    }
    return result;
  });

  app.put("/api/hunting-places/:id/area-order", async (request, reply) => {
    const body = bodyObject(request.body);
    const result = updateHuntingPlaceAreaOrder(db, (request.params as Record<string, string>).id, body.area_names ?? body.areaNames);
    if (!result.ok) {
      reply.code(result.error.includes("not found") ? 404 : 400);
    }
    return result;
  });
}
