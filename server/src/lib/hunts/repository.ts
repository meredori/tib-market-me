import fs from "node:fs";
import type Database from "better-sqlite3";
import { config } from "../../config";
import { getKnownCharacter } from "../tibiadata/characters";
import {
  extractHuntTextsFromLogFile,
  huntSessionSignatureFromRaw,
  isInsideDirectory,
  parseHuntSessionText,
  rawTextHash,
  readHuntLogFiles
} from "./parser";
import type { HuntInput } from "./types";
import { matchHuntToHuntingPlaces } from "./huntingPlaceMatcher";
import {
  asNumber,
  asNumberOrNull,
  asRecord,
  asText,
  coerceExcludedItemNames,
  coerceTags,
  firstText,
  normalizeLootItemName,
  nowIso,
  sha256,
  toIsoOrNull
} from "./utils";

export type BuildPreview = (payload: unknown) => Promise<Record<string, unknown>>;

export function computeBoostFactor(rawTotalXp: number, totalXp: number): number | null {
  if (rawTotalXp <= 0 || totalXp <= 0) {
    return null;
  }
  return Number((totalXp / rawTotalXp).toFixed(4));
}

function monsterSignature(monsters: Array<{ name: string; count: number }>): Array<{ name: string; pct: number }> {
  const total = monsters.reduce((acc, monster) => acc + Math.max(0, monster.count), 0);
  if (total <= 0) {
    return [];
  }
  return monsters
    .map((monster) => ({
      name: normalizeLootItemName(monster.name),
      pct: Math.max(0, monster.count) / total
    }))
    .filter((monster) => monster.name && monster.pct > 0)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);
}

function cleanDisplayText(value: unknown): string {
  return asText(value)
    .replace(/\{\{\s*Mapper Coords\|[^}]*\}\}/gi, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/[,\s]+$/g, "")
    .trim();
}

function signatureSimilarity(
  a: Array<{ name: string; pct: number }>,
  b: Array<{ name: string; pct: number }>
): number {
  const bByName = new Map(b.map((entry) => [entry.name, entry.pct]));
  let overlap = 0;
  for (const entry of a) {
    overlap += Math.min(entry.pct, bByName.get(entry.name) ?? 0);
  }
  return Number(overlap.toFixed(4));
}

export function suggestLocation(
  db: Database.Database,
  monsters: Array<{ name: string; count: number }>
): { name: string | null; confidence: number; needs_setup: boolean } {
  const signature = monsterSignature(monsters);
  if (!signature.length) {
    return { name: null, confidence: 0, needs_setup: true };
  }

  const rows = db
    .prepare("SELECT name, monster_signature_json FROM hunt_locations ORDER BY updated_at DESC")
    .all() as Array<Record<string, unknown>>;

  let best = { name: null as string | null, confidence: 0 };
  for (const row of rows) {
    try {
      const stored = JSON.parse(asText(row.monster_signature_json)) as Array<{ name: string; pct: number }>;
      const confidence = signatureSimilarity(signature, stored);
      if (confidence > best.confidence) {
        best = { name: asText(row.name), confidence };
      }
    } catch {
      // Ignore malformed learned signatures.
    }
  }

  return best.confidence >= 0.72
    ? { ...best, needs_setup: false }
    : { name: null, confidence: best.confidence, needs_setup: true };
}

function saveLocationSignature(
  db: Database.Database,
  locationName: string | null,
  monsters: Array<{ name: string; count: number }>
): void {
  const name = asText(locationName).trim();
  const signature = monsterSignature(monsters);
  if (!name || !signature.length) {
    return;
  }
  db.prepare(
    `
    INSERT INTO hunt_locations (name, monster_signature_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      monster_signature_json = excluded.monster_signature_json,
      updated_at = excluded.updated_at
  `
  ).run(name, JSON.stringify(signature), nowIso());
}

export function existingHuntsByImportIdentity(db: Database.Database): {
  byHash: Map<string, Record<string, unknown>>;
  bySignature: Map<string, Record<string, unknown>>;
} {
  const rows = db
    .prepare(
      `
      SELECT id, label, uploaded_at, raw_text, raw_text_hash
      FROM hunt_uploads
      WHERE raw_text_hash IS NOT NULL OR raw_text != ''
    `
    )
    .all() as Array<Record<string, unknown>>;

  const byHash = new Map<string, Record<string, unknown>>();
  const bySignature = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const rawText = asText(row.raw_text);
    const hash = asText(row.raw_text_hash) || rawTextHash(rawText);
    if (hash) {
      byHash.set(hash, row);
    }
    const signature = huntSessionSignatureFromRaw(rawText);
    if (signature) {
      bySignature.set(signature, row);
    }
  }

  return { byHash, bySignature };
}

function findExistingHuntByInput(db: Database.Database, input: HuntInput): Record<string, unknown> | null {
  const rawHash = input.raw_text_hash || rawTextHash(input.raw_text);
  const signature = huntSessionSignatureFromRaw(input.raw_text);
  const identities = existingHuntsByImportIdentity(db);
  return (rawHash ? identities.byHash.get(rawHash) : null)
    ?? (signature ? identities.bySignature.get(signature) : null)
    ?? null;
}

function ignoredHuntLogImports(db: Database.Database): Set<string> {
  const rows = db
    .prepare("SELECT import_key FROM hunt_log_import_ignores")
    .all() as Array<Record<string, unknown>>;

  return new Set(rows.map((row) => asText(row.import_key)).filter(Boolean));
}

function findHuntLogFileForImportKey(importKey: string): { path: string; name: string; modified_at: string } | null {
  for (const file of readHuntLogFiles(config.tibiaLogDir)) {
    try {
      const texts = extractHuntTextsFromLogFile(file.path);
      if (texts.some((text) => rawTextHash(text) === importKey)) {
        return file;
      }
    } catch {
      // Ignore malformed files while locating the source for a specific import.
    }
  }
  return null;
}

function positiveIdOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = asNumberOrNull(value);
  return parsed && parsed > 0 ? Math.trunc(parsed) : null;
}

export async function listHuntLogImportCandidates(
  db: Database.Database,
  buildPreview: BuildPreview
): Promise<Record<string, unknown>> {
  const importedIdentity = existingHuntsByImportIdentity(db);
  const ignoredKeys = ignoredHuntLogImports(db);
  const files = readHuntLogFiles(config.tibiaLogDir);
  const seen = new Set<string>();
  const candidates: Array<Record<string, unknown>> = [];

  for (const file of files) {
    try {
      const texts = extractHuntTextsFromLogFile(file.path);
      for (let index = 0; index < texts.length; index += 1) {
        const rawText = texts[index].replace(/<\/??hunt>/gi, "").trim();
        const hash = rawTextHash(rawText);
        if (!rawText || seen.has(hash)) {
          continue;
        }
        seen.add(hash);
        const signature = huntSessionSignatureFromRaw(rawText);
        const imported = importedIdentity.byHash.get(hash)
          ?? (signature ? importedIdentity.bySignature.get(signature) : null)
          ?? null;
        const ignored = ignoredKeys.has(hash);
        const preview = await buildPreview({ raw_text: rawText });

        candidates.push({
          import_key: hash,
          file_name: file.name,
          file_path: file.path,
          file_modified_at: file.modified_at,
          file_hunt_index: index,
          imported: Boolean(imported),
          ignored,
          imported_hunt: imported
            ? {
              id: asNumber(imported.id, 0),
              label: asText(imported.label),
              uploaded_at: asText(imported.uploaded_at)
            }
            : null,
          preview,
          raw_text: rawText
        });
      }
    } catch (error) {
      candidates.push({
        import_key: sha256(`${file.path}:${file.modified_at}`),
        file_name: file.name,
        file_path: file.path,
        file_modified_at: file.modified_at,
        imported: false,
        ignored: false,
        error: String(error)
      });
    }
  }

  return {
    ok: true,
    log_dir: config.tibiaLogDir,
    candidates,
    summary: {
      files_scanned: files.length,
      total_candidates: candidates.length,
      pending_candidates: candidates.filter((candidate) => !candidate.imported && !candidate.ignored && !candidate.error).length,
      already_imported: candidates.filter((candidate) => candidate.imported).length,
      ignored: candidates.filter((candidate) => candidate.ignored).length,
      errored: candidates.filter((candidate) => candidate.error).length
    }
  };
}

export function ignoreHuntLogImport(db: Database.Database, payload: unknown): Record<string, unknown> {
  const row = asRecord(payload) ?? {};
  const importKey = asText(row.import_key).trim();
  if (!/^[a-f0-9]{64}$/i.test(importKey)) {
    throw new Error("Invalid import key");
  }

  const file = findHuntLogFileForImportKey(importKey);
  db.prepare(
    `
    INSERT INTO hunt_log_import_ignores (import_key, file_path, file_name, ignored_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(import_key) DO UPDATE SET
      file_path = excluded.file_path,
      file_name = excluded.file_name,
      ignored_at = excluded.ignored_at
  `
  ).run(importKey, file?.path ?? "", file?.name ?? "", nowIso());

  return { ok: true, import_key: importKey };
}

export function deleteHuntLogImportFile(db: Database.Database, payload: unknown): Record<string, unknown> {
  const row = asRecord(payload) ?? {};
  const importKey = asText(row.import_key).trim();
  if (!/^[a-f0-9]{64}$/i.test(importKey)) {
    throw new Error("Invalid import key");
  }

  const file = findHuntLogFileForImportKey(importKey);
  if (!file) {
    throw new Error("Log file not found");
  }
  if (!isInsideDirectory(config.tibiaLogDir, file.path)) {
    throw new Error("Refusing to delete a file outside the Tibia log folder");
  }

  fs.unlinkSync(file.path);
  db.prepare("DELETE FROM hunt_log_import_ignores WHERE import_key = ?").run(importKey);
  return { ok: true, deleted_file: file.path, import_key: importKey };
}

