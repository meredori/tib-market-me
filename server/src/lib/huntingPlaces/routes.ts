import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { getHuntingPlaceDetail } from "./intelligence";

export function registerHuntingPlaceRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/hunting-places/:id", async (request, reply) => {
    const result = getHuntingPlaceDetail(db, (request.params as Record<string, string>).id);
    if (!result.ok) {
      reply.code(result.error.includes("not found") ? 404 : 400);
    }
    return result;
  });
}
