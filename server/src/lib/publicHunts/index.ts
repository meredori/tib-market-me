import type Database from "better-sqlite3";
import { confidence as buildConfidence, freshness as buildFreshness, provenance } from "../intelligence/metadata";
import { finishJob, listJobs, startJob, updateJobProgress } from "../intelligence/jobs";
import { summarizeJobs } from "../intelligence/jobs";
import type { JobStatus } from "../intelligence/types";
import { matchHuntToHuntingPlaces } from "../hunts/huntingPlaceMatcher";
import type { ParsedHuntText } from "../hunts/types";
import { asNumber, asRecord, asText, nowIso, sha256 } from "../hunts/utils";
import { normalizePublicName } from "../tibiadata/publicReference";

const SOURCE = "hunt-analyser";
const BASE_URL = "https://www.hunt-analyser.com";
const LIST_PATH = "/hunt_sessions?hunt_sessions_by=is_public";
const DEFAULT_THROTTLE_MS = 900;
const DEFAULT_DETAIL_CONCURRENCY = 6;
const DEFAULT_KNOWN_PAGE_STOP_THRESHOLD = 1;
let publicHuntImportInProgress = false;

type Fetcher = (url: string) => Promise<string>;

export type PublicHuntListEntry = {
  source_session_id: string;
  source_url: string;
  title: string;
};

export type ParsedPublicHunt = {
  source_session_id: string;
  source_url: string;
  title: string;
  author_label: string | null;
  observed_at: string | null;
  duration_minutes: number | null;
  party_size: number | null;
  party: Array<{ vocation: string; level: number | null }>;
  total_xp: number | null;
  raw_total_xp: number | null;
  xp_per_hour: number | null;
  raw_xp_per_hour: number | null;
  balance_gold: number | null;
  profit_per_hour: number | null;
  monsters: Array<{ name: string; count: number }>;
  confidence: number;
  parse_status: "parsed" | "partial" | "error";
  parse_error: string | null;
};

type StoredPublicHunt = ParsedPublicHunt & {
  raw_html: string;
  payload_fingerprint: string;
  imported_at: string;
  refreshed_at: string;
};