function buildHuntInput(db: Database.Database, payload: unknown): HuntInput {
  const row = asRecord(payload) ?? {};
  const rawText = asText(row.raw_text).replace(/<\/??hunt>/gi, "").trim();
  const parsedText = rawText.trim() ? parseHuntSessionText(rawText) : null;
  const fallbackTotalXp = asNumber(row.total_xp, parsedText?.total_xp ?? 0);
  const fallbackRawTotalXp = parsedText?.raw_total_xp ?? fallbackTotalXp;
  const monsters = parsedText?.monsters ?? [];
  const lootItems = parsedText?.loot_items ?? [];
  const matchMode = asText(row.hunting_place_match_mode ?? row.match_mode).trim() === "mixed_route"
    ? "mixed_route"
    : "auto";
  const processedJson = JSON.stringify({
    parsed: parsedText,
    monsters,
    loot_items: lootItems,
    processed_at: nowIso()
  });
  const manualHuntingPlaceId = positiveIdOrNull(row.public_hunting_place_id ?? row.hunting_place_id);
  const characterName = asText(row.character_name).trim() || null;
  const characterVocation = asText(row.character_vocation).trim();
  const characterWorld = asText(row.character_world).trim();
  const knownCharacter = characterName ? getKnownCharacter(db, characterName) : null;

  return {
    label: asText(row.label).trim() || parsedText?.label || "Untitled Hunt",
    duration_minutes: Math.max(1, Math.round(asNumber(row.duration_minutes, parsedText?.duration_minutes ?? 1))),
    raw_total_xp: Math.max(0, Math.round(asNumber(row.raw_total_xp, fallbackRawTotalXp))),
    total_xp: Math.max(0, Math.round(fallbackTotalXp)),
    total_loot_gold: Math.max(0, Math.round(asNumber(row.total_loot_gold, parsedText?.total_loot_gold ?? 0))),
    total_supply_cost: Math.max(0, Math.round(asNumber(row.total_supply_cost, parsedText?.total_supply_cost ?? 0))),
    started_at: parsedText?.started_at ?? toIsoOrNull(row.started_at),
    ended_at: parsedText?.ended_at ?? toIsoOrNull(row.ended_at),
    location_name: asText(row.location_name).trim() || null,
    character_name: knownCharacter?.name ?? characterName,
    character_vocation: characterVocation || (knownCharacter?.vocation ?? null),
    character_level: asNumberOrNull(row.character_level) ?? knownCharacter?.level ?? null,
    character_world: characterWorld || (knownCharacter?.world ?? null),
    character_lookup_at: toIsoOrNull(row.character_lookup_at) ?? knownCharacter?.fetched_at ?? null,
    public_hunting_place_id: manualHuntingPlaceId,
    hunting_place_confidence: 0,
    hunting_place_match_status: manualHuntingPlaceId ? "manual" : "unmatched",
    hunting_place_match_reasons_json: "[]",
    hunting_place_alternates_json: "[]",
    hunting_place_match_provenance_json: "[]",
    hunting_place_match_explanations_json: "[]",
    hunting_place_match_attempted_at: null,
    hunting_place_match_mode: matchMode,
    hunting_place_match_readiness: manualHuntingPlaceId ? "manual" : "unmatched",
    hunting_place_match_readiness_reason: null,
    hunting_place_noise_creatures_json: "[]",
    hunting_place_match_manual: manualHuntingPlaceId ? 1 : 0,
    tags: coerceTags(row.tags),
    excluded_item_names: coerceExcludedItemNames(row.excluded_item_names),
    raw_text: rawText,
    processed_json: processedJson,
    raw_text_hash: rawTextHash(rawText)
  };
}

function applyHuntingPlaceMatch(db: Database.Database, input: HuntInput): HuntInput {
  const processed = JSON.parse(input.processed_json) as Record<string, unknown>;
  const parsed = asRecord(processed.parsed) as import("./types").ParsedHuntText | null;
  const match = matchHuntToHuntingPlaces(db, parsed, {
    locationName: input.location_name,
    characterLevel: input.character_level,
    manualHuntingPlaceId: input.public_hunting_place_id,
    mode: input.hunting_place_match_mode === "mixed_route" ? "mixed_route" : "auto"
  });

  input.public_hunting_place_id = match.selected_hunting_place_id;
  input.hunting_place_confidence = match.confidence;
  input.hunting_place_match_status = match.status;
  input.hunting_place_match_reasons_json = JSON.stringify(match.reasons);
  input.hunting_place_alternates_json = JSON.stringify(match.candidates);
  input.hunting_place_match_provenance_json = JSON.stringify(match.provenance);
  input.hunting_place_match_explanations_json = JSON.stringify(match.explanations);
  input.hunting_place_match_attempted_at = nowIso();
  input.hunting_place_match_readiness = match.readiness;
  input.hunting_place_match_readiness_reason = match.readiness_reason;
  input.hunting_place_noise_creatures_json = JSON.stringify(match.noise_creatures);
  input.hunting_place_match_manual = match.status === "manual" || match.status === "mixed_route" ? 1 : 0;

  if (!input.location_name && match.selected_hunting_place_name) {
    input.location_name = match.selected_hunting_place_name;
  }

  return input;
}

