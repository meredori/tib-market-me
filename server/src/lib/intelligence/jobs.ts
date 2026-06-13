import type Database from "better-sqlite3";
import type { EntityRef, EntityType, JobStatus, JobStatusValue } from "./types";

type StartJobInput = {
  jobType: string;
  entityType?: EntityType | string | null;
  totalCount?: number;
  cursor?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type ProgressInput = {
  completedCount?: number;
  totalCount?: number;
  failedCount?: number;
  currentEntity?: EntityRef | null;
  cursor?: Record<string, unknown>;
  message?: string;
  metadata?: Record<string, unknown>;
};

type FailureInput = {
  error: unknown;
  currentEntity?: EntityRef | null;
  backoffUntil?: string | null;
  retryCount?: number;
  message?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function recordEvent(
  db: Database.Database,
  jobId: number,
  eventType: string,
  message: string | null,
  entity: EntityRef | null = null,
  payload: Record<string, unknown> = {}
): void {
  db.prepare(
    `
    INSERT INTO intelligence_job_events (
      job_id, event_type, message, entity_type, entity_id, entity_name, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    Math.trunc(jobId),
    eventType,
    message,
    entity?.type ?? null,
    entity?.id === null || entity?.id === undefined ? null : String(entity.id),
    entity?.name ?? null,
    safeJson(payload),
    nowIso()
  );
}

export function startJob(db: Database.Database, input: StartJobInput): JobStatus {
  const startedAt = nowIso();
  const tx = db.transaction(() => {
    const interruptedRows = db.prepare(
      `
      SELECT id
      FROM intelligence_jobs
      WHERE job_type = ?
        AND status IN ('queued', 'running', 'paused', 'backoff')
      `
    ).all(input.jobType) as Array<{ id: number }>;

    db.prepare(
      `
      UPDATE intelligence_jobs
      SET status = 'interrupted',
        updated_at = ?,
        finished_at = ?,
        last_error = 'Job was interrupted by a newer run',
        last_error_at = ?
      WHERE job_type = ?
        AND status IN ('queued', 'running', 'paused', 'backoff')
      `
    ).run(startedAt, startedAt, startedAt, input.jobType);

    for (const row of interruptedRows) {
      recordEvent(db, row.id, "interrupted", "Job was interrupted by a newer run");
    }

    const inserted = db.prepare(
      `
      INSERT INTO intelligence_jobs (
        job_type, entity_type, status, cursor_json, total_count, completed_count, failed_count,
        started_at, updated_at, metadata_json
      ) VALUES (?, ?, 'running', ?, ?, 0, 0, ?, ?, ?)
      `
    ).run(
      input.jobType,
      input.entityType ?? null,
      safeJson(input.cursor ?? {}),
      Math.max(0, Math.trunc(input.totalCount ?? 0)),
      startedAt,
      startedAt,
      safeJson(input.metadata ?? {})
    );
    const id = Number(inserted.lastInsertRowid);
    recordEvent(db, id, "started", "Job started", null, input.metadata ?? {});
    return id;
  });

  return getJob(db, tx());
}

export function updateJobProgress(db: Database.Database, jobId: number, input: ProgressInput): JobStatus {
  const current = getJob(db, jobId);
  const updatedAt = nowIso();
  const cursor = input.cursor ?? current.cursor;
  const metadata = { ...current.metadata, ...(input.metadata ?? {}) };
  const currentEntity = input.currentEntity === undefined ? current.current_entity : input.currentEntity;
  db.prepare(
    `
    UPDATE intelligence_jobs
    SET total_count = ?,
      completed_count = ?,
      failed_count = ?,
      current_entity_type = ?,
      current_entity_id = ?,
      current_entity_name = ?,
      cursor_json = ?,
      updated_at = ?,
      last_success_at = ?,
      metadata_json = ?
    WHERE id = ?
    `
  ).run(
    Math.max(0, Math.trunc(input.totalCount ?? current.total_count)),
    Math.max(0, Math.trunc(input.completedCount ?? current.completed_count)),
    Math.max(0, Math.trunc(input.failedCount ?? current.failed_count)),
    currentEntity?.type ?? null,
    currentEntity?.id === null || currentEntity?.id === undefined ? null : String(currentEntity.id),
    currentEntity?.name ?? null,
    safeJson(cursor),
    updatedAt,
    updatedAt,
    safeJson(metadata),
    Math.trunc(jobId)
  );
  recordEvent(db, jobId, "progress", input.message ?? null, currentEntity, {
    completed_count: input.completedCount ?? current.completed_count,
    failed_count: input.failedCount ?? current.failed_count
  });
  return getJob(db, jobId);
}

export function recordJobFailure(db: Database.Database, jobId: number, input: FailureInput): JobStatus {
  const current = getJob(db, jobId);
  const updatedAt = nowIso();
  const status: JobStatusValue = input.backoffUntil ? "backoff" : "running";
  const currentEntity = input.currentEntity ?? current.current_entity;
  db.prepare(
    `
    UPDATE intelligence_jobs
    SET status = ?,
      failed_count = failed_count + 1,
      failure_count = failure_count + 1,
      retry_count = ?,
      current_entity_type = ?,
      current_entity_id = ?,
      current_entity_name = ?,
      last_error = ?,
      last_error_at = ?,
      backoff_until = ?,
      updated_at = ?
    WHERE id = ?
    `
  ).run(
    status,
    Math.max(0, Math.trunc(input.retryCount ?? current.retry_count)),
    currentEntity?.type ?? null,
    currentEntity?.id === null || currentEntity?.id === undefined ? null : String(currentEntity.id),
    currentEntity?.name ?? null,
    String(input.error),
    updatedAt,
    input.backoffUntil ?? null,
    updatedAt,
    Math.trunc(jobId)
  );
  recordEvent(db, jobId, "failure", input.message ?? String(input.error), currentEntity, { error: String(input.error) });
  return getJob(db, jobId);
}

export function finishJob(
  db: Database.Database,
  jobId: number,
  status: Extract<JobStatusValue, "success" | "error" | "cancelled">,
  input: { error?: unknown; completedCount?: number; failedCount?: number; metadata?: Record<string, unknown> } = {}
): JobStatus {
  const current = getJob(db, jobId);
  const finishedAt = nowIso();
  const metadata = { ...current.metadata, ...(input.metadata ?? {}) };
  db.prepare(
    `
    UPDATE intelligence_jobs
    SET status = ?,
      completed_count = ?,
      failed_count = ?,
      last_error = ?,
      last_error_at = ?,
      finished_at = ?,
      updated_at = ?,
      metadata_json = ?
    WHERE id = ?
    `
  ).run(
    status,
    Math.max(0, Math.trunc(input.completedCount ?? current.completed_count)),
    Math.max(0, Math.trunc(input.failedCount ?? current.failed_count)),
    input.error ? String(input.error) : current.last_error,
    input.error ? finishedAt : current.last_error_at,
    finishedAt,
    finishedAt,
    safeJson(metadata),
    Math.trunc(jobId)
  );
  recordEvent(db, jobId, status, status === "success" ? "Job completed" : input.error ? String(input.error) : `Job ${status}`);
  return getJob(db, jobId);
}

export function getJob(db: Database.Database, jobId: number): JobStatus {
  const row = db.prepare("SELECT * FROM intelligence_jobs WHERE id = ?").get(Math.trunc(jobId)) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error(`Intelligence job ${jobId} not found`);
  }
  return toJobStatus(row);
}

export function listJobs(db: Database.Database, jobType?: string, limit = 10): JobStatus[] {
  const rows = jobType
    ? db.prepare("SELECT * FROM intelligence_jobs WHERE job_type = ? ORDER BY started_at DESC LIMIT ?").all(jobType, Math.max(1, Math.trunc(limit)))
    : db.prepare("SELECT * FROM intelligence_jobs ORDER BY started_at DESC LIMIT ?").all(Math.max(1, Math.trunc(limit)));
  return (rows as Array<Record<string, unknown>>).map(toJobStatus);
}

export function summarizeJobs(db: Database.Database, jobTypes: string[]): Record<string, unknown> {
  const latest = listJobs(db, undefined, 20);
  const active = latest.filter((job) => ["queued", "running", "paused", "backoff"].includes(job.status));
  const byType: Record<string, JobStatus[]> = {};
  for (const type of jobTypes) {
    byType[type] = listJobs(db, type, 5);
  }
  return {
    active,
    latest: latest.slice(0, 5),
    by_type: byType
  };
}

function toJobStatus(row: Record<string, unknown>): JobStatus {
  const entityType = typeof row.entity_type === "string" && row.entity_type ? row.entity_type : null;
  const currentEntityType = typeof row.current_entity_type === "string" && row.current_entity_type ? row.current_entity_type : entityType;
  const currentId = typeof row.current_entity_id === "string" && row.current_entity_id ? row.current_entity_id : null;
  const currentName = typeof row.current_entity_name === "string" && row.current_entity_name ? row.current_entity_name : null;
  return {
    id: Number(row.id),
    job_type: String(row.job_type ?? ""),
    entity_type: entityType,
    status: String(row.status ?? "error") as JobStatusValue,
    cursor: parseRecord(row.cursor_json),
    total_count: Number(row.total_count ?? 0),
    completed_count: Number(row.completed_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    current_entity: currentEntityType || currentId || currentName
      ? { type: (currentEntityType ?? "task") as EntityType, id: currentId, name: currentName }
      : null,
    last_success_at: typeof row.last_success_at === "string" ? row.last_success_at : null,
    last_error: typeof row.last_error === "string" ? row.last_error : null,
    last_error_at: typeof row.last_error_at === "string" ? row.last_error_at : null,
    failure_count: Number(row.failure_count ?? 0),
    retry_count: Number(row.retry_count ?? 0),
    backoff_until: typeof row.backoff_until === "string" ? row.backoff_until : null,
    started_at: String(row.started_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    finished_at: typeof row.finished_at === "string" ? row.finished_at : null,
    metadata: parseRecord(row.metadata_json)
  };
}