type PublicHuntRow = {
  id: number;
  source: string;
  source_session_id: string;
  source_url: string;
  title: string;
  author_label: string | null;
  observed_at: string | null;
  imported_at: string;
  refreshed_at: string;
  payload_fingerprint: string;
  parse_status: string;
  parse_error: string | null;
  review_status: string;
  suspicious_status: string;
  suspicious_reasons_json: string;
  parsed_confidence: number;
  duration_minutes: number | null;
  party_size: number | null;
  party_json: string;
  total_xp: number | null;
  raw_total_xp: number | null;
  xp_per_hour: number | null;
  raw_xp_per_hour: number | null;
  balance_gold: number | null;
  profit_per_hour: number | null;
  public_hunting_place_id: number | null;
  matched_hunting_place_name?: string | null;
  matched_hunting_place_location?: string | null;
  hunting_place_confidence: number;
  hunting_place_match_status: string;
  hunting_place_match_reasons_json: string;
  hunting_place_alternates_json: string;
  hunting_place_match_explanations_json: string;
  hunting_place_match_readiness: string;
  hunting_place_match_readiness_reason: string | null;
  hunting_place_noise_creatures_json: string;
  last_reviewed_at: string | null;
  review_note: string | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function compactText(value: string): string {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function numberFromText(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function minutesFromText(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const text = value.trim();
  const hhmm = text.match(/(\d{1,2}):(\d{2})\s*h?/i);
  if (hhmm) {
    return Number(hhmm[1]) * 60 + Number(hhmm[2]);
  }
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/i);
  if (hours) {
    return Math.round(Number(hours[1]) * 60);
  }
  return numberFromText(text);
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(`${value.trim()} UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function firstMatch(input: string, pattern: RegExp): string | null {
  const match = input.match(pattern);
  return match?.[1] ? decodeHtml(match[1]).trim() : null;
}

function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function parsePublicHuntList(html: string): { entries: PublicHuntListEntry[]; total_count: number | null; next_page: number | null } {
  const entries: PublicHuntListEntry[] = [];
  const seen = new Set<string>();
  const cardPattern = /data-row-click-url-value="(\/hunt_sessions\/(\d+))"([\s\S]*?)(?=data-row-click-url-value="\/hunt_sessions\/\d+"|<nav class="mt-2|Displaying hunt sessions|$)/g;
  let match: RegExpExecArray | null;
  while ((match = cardPattern.exec(html)) !== null) {
    const sourceId = match[2];
    if (seen.has(sourceId)) {
      continue;
    }
    seen.add(sourceId);
    const title = firstMatch(match[3], /<h3[^>]*>([\s\S]*?)<\/h3>/i) ?? `Hunt ${sourceId}`;
    entries.push({
      source_session_id: sourceId,
      source_url: absoluteUrl(match[1]),
      title: compactText(title)
    });
  }

  const total = numberFromText(firstMatch(html, /Displaying hunt sessions[\s\S]*?of\s*<b>([\d,]+)<\/b>/i));
  const nextPage = numberFromText(firstMatch(html, /href="[^"]*page=(\d+)[^"]*"[^>]*>\s*Next\s*<\/a>/i));
  return { entries, total_count: total, next_page: nextPage };
}

function parseMetric(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*:?\\s*(-?[\\d,]+(?:\\.\\d+)?)`, "i"));
    const parsed = numberFromText(match?.[1]);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function parseDuration(text: string): number | null {
  const match = text.match(/(?:Session Duration|Duration)\s*:?\s*([0-9:.]+\s*h?)/i);
  return minutesFromText(match?.[1]);
}

function parseParty(html: string, fallbackText: string): Array<{ vocation: string; level: number | null }> {
  const party: Array<{ vocation: string; level: number | null }> = [];
  const htmlPattern = /<span class="font-semibold">([A-Z]{2})<\/span>\s*<span class="font-mono[^"]*">(\d+)<\/span>/g;
  let match: RegExpExecArray | null;
  while ((match = htmlPattern.exec(html)) !== null) {
    party.push({ vocation: match[1], level: Number(match[2]) });
  }
  if (party.length) {
    return party;
  }
  const textPattern = /\b(EK|ED|MS|RP)\s+(\d{1,4})\b/g;
  while ((match = textPattern.exec(fallbackText)) !== null) {
    party.push({ vocation: match[1], level: Number(match[2]) });
  }
  return party;
}

function parseMonsters(html: string): Array<{ name: string; count: number }> {
  const heading = html.search(/Monster Killed/i);
  const chunk = heading >= 0 ? html.slice(heading) : html;
  const rows = [...chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const monsters: Array<{ name: string; count: number }> = [];
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => compactText(cell[1]));
    if (cells.length < 3 || !/^#?\d+/.test(cells[0])) {
      continue;
    }
    const count = numberFromText(cells[cells.length - 1]);
    const name = cells.slice(1, -1).join(" ").replace(/\s+/g, " ").trim();
    if (name && count !== null) {
      monsters.push({ name, count });
    }
  }
  return monsters;
}