export function createHuntUpload(db: Database.Database, payload: unknown): Record<string, unknown> {
  const input = applyHuntingPlaceMatch(db, buildHuntInput(db, payload));
  const row = asRecord(payload) ?? {};

  if (asText(row.source) === "log_import") {
    const existing = findExistingHuntByInput(db, input);
    if (existing) {
      const huntId = asNumber(existing.id, 0);
      return {
        ...(getHuntUploadRow(db, huntId) ?? normalizeHuntRow(existing)),
        duplicate: true
      };
    }
  }

  const inserted = db
    .prepare(
      `
      INSERT INTO hunt_uploads (
        label,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        tags_json,
        excluded_items_json,
        raw_text,
        processed_json,
        raw_text_hash,
        location_name,
        boost_factor,
        character_name,
        character_vocation,
        character_level,
        character_world,
        character_lookup_at,
        public_hunting_place_id,
        hunting_place_confidence,
        hunting_place_match_status,
        hunting_place_match_reasons_json,
        hunting_place_alternates_json,
        hunting_place_match_provenance_json,
        hunting_place_match_explanations_json,
        hunting_place_match_attempted_at,
        hunting_place_match_mode,
        hunting_place_match_readiness,
        hunting_place_match_readiness_reason,
        hunting_place_noise_creatures_json,
        hunting_place_match_manual
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.label,
      input.duration_minutes,
      input.raw_total_xp,
      input.total_xp,
      input.total_loot_gold,
      input.total_supply_cost,
      input.started_at,
      input.ended_at,
      JSON.stringify(input.tags),
      JSON.stringify(input.excluded_item_names),
      input.raw_text,
      input.processed_json,
      input.raw_text_hash,
      input.location_name,
      computeBoostFactor(input.raw_total_xp, input.total_xp),
      input.character_name,
      input.character_vocation,
      input.character_level,
      input.character_world,
      input.character_lookup_at,
      input.public_hunting_place_id,
      input.hunting_place_confidence,
      input.hunting_place_match_status,
      input.hunting_place_match_reasons_json,
      input.hunting_place_alternates_json,
      input.hunting_place_match_provenance_json,
      input.hunting_place_match_explanations_json,
      input.hunting_place_match_attempted_at,
      input.hunting_place_match_mode,
      input.hunting_place_match_readiness,
      input.hunting_place_match_readiness_reason,
      input.hunting_place_noise_creatures_json,
      input.hunting_place_match_manual
    );
  saveLocationSignature(db, input.location_name, JSON.parse(input.processed_json).monsters ?? []);

  return getHuntUploadRow(db, Number(inserted.lastInsertRowid)) ?? normalizeHuntRow({});
}

export function updateHuntUpload(
  db: Database.Database,
  huntId: number,
  payload: unknown
): Record<string, unknown> | null {
  if (!Number.isFinite(huntId) || huntId <= 0) {
    throw new Error("Invalid hunt id");
  }

  const input = applyHuntingPlaceMatch(db, buildHuntInput(db, payload));
  const updated = db
    .prepare(
      `
      UPDATE hunt_uploads
      SET
        label = ?,
        duration_minutes = ?,
        raw_total_xp = ?,
        total_xp = ?,
        total_loot_gold = ?,
        total_supply_cost = ?,
        started_at = ?,
        ended_at = ?,
        tags_json = ?,
        excluded_items_json = ?,
        raw_text = ?,
        processed_json = ?,
        raw_text_hash = ?,
        location_name = ?,
        boost_factor = ?,
        character_name = ?,
        character_vocation = ?,
        character_level = ?,
        character_world = ?,
        character_lookup_at = ?,
        public_hunting_place_id = ?,
        hunting_place_confidence = ?,
        hunting_place_match_status = ?,
        hunting_place_match_reasons_json = ?,
        hunting_place_alternates_json = ?,
        hunting_place_match_provenance_json = ?,
        hunting_place_match_explanations_json = ?,
        hunting_place_match_attempted_at = ?,
        hunting_place_match_mode = ?,
        hunting_place_match_readiness = ?,
        hunting_place_match_readiness_reason = ?,
        hunting_place_noise_creatures_json = ?,
        hunting_place_match_manual = ?
      WHERE id = ?
    `
    )
    .run(
      input.label,
      input.duration_minutes,
      input.raw_total_xp,
      input.total_xp,
      input.total_loot_gold,
      input.total_supply_cost,
      input.started_at,
      input.ended_at,
      JSON.stringify(input.tags),
      JSON.stringify(input.excluded_item_names),
      input.raw_text,
      input.processed_json,
      input.raw_text_hash,
      input.location_name,
      computeBoostFactor(input.raw_total_xp, input.total_xp),
      input.character_name,
      input.character_vocation,
      input.character_level,
      input.character_world,
      input.character_lookup_at,
      input.public_hunting_place_id,
      input.hunting_place_confidence,
      input.hunting_place_match_status,
      input.hunting_place_match_reasons_json,
      input.hunting_place_alternates_json,
      input.hunting_place_match_provenance_json,
      input.hunting_place_match_explanations_json,
      input.hunting_place_match_attempted_at,
      input.hunting_place_match_mode,
      input.hunting_place_match_readiness,
      input.hunting_place_match_readiness_reason,
      input.hunting_place_noise_creatures_json,
      input.hunting_place_match_manual,
      Math.trunc(huntId)
    );

  if (updated.changes === 0) {
    return null;
  }

  saveLocationSignature(db, input.location_name, JSON.parse(input.processed_json).monsters ?? []);
  return getHuntUploadRow(db, Math.trunc(huntId));
}

export function deleteHuntUpload(db: Database.Database, huntId: number): boolean {
  if (!Number.isFinite(huntId) || huntId <= 0) {
    throw new Error("Invalid hunt id");
  }

  const deleted = db.prepare("DELETE FROM hunt_uploads WHERE id = ?").run(Math.trunc(huntId));
  return deleted.changes > 0;
}

export type HuntRematchMode = "suggest_only" | "auto_apply" | "replace_non_manual";

function storeHuntingPlaceMatch(
  db: Database.Database,
  huntId: number,
  match: ReturnType<typeof matchHuntToHuntingPlaces>,
  mode: HuntRematchMode,
  existingPlaceId: number | null
): void {
  let selectedId = existingPlaceId;
  let status = match.status;
  let readiness = match.readiness;

  if (mode === "suggest_only") {
    status = match.status === "auto" ? "review" : match.status;
    readiness = match.readiness === "auto" ? "review" : match.readiness;
  } else if (mode === "auto_apply") {
    selectedId = match.status === "auto" ? match.selected_hunting_place_id : existingPlaceId;
  } else {
    selectedId = match.selected_hunting_place_id;
  }

  db.prepare(
    `
    UPDATE hunt_uploads
    SET
      public_hunting_place_id = ?,
      hunting_place_confidence = ?,
      hunting_place_match_status = ?,
      hunting_place_match_reasons_json = ?,
      hunting_place_alternates_json = ?,
      hunting_place_match_provenance_json = ?,
      hunting_place_match_explanations_json = ?,
      hunting_place_match_attempted_at = ?,
      hunting_place_match_mode = ?,
      hunting_place_match_readiness = ?,
      hunting_place_match_readiness_reason = ?,
      hunting_place_noise_creatures_json = ?,
      hunting_place_match_manual = 0
    WHERE id = ?
  `
  ).run(
    selectedId,
    match.confidence,
    status,
    JSON.stringify(mode === "suggest_only" ? ["suggested only", ...match.reasons] : match.reasons),
    JSON.stringify(match.candidates),
    JSON.stringify(match.provenance),
    JSON.stringify(match.explanations),
    nowIso(),
    mode,
    readiness,
    match.readiness_reason,
    JSON.stringify(match.noise_creatures),
    huntId
  );
}

function rowParsedHunt(row: Record<string, unknown>): import("./types").ParsedHuntText {
  const rawText = asText(row.raw_text);
  if (rawText.trim()) {
    return parseHuntSessionText(rawText);
  }
  throw new Error("Hunt has no raw text to rematch");
}

export function rematchHuntUpload(
  db: Database.Database,
  huntId: number,
  mode: HuntRematchMode = "suggest_only"
): Record<string, unknown> | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        raw_text,
        location_name,
        character_level,
        public_hunting_place_id,
        hunting_place_match_manual,
        hunting_place_match_status
      FROM hunt_uploads
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(Math.trunc(huntId)) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }
  if (asNumber(row.hunting_place_match_manual, 0) === 1) {
    return {
      ok: true,
      skipped: true,
      reason: "existing match preserved",
      item: getHuntUploadRow(db, Math.trunc(huntId))
    };
  }

  const match = matchHuntToHuntingPlaces(db, rowParsedHunt(row), {
    locationName: asText(row.location_name).trim() || null,
    characterLevel: asNumberOrNull(row.character_level)
  });
  storeHuntingPlaceMatch(db, Math.trunc(huntId), match, mode, positiveIdOrNull(row.public_hunting_place_id));
  return {
    ok: true,
    skipped: false,
    mode,
    item: getHuntUploadRow(db, Math.trunc(huntId))
  };
}

export function rematchHuntUploads(
  db: Database.Database,
  mode: HuntRematchMode = "suggest_only"
): Record<string, unknown> {
  const rows = db
    .prepare(
      `
      SELECT id
      FROM hunt_uploads
      WHERE hunting_place_match_manual = 0
        AND (
          hunting_place_match_status IN ('unmatched', 'review', 'blocked')
          OR public_hunting_place_id IS NULL
          OR (location_name IS NOT NULL AND TRIM(location_name) != '')
        )
      ORDER BY uploaded_at DESC, id DESC
    `
    )
    .all() as Array<Record<string, unknown>>;

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const items: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    try {
      const result = rematchHuntUpload(db, asNumber(row.id, 0), mode);
      if (result?.skipped) {
        skipped += 1;
      } else if (result?.item) {
        processed += 1;
        items.push(result.item as Record<string, unknown>);
      }
    } catch {
      failed += 1;
    }
  }

  return {
    ok: true,
    mode,
    summary: {
      candidates: rows.length,
      processed,
      skipped,
      failed
    },
    items
  };
}

export function searchHuntingPlaces(db: Database.Database, query: string): Record<string, unknown> {
  const normalizedQuery = normalizeLootItemName(query).replace(/%/g, "").trim();
  const like = `%${normalizedQuery}%`;
  const rows = db
    .prepare(
      `
      SELECT
        place.id,
        place.name,
        place.normalized_name,
        place.location,
        place.min_level,
        place.max_level,
        place.detail_status,
        COALESCE((
          SELECT COUNT(*)
          FROM public_hunting_place_creatures creature
          WHERE creature.hunting_place_id = place.id
        ), 0) AS creature_count
      FROM public_hunting_places place
      WHERE ? = '' OR place.normalized_name LIKE ? OR LOWER(COALESCE(place.location, '')) LIKE ?
      ORDER BY
        CASE WHEN place.normalized_name = ? THEN 0 ELSE 1 END,
        place.name
      LIMIT 80
    `
    )
    .all(normalizedQuery, like, like, normalizedQuery) as Array<Record<string, unknown>>;

  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 3);
  function score(row: Record<string, unknown>): number {
    const haystack = normalizeLootItemName(`${asText(row.normalized_name)} ${asText(row.location)}`);
    if (!normalizedQuery) {
      return 0;
    }
    if (asText(row.normalized_name) === normalizedQuery) {
      return 1;
    }
    if (haystack.includes(normalizedQuery)) {
      return 0.85;
    }
    const matched = queryTokens.filter((token) => haystack.includes(token)).length;
    return queryTokens.length ? Math.min(0.8, matched / queryTokens.length) : 0;
  }

  return {
    ok: true,
    items: rows
      .map((row) => ({ row, confidence: score(row) }))
      .sort((a, b) => b.confidence - a.confidence || asText(a.row.name).localeCompare(asText(b.row.name)))
      .slice(0, 30)
      .map(({ row, confidence }) => ({
      id: asNumber(row.id, 0),
      name: cleanDisplayText(row.name),
      normalized_name: asText(row.normalized_name),
      location: cleanDisplayText(row.location) || null,
      min_level: asNumberOrNull(row.min_level),
      max_level: asNumberOrNull(row.max_level),
      detail_status: asText(row.detail_status) || "pending",
      creature_count: asNumber(row.creature_count, 0),
      confidence: Number(confidence.toFixed(4))
    }))
  };
}

function getHuntUploadRow(db: Database.Database, huntId: number): Record<string, unknown> | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        label,
        uploaded_at,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        tags_json,
        excluded_items_json,
        location_name,
        location_confidence,
        boost_factor,
        character_name,
        character_vocation,
        character_level,
        character_world,
        character_lookup_at,
        public_hunting_place_id,
        hunting_place_confidence,
        hunting_place_match_status,
        hunting_place_match_reasons_json,
        hunting_place_alternates_json,
        hunting_place_match_provenance_json,
        hunting_place_match_explanations_json,
        hunting_place_match_attempted_at,
        hunting_place_match_mode,
        hunting_place_match_readiness,
        hunting_place_match_readiness_reason,
        hunting_place_noise_creatures_json,
        hunting_place_match_manual
      FROM hunt_uploads
      WHERE id = ?
    `
    )
    .get(huntId) as Record<string, unknown> | undefined;

  return row ? normalizeHuntRow(row) : null;
}

