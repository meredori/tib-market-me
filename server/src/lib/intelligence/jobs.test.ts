import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entityRef } from "./metadata";
import { finishJob, listJobs, recordJobFailure, startJob, updateJobProgress } from "./jobs";

let db: Database.Database;

function createDb(): Database.Database {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE intelligence_jobs (
      id INTEGER PRIMARY KEY,
      job_type TEXT NOT NULL,
      entity_type TEXT,
      status TEXT NOT NULL,
      cursor_json TEXT NOT NULL DEFAULT '{}',
      total_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      current_entity_type TEXT,
      current_entity_id TEXT,
      current_entity_name TEXT,
      last_success_at TEXT,
      last_error TEXT,
      last_error_at TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      backoff_until TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE intelligence_job_events (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES intelligence_jobs(id) ON DELETE CASCADE
    );
  `);
  return database;
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("intelligence job lifecycle", () => {
  it("tracks progress and success", () => {
    const job = startJob(db, { jobType: "public-reference-catalog", entityType: "creature", totalCount: 2 });
    const progressed = updateJobProgress(db, job.id, {
      completedCount: 1,
      currentEntity: entityRef("creature", { id: 101, name: "Dragon" }),
      cursor: { phase: "creatures" }
    });
    const done = finishJob(db, job.id, "success", { completedCount: 2 });

    expect(progressed.current_entity).toMatchObject({ type: "creature", id: "101", name: "Dragon" });
    expect(done).toMatchObject({ status: "success", completed_count: 2 });
  });

  it("records failure state and interrupts older active jobs of the same type", () => {
    const first = startJob(db, { jobType: "public-reference-catalog" });
    recordJobFailure(db, first.id, { error: new Error("rate limited"), backoffUntil: "2026-06-13T01:00:00.000Z" });
    const second = startJob(db, { jobType: "public-reference-catalog" });
    const jobs = listJobs(db, "public-reference-catalog", 5);

    expect(second.status).toBe("running");
    expect(jobs.find((job) => job.id === first.id)?.status).toBe("interrupted");
    expect(jobs.find((job) => job.id === first.id)?.last_error).toBe("Job was interrupted by a newer run");
  });
});
