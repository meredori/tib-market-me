import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { objectBody } from "../http/validation";
import { listHuntRecommendations, saveRecommendationFeedback } from "./index";

function queryObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function registerRecommendationRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/hunt-recommendations", async (request, reply) => {
    try {
      return listHuntRecommendations(db, queryObject(request.query));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/hunt-recommendations/feedback", async (request, reply) => {
    try {
      return saveRecommendationFeedback(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });
}