function normalizeHuntRow(row: Record<string, unknown>): Record<string, unknown> {
  const durationMinutes = Math.max(1, asNumber(row.duration_minutes, 1));
  const totalXp = Math.max(0, asNumber(row.total_xp, 0));
  const rawTotalXp = Math.max(0, asNumber(row.raw_total_xp, totalXp));
  const totalLoot = Math.max(0, asNumber(row.total_loot_gold, 0));
  const totalSupply = Math.max(0, asNumber(row.total_supply_cost, 0));
  const netProfit = totalLoot - totalSupply;
  const hours = durationMinutes / 60;

  let tags: string[] = [];
  if (typeof row.tags_json === "string") {
    try {
      const parsed = JSON.parse(row.tags_json);
      if (Array.isArray(parsed)) {
        tags = parsed.map((entry) => asText(entry)).filter(Boolean);
      }
    } catch {
      tags = [];
    }
  }

  let excludedItemNames: string[] = [];
  if (typeof row.excluded_items_json === "string") {
    try {
      excludedItemNames = coerceExcludedItemNames(JSON.parse(row.excluded_items_json));
    } catch {
      excludedItemNames = [];
    }
  }

  let matchReasons: string[] = [];
  if (typeof row.hunting_place_match_reasons_json === "string") {
    try {
      const parsed = JSON.parse(row.hunting_place_match_reasons_json);
      matchReasons = Array.isArray(parsed) ? parsed.map((entry) => asText(entry)).filter(Boolean) : [];
    } catch {
      matchReasons = [];
    }
  }

  let matchCandidates: Array<Record<string, unknown>> = [];
  if (typeof row.hunting_place_alternates_json === "string") {
    try {
      const parsed = JSON.parse(row.hunting_place_alternates_json);
      matchCandidates = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      matchCandidates = [];
    }
  }

  let matchProvenance: Array<Record<string, unknown>> = [];
  if (typeof row.hunting_place_match_provenance_json === "string") {
    try {
      const parsed = JSON.parse(row.hunting_place_match_provenance_json);
      matchProvenance = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      matchProvenance = [];
    }
  }

  let matchExplanations: Array<Record<string, unknown>> = [];
  if (typeof row.hunting_place_match_explanations_json === "string") {
    try {
      const parsed = JSON.parse(row.hunting_place_match_explanations_json);
      matchExplanations = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      matchExplanations = [];
    }
  }

  let noiseCreatures: string[] = [];
  if (typeof row.hunting_place_noise_creatures_json === "string") {
    try {
      const parsed = JSON.parse(row.hunting_place_noise_creatures_json);
      noiseCreatures = Array.isArray(parsed) ? parsed.map((entry) => asText(entry)).filter(Boolean) : [];
    } catch {
      noiseCreatures = [];
    }
  }

  return {
    id: asNumber(row.id, 0),
    label: asText(row.label),
    uploaded_at: asText(row.uploaded_at),
    duration_minutes: durationMinutes,
    raw_total_xp: rawTotalXp,
    total_xp: totalXp,
    total_loot_gold: totalLoot,
    total_supply_cost: totalSupply,
    net_profit: netProfit,
    xp_per_hour: Math.round(totalXp / hours),
    raw_xp_per_hour: Math.round(rawTotalXp / hours),
    gold_per_hour: Math.round(netProfit / hours),
    started_at: row.started_at ?? null,
    ended_at: row.ended_at ?? null,
    location_name: row.location_name ?? null,
    location_confidence: asNumber(row.location_confidence, 0),
    boost_factor: row.boost_factor ?? computeBoostFactor(rawTotalXp, totalXp),
    character_name: row.character_name ?? null,
    character_vocation: row.character_vocation ?? null,
    character_level: asNumberOrNull(row.character_level),
    character_world: row.character_world ?? null,
    character_lookup_at: row.character_lookup_at ?? null,
    hunting_place_match: {
      selected_hunting_place_id: positiveIdOrNull(row.public_hunting_place_id),
      confidence: asNumber(row.hunting_place_confidence, 0),
      status: asText(row.hunting_place_match_status) || "unmatched",
      manual: asNumber(row.hunting_place_match_manual, 0) === 1,
      attempted_at: row.hunting_place_match_attempted_at ?? null,
      mode: asText(row.hunting_place_match_mode) || "auto",
      readiness: asText(row.hunting_place_match_readiness) || asText(row.hunting_place_match_status) || "unmatched",
      readiness_reason: row.hunting_place_match_readiness_reason ?? null,
      reasons: matchReasons,
      explanations: matchExplanations,
      provenance: matchProvenance,
      candidates: matchCandidates,
      noise_creatures: noiseCreatures
    },
    tags,
    excluded_item_names: excludedItemNames
  };
}

