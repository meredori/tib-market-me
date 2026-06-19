import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { objectBody, parsePositiveId } from "../http/validation";
import {
  deleteAccessRequirement,
  listAccessRequirements,
  listAccessStates,
  saveAccessRequirement,
  saveAccessState
} from "./index";

function queryObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

export function registerAccessRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/access/requirements", async (request, reply) => {
    try {
      return listAccessRequirements(db, queryObject(request.query));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/access/requirements", async (request, reply) => {
    try {
      return saveAccessRequirement(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/access/requirements/:id", async (request, reply) => {
    try {
      const id = parsePositiveId((request.params as Record<string, string>).id, "access requirement id");
      const result = saveAccessRequirement(db, objectBody(request.body), id);
      if (!result.ok) {
        reply.code(404);
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.delete("/api/access/requirements/:id", async (request, reply) => {
    try {
      const id = parsePositiveId((request.params as Record<string, string>).id, "access requirement id");
      const result = deleteAccessRequirement(db, id);
      if (!result.ok) {
        reply.code(404);
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.get("/api/access/states", async (request, reply) => {
    try {
      return listAccessStates(db, queryObject(request.query));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/access/states", async (request, reply) => {
    try {
      return saveAccessState(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });
}
