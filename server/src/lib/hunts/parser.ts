import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import type { ParsedHuntText } from "./types";
import {
  asNumber,
  asRecord,
  asText,
  normalizeLootItemName,
  sha256
} from "./utils";

export const HUNT_LOG_IMPORT_LIMIT = 120;

function parseNumberToken(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseLineValue(raw: string, label: string): number | null {
  const rx = new RegExp(`^\\s*${label}:\\s*([\\d,]+)\\s*$`, "im");
  const match = raw.match(rx);
  return parseNumberToken(match?.[1] ?? null);
}

function sortedCountRows(rows: Array<{ name: string; count: number }>): Array<{ name: string; count: number }> {
  return rows
    .map((row) => ({
      name: normalizeLootItemName(row.name),
      count: Math.max(0, Math.round(asNumber(row.count, 0)))
    }))
    .filter((row) => row.name && row.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.count - b.count);
}

function sortedLootRows(
  rows: Array<{ name: string; quantity: number; normalized_name?: string }>
): Array<{ name: string; quantity: number }> {
  return rows
    .map((row) => ({
      name: normalizeLootItemName(row.normalized_name || row.name),
      quantity: Math.max(0, Math.round(asNumber(row.quantity, 0)))
    }))
    .filter((row) => row.name && row.quantity > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.quantity - b.quantity);
}

export function rawTextHash(rawText: string): string {
  return sha256(rawText.replace(/<\/??hunt>/gi, "").trim());
}

export function huntSessionSignature(parsed: ParsedHuntText | null): string | null {
  if (!parsed) {
    return null;
  }

  return sha256(JSON.stringify({
    duration_minutes: Math.max(0, Math.round(asNumber(parsed.duration_minutes, 0))),
    raw_total_xp: Math.max(0, Math.round(asNumber(parsed.raw_total_xp, 0))),
    total_xp: Math.max(0, Math.round(asNumber(parsed.total_xp, 0))),
    total_loot_gold: Math.max(0, Math.round(asNumber(parsed.total_loot_gold, 0))),
    total_supply_cost: Math.max(0, Math.round(asNumber(parsed.total_supply_cost, 0))),
    started_at: parsed.started_at ?? null,
    ended_at: parsed.ended_at ?? null,
    monsters: sortedCountRows(parsed.monsters),
    loot_items: sortedLootRows(parsed.loot_items)
  }));
}

export function huntSessionSignatureFromRaw(rawText: string): string | null {
  const cleaned = rawText.replace(/<\/??hunt>/gi, "").trim();
  if (!cleaned) {
    return null;
  }
  try {
    return huntSessionSignature(parseHuntSessionText(cleaned));
  } catch {
    return null;
  }
}

export function parseCountedSection(raw: string, header: string): Array<{ name: string; count: number }> {
  const lines = raw.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === `${header.toLowerCase()}:`);
  if (startIndex < 0) {
    return [];
  }

  const out: Array<{ name: string; count: number }> = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    if (/^\S.+:\s*$/.test(line)) {
      break;
    }
    const match = line.match(/^\s*([\d,]+)x\s+(.+?)\s*$/i);
    if (!match) {
      continue;
    }
    const count = parseNumberToken(match[1]);
    const name = asText(match[2]).trim().toLowerCase();
    if (count === null || count <= 0 || !name) {
      continue;
    }
    out.push({ name, count });
  }
  return out;
}

