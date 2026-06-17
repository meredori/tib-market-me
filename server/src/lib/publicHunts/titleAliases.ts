import type Database from "better-sqlite3";
import { asNumber, asText, nowIso } from "../hunts/utils";
import { normalizePublicName } from "../tibiadata/publicReference";

export type PublicHuntTitleAlias = {
  phrase: string;
  public_hunting_place_id: number;
  hunting_place_name: string;
  hunting_place_location: string | null;
  evidence_count: number;
  total_phrase_count: number;
  confidence: number;
  example_titles: string[];
  last_seen_at: string | null;
  updated_at: string;
};

export type TitleAliasSignal = {
  phrase: string;
  confidence: number;
  evidence_count: number;
  total_phrase_count: number;
};

const STOP_WORDS = new Set([
  "and",
  "the",
  "hunt",
  "hunting",
  "test",
  "team",
  "solo",
  "duo",
  "trio",
  "quad",
  "profit",
  "waste",
  "exp",
  "xp",
  "raw",
  "hour",
  "hours",
  "min",
  "mins",
  "ek",
  "ed",
  "ms",
  "rp",
  "pt"
]);

function parseExamples(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => asText(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function titleTokens(title: string): string[] {
  return normalizePublicName(title)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOP_WORDS.has(token));
}

export function publicHuntTitlePhrases(title: string): string[] {
  const tokens = titleTokens(title);
  const phrases = new Set<string>();
  for (let size = Math.min(4, tokens.length); size >= 2; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      phrases.add(tokens.slice(index, index + size).join(" "));
    }
  }
  if (tokens.length === 1 && tokens[0].length >= 3) {
    phrases.add(tokens[0]);
  }
  if (tokens.length > 1 && tokens.length <= 5) {
    phrases.add(tokens.join(" "));
  }
  return [...phrases].filter((phrase) => phrase.length >= 3);
}

export function rebuildPublicHuntTitleAliases(db: Database.Database): number {
  const rows = db.prepare(`
    SELECT
      session.title,
      session.public_hunting_place_id,
      session.last_reviewed_at,
      session.refreshed_at
    FROM public_hunt_sessions session
    WHERE session.review_status = 'accepted'
      AND session.public_hunting_place_id IS NOT NULL
      AND session.suspicious_status != 'suspicious'
      AND EXISTS (
        SELECT 1
        FROM public_hunt_session_monsters monster
        WHERE monster.public_hunt_session_id = session.id
          AND monster.kill_count > 0
      )
  `).all() as Array<Record<string, unknown>>;

  type PhraseStats = {
    total: number;
    places: Map<number, { count: number; examples: string[]; lastSeen: string | null }>;
  };
  const stats = new Map<string, PhraseStats>();
  for (const row of rows) {
    const title = asText(row.title);
    const placeId = Math.trunc(asNumber(row.public_hunting_place_id, 0));
    if (!title || placeId <= 0) {
      continue;
    }
    const seenPhrases = publicHuntTitlePhrases(title);
    for (const phrase of seenPhrases) {
      const phraseStats = stats.get(phrase) ?? { total: 0, places: new Map() };
      phraseStats.total += 1;
      const placeStats = phraseStats.places.get(placeId) ?? { count: 0, examples: [], lastSeen: null };
      placeStats.count += 1;
      if (!placeStats.examples.includes(title) && placeStats.examples.length < 5) {
        placeStats.examples.push(title);
      }
      const lastSeen = asText(row.last_reviewed_at) || asText(row.refreshed_at) || null;
      if (lastSeen && (!placeStats.lastSeen || lastSeen > placeStats.lastSeen)) {
        placeStats.lastSeen = lastSeen;
      }
      phraseStats.places.set(placeId, placeStats);
      stats.set(phrase, phraseStats);
    }
  }

  const updatedAt = nowIso();
  const insert = db.prepare(`
    INSERT INTO public_hunt_title_aliases (
      phrase, public_hunting_place_id, evidence_count, total_phrase_count,
      confidence, example_titles_json, last_seen_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.prepare("DELETE FROM public_hunt_title_aliases").run();
  let inserted = 0;
  for (const [phrase, phraseStats] of stats) {
    for (const [placeId, placeStats] of phraseStats.places) {
      const confidence = phraseStats.total > 0 ? placeStats.count / phraseStats.total : 0;
      insert.run(
        phrase,
        placeId,
        placeStats.count,
        phraseStats.total,
        Number(confidence.toFixed(4)),
        JSON.stringify(placeStats.examples),
        placeStats.lastSeen,
        updatedAt
      );
      inserted += 1;
    }
  }
  return inserted;
}

export function listPublicHuntTitleAliases(db: Database.Database, limit = 80): Record<string, unknown> {
  const rows = db.prepare(`
    SELECT
      alias.phrase,
      alias.public_hunting_place_id,
      place.name AS hunting_place_name,
      place.location AS hunting_place_location,
      alias.evidence_count,
      alias.total_phrase_count,
      alias.confidence,
      alias.example_titles_json,
      alias.last_seen_at,
      alias.updated_at
    FROM public_hunt_title_aliases alias
    JOIN public_hunting_places place
      ON place.id = alias.public_hunting_place_id
    WHERE alias.evidence_count >= 2
      AND alias.confidence >= 0.6
    ORDER BY alias.confidence DESC, alias.evidence_count DESC, alias.phrase, place.name
    LIMIT ?
  `).all(Math.max(1, Math.trunc(limit))) as Array<Record<string, unknown>>;
  return {
    ok: true,
    items: rows.map((row) => ({
      phrase: asText(row.phrase),
      public_hunting_place_id: asNumber(row.public_hunting_place_id, 0),
      hunting_place_name: asText(row.hunting_place_name),
      hunting_place_location: asText(row.hunting_place_location) || null,
      evidence_count: asNumber(row.evidence_count, 0),
      total_phrase_count: asNumber(row.total_phrase_count, 0),
      confidence: asNumber(row.confidence, 0),
      example_titles: parseExamples(row.example_titles_json),
      last_seen_at: asText(row.last_seen_at) || null,
      updated_at: asText(row.updated_at)
    }))
  };
}

export function titleAliasSignalForPlace(
  db: Database.Database,
  title: string | null,
  placeId: number
): TitleAliasSignal | null {
  return titleAliasSignalsForTitle(db, title).get(placeId) ?? null;
}

export function titleAliasSignalsForTitle(db: Database.Database, title: string | null): Map<number, TitleAliasSignal> {
  const phrases = title ? publicHuntTitlePhrases(title) : [];
  const signals = new Map<number, TitleAliasSignal>();
  if (!phrases.length) {
    return signals;
  }
  try {
    const placeholders = phrases.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT public_hunting_place_id, phrase, evidence_count, total_phrase_count, confidence
      FROM public_hunt_title_aliases
      WHERE phrase IN (${placeholders})
        AND evidence_count >= 2
        AND confidence >= 0.6
      ORDER BY confidence DESC, evidence_count DESC, LENGTH(phrase) DESC
    `).all(...phrases) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const placeId = asNumber(row.public_hunting_place_id, 0);
      if (placeId <= 0 || signals.has(placeId)) {
        continue;
      }
      signals.set(placeId, {
        phrase: asText(row.phrase),
        confidence: asNumber(row.confidence, 0),
        evidence_count: asNumber(row.evidence_count, 0),
        total_phrase_count: asNumber(row.total_phrase_count, 0)
      });
    }
    return signals;
  } catch {
    return signals;
  }
}
