import type Database from "better-sqlite3";
import { config } from "../../config";
import type { ItemDetailCacheRow } from "./types";
import {
  asBooleanInt,
  asNumberOrNull,
  asRecord,
  firstNumber,
  firstText,
  normalizeLootItemName,
  nowIso
} from "./utils";

const ITEM_DETAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TIBIA_DATA_ITEM_BASE_URL = "https://tibiadata.bytewizards.de/api/v1/items";

type FetchLike = typeof fetch;
let itemDetailFetch: FetchLike = fetch;

export function setItemDetailFetchForTests(fetchImpl: FetchLike): void {
  itemDetailFetch = fetchImpl;
}

export function resetItemDetailFetchForTests(): void {
  itemDetailFetch = fetch;
}

function isFreshIso(value: string | null, ttlMs: number): boolean {
  if (!value) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Date.now() - parsed < ttlMs;
}

function weightFromText(value: unknown): number | null {
  const text = typeof value === "string" ? value : "";
  if (!text) {
    return null;
  }

  const patterns = [
    /\bweight\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:oz)?\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*oz\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const number = asNumberOrNull(match?.[1]);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

export function getCachedItemDetail(db: Database.Database, normalizedName: string): ItemDetailCacheRow | null {
  try {
    return db
      .prepare(
        `
        SELECT
          normalized_name,
          requested_name,
          actual_name,
          plural,
          category_slug,
          category_name,
          stackable,
          marketable,
          npc_price,
          npc_value,
          value,
          weight_oz,
          wiki_url,
          payload_json,
          last_fetched_at
        FROM item_detail_cache
        WHERE normalized_name = ?
      `
      )
      .get(normalizedName) as ItemDetailCacheRow | undefined ?? null;
  } catch {
    return null;
  }
}

function itemPayloadFromResponse(payload: Record<string, unknown>): Record<string, unknown> {
  return asRecord(payload.item)
    ?? asRecord(payload.data)
    ?? asRecord(payload.result)
    ?? payload;
}

function infoboxFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const itemPayload = itemPayloadFromResponse(payload);
  return asRecord(itemPayload.structuredData)?.infobox
    ? asRecord(asRecord(itemPayload.structuredData)?.infobox) ?? {}
    : asRecord(itemPayload.infobox) ?? {};
}

function infoboxFieldsFromPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const infobox = infoboxFromPayload(payload);
  return asRecord(infobox.fields) ?? {};
}

function extractItemWeightOz(payload: Record<string, unknown>): number | null {
  const itemPayload = itemPayloadFromResponse(payload);
  const infobox = infoboxFromPayload(payload);
  const fields = infoboxFieldsFromPayload(payload);

  return firstNumber(
    itemPayload.weight,
    itemPayload.weightOz,
    itemPayload.weight_oz,
    itemPayload.Weight,
    infobox.weight,
    infobox.Weight,
    fields.weight,
    fields.Weight,
    weightFromText(itemPayload.plainTextContent),
    weightFromText(itemPayload.rawWikiText),
    weightFromText(infobox.plainTextContent),
    weightFromText(infobox.rawWikiText)
  );
}

export function extractItemDetailRow(requestedName: string, payload: Record<string, unknown>): ItemDetailCacheRow {
  const normalizedName = normalizeLootItemName(requestedName);
  const itemPayload = itemPayloadFromResponse(payload);
  const infobox = infoboxFromPayload(payload);
  const fields = infoboxFieldsFromPayload(payload);

  return {
    normalized_name: normalizedName,
    requested_name: requestedName,
    actual_name: firstText(
      itemPayload.actualName,
      itemPayload.name,
      infobox.actualName,
      infobox.name,
      fields.actualName,
      fields.name
    ),
    plural: firstText(itemPayload.plural, infobox.plural, fields.plural),
    category_slug: firstText(itemPayload.categorySlug, itemPayload.category_slug),
    category_name: firstText(itemPayload.categoryName, itemPayload.category_name, infobox.category, fields.category),
    stackable: asBooleanInt(itemPayload.stackable ?? infobox.stackable ?? fields.stackable),
    marketable: asBooleanInt(itemPayload.marketable ?? infobox.marketable ?? fields.marketable),
    npc_price: firstNumber(itemPayload.npcPrice, itemPayload.npc_price, infobox.npcPrice, fields.npcPrice),
    npc_value: firstNumber(itemPayload.npcValue, itemPayload.npc_value, infobox.npcValue, fields.npcValue),
    value: firstNumber(itemPayload.value, infobox.value, fields.value),
    weight_oz: extractItemWeightOz(payload),
    wiki_url: firstText(itemPayload.wikiUrl, itemPayload.wiki_url, payload.wikiUrl, payload.wiki_url),
    payload_json: JSON.stringify(payload),
    last_fetched_at: nowIso()
  };
}

