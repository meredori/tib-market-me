import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { objectBody, parsePositiveId } from "../http/validation";
import {
  createTaskboardTask,
  getTaskboardTask,
  listTaskboardTasks,
  updateTaskboardTask
} from "./taskboard";

export function registerTaskboardRoutes(app: FastifyInstance, db: Database.Database): void {
  app.get("/api/taskboard/tasks", async () => listTaskboardTasks(db));

  app.get("/api/taskboard/tasks/:id", async (request, reply) => {
    try {
      const taskId = parsePositiveId((request.params as Record<string, string>).id, "task id");
      const result = getTaskboardTask(db, taskId);
      if (!result) {
        reply.code(404);
        return { ok: false, error: "Task not found" };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.post("/api/taskboard/tasks", async (request, reply) => {
    try {
      return createTaskboardTask(db, objectBody(request.body));
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });

  app.put("/api/taskboard/tasks/:id", async (request, reply) => {
    try {
      const taskId = parsePositiveId((request.params as Record<string, string>).id, "task id");
      const result = updateTaskboardTask(db, taskId, objectBody(request.body));
      if (!result) {
        reply.code(404);
        return { ok: false, error: "Task not found" };
      }
      return result;
    } catch (error) {
      reply.code(400);
      return { ok: false, error: String(error) };
    }
  });
}
