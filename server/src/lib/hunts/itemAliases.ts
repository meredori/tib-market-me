import type Database from "better-sqlite3";
import { getItemDetails } from "../sync/updatePrices";
import { normalizeLootItemName, nowIso } from "./utils";

function ensureItemMetadata(db: Database.Database, itemId: number, rawName: string): void {
  const now = nowIso();
  const payload = {
    id: itemId,
    name: rawName,
    source: "manual_alias"
  };
  db.prepare(
    `
    INSERT INTO item_metadata (item_id, name, wiki_name, category, tier, raw_payload_json, payload_hash, fetched_at, updated_at)
    VALUES (?, ?, ?, NULL, -1, ?, NULL, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      name = COALESCE(item_metadata.name, excluded.name),
      wiki_name = COALESCE(item_metadata.wiki_name, excluded.wiki_name),
      updated_at = excluded.updated_at
  `
  ).run(itemId, rawName, rawName, JSON.stringify(payload), now, now);
}

export function setItemAlias(
  db: Database.Database,
  input: { raw_name: string; item_id: number }
): Record<string, unknown> {
  const rawName = input.raw_name.trim();
  const normalizedName = normalizeLootItemName(rawName);
  const itemId = Math.trunc(Number(input.item_id));

  if (!rawName || !normalizedName) {
    throw new Error("raw_name is required");
  }
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new Error("item_id must be a positive number");
  }

  let item = getItemDetails(db, itemId);
  if (!item) {
    ensureItemMetadata(db, itemId, rawName);
    item = {
      id: itemId,
      name: rawName,
      wiki_name: rawName,
      image_path: `/items/${itemId}.png`,
      client_value: null
    };
  }

  db.prepare(
    `
    INSERT INTO item_aliases (normalized_name, raw_name, item_id, source, updated_at)
    VALUES (?, ?, ?, 'manual', CURRENT_TIMESTAMP)
    ON CONFLICT(normalized_name) DO UPDATE SET
      raw_name = excluded.raw_name,
      item_id = excluded.item_id,
      source = excluded.source,
      updated_at = excluded.updated_at
  `
  ).run(normalizedName, rawName, itemId);

  return {
    normalized_name: normalizedName,
    raw_name: rawName,
    item_id: itemId,
    item
  };
}