export function parsePublicHuntDetail(html: string, sourceUrl: string, sourceSessionId: string): ParsedPublicHunt {
  const main = html.includes(`hunt_session_${sourceSessionId}`)
    ? html.slice(html.indexOf(`hunt_session_${sourceSessionId}`))
    : html;
  const text = compactText(main);
  const title = compactText(firstMatch(main, /<h1[^>]*>\s*([\s\S]*?)(?:<a|<\/h1>)/i) ?? `Hunt ${sourceSessionId}`);
  const author = compactText(firstMatch(main, /search=[^"]*">\s*by\s*([^<]+)<\/a>/i) ?? "") || null;
  const observedRaw = firstMatch(main, /<p class="text-sm text-brand-ink-soft">\s*([^<]+?)\s*<\/p>/i);
  const durationMinutes = parseDuration(text);
  const xpPerHour = parseMetric(text, ["XP/h", "XP per hour"]);
  const rawXpPerHour = parseMetric(text, ["Raw XP/h", "Raw XP per hour"]);
  const totalXp = parseMetric(text, ["XP Gain", "Experience Gain"]);
  const balance = parseMetric(text, ["Balance", "Profit"]);
  const party = parseParty(main, text);
  const monsters = parseMonsters(main);
  const rawTotalXp = rawXpPerHour !== null && durationMinutes ? Math.round(rawXpPerHour * durationMinutes / 60) : null;
  const profitPerHour = balance !== null && durationMinutes ? Math.round(balance * 60 / Math.max(1, durationMinutes)) : null;
  const present = [durationMinutes, xpPerHour, totalXp, balance].filter((value) => value !== null).length;
  const confidence = Math.min(1, 0.2 + present * 0.14 + (party.length ? 0.12 : 0) + (monsters.length ? 0.12 : 0));
  const parseStatus = confidence >= 0.55 ? "parsed" : confidence >= 0.3 ? "partial" : "error";
  return {
    source_session_id: sourceSessionId,
    source_url: sourceUrl,
    title,
    author_label: author,
    observed_at: parseDate(observedRaw),
    duration_minutes: durationMinutes,
    party_size: party.length || null,
    party,
    total_xp: totalXp,
    raw_total_xp: rawTotalXp,
    xp_per_hour: xpPerHour,
    raw_xp_per_hour: rawXpPerHour,
    balance_gold: balance,
    profit_per_hour: profitPerHour,
    monsters,
    confidence: Number(confidence.toFixed(4)),
    parse_status: parseStatus,
    parse_error: parseStatus === "error" ? "Could not parse enough core hunt metrics from the public page." : null
  };
}

function suspiciousReasons(input: ParsedPublicHunt, duplicateConflict: boolean): string[] {
  const reasons: string[] = [];
  if (input.parse_status === "error" || input.confidence < 0.45) {
    reasons.push("missing core fields");
  }
  if (input.duration_minutes !== null && input.duration_minutes < 15) {
    reasons.push("very short duration");
  }
  if (input.duration_minutes !== null && input.duration_minutes > 12 * 60) {
    reasons.push("unusually long duration");
  }
  if (input.xp_per_hour !== null && input.xp_per_hour > 200_000_000) {
    reasons.push("extreme xp per hour");
  }
  if (input.profit_per_hour !== null && Math.abs(input.profit_per_hour) > 50_000_000) {
    reasons.push("extreme profit per hour");
  }
  if (duplicateConflict) {
    reasons.push("duplicate fingerprint conflict");
  }
  return reasons;
}

function toParsedHuntText(input: ParsedPublicHunt): ParsedHuntText {
  return {
    label: input.title,
    duration_minutes: input.duration_minutes,
    raw_total_xp: input.raw_total_xp,
    total_xp: input.total_xp,
    total_loot_gold: input.balance_gold && input.balance_gold > 0 ? input.balance_gold : 0,
    total_supply_cost: input.balance_gold && input.balance_gold < 0 ? Math.abs(input.balance_gold) : 0,
    started_at: input.observed_at,
    ended_at: input.observed_at,
    hunt_date: input.observed_at,
    monsters: input.monsters,
    loot_items: []
  };
}

function upsertPublicHunt(db: Database.Database, input: StoredPublicHunt): number {
  const existingByFingerprint = db.prepare(
    "SELECT id, source_session_id, title, suspicious_reasons_json FROM public_hunt_sessions WHERE source = ? AND payload_fingerprint = ? AND source_session_id != ?"
  ).get(SOURCE, input.payload_fingerprint, input.source_session_id) as { id: number; source_session_id: string; title: string; suspicious_reasons_json: string } | undefined;
  const duplicateConflict = Boolean(existingByFingerprint && existingByFingerprint.title !== input.title);
  const suspicious = suspiciousReasons(input, duplicateConflict);
  const match = matchHuntToHuntingPlaces(db, toParsedHuntText(input), {
    locationName: input.title,
    characterLevel: input.party.map((entry) => entry.level).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
    sourceType: "public_hunt_import"
  });
  const reviewStatus = suspicious.length
    ? "needs_review"
    : match.status === "auto"
      ? "accepted"
      : "needs_review";
  const selectedPlace = match.status === "auto" ? match.selected_hunting_place_id : null;

  const existing = db.prepare("SELECT id, imported_at FROM public_hunt_sessions WHERE source = ? AND source_session_id = ?")
    .get(SOURCE, input.source_session_id) as { id: number; imported_at: string } | undefined;
  if (!existing && existingByFingerprint) {
    const reasons = Array.from(new Set([...parseArray(existingByFingerprint.suspicious_reasons_json).map(String), "duplicate fingerprint"]));
    db.prepare(`
      UPDATE public_hunt_sessions
      SET suspicious_status = 'suspicious',
        suspicious_reasons_json = ?,
        review_status = CASE WHEN review_status = 'ignored' THEN review_status ELSE 'needs_review' END,
        refreshed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(reasons), input.refreshed_at, existingByFingerprint.id);
    return existingByFingerprint.id;
  }
  if (existing) {
    db.prepare(`
      UPDATE public_hunt_sessions
      SET source_url = ?, title = ?, author_label = ?, observed_at = ?, refreshed_at = ?,
        raw_html = ?, payload_fingerprint = ?, parse_status = ?, parse_error = ?,
        suspicious_status = ?, suspicious_reasons_json = ?, parsed_confidence = ?,
        duration_minutes = ?, party_size = ?, party_json = ?, total_xp = ?, raw_total_xp = ?,
        xp_per_hour = ?, raw_xp_per_hour = ?, balance_gold = ?, profit_per_hour = ?,
        public_hunting_place_id = ?, hunting_place_confidence = ?, hunting_place_match_status = ?,
        hunting_place_match_reasons_json = ?, hunting_place_alternates_json = ?,
        hunting_place_match_provenance_json = ?, hunting_place_match_explanations_json = ?,
        hunting_place_match_attempted_at = ?, hunting_place_match_readiness = ?,
        hunting_place_match_readiness_reason = ?, hunting_place_noise_creatures_json = ?,
        review_status = CASE WHEN review_status IN ('ignored', 'accepted', 'rejected') THEN review_status ELSE ? END
      WHERE id = ?
    `).run(
      input.source_url,
      input.title,
      input.author_label,
      input.observed_at,
      input.refreshed_at,
      input.raw_html,
      input.payload_fingerprint,
      input.parse_status,
      input.parse_error,
      suspicious.length ? "suspicious" : "clear",
      JSON.stringify(suspicious),
      input.confidence,
      input.duration_minutes,
      input.party_size,
      JSON.stringify(input.party),
      input.total_xp,
      input.raw_total_xp,
      input.xp_per_hour,
      input.raw_xp_per_hour,
      input.balance_gold,
      input.profit_per_hour,
      selectedPlace,
      match.confidence,
      match.status,
      JSON.stringify(match.reasons),
      JSON.stringify(match.candidates),
      JSON.stringify(match.provenance),
      JSON.stringify(match.explanations),
      input.refreshed_at,
      match.readiness,
      match.readiness_reason,
      JSON.stringify(match.noise_creatures),
      reviewStatus,
      existing.id
    );
    replaceMonsters(db, existing.id, input.monsters);
    return existing.id;
  }

  const inserted = db.prepare(`
    INSERT INTO public_hunt_sessions (
      source, source_session_id, source_url, title, author_label, observed_at, imported_at, refreshed_at,
      raw_html, payload_fingerprint, parse_status, parse_error, review_status, suspicious_status,
      suspicious_reasons_json, parsed_confidence, duration_minutes, party_size, party_json, total_xp,
      raw_total_xp, xp_per_hour, raw_xp_per_hour, balance_gold, profit_per_hour, public_hunting_place_id,
      hunting_place_confidence, hunting_place_match_status, hunting_place_match_reasons_json,
      hunting_place_alternates_json, hunting_place_match_provenance_json, hunting_place_match_explanations_json,
      hunting_place_match_attempted_at, hunting_place_match_readiness, hunting_place_match_readiness_reason,
      hunting_place_noise_creatures_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    SOURCE,
    input.source_session_id,
    input.source_url,
    input.title,
    input.author_label,
    input.observed_at,
    input.imported_at,
    input.refreshed_at,
    input.raw_html,
    input.payload_fingerprint,
    input.parse_status,
    input.parse_error,
    reviewStatus,
    suspicious.length ? "suspicious" : "clear",
    JSON.stringify(suspicious),
    input.confidence,
    input.duration_minutes,
    input.party_size,
    JSON.stringify(input.party),
    input.total_xp,
    input.raw_total_xp,
    input.xp_per_hour,
    input.raw_xp_per_hour,
    input.balance_gold,
    input.profit_per_hour,
    selectedPlace,
    match.confidence,
    match.status,
    JSON.stringify(match.reasons),
    JSON.stringify(match.candidates),
    JSON.stringify(match.provenance),
    JSON.stringify(match.explanations),
    input.imported_at,
    match.readiness,
    match.readiness_reason,
    JSON.stringify(match.noise_creatures)
  );
  const id = Number(inserted.lastInsertRowid);
  replaceMonsters(db, id, input.monsters);
  return id;
}

function replaceMonsters(db: Database.Database, id: number, monsters: Array<{ name: string; count: number }>): void {
  db.prepare("DELETE FROM public_hunt_session_monsters WHERE public_hunt_session_id = ?").run(id);
  const insert = db.prepare(`
    INSERT INTO public_hunt_session_monsters (
      public_hunt_session_id, monster_name, normalized_monster_name, kill_count
    ) VALUES (?, ?, ?, ?)
  `);
  for (const monster of monsters) {
    insert.run(id, monster.name, normalizePublicName(monster.name), Math.max(0, Math.trunc(monster.count)));
  }
}

async function defaultFetch(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "TibiaMarketLocalImport/1.0" } });
  if (!response.ok) {
    throw new Error(`Hunt Analyser request failed ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function listUrl(page: number): string {
  return `${BASE_URL}${LIST_PATH}${page > 1 ? `&page=${page}` : ""}`;
}

function parseObjectJson(value: unknown): Record<string, unknown> {
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

function hasCompletedPublicHuntBackfill(db: Database.Database): boolean {
  const rows = db.prepare(`
    SELECT metadata_json
    FROM intelligence_jobs
    WHERE job_type = 'public-hunt-import'
      AND status = 'success'
    ORDER BY started_at DESC
    LIMIT 50
  `).all() as Array<{ metadata_json: string | null }>;
  return rows.some((row) => parseObjectJson(row.metadata_json).stop_reason === "end_of_pages");
}

function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DETAIL_CONCURRENCY;
  }
  return Math.min(12, Math.max(1, Math.trunc(value)));
}

async function runConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function checkPublicHunts(
  db: Database.Database,
  options: { limit?: number; fetcher?: Fetcher; throttleMs?: number; concurrency?: number; knownPageStopThreshold?: number } = {}
): Promise<{ ok: true; job: JobStatus; imported: number; discovered: number; skipped: number }> {
  const job = createPublicHuntImportJob(db, options);
  return runPublicHuntImportJob(db, job, options);
}

function createPublicHuntImportJob(
  db: Database.Database,
  options: { limit?: number; concurrency?: number } = {}
): JobStatus {
  if (publicHuntImportInProgress) {
    throw new Error("Public hunt import is already running");
  }
  publicHuntImportInProgress = true;
  const limit = options.limit === undefined ? undefined : Math.max(1, Math.trunc(options.limit));
  const concurrency = normalizeConcurrency(options.concurrency);
  const hasBackfill = hasCompletedPublicHuntBackfill(db);
  return startJob(db, {
    jobType: "public-hunt-import",
    entityType: "hunt",
    totalCount: limit ?? 0,
    cursor: { next_page: 1 },
    metadata: { source: SOURCE, manual: true, ai_train: false, detail_concurrency: concurrency, scope: limit === undefined ? hasBackfill ? "freshness_scan" : "backfill_scan" : "limited" }
  });
}

async function runPublicHuntImportJob(
  db: Database.Database,
  job: JobStatus,
  options: { limit?: number; fetcher?: Fetcher; throttleMs?: number; concurrency?: number; knownPageStopThreshold?: number } = {}
): Promise<{ ok: true; job: JobStatus; imported: number; discovered: number; skipped: number }> {
  const limit = options.limit === undefined ? undefined : Math.max(1, Math.trunc(options.limit));
  const fetcher = options.fetcher ?? defaultFetch;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const concurrency = normalizeConcurrency(options.concurrency);
  const knownPageStopThreshold = Math.max(1, Math.trunc(options.knownPageStopThreshold ?? DEFAULT_KNOWN_PAGE_STOP_THRESHOLD));
  const canStopAfterKnownPages = limit === undefined && hasCompletedPublicHuntBackfill(db);
  const scope = limit === undefined ? canStopAfterKnownPages ? "freshness_scan" : "backfill_scan" : "limited";
  let imported = 0;
  let skipped = 0;
  let discovered = 0;
  let attempted = 0;
  let knownOnlyPages = 0;
  let stopReason: string | undefined;
  let page = 1;
  let currentJob = job;
  try {
    while (limit === undefined || imported < limit) {
      const listHtml = await fetcher(listUrl(page));
      const list = parsePublicHuntList(listHtml);
      discovered += list.entries.length;
      const totalCount = limit ?? list.total_count ?? discovered;
      if (!list.entries.length) {
        break;
      }

      const entries = limit === undefined
        ? list.entries
        : list.entries.slice(0, Math.max(0, limit - imported));
      const newEntries: PublicHuntListEntry[] = [];
      for (const entry of entries) {
        const seen = db.prepare("SELECT id FROM public_hunt_sessions WHERE source = ? AND source_session_id = ?")
          .get(SOURCE, entry.source_session_id);
        if (seen) {
          skipped += 1;
          continue;
        }
        newEntries.push(entry);
      }
      knownOnlyPages = entries.length > 0 && newEntries.length === 0 ? knownOnlyPages + 1 : 0;

      const importedPage = await runConcurrent(newEntries, concurrency, async (entry) => {
        await delay(throttleMs);
        const detailHtml = await fetcher(entry.source_url);
        const parsed = parsePublicHuntDetail(detailHtml, entry.source_url, entry.source_session_id);
        const at = nowIso();
        upsertPublicHunt(db, {
          ...parsed,
          raw_html: detailHtml,
          payload_fingerprint: sha256(detailHtml),
          imported_at: at,
          refreshed_at: at
        });
        return { entry, parsed };
      });

      for (const item of importedPage) {
        imported += 1;
        attempted += 1;
        currentJob = updateJobProgress(db, job.id, {
          completedCount: imported,
          totalCount,
          currentEntity: { type: "hunt", id: item.entry.source_session_id, name: item.parsed.title },
          cursor: { next_page: page, last_source_session_id: item.entry.source_session_id },
          message: `Imported ${item.parsed.title}`
        });
      }

      if (!list.next_page || (limit !== undefined && imported >= limit)) {
        page = list.next_page ?? page;
        stopReason = !list.next_page ? "end_of_pages" : "limit_reached";
        break;
      }
      if (canStopAfterKnownPages && knownOnlyPages >= knownPageStopThreshold) {
        stopReason = "known_pages";
        currentJob = updateJobProgress(db, job.id, {
          completedCount: imported,
          totalCount,
          cursor: { next_page: list.next_page, stopped_after_known_pages: knownOnlyPages },
          metadata: { source_total_count: list.total_count, discovered, skipped, attempted, stop_reason: "known_pages" },
          message: `Stopped after ${knownOnlyPages} known public hunt page(s).`
        });
        break;
      }
      page = list.next_page;
      currentJob = updateJobProgress(db, job.id, {
        completedCount: imported,
        totalCount,
        cursor: { next_page: page },
        metadata: { source_total_count: list.total_count, discovered, skipped, attempted }
      });
      await delay(throttleMs);
    }
    currentJob = finishJob(db, job.id, "success", {
      completedCount: imported,
      metadata: {
        imported,
        skipped,
        discovered,
        next_page: page,
        detail_concurrency: concurrency,
        scope,
        stop_reason: stopReason
      }
    });
    return { ok: true, job: currentJob, imported, discovered, skipped };
  } catch (error) {
    currentJob = finishJob(db, job.id, "error", { error, completedCount: imported, metadata: { imported, skipped, discovered, next_page: page, detail_concurrency: concurrency } });
    return { ok: true, job: currentJob, imported, discovered, skipped };
  } finally {
    publicHuntImportInProgress = false;
  }
}

export function startPublicHuntImport(
  db: Database.Database,
  options: { limit?: number; concurrency?: number } = {}
): JobStatus {
  const job = createPublicHuntImportJob(db, options);
  void runPublicHuntImportJob(db, job, options).catch(() => {
    // The job record captures background failures.
  });
  return job;
}

function parseArray(value: unknown): unknown[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function monstersForPublicHunt(db: Database.Database, id: number): Array<{ name: string; normalized_name: string; count: number }> {
  return (db.prepare(`
    SELECT monster_name AS name, normalized_monster_name AS normalized_name, kill_count AS count
    FROM public_hunt_session_monsters
    WHERE public_hunt_session_id = ?
    ORDER BY kill_count DESC, monster_name
  `).all(id) as Array<{ name: string; normalized_name: string; count: number }>);
}

function rowToPublicHunt(db: Database.Database, row: PublicHuntRow): Record<string, unknown> {
  const candidates = parseArray(row.hunting_place_alternates_json);
  const bestCandidate = asRecord(candidates[0]);
  const currentHuntingPlace = row.public_hunting_place_id
    ? {
      id: row.public_hunting_place_id,
      name: row.matched_hunting_place_name ?? null,
      location: row.matched_hunting_place_location ?? null,
      source: "matched"
    }
    : bestCandidate
      ? {
        id: asNumber(bestCandidate.id, 0) || null,
        name: asText(bestCandidate.name) || null,
        location: asText(bestCandidate.location) || null,
        confidence: bestCandidate.confidence_detail ?? bestCandidate.confidence ?? null,
        source: "best_guess"
      }
      : null;
  const displayStatus = row.review_status === "ignored"
    ? "ignored"
    : row.suspicious_status === "suspicious"
      ? "suspicious"
      : row.public_hunting_place_id
        ? "matched"
        : row.hunting_place_match_status === "review"
          ? "needs review"
          : row.hunting_place_match_status || row.review_status;
  return {
    ...row,
    party: parseArray(row.party_json),
    suspicious_reasons: parseArray(row.suspicious_reasons_json),
    monsters: monstersForPublicHunt(db, row.id),
    display_status: displayStatus,
    matched_hunting_place: row.public_hunting_place_id ? {
      id: row.public_hunting_place_id,
      name: row.matched_hunting_place_name ?? null,
      location: row.matched_hunting_place_location ?? null
    } : null,
    current_hunting_place: currentHuntingPlace,
    match: {
      public_hunting_place_id: row.public_hunting_place_id,
      confidence: buildConfidence(row.hunting_place_confidence, { estimated: true }),
      status: row.hunting_place_match_status,
      readiness: row.hunting_place_match_readiness,
      readiness_reason: row.hunting_place_match_readiness_reason,
      reasons: parseArray(row.hunting_place_match_reasons_json),
      candidates,
      explanations: parseArray(row.hunting_place_match_explanations_json),
      noise_creatures: parseArray(row.hunting_place_noise_creatures_json)
    },
    confidence: buildConfidence(row.parsed_confidence, { estimated: true }),
    provenance: [provenance("public_hunt_import", { source_id: row.source_session_id, imported_at: row.imported_at })]
  };
}

export function getPublicHuntStatus(db: Database.Database): Record<string, unknown> {
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN review_status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN review_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN review_status = 'ignored' THEN 1 ELSE 0 END) AS ignored,
      SUM(CASE WHEN suspicious_status = 'suspicious' THEN 1 ELSE 0 END) AS suspicious,
      SUM(CASE WHEN public_hunting_place_id IS NOT NULL THEN 1 ELSE 0 END) AS matched
    FROM public_hunt_sessions
  `).get() as Record<string, number | null>;
  const latest = db.prepare("SELECT MAX(refreshed_at) AS latest FROM public_hunt_sessions").get() as { latest: string | null };
  return {
    ok: true,
    source: SOURCE,
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value || 0)])),
    freshness: buildFreshness(latest.latest, { staleAfterHours: 24 * 14, missingDataReason: "No public hunts imported yet." }),
    jobs: summarizeJobs(db, ["public-hunt-import"]),
    policy: {
      manual_only: true,
      ai_train: false,
      note: "Manual factual import from public pages; not used for model training."
    }
  };
}