export function listHuntUploads(db: Database.Database): Record<string, unknown> {
  const rows = db
    .prepare(
      `
      SELECT
        id,
        label,
        uploaded_at,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        tags_json,
        excluded_items_json,
        location_name,
        location_confidence,
        boost_factor,
        character_name,
        character_vocation,
        character_level,
        character_world,
        character_lookup_at,
        public_hunting_place_id,
        hunting_place_confidence,
        hunting_place_match_status,
        hunting_place_match_reasons_json,
        hunting_place_alternates_json,
        hunting_place_match_provenance_json,
        hunting_place_match_explanations_json,
        hunting_place_match_attempted_at,
        hunting_place_match_mode,
        hunting_place_match_readiness,
        hunting_place_match_readiness_reason,
        hunting_place_noise_creatures_json,
        hunting_place_match_manual
      FROM hunt_uploads
      ORDER BY uploaded_at DESC, id DESC
    `
    )
    .all() as Array<Record<string, unknown>>;

  const items = rows.map(normalizeHuntRow);
  const topByXpm = [...items].sort((a, b) => Number(b.xp_per_hour) - Number(a.xp_per_hour))[0] ?? null;
  const topByGpm = [...items].sort((a, b) => Number(b.gold_per_hour) - Number(a.gold_per_hour))[0] ?? null;

  return {
    items,
    summary: {
      total_hunts: items.length,
      top_xpm: topByXpm,
      top_gpm: topByGpm
    }
  };
}