function toIsoFromDateTimeParts(datePart: string, timePart: string): string | null {
  const raw = `${datePart}T${timePart}`;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function pluralizeMonster(name: string, count: number): string {
  if (count <= 1) {
    return name;
  }
  if (name.endsWith("s")) {
    return name;
  }
  if (name.endsWith("y") && name.length > 1) {
    const beforeY = name[name.length - 2].toLowerCase();
    const vowel = beforeY === "a" || beforeY === "e" || beforeY === "i" || beforeY === "o" || beforeY === "u";
    if (!vowel) {
      return `${name.slice(0, -1)}ies`;
    }
  }
  return `${name}s`;
}

function detectTopMonsterName(raw: string): string | null {
  const kills = parseCountedSection(raw, "Killed Monsters");
  if (!kills.length) {
    return null;
  }
  const top = [...kills].sort((a, b) => b.count - a.count)[0];
  return pluralizeMonster(top.name, top.count);
}

export function parseHuntSessionText(rawText: string): ParsedHuntText {
  const cleaned = rawText.replace(/<\/?hunt>/gi, "").trim();
  const sessionMatch = cleaned.match(
    /Session data:\s*From\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2}:\d{2})\s*to\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2}:\d{2})/i
  );
  const startedAt = sessionMatch ? toIsoFromDateTimeParts(sessionMatch[1], sessionMatch[2]) : null;
  const endedAt = sessionMatch ? toIsoFromDateTimeParts(sessionMatch[3], sessionMatch[4]) : null;
  const huntDate = sessionMatch?.[1] ?? null;
  let durationMinutes: number | null = null;
  const durationMatch = cleaned.match(/^\s*Session:\s*(\d{1,2}):(\d{2})h\s*$/im);
  if (durationMatch) {
    durationMinutes = Number(durationMatch[1]) * 60 + Number(durationMatch[2]);
  }
  const rawXpGain = parseLineValue(cleaned, "Raw XP Gain");
  const xpGain = parseLineValue(cleaned, "XP Gain");
  const loot = parseLineValue(cleaned, "Loot");
  const supplies = parseLineValue(cleaned, "Supplies");
  const monsters = parseCountedSection(cleaned, "Killed Monsters");
  const lootItemsRaw = parseCountedSection(cleaned, "Looted Items");
  const lootItems = lootItemsRaw.map((item) => ({
    name: item.name,
    quantity: item.count,
    normalized_name: normalizeLootItemName(item.name)
  }));
  const fallbackDate = huntDate ?? new Date().toISOString().slice(0, 10);
  const generatedLabel = detectTopMonsterName(cleaned) ? `${detectTopMonsterName(cleaned)} - ${fallbackDate}` : null;

  return {
    label: generatedLabel,
    duration_minutes: durationMinutes,
    raw_total_xp: rawXpGain,
    total_xp: xpGain,
    total_loot_gold: loot,
    total_supply_cost: supplies,
    started_at: startedAt,
    ended_at: endedAt,
    hunt_date: huntDate,
    monsters,
    loot_items: lootItems
  };
}

export function looksLikeHuntText(value: string): boolean {
  return /Session data:\s*From/i.test(value)
    && /Killed Monsters:/i.test(value)
    && /Looted Items:/i.test(value);
}

export function splitHuntTexts(raw: string): string[] {
  const wrapped = Array.from(raw.matchAll(/<hunt>([\s\S]*?)<\/hunt>/gi))
    .map((match) => asText(match[1]).trim())
    .filter(looksLikeHuntText);

  if (wrapped.length) {
    return wrapped;
  }

  return looksLikeHuntText(raw) ? [raw.trim()] : [];
}

export function collectJsonHuntTexts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(...splitHuntTexts(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJsonHuntTexts(entry, out);
    }
    return out;
  }
  const row = asRecord(value);
  if (row) {
    for (const entry of Object.values(row)) {
      collectJsonHuntTexts(entry, out);
    }
  }
  return out;
}

export function extractHuntTextsFromLogFile(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  if (filePath.toLowerCase().endsWith(".json")) {
    try {
      return collectJsonHuntTexts(JSON.parse(raw));
    } catch {
      return splitHuntTexts(raw);
    }
  }
  return splitHuntTexts(raw);
}

export function readHuntLogFiles(dir = config.tibiaLogDir): Array<{ path: string; name: string; modified_at: string }> {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(txt|json|log)$/i.test(entry.name))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        path: filePath,
        name: entry.name,
        modified_at: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => Date.parse(b.modified_at) - Date.parse(a.modified_at))
    .slice(0, HUNT_LOG_IMPORT_LIMIT);
}

export function isInsideDirectory(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