function singularizeSimple(name: string): string {
  if (name.endsWith("ies") && name.length > 3) {
    return `${name.slice(0, -3)}y`;
  }
  if (name.endsWith("s") && !name.endsWith("ss") && name.length > 1) {
    return name.slice(0, -1);
  }
  return name;
}

function refreshCachedItemDetailFromPayload(
  db: Database.Database,
  cached: ItemDetailCacheRow
): ItemDetailCacheRow | null {
  try {
    const payload = JSON.parse(cached.payload_json) as Record<string, unknown>;
    return saveItemDetail(db, cached.requested_name || cached.normalized_name, payload);
  } catch {
    return cached;
  }
}

export function saveItemDetail(
  db: Database.Database,
  requestedName: string,
  payload: Record<string, unknown>
): ItemDetailCacheRow {
  const detail = extractItemDetailRow(requestedName, payload);
  db.prepare(
    `
    INSERT INTO item_detail_cache (
      normalized_name,
      requested_name,
      actual_name,
      plural,
      category_slug,
      category_name,
      stackable,
      marketable,
      npc_price,
      npc_value,
      value,
      weight_oz,
      wiki_url,
      payload_json,
      last_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET
      requested_name = excluded.requested_name,
      actual_name = excluded.actual_name,
      plural = excluded.plural,
      category_slug = excluded.category_slug,
      category_name = excluded.category_name,
      stackable = excluded.stackable,
      marketable = excluded.marketable,
      npc_price = excluded.npc_price,
      npc_value = excluded.npc_value,
      value = excluded.value,
      weight_oz = excluded.weight_oz,
      wiki_url = excluded.wiki_url,
      payload_json = excluded.payload_json,
      last_fetched_at = excluded.last_fetched_at
  `
  ).run(
    detail.normalized_name,
    detail.requested_name,
    detail.actual_name,
    detail.plural,
    detail.category_slug,
    detail.category_name,
    detail.stackable,
    detail.marketable,
    detail.npc_price,
    detail.npc_value,
    detail.value,
    detail.weight_oz,
    detail.wiki_url,
    detail.payload_json,
    detail.last_fetched_at
  );
  return detail;
}

async function fetchItemDetail(db: Database.Database, itemName: string): Promise<ItemDetailCacheRow | null> {
  const normalizedName = normalizeLootItemName(itemName);
  const cached = getCachedItemDetail(db, normalizedName);
  if (cached) {
    const refreshedCached = cached.weight_oz === null ? refreshCachedItemDetailFromPayload(db, cached) : cached;
    if (refreshedCached && isFreshIso(refreshedCached.last_fetched_at, ITEM_DETAIL_CACHE_TTL_MS)) {
      return refreshedCached;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const candidates = Array.from(new Set([normalizedName, singularizeSimple(normalizedName)].filter(Boolean)));
    for (const candidate of candidates) {
      const response = await itemDetailFetch(`${TIBIA_DATA_ITEM_BASE_URL}/${encodeURIComponent(candidate)}`, {
        signal: controller.signal
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json() as Record<string, unknown>;
      return saveItemDetail(db, normalizedName, payload);
    }
    return cached;
  } catch {
    return cached;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAndCacheItemDetail(
  db: Database.Database,
  itemName: string
): Promise<ItemDetailCacheRow | null> {
  return fetchItemDetail(db, itemName);
}

export async function hydrateHuntItemDetails(
  db: Database.Database,
  itemNames: string[]
): Promise<{ ok: true; items: Array<{ name: string; normalized_name: string; item_detail: ItemDetailCacheRow | null }> }> {
  const uniqueNames = Array.from(
    new Map(
      itemNames
        .map((name) => (typeof name === "string" ? name : "").trim())
        .filter(Boolean)
        .map((name) => [normalizeLootItemName(name), name])
    ).values()
  );
  const items: Array<{ name: string; normalized_name: string; item_detail: ItemDetailCacheRow | null }> = [];
  let cursor = 0;
  const concurrency = 3;

  async function worker(): Promise<void> {
    while (cursor < uniqueNames.length) {
      const name = uniqueNames[cursor];
      cursor += 1;
      const normalizedName = normalizeLootItemName(name);
      const itemDetail = await fetchAndCacheItemDetail(db, name);
      items.push({
        name,
        normalized_name: normalizedName,
        item_detail: itemDetail
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueNames.length) }, () => worker()));
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, items };
}