export async function listHuntingAreaSummaries(
  db: Database.Database,
  buildPreview: BuildPreview
): Promise<Record<string, unknown>> {
  const rows = db
    .prepare(
      `
      SELECT
        id,
        label,
        duration_minutes,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        raw_text,
        excluded_items_json,
        location_name
      FROM hunt_uploads
      WHERE location_name IS NOT NULL AND TRIM(location_name) != ''
      ORDER BY uploaded_at DESC, id DESC
    `
    )
    .all() as Array<Record<string, unknown>>;

  const areas = new Map<string, {
    location_name: string;
    hunt_count: number;
    total_duration_minutes: number;
    total_xp: number;
    total_net_profit: number;
    best_xp_per_hour: number;
    best_gp_per_hour: number;
    drops: Map<string, {
      name: string;
      quantity: number;
      total_value: number;
      unit_value: number;
      item_id: number | null;
      value_source: string | null;
    }>;
  }>();

  for (const row of rows) {
    const locationName = asText(row.location_name).trim();
    if (!locationName) {
      continue;
    }
    const durationMinutes = Math.max(1, asNumber(row.duration_minutes, 1));
    const hours = durationMinutes / 60;
    const totalXp = Math.max(0, asNumber(row.total_xp, 0));
    const netProfit = Math.max(0, asNumber(row.total_loot_gold, 0)) - Math.max(0, asNumber(row.total_supply_cost, 0));
    const area = areas.get(locationName) ?? {
      location_name: locationName,
      hunt_count: 0,
      total_duration_minutes: 0,
      total_xp: 0,
      total_net_profit: 0,
      best_xp_per_hour: 0,
      best_gp_per_hour: 0,
      drops: new Map()
    };

    area.hunt_count += 1;
    area.total_duration_minutes += durationMinutes;
    area.total_xp += totalXp;
    area.total_net_profit += netProfit;
    area.best_xp_per_hour = Math.max(area.best_xp_per_hour, Math.round(totalXp / hours));
    area.best_gp_per_hour = Math.max(area.best_gp_per_hour, Math.round(netProfit / hours));

    try {
      const excludedItemNames = typeof row.excluded_items_json === "string"
        ? coerceExcludedItemNames(JSON.parse(row.excluded_items_json))
        : [];
      const preview = await buildPreview({
        raw_text: row.raw_text,
        excluded_item_names: excludedItemNames,
        location_name: locationName
      });
      for (const item of (preview.loot_items as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.excluded) {
          continue;
        }
        const name = asText(item.name).trim();
        if (!name) {
          continue;
        }
        const key = normalizeLootItemName(name);
        const existing = area.drops.get(key) ?? {
          name,
          quantity: 0,
          total_value: 0,
          unit_value: 0,
          item_id: asNumberOrNull(item.item_id),
          value_source: firstText(item.value_source)
        };
        const quantity = Math.max(0, asNumber(item.quantity, 0));
        const totalValue = Math.max(0, asNumber(item.total_value, 0));
        const unitValue = Math.max(0, asNumber(item.unit_value, quantity > 0 ? totalValue / quantity : 0));
        existing.quantity += quantity;
        existing.total_value += totalValue;
        existing.unit_value = Math.max(existing.unit_value, unitValue);
        if (!existing.item_id) {
          existing.item_id = asNumberOrNull(item.item_id);
        }
        if (!existing.value_source) {
          existing.value_source = firstText(item.value_source);
        }
        area.drops.set(key, existing);
      }
    } catch {
      // A malformed historical raw_text should not block the area overview.
    }

    areas.set(locationName, area);
  }

  const items = Array.from(areas.values())
    .map((area) => {
      const hours = Math.max(area.total_duration_minutes / 60, 1 / 60);
      return {
        location_name: area.location_name,
        hunt_count: area.hunt_count,
        total_duration_minutes: area.total_duration_minutes,
        average_xp_per_hour: Math.round(area.total_xp / hours),
        average_gp_per_hour: Math.round(area.total_net_profit / hours),
        best_xp_per_hour: area.best_xp_per_hour,
        best_gp_per_hour: area.best_gp_per_hour,
        valuable_drops: Array.from(area.drops.values())
          .filter((drop) => drop.unit_value > 0 && drop.item_id)
          .sort((a, b) => b.unit_value - a.unit_value || b.total_value - a.total_value)
          .slice(0, 4)
      };
    })
    .sort((a, b) => b.average_gp_per_hour - a.average_gp_per_hour);

  return { ok: true, items };
}

