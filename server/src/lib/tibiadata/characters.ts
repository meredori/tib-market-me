import type Database from "better-sqlite3";
import { asNumberOrNull, asRecord, asText, nowIso } from "../hunts/utils";

const TIBIA_DATA_CHARACTER_URL = "https://api.tibiadata.com/v4/character";
const RISK_VALUES = new Set(["any", "low", "medium", "high"]);
const PARTY_VALUES = new Set(["any", "solo", "duo", "team"]);
const WALK_VALUES = new Set(["any", "prefer", "avoid"]);

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
  account_created: string | null;
  loyalty_title: string | null;
  account_position: string | null;
  achievement_points: number | null;
  character_title: string | null;
  deletion_date: string | null;
  traded: boolean | null;
  unlocked_titles: number | null;
  former_names: string[];
  former_worlds: string[];
  premium_hint: string | null;
  magic_level: number | null;
  skill_level: number | null;
  profile_notes: string | null;
  preferred_risk: "any" | "low" | "medium" | "high" | null;
  preferred_hunt_style: string | null;
  party_preference: "any" | "solo" | "duo" | "team" | null;
  short_walk_preference: "any" | "prefer" | "avoid" | null;
  equipment_notes: string | null;
  charm_notes: string | null;
  unlock_notes: string | null;
  planner_updated_at: string | null;
  source_timestamp: string | null;
  fetched_at: string;
};

