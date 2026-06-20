import type Database from "better-sqlite3";
import { lookupTibiaCharacter, type TibiaCharacterSummary } from "./tibiadata/characters";
import { asText, nowIso } from "./hunts/utils";

const DEFAULT_CHARACTER_KEY = "default_character_name";

export type AppSettings = {
  default_character_name: string | null;
  default_character: TibiaCharacterSummary | null;
};

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1").get(key) as { value?: string } | undefined;
  const value = asText(row?.value).trim();
  return value || null;
}

function setSetting(db: Database.Database, key: string, value: string | null): void {
  if (!value) {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
    return;
  }
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, nowIso());
}

export function getAppSettings(db: Database.Database): AppSettings {
  const defaultCharacterName = getSetting(db, DEFAULT_CHARACTER_KEY);
  return {
    default_character_name: defaultCharacterName,
    default_character: null
  };
}

export async function updateAppSettings(
  db: Database.Database,
  input: Record<string, unknown>
): Promise<AppSettings> {
  const rawName = asText(input.default_character_name ?? input.defaultCharacterName).trim().replace(/\s+/g, " ");
  if (!rawName) {
    setSetting(db, DEFAULT_CHARACTER_KEY, null);
    return getAppSettings(db);
  }
  if (rawName.length > 60) {
    throw new Error("Default character name must be 60 characters or fewer");
  }

  const character = await lookupTibiaCharacter(db, rawName);
  setSetting(db, DEFAULT_CHARACTER_KEY, character.name);
  return {
    default_character_name: character.name,
    default_character: character
  };
}