export function listPublicHuntReviewQueue(db: Database.Database, limit = 500): Record<string, unknown> {
  const rows = db.prepare(`
    SELECT
      session.*,
      place.name AS matched_hunting_place_name,
      place.location AS matched_hunting_place_location
    FROM public_hunt_sessions session
    LEFT JOIN public_hunting_places place
      ON place.id = session.public_hunting_place_id
    WHERE session.review_status NOT IN ('ignored', 'accepted')
      AND session.public_hunting_place_id IS NULL
    ORDER BY
      CASE
        WHEN session.review_status = 'needs_review' OR session.suspicious_status = 'suspicious' THEN 0
        WHEN session.review_status = 'accepted' THEN 1
        ELSE 2
      END,
      session.refreshed_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.trunc(limit))) as PublicHuntRow[];
  return { ok: true, items: rows.map((row) => rowToPublicHunt(db, row)) };
}

export function reviewPublicHunt(db: Database.Database, idInput: unknown, payload: unknown): Record<string, unknown> {
  const id = Math.max(0, Math.trunc(asNumber(idInput, 0)));
  const body = asRecord(payload) ?? {};
  const action = asText(body.action);
  const note = asText(body.note).trim() || null;
  const placeId = asNumber(body.public_hunting_place_id ?? body.publicHuntingPlaceId, 0);
  const row = db.prepare("SELECT * FROM public_hunt_sessions WHERE id = ?").get(id) as PublicHuntRow | undefined;
  if (!row) {
    return { ok: false, error: "Public hunt not found." };
  }
  const reviewedAt = nowIso();
  if (action === "accept_match") {
    const candidates = parseArray(row.hunting_place_alternates_json)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry));
    const candidateFromList = Math.trunc(asNumber(candidates[0]?.id, 0)) || null;
    const candidateId = row.public_hunting_place_id ?? candidateFromList;
    db.prepare(`
      UPDATE public_hunt_sessions
      SET public_hunting_place_id = COALESCE(?, public_hunting_place_id),
        hunting_place_match_status = CASE WHEN ? IS NOT NULL THEN 'manual' ELSE hunting_place_match_status END,
        hunting_place_match_readiness = CASE WHEN ? IS NOT NULL THEN 'manual' ELSE hunting_place_match_readiness END,
        review_status = 'accepted',
        suspicious_status = 'clear',
        last_reviewed_at = ?,
        review_note = ?
      WHERE id = ?
    `).run(candidateId, candidateId, candidateId, reviewedAt, note, id);
  } else if (action === "choose_place" && placeId > 0) {
    db.prepare(`
      UPDATE public_hunt_sessions
      SET public_hunting_place_id = ?, hunting_place_match_status = 'manual', hunting_place_match_readiness = 'manual',
        hunting_place_confidence = 1, review_status = 'accepted', suspicious_status = 'clear',
        last_reviewed_at = ?, review_note = ?
      WHERE id = ?
    `).run(Math.trunc(placeId), reviewedAt, note, id);
  } else if (action === "mark_unmatched") {
    db.prepare(`
      UPDATE public_hunt_sessions
      SET public_hunting_place_id = NULL, hunting_place_match_status = 'unmatched', hunting_place_match_readiness = 'unmatched',
        review_status = 'rejected', last_reviewed_at = ?, review_note = ?
      WHERE id = ?
    `).run(reviewedAt, note, id);
  } else if (action === "mark_suspicious") {
    db.prepare("UPDATE public_hunt_sessions SET suspicious_status = 'suspicious', review_status = 'needs_review', last_reviewed_at = ?, review_note = ? WHERE id = ?")
      .run(reviewedAt, note, id);
  } else if (action === "ignore") {
    db.prepare("UPDATE public_hunt_sessions SET review_status = 'ignored', last_reviewed_at = ?, review_note = ? WHERE id = ?")
      .run(reviewedAt, note, id);
  } else {
    return { ok: false, error: "Unsupported public hunt review action." };
  }
  const updated = db.prepare("SELECT * FROM public_hunt_sessions WHERE id = ?").get(id) as PublicHuntRow;
  return { ok: true, item: rowToPublicHunt(db, updated) };
}

export function reprocessPublicHunts(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare("SELECT * FROM public_hunt_sessions WHERE review_status != 'ignored' ORDER BY refreshed_at DESC").all() as PublicHuntRow[];
  let updated = 0;
  for (const row of rows) {
    const monsters = db.prepare("SELECT monster_name AS name, kill_count AS count FROM public_hunt_session_monsters WHERE public_hunt_session_id = ?")
      .all(row.id) as Array<{ name: string; count: number }>;
    const parsed: ParsedPublicHunt = {
      source_session_id: row.source_session_id,
      source_url: row.source_url,
      title: row.title,
      author_label: row.author_label,
      observed_at: row.observed_at,
      duration_minutes: row.duration_minutes,
      party_size: row.party_size,
      party: parseArray(row.party_json).map((entry) => asRecord(entry) ?? {}).map((entry) => ({ vocation: asText(entry.vocation), level: entry.level === null ? null : asNumber(entry.level, 0) || null })),
      total_xp: row.total_xp,
      raw_total_xp: row.raw_total_xp,
      xp_per_hour: row.xp_per_hour,
      raw_xp_per_hour: row.raw_xp_per_hour,
      balance_gold: row.balance_gold,
      profit_per_hour: row.profit_per_hour,
      monsters,
      confidence: row.parsed_confidence,
      parse_status: row.parse_status === "error" ? "error" : row.parse_status === "partial" ? "partial" : "parsed",
      parse_error: row.parse_error
    };
    const match = matchHuntToHuntingPlaces(db, toParsedHuntText(parsed), {
      locationName: row.title,
      characterLevel: parsed.party.map((entry) => entry.level).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
      sourceType: "public_hunt_import"
    });
    const selectedPlace = match.status === "auto" ? match.selected_hunting_place_id : row.public_hunting_place_id;
    db.prepare(`
      UPDATE public_hunt_sessions
      SET public_hunting_place_id = ?, hunting_place_confidence = ?, hunting_place_match_status = ?,
        hunting_place_match_reasons_json = ?, hunting_place_alternates_json = ?,
        hunting_place_match_provenance_json = ?, hunting_place_match_explanations_json = ?,
        hunting_place_match_attempted_at = ?, hunting_place_match_readiness = ?,
        hunting_place_match_readiness_reason = ?, hunting_place_noise_creatures_json = ?,
        review_status = CASE WHEN review_status = 'accepted' THEN review_status WHEN ? = 'auto' THEN 'accepted' ELSE 'needs_review' END
      WHERE id = ?
    `).run(
      selectedPlace,
      match.confidence,
      match.status,
      JSON.stringify(match.reasons),
      JSON.stringify(match.candidates),
      JSON.stringify(match.provenance),
      JSON.stringify(match.explanations),
      nowIso(),
      match.readiness,
      match.readiness_reason,
      JSON.stringify(match.noise_creatures),
      match.status,
      row.id
    );
    updated += 1;
  }
  return { ok: true, reprocessed: updated };
}