export type CharacterProfileUpdate = {
  magic_level?: unknown;
  skill_level?: unknown;
  profile_notes?: unknown;
  preferred_risk?: unknown;
  preferred_hunt_style?: unknown;
  party_preference?: unknown;
  short_walk_preference?: unknown;
  equipment_notes?: unknown;
  charm_notes?: unknown;
  unlock_notes?: unknown;
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

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => displayCharacterName(asText(entry))).filter(Boolean)
    : [];
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalPlannerText(value: unknown, maxLength: number): string | null {
  const text = asText(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function plannerChoice<T extends string>(value: unknown, allowed: Set<string>): T | null {
  const text = asText(value).trim().toLowerCase();
  return allowed.has(text) ? text as T : null;
}

function rowToCharacter(row: Record<string, unknown>): TibiaCharacterSummary {
  return {
    name: asText(row.name),
    vocation: asText(row.vocation) || null,
    level: asNumberOrNull(row.level),
    world: asText(row.world) || null,
    sex: asText(row.sex) || null,
    residence: asText(row.residence) || null,
    guild_name: asText(row.guild_name) || null,
    account_status: asText(row.account_status) || null,
    last_login: asText(row.last_login) || null,
    account_created: asText(row.account_created) || null,
    loyalty_title: asText(row.loyalty_title) || null,
    account_position: asText(row.account_position) || null,
    achievement_points: asNumberOrNull(row.achievement_points),
    character_title: asText(row.character_title) || null,
    deletion_date: asText(row.deletion_date) || null,
    traded: row.traded === null || row.traded === undefined ? null : Boolean(row.traded),
    unlocked_titles: asNumberOrNull(row.unlocked_titles),
    former_names: parseJsonArray(row.former_names_json),
    former_worlds: parseJsonArray(row.former_worlds_json),
    premium_hint: asText(row.premium_hint) || null,
    magic_level: asNumberOrNull(row.magic_level),
    skill_level: asNumberOrNull(row.skill_level),
    profile_notes: asText(row.profile_notes) || null,
    preferred_risk: plannerChoice(row.preferred_risk, RISK_VALUES),
    preferred_hunt_style: asText(row.preferred_hunt_style) || null,
    party_preference: plannerChoice(row.party_preference, PARTY_VALUES),
    short_walk_preference: plannerChoice(row.short_walk_preference, WALK_VALUES),
    equipment_notes: asText(row.equipment_notes) || null,
    charm_notes: asText(row.charm_notes) || null,
    unlock_notes: asText(row.unlock_notes) || null,
    planner_updated_at: asText(row.planner_updated_at) || null,
    source_timestamp: asText(row.source_timestamp) || null,
    fetched_at: asText(row.fetched_at)
  };
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(asText(value) || "[]");
    return Array.isArray(parsed) ? parsed.map((entry) => asText(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
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
  const account = asRecord(characterEnvelope?.account_information);
  const information = asRecord(root?.information);
  const accountStatus = asText(character.account_status) || null;

  return {
    name,
    vocation: asText(character.vocation) || null,
    level: asNumberOrNull(character.level),
    world: asText(character.world) || null,
    sex: asText(character.sex) || null,
    residence: asText(character.residence) || null,
    guild_name: asText(guild?.name) || null,
    account_status: accountStatus,
    last_login: asText(character.last_login) || null,
    account_created: asText(account?.created) || null,
    loyalty_title: asText(account?.loyalty_title) || null,
    account_position: asText(account?.position) || null,
    achievement_points: asNumberOrNull(character.achievement_points),
    character_title: asText(character.title) || null,
    deletion_date: asText(character.deletion_date) || null,
    traded: booleanOrNull(character.traded),
    unlocked_titles: asNumberOrNull(character.unlocked_titles),
    former_names: textArray(character.former_names),
    former_worlds: textArray(character.former_worlds),
    premium_hint: accountStatus?.toLowerCase().includes("premium") ? "premium" : accountStatus ? "free" : null,
    magic_level: null,
    skill_level: null,
    profile_notes: null,
    preferred_risk: null,
    preferred_hunt_style: null,
    party_preference: null,
    short_walk_preference: null,
    equipment_notes: null,
    charm_notes: null,
    unlock_notes: null,
    planner_updated_at: null,
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
      account_created,
      loyalty_title,
      account_position,
      achievement_points,
      character_title,
      deletion_date,
      traded,
      unlocked_titles,
      former_names_json,
      former_worlds_json,
      premium_hint,
      source_timestamp,
      fetched_at,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      account_created = excluded.account_created,
      loyalty_title = excluded.loyalty_title,
      account_position = excluded.account_position,
      achievement_points = excluded.achievement_points,
      character_title = excluded.character_title,
      deletion_date = excluded.deletion_date,
      traded = excluded.traded,
      unlocked_titles = excluded.unlocked_titles,
      former_names_json = excluded.former_names_json,
      former_worlds_json = excluded.former_worlds_json,
      premium_hint = excluded.premium_hint,
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
    character.account_created,
    character.loyalty_title,
    character.account_position,
    character.achievement_points,
    character.character_title,
    character.deletion_date,
    character.traded === null ? null : character.traded ? 1 : 0,
    character.unlocked_titles,
    JSON.stringify(character.former_names),
    JSON.stringify(character.former_worlds),
    character.premium_hint,
    character.source_timestamp,
    character.fetched_at,
    JSON.stringify(payload)
  );

  return getKnownCharacter(db, character.name) ?? character;
}

export async function lookupTibiaCharacter(db: Database.Database, name: string): Promise<TibiaCharacterSummary> {
  const result = await fetchTibiaCharacter(name);
  return upsertTibiaCharacter(db, result.character, result.payload);
}

const CHARACTER_SELECT = `
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
    account_created,
    loyalty_title,
    account_position,
    achievement_points,
    character_title,
    deletion_date,
    traded,
    unlocked_titles,
    former_names_json,
    former_worlds_json,
    premium_hint,
    magic_level,
    skill_level,
    profile_notes,
    preferred_risk,
    preferred_hunt_style,
    party_preference,
    short_walk_preference,
    equipment_notes,
    charm_notes,
    unlock_notes,
    planner_updated_at,
    source_timestamp,
    fetched_at
  FROM tibia_characters
`;

export function getKnownCharacter(db: Database.Database, name: string): TibiaCharacterSummary | null {
  const searchName = characterSearchTerm(name);
  const row = db.prepare(`
    ${CHARACTER_SELECT}
    WHERE normalized_name = ?
    LIMIT 1
  `).get(normalizeCharacterName(searchName)) as Record<string, unknown> | undefined;
  return row ? rowToCharacter(row) : null;
}

export function updateCharacterProfile(
  db: Database.Database,
  name: string,
  input: CharacterProfileUpdate
): TibiaCharacterSummary {
  const searchName = characterSearchTerm(name);
  const existing = getKnownCharacter(db, searchName);
  if (!existing) {
    throw new Error("Character profile not found. Look up the character first.");
  }
  const now = nowIso();
  db.prepare(`
    UPDATE tibia_characters
    SET
      magic_level = ?,
      skill_level = ?,
      profile_notes = ?,
      preferred_risk = ?,
      preferred_hunt_style = ?,
      party_preference = ?,
      short_walk_preference = ?,
      equipment_notes = ?,
      charm_notes = ?,
      unlock_notes = ?,
      planner_updated_at = ?
    WHERE normalized_name = ?
  `).run(
    optionalPositiveInt(input.magic_level),
    optionalPositiveInt(input.skill_level),
    optionalPlannerText(input.profile_notes, 1600),
    plannerChoice(input.preferred_risk, RISK_VALUES),
    optionalPlannerText(input.preferred_hunt_style, 80),
    plannerChoice(input.party_preference, PARTY_VALUES),
    plannerChoice(input.short_walk_preference, WALK_VALUES),
    optionalPlannerText(input.equipment_notes, 1600),
    optionalPlannerText(input.charm_notes, 1600),
    optionalPlannerText(input.unlock_notes, 1600),
    now,
    normalizeCharacterName(searchName)
  );
  return getKnownCharacter(db, searchName) ?? existing;
}

function optionalPositiveInt(value: unknown): number | null {
  const parsed = asNumberOrNull(value);
  return parsed && parsed > 0 ? Math.trunc(parsed) : null;
}

export function searchKnownCharacters(db: Database.Database, query: string, limit = 20): TibiaCharacterSummary[] {
  const term = normalizeCharacterName(asText(query));
  const cappedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const rows = db.prepare(
    `
    ${CHARACTER_SELECT}
    WHERE ? = '' OR normalized_name LIKE ?
    ORDER BY fetched_at DESC, level DESC, name ASC
    LIMIT ?
  `
  ).all(term, `%${term}%`, cappedLimit) as Array<Record<string, unknown>>;

  return rows.map(rowToCharacter);
}