export async function listGlobalLootSummary(
  db: Database.Database,
  buildPreview: BuildPreview
): Promise<Record<string, unknown>> {
  const rows = db
    .prepare(
      `
      SELECT
        id,
        raw_text,
        excluded_items_json,
        location_name
      FROM hunt_uploads
      ORDER BY uploaded_at DESC, id DESC
    `
    )
    .all() as Array<Record<string, unknown>>;

  const drops = new Map<string, {
    name: string;
    quantity: number;
    total_value: number;
    unit_value: number;
    item_id: number | null;
    value_source: string | null;
    hunt_count: number;
  }>();

  let parsedHunts = 0;
  for (const row of rows) {
    try {
      const excludedItemNames = typeof row.excluded_items_json === "string"
        ? coerceExcludedItemNames(JSON.parse(row.excluded_items_json))
        : [];
      const preview = await buildPreview({
        raw_text: row.raw_text,
        excluded_item_names: excludedItemNames,
        location_name: row.location_name
      });
      parsedHunts += 1;
      const seenInHunt = new Set<string>();
      for (const item of (preview.loot_items as Array<Record<string, unknown>> | undefined) ?? []) {
        if (item.excluded) {
          continue;
        }
        const name = asText(item.name).trim();
        if (!name) {
          continue;
        }
        const key = normalizeLootItemName(name);
        const existing = drops.get(key) ?? {
          name,
          quantity: 0,
          total_value: 0,
          unit_value: 0,
          item_id: asNumberOrNull(item.item_id),
          value_source: firstText(item.value_source),
          hunt_count: 0
        };
        const quantity = Math.max(0, asNumber(item.quantity, 0));
        const totalValue = Math.max(0, asNumber(item.total_value, 0));
        const unitValue = Math.max(0, asNumber(item.unit_value, quantity > 0 ? totalValue / quantity : 0));
        existing.quantity += quantity;
        existing.total_value += totalValue;
        existing.unit_value = Math.max(existing.unit_value, unitValue);
        if (!existing.item_id) {
          existing.item_id = asNumberOrNull(item.item_id);
        }
        if (!existing.value_source) {
          existing.value_source = firstText(item.value_source);
        }
        if (!seenInHunt.has(key)) {
          existing.hunt_count += 1;
          seenInHunt.add(key);
        }
        drops.set(key, existing);
      }
    } catch {
      // A malformed historical raw_text should not block the global loot overview.
    }
  }

  const items = Array.from(drops.values())
    .sort((a, b) => b.total_value - a.total_value || b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, 20);

  return {
    ok: true,
    items,
    summary: {
      total_hunts: rows.length,
      parsed_hunts: parsedHunts,
      total_items: drops.size
    }
  };
}

export async function getHuntUploadPreview(
  db: Database.Database,
  huntId: number,
  buildPreviewFromParsed: (
    parsed: import("./types").ParsedHuntText,
    rawText: string,
    excludedItemNames: string[],
    explicitLocationName: string | null
  ) => Promise<Record<string, unknown>>,
  buildPreview: BuildPreview
): Promise<Record<string, unknown> | null> {
  const row = db
    .prepare(
      `
      SELECT
        id,
        label,
        uploaded_at,
        raw_text,
        processed_json,
        location_name,
        character_name,
        character_vocation,
        character_level,
        character_world,
        character_lookup_at,
        public_hunting_place_id,
        hunting_place_confidence,
        hunting_place_match_status,
        hunting_place_match_reasons_json,
        hunting_place_alternates_json,
        hunting_place_match_provenance_json,
        hunting_place_match_explanations_json,
        hunting_place_match_attempted_at,
        hunting_place_match_mode,
        hunting_place_match_readiness,
        hunting_place_match_readiness_reason,
        hunting_place_noise_creatures_json,
        hunting_place_match_manual,
        tags_json,
        excluded_items_json
      FROM hunt_uploads
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(Math.trunc(huntId)) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  let excludedItemNames: string[] = [];
  if (typeof row.excluded_items_json === "string") {
    try {
      excludedItemNames = coerceExcludedItemNames(JSON.parse(row.excluded_items_json));
    } catch {
      excludedItemNames = [];
    }
  }
  let parsed: import("./types").ParsedHuntText | null = null;
  if (typeof row.processed_json === "string" && row.processed_json.trim()) {
    try {
      const processed = JSON.parse(row.processed_json) as Record<string, unknown>;
      const processedParsed = asRecord(processed.parsed);
      if (processedParsed) {
        parsed = {
          label: firstText(processedParsed.label),
          duration_minutes: asNumberOrNull(processedParsed.duration_minutes),
          raw_total_xp: asNumberOrNull(processedParsed.raw_total_xp),
          total_xp: asNumberOrNull(processedParsed.total_xp),
          total_loot_gold: asNumberOrNull(processedParsed.total_loot_gold),
          total_supply_cost: asNumberOrNull(processedParsed.total_supply_cost),
          started_at: firstText(processedParsed.started_at),
          ended_at: firstText(processedParsed.ended_at),
          hunt_date: firstText(processedParsed.hunt_date),
          monsters: Array.isArray(processedParsed.monsters)
            ? processedParsed.monsters as Array<{ name: string; count: number }>
            : Array.isArray(processed.monsters)
              ? processed.monsters as Array<{ name: string; count: number }>
              : [],
          loot_items: Array.isArray(processedParsed.loot_items)
            ? processedParsed.loot_items as Array<{ name: string; quantity: number; normalized_name: string }>
            : Array.isArray(processed.loot_items)
              ? processed.loot_items as Array<{ name: string; quantity: number; normalized_name: string }>
              : []
        };
      }
    } catch {
      parsed = null;
    }
  }

  const rawText = asText(row.raw_text);
  const preview = parsed
    ? await buildPreviewFromParsed(parsed, rawText, excludedItemNames, asText(row.location_name).trim() || null)
    : await buildPreview({
      raw_text: rawText,
      excluded_item_names: excludedItemNames,
      location_name: row.location_name
    });

  const normalized = normalizeHuntRow(row);
  return {
    ...preview,
    location: {
      ...(asRecord(preview.location) ?? {}),
      hunting_place_match: normalized.hunting_place_match
    },
    saved_hunt: {
      id: asNumber(row.id, 0),
      label: asText(row.label),
      uploaded_at: asText(row.uploaded_at),
      character_name: row.character_name ?? null,
      character_vocation: row.character_vocation ?? null,
      character_level: asNumberOrNull(row.character_level),
      character_world: row.character_world ?? null,
      character_lookup_at: row.character_lookup_at ?? null,
      hunting_place_match: normalized.hunting_place_match
    }
  };
}
