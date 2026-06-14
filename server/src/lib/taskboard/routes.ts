import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { objectBody, parsePositiveId } from "../http/validation";
import {
  createTaskboardEntry,
  deleteTaskboardEntry,
  getTaskboardEntry,
  listTaskboardEntries,
  updateTaskboardEntry
} from "./taskboard";

export function registerTaskboardRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/taskboard/entries", async () => listTaskboardEntries(db));

  app.get("/api/taskboard/entries/:id", async (request, reply) => {
    try {
      const entryId = parsePositiveId((request.params as Record<string, string>).id, "taskboard entry id");
      const result = getTaskboardEntry(db, entryId);
      if (!result) {
        reply.code(404);
        return { ok: false, error: "Taskboard entry not found" };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/taskboard/entries", async (request, reply) => {
    try {
      return createTaskboardEntry(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/taskboard/entries/:id", async (request, reply) => {
    try {
      const entryId = parsePositiveId((request.params as Record<string, string>).id, "taskboard entry id");
      const result = updateTaskboardEntry(db, entryId, objectBody(request.body));
      if (!result) {
        reply.code(404);
        return { ok: false, error: "Taskboard entry not found" };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.delete("/api/taskboard/entries/:id", async (request, reply) => {
    try {
      const entryId = parsePositiveId((request.params as Record<string, string>).id, "taskboard entry id");
      const deleted = deleteTaskboardEntry(db, entryId);
      if (!deleted) {
        reply.code(404);
        return { ok: false, error: "Taskboard entry not found" };
      }
      return { ok: true, deleted_id: entryId };
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });
}
