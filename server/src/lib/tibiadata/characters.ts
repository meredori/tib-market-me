import type Database from "better-sqlite3";
import { asNumberOrNull, asRecord, asText, nowIso } from "../hunts/utils";

const TIBIA_DATA_CHARACTER_URL = "https://api.tibiadata.com/v4/character";

export type TibiaCharacterSummary = {
  name: string;
  vocation: string | null;
  level: number | null;
  world: string | null;
  sex: string | null;
  residence: string | null;
  guild_name: string | null;
  account_status: string | null;
  last_login: string | null;
  source_timestamp: string | null;
  fetched_at: string;
};

let characterFetchForTests: typeof fetch | null = null;

export function setCharacterFetchForTests(fetchImpl: typeof fetch): void {
  characterFetchForTests = fetchImpl;
}

export function resetCharacterFetchForTests(): void {
  characterFetchForTests = null;
}

function normalizeCharacterName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function displayCharacterName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function characterSearchTerm(value: unknown): string {
  const name = displayCharacterName(asText(value));
  if (!name || name.length > 60) {
    throw new Error("Character name must be 1-60 characters");
  }
  return name;
}

export function normalizeTibiaCharacterResponse(payload: unknown): TibiaCharacterSummary | null {
  const root = asRecord(payload);
  const characterEnvelope = asRecord(root?.character);
  const character = asRecord(characterEnvelope?.character);
  if (!character) {
    return null;
  }

  const name = displayCharacterName(asText(character.name));
  if (!name) {
    return null;
  }

  const guild = asRecord(character.guild);
  const information = asRecord(root?.information);

  return {
    name,
    vocation: asText(character.vocation) || null,
    level: asNumberOrNull(character.level),
    world: asText(character.world) || null,
    sex: asText(character.sex) || null,
    residence: asText(character.residence) || null,
    guild_name: asText(guild?.name) || null,
    account_status: asText(character.account_status) || null,
    last_login: asText(character.last_login) || null,
    source_timestamp: asText(information?.timestamp) || null,
    fetched_at: nowIso()
  };
}

export async function fetchTibiaCharacter(name: string): Promise<{ character: TibiaCharacterSummary; payload: unknown }> {
  const searchName = characterSearchTerm(name);
  const fetchImpl = characterFetchForTests ?? fetch;
  const response = await fetchImpl(`${TIBIA_DATA_CHARACTER_URL}/${encodeURIComponent(searchName)}`);
  if (!response.ok) {
    throw new Error(`TibiaData character lookup failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  const character = normalizeTibiaCharacterResponse(payload);
  if (!character) {
    throw new Error("TibiaData character response did not include character details");
  }

  return { character, payload };
}

export function upsertTibiaCharacter(
  db: Database.Database,
  character: TibiaCharacterSummary,
  payload: unknown
): TibiaCharacterSummary {
  db.prepare(
    `
    INSERT INTO tibia_characters (
      name,
      normalized_name,
      vocation,
      level,
      world,
      sex,
      residence,
      guild_name,
      account_status,
      last_login,
      source_timestamp,
      fetched_at,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET
      name = excluded.name,
      vocation = excluded.vocation,
      level = excluded.level,
      world = excluded.world,
      sex = excluded.sex,
      residence = excluded.residence,
      guild_name = excluded.guild_name,
      account_status = excluded.account_status,
      last_login = excluded.last_login,
      source_timestamp = excluded.source_timestamp,
      fetched_at = excluded.fetched_at,
      payload_json = excluded.payload_json
  `
  ).run(
    character.name,
    normalizeCharacterName(character.name),
    character.vocation,
    character.level,
    character.world,
    character.sex,
    character.residence,
    character.guild_name,
    character.account_status,
    character.last_login,
    character.source_timestamp,
    character.fetched_at,
    JSON.stringify(payload)
  );

  return character;
}

export async function lookupTibiaCharacter(db: Database.Database, name: string): Promise<TibiaCharacterSummary> {
  const result = await fetchTibiaCharacter(name);
  return upsertTibiaCharacter(db, result.character, result.payload);
}

export function searchKnownCharacters(db: Database.Database, query: string, limit = 20): TibiaCharacterSummary[] {
  const term = normalizeCharacterName(asText(query));
  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const rows = db.prepare(
    `
    SELECT
      name,
      vocation,
      level,
      world,
      sex,
      residence,
      guild_name,
      account_status,
      last_login,
      source_timestamp,
      fetched_at
    FROM tibia_characters
    WHERE ? = '' OR normalized_name LIKE ?
    ORDER BY fetched_at DESC, level DESC, name ASC
    LIMIT ?
  `
  ).all(term, `%${term}%`, cappedLimit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    name: asText(row.name),
    vocation: asText(row.vocation) || null,
    level: asNumberOrNull(row.level),
    world: asText(row.world) || null,
    sex: asText(row.sex) || null,
    residence: asText(row.residence) || null,
    guild_name: asText(row.guild_name) || null,
    account_status: asText(row.account_status) || null,
    last_login: asText(row.last_login) || null,
    source_timestamp: asText(row.source_timestamp) || null,
    fetched_at: asText(row.fetched_at)
  }));
}
