import fs from "node:fs";
import type Database from "better-sqlite3";
import { config } from "../../config";
import {
  extractHuntTextsFromLogFile,
  huntSessionSignatureFromRaw,
  isInsideDirectory,
  parseHuntSessionText,
  rawTextHash,
  readHuntLogFiles
} from "./parser";
import type { HuntInput } from "./types";
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

function buildHuntInput(payload: unknown): HuntInput {
  const row = asRecord(payload) ?? {};
  const rawText = asText(row.raw_text).replace(/<\/??hunt>/gi, "").trim();
  const parsedText = rawText.trim() ? parseHuntSessionText(rawText) : null;
  const fallbackTotalXp = asNumber(row.total_xp, parsedText?.total_xp ?? 0);
  const fallbackRawTotalXp = parsedText?.raw_total_xp ?? fallbackTotalXp;
  const monsters = parsedText?.monsters ?? [];
  const lootItems = parsedText?.loot_items ?? [];
  const processedJson = JSON.stringify({
    parsed: parsedText,
    monsters,
    loot_items: lootItems,
    processed_at: nowIso()
  });

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
    tags: coerceTags(row.tags),
    excluded_item_names: coerceExcludedItemNames(row.excluded_item_names),
    raw_text: rawText,
    processed_json: processedJson,
    raw_text_hash: rawTextHash(rawText)
  };
}

export function createHuntUpload(db: Database.Database, payload: unknown): Record<string, unknown> {
  const input = buildHuntInput(payload);
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
        boost_factor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      computeBoostFactor(input.raw_total_xp, input.total_xp)
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

  const input = buildHuntInput(payload);
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
        boost_factor = ?
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
        boost_factor
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
        boost_factor
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

  return {
    ...preview,
    saved_hunt: {
      id: asNumber(row.id, 0),
      label: asText(row.label),
      uploaded_at: asText(row.uploaded_at)
    }
  };
}
