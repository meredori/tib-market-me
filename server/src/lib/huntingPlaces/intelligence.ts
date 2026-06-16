import type Database from "better-sqlite3";
import { config } from "../../config";
import {
  confidence as buildConfidence,
  entityRef,
  explanation,
  freshness as buildFreshness,
  labelsFromExplanations,
  provenance
} from "../intelligence/metadata";
import type { Confidence, Freshness, InsightExplanation, Provenance } from "../intelligence/types";
import { getEffectiveLootLogicPreview } from "../sync/lootLogic";
import { normalizeLootItemName } from "../hunts/utils";

const STALE_REFERENCE_HOURS = 24 * 30;
const AGING_REFERENCE_HOURS = 24 * 14;
const STALE_MARKET_HOURS = 24 * 14;
const AGING_MARKET_HOURS = 24 * 7;
const PRICING_MODEL = config.pricingModel;

type HuntingPlaceRow = {
  id: number;
  name: string;
  normalized_name: string;
  location: string | null;
  min_level: number | null;
  max_level: number | null;
  exp_stars: number | null;
  loot_stars: number | null;
  bestiary_stars: number | null;
  risk_level: string | null;
  last_updated: string | null;
  last_seen: string | null;
  fetched_at: string;
  payload_json: string;
};

type PlaceCreatureRow = {
  creature_id: number | null;
  creature_name: string;
  normalized_creature_name: string;
  occurrence: string | null;
  payload_json: string;
  public_creature_id: number | null;
  resolved_creature_name: string | null;
  hitpoints: number | null;
  experience: number | null;
  bestiary_class: string | null;
  bestiary_category: string | null;
  bestiary_difficulty: string | null;
  charm_points: number | null;
  total_kills: number | null;
  creature_last_updated: string | null;
  creature_last_seen: string | null;
  creature_fetched_at: string | null;
};

type LootRow = {
  creature_id: number | null;
  creature_name: string;
  normalized_creature_name: string;
  occurrence: string | null;
  item_id: number | null;
  item_name: string;
  normalized_item_name: string;
  chance_percent: number | null;
  min_count: number | null;
  max_count: number | null;
  rarity: string | null;
  amount_text: string | null;
  fetched_at: string;
  market_item_id: number | null;
  metadata_name: string | null;
  wiki_name: string | null;
  client_value: number | null;
  suggested_list_price: number | null;
  fair_price: number | null;
  trend: string | null;
  liquidity: number | null;
  market_confidence: number | null;
  sell_offer: number | null;
  month_sold: number | null;
  day_sold: number | null;
  month_highest_sell: number | null;
  day_highest_sell: number | null;
  npc_buy: number | null;
  override_mode: string | null;
  market_finished_at: string | null;
};

type HuntRow = {
  id: number;
  label: string;
  duration_minutes: number;
  raw_total_xp: number;
  total_xp: number;
  total_loot_gold: number;
  total_supply_cost: number;
  started_at: string | null;
  ended_at: string | null;
  uploaded_at: string;
  location_name: string | null;
  character_name: string | null;
  character_vocation: string | null;
  character_level: number | null;
  character_world: string | null;
  public_hunting_place_id: number | null;
  hunting_place_confidence: number;
  hunting_place_match_status: string;
  hunting_place_match_mode: string;
  hunting_place_match_readiness: string;
  hunting_place_match_manual: number;
  processed_json: string;
};

type PublicHuntSessionRow = {
  id: number;
  source_session_id: string;
  source_url: string;
  title: string;
  author_label: string | null;
  observed_at: string | null;
  refreshed_at: string;
  duration_minutes: number | null;
  party_size: number | null;
  party_json: string;
  total_xp: number | null;
  xp_per_hour: number | null;
  raw_xp_per_hour: number | null;
  balance_gold: number | null;
  profit_per_hour: number | null;
  parsed_confidence: number;
  hunting_place_confidence: number;
};

export type HuntingPlaceCreatureSummary = {
  public_creature_id: number | null;
  normalized_creature_name: string;
  name: string;
  occurrence: string | null;
  hitpoints: number | null;
  experience: number | null;
  bestiary: {
    class: string | null;
    category: string | null;
    difficulty: string | null;
    charm_points: number | null;
    total_kills: number | null;
  };
  freshness: Freshness;
  provenance: Provenance[];
  confidence: Confidence;
};

export type HuntingPlaceLootSummary = {
  item_id: number | null;
  name: string;
  normalized_item_name: string;
  creature_names: string[];
  rarity: string | null;
  chance_percent: number | null;
  min_count: number | null;
  max_count: number | null;
  amount_text: string | null;
  estimated_unit_value: number | null;
  estimated_drop_value: number | null;
  value_strategy: string;
  market: {
    trend: string | null;
    liquidity: number | null;
    confidence: number | null;
    sell_offer: number | null;
    month_sold: number | null;
    day_sold: number | null;
  };
  confidence: Confidence;
  freshness: Freshness;
  provenance: Provenance[];
  explanations: InsightExplanation[];
};

export type PersonalHuntSummary = {
  id: number;
  label: string;
  duration_minutes: number;
  started_at: string | null;
  ended_at: string | null;
  uploaded_at: string;
  character_name: string | null;
  character_vocation: string | null;
  character_level: number | null;
  character_world: string | null;
  xp: number;
  raw_xp: number;
  xp_per_hour: number | null;
  loot_gold: number;
  supply_cost: number;
  profit: number;
  profit_per_hour: number | null;
  supply_cost_per_hour: number | null;
  match: {
    public_hunting_place_id: number | null;
    confidence: Confidence;
    status: string;
    mode: string;
    readiness: string;
    manual: boolean;
  };
  provenance: Provenance[];
};

export type PublicHuntSessionSummary = {
  id: number;
  source_session_id: string;
  source_url: string;
  title: string;
  observed_at: string | null;
  duration_minutes: number | null;
  party_size: number | null;
  level_min: number | null;
  level_max: number | null;
  vocations: string[];
  xp_per_hour: number | null;
  raw_xp_per_hour: number | null;
  profit_per_hour: number | null;
  balance_gold: number | null;
  confidence: Confidence;
  provenance: Provenance[];
};

export type PublicHuntCreatureSummary = {
  name: string;
  normalized_name: string;
  kills: number;
  kills_per_hour: number | null;
  session_count: number;
};

export type PublicHuntIntelligenceSummary = {
  sessions: PublicHuntSessionSummary[];
  summary: {
    session_count: number;
    matched_session_count: number;
    median_xp_per_hour: number | null;
    min_xp_per_hour: number | null;
    max_xp_per_hour: number | null;
    median_raw_xp_per_hour: number | null;
    median_profit_per_hour: number | null;
    min_profit_per_hour: number | null;
    max_profit_per_hour: number | null;
    median_kills_per_hour: number | null;
    level_bands: string[];
    vocations: string[];
    top_creatures: PublicHuntCreatureSummary[];
    confidence: Confidence;
    freshness: Freshness;
    provenance: Provenance[];
    explanations: InsightExplanation[];
  };
};

export type HuntingPlaceDetail = {
  ok: true;
  public_hunting_place_id: number;
  place: {
    public_hunting_place_id: number;
    name: string;
    normalized_name: string;
    location: string | null;
    min_level: number | null;
    max_level: number | null;
    exp_stars: number | null;
    loot_stars: number | null;
    bestiary_stars: number | null;
    risk_level: string | null;
    source: "public_reference";
    provenance: Provenance[];
    freshness: Freshness;
    confidence: Confidence;
  };
  reference: {
    creatures: HuntingPlaceCreatureSummary[];
    expected_loot: HuntingPlaceLootSummary[];
    market_weighted_loot_value: {
      total_estimated_value: number;
      priced_item_count: number;
      total_item_count: number;
      confidence: Confidence;
      freshness: Freshness;
      provenance: Provenance[];
      explanations: InsightExplanation[];
    };
  };
  personal: {
    hunts: PersonalHuntSummary[];
    summary: {
      hunt_count: number;
      total_duration_minutes: number;
      total_xp: number;
      total_profit: number;
      total_supply_cost: number;
      best_xp_per_hour: number | null;
      median_xp_per_hour: number | null;
      recent_xp_per_hour: number | null;
      best_profit_per_hour: number | null;
      median_profit_per_hour: number | null;
      recent_profit_per_hour: number | null;
      best_supply_cost_per_hour: number | null;
      median_supply_cost_per_hour: number | null;
      recent_supply_cost_per_hour: number | null;
      confidence: Confidence;
      freshness: Freshness;
      provenance: Provenance[];
      explanations: InsightExplanation[];
    };
  };
  public_sessions: PublicHuntIntelligenceSummary;
  suitability: {
    level_band: string;
    safety_label: string;
    signals: InsightExplanation[];
    warning_labels: string[];
    positive_labels: string[];
  };
  integrations: {
    bestiary: IntegrationSection;
    taskboard: IntegrationSection;
  };
  data_quality: {
    confidence: Confidence;
    freshness: Freshness;
    explanations: InsightExplanation[];
    provenance: Provenance[];
  };
};

export type PlaceholderSection = {
  status: "unavailable";
  available: false;
  reason: string;
  public_hunting_place_id: number;
};

export type AvailableIntegrationSection = {
  status: "available";
  available: true;
  reason: string;
  public_hunting_place_id: number;
  summary: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
};

export type IntegrationSection = PlaceholderSection | AvailableIntegrationSection;

export type HuntingPlaceDetailResult = HuntingPlaceDetail | {
  ok: false;
  error: string;
  public_hunting_place_id: number;
};

export type HuntingPlaceListFilters = {
  q?: string;
  has_personal_hunts?: boolean;
  has_public_hunts?: boolean;
  limit?: number;
};

export type HuntingPlaceListItem = {
  public_hunting_place_id: number;
  name: string;
  normalized_name: string;
  location: string | null;
  min_level: number | null;
  max_level: number | null;
  risk_level: string | null;
  detail_status: string;
  creature_count: number;
  expected_loot_count: number;
  personal_hunt_count: number;
  public_hunt_count: number;
};

export type HuntingPlaceListResult = {
  ok: true;
  items: HuntingPlaceListItem[];
  summary: {
    total: number;
    with_personal_hunts: number;
    with_public_hunts: number;
    with_level_range: number;
    with_expected_loot: number;
  };
  filters: {
    q: string;
    has_personal_hunts: boolean;
    has_public_hunts: boolean;
    limit: number;
  };
};

function asPositiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
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

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function latestIso(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > bestMs) {
      best = value;
      bestMs = parsed;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) {
    return null;
  }
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 === 0
    ? Math.round((clean[middle - 1] + clean[middle]) / 2)
    : Math.round(clean[middle]);
}

function perHour(value: number, durationMinutes: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }
  return Math.round((value / durationMinutes) * 60);
}

function chanceWeight(chancePercent: number | null): number | null {
  if (chancePercent === null || !Number.isFinite(chancePercent) || chancePercent <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, chancePercent / 100));
}

function averageCount(minCount: number | null, maxCount: number | null): number {
  const min = Number.isFinite(minCount) && minCount !== null && minCount > 0 ? minCount : 1;
  const max = Number.isFinite(maxCount) && maxCount !== null && maxCount > 0 ? maxCount : min;
  return Math.max(1, (min + Math.max(min, max)) / 2);
}

function fetchPlace(db: Database.Database, placeId: number): HuntingPlaceRow | null {
  return db
    .prepare(
      `
      SELECT id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
             bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
      FROM public_hunting_places
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(placeId) as HuntingPlaceRow | undefined ?? null;
}

function fetchCreatures(db: Database.Database, placeId: number): PlaceCreatureRow[] {
  return db
    .prepare(
      `
      SELECT
        hpc.creature_id,
        hpc.creature_name,
        hpc.normalized_creature_name,
        hpc.occurrence,
        hpc.payload_json,
        pc.id AS public_creature_id,
        pc.name AS resolved_creature_name,
        pc.hitpoints,
        pc.experience,
        pc.bestiary_class,
        pc.bestiary_category,
        pc.bestiary_difficulty,
        pc.charm_points,
        pc.total_kills,
        pc.last_updated AS creature_last_updated,
        pc.last_seen AS creature_last_seen,
        pc.fetched_at AS creature_fetched_at
      FROM public_hunting_place_creatures hpc
      LEFT JOIN public_creatures pc
        ON pc.id = hpc.creature_id
        OR pc.normalized_name = hpc.normalized_creature_name
      WHERE hpc.hunting_place_id = ?
      ORDER BY
        CASE LOWER(COALESCE(hpc.occurrence, ''))
          WHEN 'common' THEN 0
          WHEN 'uncommon' THEN 1
          WHEN 'rare' THEN 2
          ELSE 3
        END,
        LOWER(hpc.creature_name)
      `
    )
    .all(placeId) as PlaceCreatureRow[];
}

function fetchLoot(db: Database.Database, placeId: number): LootRow[] {
  return db
    .prepare(
      `
      WITH latest_run AS (
        SELECT id, finished_at
        FROM market_runs
        WHERE status = 'success'
        ORDER BY id DESC
        LIMIT 1
      ),
      npc_buy AS (
        SELECT item_id, MAX(price) AS npc_buy
        FROM item_npc_buy
        GROUP BY item_id
      )
      SELECT
        hpc.creature_id,
        hpc.creature_name,
        hpc.normalized_creature_name,
        hpc.occurrence,
        pcl.item_id,
        pcl.item_name,
        pcl.normalized_item_name,
        pcl.chance_percent,
        pcl.min_count,
        pcl.max_count,
        pcl.rarity,
        pcl.amount_text,
        pcl.fetched_at,
        COALESCE(pcl.item_id, im.item_id) AS market_item_id,
        im.name AS metadata_name,
        im.wiki_name,
        mip.client_value,
        mip.suggested_list_price,
        mip.fair_price,
        mip.trend,
        mip.liquidity,
        mip.confidence AS market_confidence,
        mif.sell_offer,
        mif.month_sold,
        mif.day_sold,
        mif.month_highest_sell,
        mif.day_highest_sell,
        COALESCE(nb.npc_buy, 0) AS npc_buy,
        COALESCE(ivo.override_mode, 'auto') AS override_mode,
        latest_run.finished_at AS market_finished_at
      FROM public_hunting_place_creatures hpc
      JOIN public_creature_loot pcl
        ON pcl.creature_id = hpc.creature_id
        OR pcl.creature_id = (
          SELECT pc.id
          FROM public_creatures pc
          WHERE pc.normalized_name = hpc.normalized_creature_name
          LIMIT 1
        )
      LEFT JOIN item_metadata im
        ON im.item_id = pcl.item_id
        OR LOWER(COALESCE(im.name, '')) = pcl.normalized_item_name
        OR LOWER(COALESCE(im.wiki_name, '')) = pcl.normalized_item_name
      LEFT JOIN latest_run ON 1 = 1
      LEFT JOIN market_item_prices mip
        ON mip.run_id = latest_run.id
       AND mip.item_id = COALESCE(pcl.item_id, im.item_id)
       AND mip.pricing_model = ?
      LEFT JOIN market_item_features mif
        ON mif.run_id = latest_run.id
       AND mif.item_id = COALESCE(pcl.item_id, im.item_id)
      LEFT JOIN npc_buy nb
        ON nb.item_id = COALESCE(pcl.item_id, im.item_id)
      LEFT JOIN item_value_overrides ivo
        ON ivo.item_id = COALESCE(pcl.item_id, im.item_id)
      WHERE hpc.hunting_place_id = ?
      ORDER BY COALESCE(pcl.chance_percent, 0) DESC, LOWER(pcl.item_name)
      `
    )
    .all(PRICING_MODEL, placeId) as LootRow[];
}

function fetchPersonalHunts(db: Database.Database, placeId: number): HuntRow[] {
  return db
    .prepare(
      `
      SELECT
        id,
        label,
        duration_minutes,
        raw_total_xp,
        total_xp,
        total_loot_gold,
        total_supply_cost,
        started_at,
        ended_at,
        uploaded_at,
        location_name,
        character_name,
        character_vocation,
        character_level,
        character_world,
        public_hunting_place_id,
        hunting_place_confidence,
        hunting_place_match_status,
        hunting_place_match_mode,
        hunting_place_match_readiness,
        hunting_place_match_manual,
        processed_json
      FROM hunt_uploads
      WHERE public_hunting_place_id = ?
        AND COALESCE(hunting_place_match_mode, 'auto') != 'mixed_route'
        AND COALESCE(hunting_place_match_status, '') != 'mixed_route'
      ORDER BY COALESCE(started_at, ended_at, uploaded_at) DESC, id DESC
      `
    )
    .all(placeId) as HuntRow[];
}

function fetchPublicHuntSessions(db: Database.Database, placeId: number): PublicHuntSessionRow[] {
  return db
    .prepare(
      `
      SELECT
        id,
        source_session_id,
        source_url,
        title,
        author_label,
        observed_at,
        refreshed_at,
        duration_minutes,
        party_size,
        party_json,
        total_xp,
        xp_per_hour,
        raw_xp_per_hour,
        balance_gold,
        profit_per_hour,
        parsed_confidence,
        hunting_place_confidence
      FROM public_hunt_sessions
      WHERE public_hunting_place_id = ?
        AND review_status = 'accepted'
        AND suspicious_status != 'suspicious'
      ORDER BY COALESCE(observed_at, refreshed_at) DESC, id DESC
      LIMIT 50
      `
    )
    .all(placeId) as PublicHuntSessionRow[];
}

function fetchPublicHuntCreatures(db: Database.Database, placeId: number): PublicHuntCreatureSummary[] {
  const rows = db
    .prepare(
      `
      SELECT
        monster.monster_name AS name,
        monster.normalized_monster_name AS normalized_name,
        SUM(monster.kill_count) AS kills,
        COUNT(DISTINCT session.id) AS session_count,
        SUM(CASE WHEN session.duration_minutes > 0 THEN session.duration_minutes ELSE 0 END) AS duration_minutes
      FROM public_hunt_sessions session
      JOIN public_hunt_session_monsters monster
        ON monster.public_hunt_session_id = session.id
      WHERE session.public_hunting_place_id = ?
        AND session.review_status = 'accepted'
        AND session.suspicious_status != 'suspicious'
      GROUP BY monster.normalized_monster_name, monster.monster_name
      ORDER BY kills DESC, session_count DESC, monster.monster_name
      LIMIT 10
      `
    )
    .all(placeId) as Array<{ name: string; normalized_name: string; kills: number; session_count: number; duration_minutes: number | null }>;

  return rows.map((row) => ({
    name: row.name,
    normalized_name: row.normalized_name,
    kills: Number(row.kills || 0),
    kills_per_hour: row.duration_minutes && row.duration_minutes > 0 ? Math.round(Number(row.kills || 0) * 60 / row.duration_minutes) : null,
    session_count: Number(row.session_count || 0)
  }));
}

function booleanFilter(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

export function listHuntingPlaces(db: Database.Database, filters: HuntingPlaceListFilters = {}): HuntingPlaceListResult {
  const q = normalizeLootItemName(asText(filters.q).trim()).replace(/%/g, "");
  const hasPersonalHunts = booleanFilter(filters.has_personal_hunts);
  const hasPublicHunts = booleanFilter(filters.has_public_hunts);
  const limit = Math.min(500, Math.max(1, Math.trunc(Number(filters.limit ?? 250) || 250)));
  const like = `%${q}%`;
  const rows = db.prepare(
    `
    WITH personal_counts AS (
      SELECT public_hunting_place_id, COUNT(*) AS hunt_count
      FROM hunt_uploads
      WHERE public_hunting_place_id IS NOT NULL
        AND COALESCE(hunting_place_match_mode, 'auto') != 'mixed_route'
        AND COALESCE(hunting_place_match_status, '') != 'mixed_route'
      GROUP BY public_hunting_place_id
    ),
    public_counts AS (
      SELECT public_hunting_place_id, COUNT(*) AS hunt_count
      FROM public_hunt_sessions
      WHERE public_hunting_place_id IS NOT NULL
        AND review_status = 'accepted'
        AND suspicious_status != 'suspicious'
      GROUP BY public_hunting_place_id
    ),
    creature_counts AS (
      SELECT hunting_place_id, COUNT(*) AS creature_count
      FROM public_hunting_place_creatures
      GROUP BY hunting_place_id
    ),
    loot_counts AS (
      SELECT hpc.hunting_place_id, COUNT(DISTINCT pcl.normalized_item_name) AS expected_loot_count
      FROM public_hunting_place_creatures hpc
      JOIN public_creature_loot pcl
        ON pcl.creature_id = hpc.creature_id
        OR pcl.creature_id = (
          SELECT pc.id
          FROM public_creatures pc
          WHERE pc.normalized_name = hpc.normalized_creature_name
          LIMIT 1
        )
      GROUP BY hpc.hunting_place_id
    )
    SELECT
      place.id,
      place.name,
      place.normalized_name,
      place.location,
      place.min_level,
      place.max_level,
      place.risk_level,
      place.detail_status,
      COALESCE(creature_counts.creature_count, 0) AS creature_count,
      COALESCE(loot_counts.expected_loot_count, 0) AS expected_loot_count,
      COALESCE(personal_counts.hunt_count, 0) AS personal_hunt_count,
      COALESCE(public_counts.hunt_count, 0) AS public_hunt_count
    FROM public_hunting_places place
    LEFT JOIN personal_counts ON personal_counts.public_hunting_place_id = place.id
    LEFT JOIN public_counts ON public_counts.public_hunting_place_id = place.id
    LEFT JOIN creature_counts ON creature_counts.hunting_place_id = place.id
    LEFT JOIN loot_counts ON loot_counts.hunting_place_id = place.id
    WHERE (? = '' OR place.normalized_name LIKE ? OR LOWER(COALESCE(place.location, '')) LIKE ?)
      AND (? = 0 OR COALESCE(personal_counts.hunt_count, 0) > 0)
      AND (? = 0 OR COALESCE(public_counts.hunt_count, 0) > 0)
    ORDER BY
      CASE WHEN place.normalized_name = ? THEN 0 ELSE 1 END,
      COALESCE(personal_counts.hunt_count, 0) DESC,
      COALESCE(public_counts.hunt_count, 0) DESC,
      COALESCE(place.min_level, place.max_level, 999999),
      place.name
    LIMIT ?
  `
  ).all(q, like, like, hasPersonalHunts ? 1 : 0, hasPublicHunts ? 1 : 0, q, limit) as Array<Record<string, unknown>>;

  const items = rows.map((row) => ({
    public_hunting_place_id: Number(row.id || 0),
    name: cleanDisplayText(row.name),
    normalized_name: asText(row.normalized_name),
    location: cleanDisplayText(row.location) || null,
    min_level: row.min_level === null || row.min_level === undefined ? null : Number(row.min_level),
    max_level: row.max_level === null || row.max_level === undefined ? null : Number(row.max_level),
    risk_level: asText(row.risk_level) || null,
    detail_status: asText(row.detail_status) || "pending",
    creature_count: Number(row.creature_count || 0),
    expected_loot_count: Number(row.expected_loot_count || 0),
    personal_hunt_count: Number(row.personal_hunt_count || 0),
    public_hunt_count: Number(row.public_hunt_count || 0)
  }));

  return {
    ok: true,
    items,
    summary: {
      total: items.length,
      with_personal_hunts: items.filter((item) => item.personal_hunt_count > 0).length,
      with_public_hunts: items.filter((item) => item.public_hunt_count > 0).length,
      with_level_range: items.filter((item) => item.min_level !== null || item.max_level !== null).length,
      with_expected_loot: items.filter((item) => item.expected_loot_count > 0).length
    },
    filters: {
      q,
      has_personal_hunts: hasPersonalHunts,
      has_public_hunts: hasPublicHunts,
      limit
    }
  };
}

function summarizeCreatures(rows: PlaceCreatureRow[]): HuntingPlaceCreatureSummary[] {
  return rows.map((row) => {
    const id = row.public_creature_id ?? row.creature_id ?? null;
    const name = row.resolved_creature_name ?? row.creature_name;
    const source = provenance("public_tibia_reference", {
      source_ref: entityRef("creature", { id, name, normalized_name: row.normalized_creature_name }),
      source_id: id,
      imported_at: row.creature_fetched_at
    });
    return {
      public_creature_id: id,
      normalized_creature_name: row.normalized_creature_name,
      name,
      occurrence: row.occurrence,
      hitpoints: row.hitpoints,
      experience: row.experience,
      bestiary: {
        class: row.bestiary_class,
        category: row.bestiary_category,
        difficulty: row.bestiary_difficulty,
        charm_points: row.charm_points,
        total_kills: row.total_kills
      },
      freshness: buildFreshness(latestIso(row.creature_last_updated, row.creature_last_seen, row.creature_fetched_at), {
        staleAfterHours: STALE_REFERENCE_HOURS,
        agingAfterHours: AGING_REFERENCE_HOURS,
        missingDataReason: id ? null : "Creature details have not been enriched yet."
      }),
      provenance: [source],
      confidence: buildConfidence(id ? 0.85 : 0.45, {
        estimated: !id,
        missingDataReason: id ? null : "Only the hunting-place creature name is available."
      })
    };
  });
}

function lootValue(row: LootRow): { unitValue: number | null; strategy: string } {
  const itemId = row.market_item_id ?? row.item_id;
  if (!itemId) {
    return { unitValue: null, strategy: "unknown" };
  }
  const logic = getEffectiveLootLogicPreview({
    client_value: row.client_value ?? 0,
    suggested_list_price: row.suggested_list_price ?? 0,
    fair_price: row.fair_price ?? 0,
    trend: row.trend ?? "unknown",
    liquidity: row.liquidity ?? 0,
    confidence: row.market_confidence ?? 0,
    month_sold: row.month_sold ?? -1,
    day_sold: row.day_sold ?? -1,
    sell_offer: row.sell_offer ?? -1,
    month_highest_sell: row.month_highest_sell ?? -1,
    day_highest_sell: row.day_highest_sell ?? -1,
    npc_buy: row.npc_buy ?? 0,
    override_mode: row.override_mode ?? "auto"
  });
  return {
    unitValue: logic.fair_sale_price > 0 ? Math.round(logic.fair_sale_price) : null,
    strategy: logic.strategy
  };
}

function summarizeLoot(rows: LootRow[]): HuntingPlaceLootSummary[] {
  const byItem = new Map<string, { rows: LootRow[]; first: LootRow }>();
  for (const row of rows) {
    const key = `${row.market_item_id ?? row.item_id ?? row.normalized_item_name}:${row.normalized_item_name}`;
    const existing = byItem.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      byItem.set(key, { rows: [row], first: row });
    }
  }

  return Array.from(byItem.values()).map(({ rows: itemRows, first }) => {
    const itemId = first.market_item_id ?? first.item_id ?? null;
    const name = first.metadata_name ?? first.wiki_name ?? first.item_name;
    const { unitValue, strategy } = lootValue(first);
    const averageChance = median(itemRows
      .map((row) => row.chance_percent)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
    const chance = chanceWeight(averageChance);
    const expectedDrops = chance === null ? null : chance * averageCount(first.min_count, first.max_count);
    const estimatedDropValue = unitValue === null || expectedDrops === null ? null : Math.round(unitValue * expectedDrops);
    const itemSource = entityRef("item", { id: itemId, name, normalized_name: first.normalized_item_name });
    const publicSource = provenance("public_tibia_reference", {
      source_ref: itemSource,
      source_id: itemId,
      imported_at: first.fetched_at
    });
    const marketSource = provenance("market_sync", {
      source_ref: itemId ? entityRef("market_observation", { id: itemId, name }) : null,
      observed_at: first.market_finished_at
    });
    const explanations: InsightExplanation[] = [];
    if (unitValue === null) {
      explanations.push(explanation("unknown value", "warning", "No market or NPC sell value is available for this expected loot item.", {
        source_refs: [itemSource],
        provenance: [publicSource],
        missing_data_reason: "Missing local market/NPC value."
      }));
    }
    if (first.market_finished_at === null) {
      explanations.push(explanation("market sync missing", "blocked", "Expected loot exists, but local market weighting is unavailable.", {
        source_refs: [itemSource],
        provenance: [marketSource],
        missing_data_reason: "Run market sync before market-weighted loot estimates are available."
      }));
    }
    return {
      item_id: itemId,
      name,
      normalized_item_name: normalizeLootItemName(first.normalized_item_name || name),
      creature_names: Array.from(new Set(itemRows.map((row) => row.creature_name))).sort((a, b) => a.localeCompare(b)),
      rarity: first.rarity,
      chance_percent: averageChance,
      min_count: first.min_count,
      max_count: first.max_count,
      amount_text: first.amount_text,
      estimated_unit_value: unitValue,
      estimated_drop_value: estimatedDropValue,
      value_strategy: strategy,
      market: {
        trend: first.trend,
        liquidity: first.liquidity,
        confidence: first.market_confidence,
        sell_offer: first.sell_offer,
        month_sold: first.month_sold,
        day_sold: first.day_sold
      },
      confidence: buildConfidence(unitValue === null ? null : first.market_confidence ?? 0.45, {
        estimated: true,
        missingDataReason: unitValue === null ? "Missing local price evidence." : null
      }),
      freshness: buildFreshness(latestIso(first.market_finished_at, first.fetched_at), {
        staleAfterHours: STALE_MARKET_HOURS,
        agingAfterHours: AGING_MARKET_HOURS,
        missingDataReason: first.market_finished_at ? null : "No local market sync is available."
      }),
      provenance: first.market_finished_at ? [publicSource, marketSource] : [publicSource],
      explanations
    };
  }).sort((a, b) => (b.estimated_drop_value ?? -1) - (a.estimated_drop_value ?? -1));
}

function summarizePersonalHunt(row: HuntRow): PersonalHuntSummary {
  const xpPerHour = perHour(row.total_xp, row.duration_minutes);
  const profit = Math.round(row.total_loot_gold - row.total_supply_cost);
  const profitPerHour = perHour(profit, row.duration_minutes);
  const supplyCostPerHour = perHour(row.total_supply_cost, row.duration_minutes);
  const source = provenance("personal_hunt", {
    source_ref: entityRef("hunt", { id: row.id, name: row.label }),
    source_id: row.id,
    observed_at: row.ended_at ?? row.started_at ?? row.uploaded_at,
    manual: row.hunting_place_match_manual === 1
  });

  return {
    id: row.id,
    label: row.label,
    duration_minutes: row.duration_minutes,
    started_at: row.started_at,
    ended_at: row.ended_at,
    uploaded_at: row.uploaded_at,
    character_name: row.character_name,
    character_vocation: row.character_vocation,
    character_level: row.character_level,
    character_world: row.character_world,
    xp: row.total_xp,
    raw_xp: row.raw_total_xp,
    xp_per_hour: xpPerHour,
    loot_gold: row.total_loot_gold,
    supply_cost: row.total_supply_cost,
    profit,
    profit_per_hour: profitPerHour,
    supply_cost_per_hour: supplyCostPerHour,
    match: {
      public_hunting_place_id: row.public_hunting_place_id,
      confidence: buildConfidence(row.hunting_place_confidence, { manual: row.hunting_place_match_manual === 1 }),
      status: row.hunting_place_match_status,
      mode: row.hunting_place_match_mode,
      readiness: row.hunting_place_match_readiness,
      manual: row.hunting_place_match_manual === 1
    },
    provenance: [source]
  };
}

function summarizePersonal(hunts: PersonalHuntSummary[]): HuntingPlaceDetail["personal"]["summary"] {
  const xpRates = hunts.map((hunt) => hunt.xp_per_hour).filter((value): value is number => value !== null);
  const profitRates = hunts.map((hunt) => hunt.profit_per_hour).filter((value): value is number => value !== null);
  const supplyRates = hunts.map((hunt) => hunt.supply_cost_per_hour).filter((value): value is number => value !== null);
  const recent = hunts[0] ?? null;
  const provenanceRows = hunts.flatMap((hunt) => hunt.provenance);
  const explanations: InsightExplanation[] = [];
  if (!hunts.length) {
    explanations.push(explanation("no personal hunts", "neutral", "No saved hunts are linked to this public hunting place yet.", {
      missing_data_reason: "Save or rematch hunts with this public hunting-place link to populate personal performance."
    }));
  }

  return {
    hunt_count: hunts.length,
    total_duration_minutes: hunts.reduce((acc, hunt) => acc + hunt.duration_minutes, 0),
    total_xp: hunts.reduce((acc, hunt) => acc + hunt.xp, 0),
    total_profit: hunts.reduce((acc, hunt) => acc + hunt.profit, 0),
    total_supply_cost: hunts.reduce((acc, hunt) => acc + hunt.supply_cost, 0),
    best_xp_per_hour: xpRates.length ? Math.max(...xpRates) : null,
    median_xp_per_hour: median(xpRates),
    recent_xp_per_hour: recent?.xp_per_hour ?? null,
    best_profit_per_hour: profitRates.length ? Math.max(...profitRates) : null,
    median_profit_per_hour: median(profitRates),
    recent_profit_per_hour: recent?.profit_per_hour ?? null,
    best_supply_cost_per_hour: supplyRates.length ? Math.max(...supplyRates) : null,
    median_supply_cost_per_hour: median(supplyRates),
    recent_supply_cost_per_hour: recent?.supply_cost_per_hour ?? null,
    confidence: buildConfidence(hunts.length >= 5 ? 0.85 : hunts.length >= 2 ? 0.65 : hunts.length === 1 ? 0.45 : null, {
      missingDataReason: hunts.length ? null : "No personal observations."
    }),
    freshness: buildFreshness(recent?.ended_at ?? recent?.started_at ?? recent?.uploaded_at ?? null, {
      staleAfterHours: STALE_REFERENCE_HOURS,
      agingAfterHours: AGING_REFERENCE_HOURS,
      missingDataReason: hunts.length ? null : "No linked personal hunt timestamp."
    }),
    provenance: provenanceRows,
    explanations
  };
}

function parsePartyRows(raw: string): Array<{ vocation: string; level: number | null }> {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry) => {
      const record = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
      const vocation = typeof record.vocation === "string" ? record.vocation : "";
      const level = Number(record.level);
      return { vocation, level: Number.isFinite(level) && level > 0 ? Math.trunc(level) : null };
    }).filter((entry) => entry.vocation || entry.level !== null);
  } catch {
    return [];
  }
}

function levelBandForSession(session: PublicHuntSessionSummary): string | null {
  if (session.level_min === null && session.level_max === null) {
    return null;
  }
  const min = session.level_min ?? session.level_max;
  const max = session.level_max ?? session.level_min;
  if (min === null || max === null) {
    return null;
  }
  const floor = Math.floor(min / 100) * 100;
  const ceil = Math.max(floor + 99, Math.ceil(max / 100) * 100 + 99);
  return `${floor}-${ceil}`;
}

function summarizePublicHunt(row: PublicHuntSessionRow): PublicHuntSessionSummary {
  const party = parsePartyRows(row.party_json);
  const levels = party.map((entry) => entry.level).filter((level): level is number => level !== null);
  const vocations = Array.from(new Set(party.map((entry) => entry.vocation).filter(Boolean))).sort();
  const source = provenance("public_hunt_import", {
    source_ref: entityRef("hunt", { id: row.source_session_id, name: row.title }),
    source_id: row.source_session_id,
    observed_at: row.observed_at,
    imported_at: row.refreshed_at
  });
  return {
    id: row.id,
    source_session_id: row.source_session_id,
    source_url: row.source_url,
    title: row.title,
    observed_at: row.observed_at,
    duration_minutes: row.duration_minutes,
    party_size: row.party_size,
    level_min: levels.length ? Math.min(...levels) : null,
    level_max: levels.length ? Math.max(...levels) : null,
    vocations,
    xp_per_hour: row.xp_per_hour,
    raw_xp_per_hour: row.raw_xp_per_hour,
    profit_per_hour: row.profit_per_hour,
    balance_gold: row.balance_gold,
    confidence: buildConfidence(Math.min(row.parsed_confidence, row.hunting_place_confidence || row.parsed_confidence), { estimated: true }),
    provenance: [source]
  };
}

function summarizePublicSessions(
  sessions: PublicHuntSessionSummary[],
  creatures: PublicHuntCreatureSummary[]
): PublicHuntIntelligenceSummary["summary"] {
  const xpRates = sessions.map((session) => session.xp_per_hour).filter((value): value is number => value !== null);
  const rawXpRates = sessions.map((session) => session.raw_xp_per_hour).filter((value): value is number => value !== null);
  const profitRates = sessions.map((session) => session.profit_per_hour).filter((value): value is number => value !== null);
  const killRates = creatures.map((creature) => creature.kills_per_hour).filter((value): value is number => value !== null);
  const latest = sessions[0] ?? null;
  const explanations: InsightExplanation[] = [];
  if (!sessions.length) {
    explanations.push(explanation("no public sessions", "neutral", "No accepted public hunt imports are linked to this hunting place yet.", {
      missing_data_reason: "Run public hunt import and review matches to populate public ranges."
    }));
  }
  const levelBands = Array.from(new Set(sessions.map(levelBandForSession).filter((value): value is string => Boolean(value)))).slice(0, 6);
  const vocations = Array.from(new Set(sessions.flatMap((session) => session.vocations))).sort();
  return {
    session_count: sessions.length,
    matched_session_count: sessions.length,
    median_xp_per_hour: median(xpRates),
    min_xp_per_hour: xpRates.length ? Math.min(...xpRates) : null,
    max_xp_per_hour: xpRates.length ? Math.max(...xpRates) : null,
    median_raw_xp_per_hour: median(rawXpRates),
    median_profit_per_hour: median(profitRates),
    min_profit_per_hour: profitRates.length ? Math.min(...profitRates) : null,
    max_profit_per_hour: profitRates.length ? Math.max(...profitRates) : null,
    median_kills_per_hour: median(killRates),
    level_bands: levelBands,
    vocations,
    top_creatures: creatures,
    confidence: buildConfidence(sessions.length >= 10 ? 0.85 : sessions.length >= 3 ? 0.65 : sessions.length === 1 ? 0.45 : null, {
      estimated: true,
      missingDataReason: sessions.length ? null : "No accepted public session observations."
    }),
    freshness: buildFreshness(latest?.observed_at ?? null, {
      staleAfterHours: STALE_REFERENCE_HOURS,
      agingAfterHours: AGING_REFERENCE_HOURS,
      missingDataReason: sessions.length ? null : "No public hunt import timestamp."
    }),
    provenance: sessions.flatMap((session) => session.provenance),
    explanations
  };
}

function suitability(place: HuntingPlaceRow, personal: HuntingPlaceDetail["personal"]["summary"]): HuntingPlaceDetail["suitability"] {
  const signals: InsightExplanation[] = [];
  if (place.risk_level) {
    signals.push(explanation(`${place.risk_level} risk`, place.risk_level.toLowerCase().includes("high") ? "warning" : "neutral", "Public reference risk label is available.", {
      source_refs: [entityRef("hunting_place", { id: place.id, name: place.name })],
      provenance: [provenance("public_tibia_reference", { source_id: place.id, imported_at: place.fetched_at })]
    }));
  }
  if (personal.hunt_count > 0 && personal.median_profit_per_hour !== null) {
    signals.push(explanation(personal.median_profit_per_hour >= 0 ? "profitable in your hunts" : "loss in your hunts", personal.median_profit_per_hour >= 0 ? "positive" : "warning", "Personal linked hunts provide observed profit data.", {
      provenance: personal.provenance
    }));
  }
  if (!place.min_level && !place.max_level) {
    signals.push(explanation("level range missing", "neutral", "Public reference does not expose a level range for this place yet.", {
      missing_data_reason: "No min/max level in public hunting-place data."
    }));
  }

  const levelBand = place.min_level || place.max_level
    ? `${place.min_level ?? "?"}-${place.max_level ?? "?"}`
    : "unknown";
  const safetyLabel = place.risk_level
    ? place.risk_level
    : place.min_level && place.min_level >= 250
      ? "higher level"
      : "unknown";

  return {
    level_band: levelBand,
    safety_label: safetyLabel,
    signals,
    warning_labels: labelsFromExplanations(signals, "warning"),
    positive_labels: labelsFromExplanations(signals, "positive")
  };
}

function marketWeighted(loot: HuntingPlaceLootSummary[]): HuntingPlaceDetail["reference"]["market_weighted_loot_value"] {
  const priced = loot.filter((item) => item.estimated_drop_value !== null);
  const totalEstimatedValue = priced.reduce((acc, item) => acc + (item.estimated_drop_value ?? 0), 0);
  const latestFreshness = loot
    .map((item) => item.freshness.last_updated)
    .reduce((best, current) => latestIso(best, current), null as string | null);
  const explanations = loot.flatMap((item) => item.explanations);
  if (!loot.length) {
    explanations.push(explanation("loot not enriched", "neutral", "No creature loot rows are available for this hunting place yet.", {
      missing_data_reason: "Public creature loot enrichment has not populated this place."
    }));
  }
  return {
    total_estimated_value: Math.round(totalEstimatedValue),
    priced_item_count: priced.length,
    total_item_count: loot.length,
    confidence: buildConfidence(loot.length ? priced.length / loot.length : null, {
      estimated: true,
      missingDataReason: loot.length ? null : "No expected loot rows."
    }),
    freshness: buildFreshness(latestFreshness, {
      staleAfterHours: STALE_MARKET_HOURS,
      agingAfterHours: AGING_MARKET_HOURS,
      missingDataReason: latestFreshness ? null : "No market-weighted loot timestamp."
    }),
    provenance: Array.from(new Map(loot.flatMap((item) => item.provenance).map((entry) => [`${entry.type}:${entry.source_id ?? ""}:${entry.observed_at ?? entry.imported_at ?? ""}`, entry])).values()),
    explanations
  };
}

function placeholder(publicHuntingPlaceId: number, reason: string): PlaceholderSection {
  return {
    status: "unavailable",
    available: false,
    reason,
    public_hunting_place_id: publicHuntingPlaceId
  };
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function taskboardRelevance(db: Database.Database, publicHuntingPlaceId: number): IntegrationSection {
  if (!hasTable(db, "taskboard_entries")) {
    return placeholder(publicHuntingPlaceId, "Taskboard storage has not been migrated yet.");
  }
  const rows = db.prepare(`
    WITH place_creatures AS (
      SELECT normalized_creature_name
      FROM public_hunting_place_creatures
      WHERE hunting_place_id = ?
    ),
    place_loot AS (
      SELECT DISTINCT pcl.normalized_item_name, pcl.item_id
      FROM public_hunting_place_creatures hpc
      JOIN public_creature_loot pcl ON pcl.creature_id = hpc.creature_id
        OR pcl.normalized_item_name != ''
      WHERE hpc.hunting_place_id = ?
        AND pcl.creature_id = hpc.creature_id
    )
    SELECT DISTINCT entry.id, entry.entry_type, COALESCE(entry.matched_name, entry.offer_text) AS name, entry.required_quantity,
           entry.normalized_name, entry.item_id, entry.updated_at
    FROM taskboard_entries entry
    LEFT JOIN place_creatures pc ON pc.normalized_creature_name = entry.normalized_name
    LEFT JOIN place_loot loot ON (entry.item_id IS NOT NULL AND loot.item_id = entry.item_id)
      OR (entry.entry_type = 'item' AND loot.normalized_item_name = entry.normalized_name)
    WHERE pc.normalized_creature_name IS NOT NULL OR loot.normalized_item_name IS NOT NULL OR loot.item_id IS NOT NULL
    ORDER BY entry.created_at, entry.id
    LIMIT 8
  `).all(publicHuntingPlaceId, publicHuntingPlaceId) as Array<Record<string, unknown>>;

  return {
    status: "available",
    available: true,
    reason: rows.length ? "Open taskboard entries match this place's creatures or drops." : "No active taskboard entries currently match this place.",
    public_hunting_place_id: publicHuntingPlaceId,
    summary: {
      matching_tasks: rows.length,
      creature_tasks: rows.filter((row) => row.entry_type === "creature").length,
      delivery_tasks: rows.filter((row) => row.entry_type === "item").length
    },
    items: rows
  };
}

function bestiaryRelevance(db: Database.Database, publicHuntingPlaceId: number): IntegrationSection {
  if (!hasTable(db, "bestiary_states")) {
    return placeholder(publicHuntingPlaceId, "Bestiary state storage has not been migrated yet.");
  }
  const rows = db.prepare(`
    SELECT hpc.creature_id AS public_creature_id,
           COALESCE(state.creature_name, pc.name, hpc.creature_name) AS creature_name,
           hpc.normalized_creature_name,
           COALESCE(state.state, 'unknown') AS state,
           COALESCE(state.current_kill_count, 0) AS current_kill_count,
           COALESCE(state.target_kill_count, pc.total_kills) AS target_kill_count,
           pc.charm_points,
           pc.bestiary_difficulty
    FROM public_hunting_place_creatures hpc
    LEFT JOIN public_creatures pc ON pc.id = hpc.creature_id OR pc.normalized_name = hpc.normalized_creature_name
    LEFT JOIN bestiary_states state ON state.normalized_creature_name = hpc.normalized_creature_name
      AND state.scope_type = 'local'
      AND state.account_key = ''
      AND state.character_key = ''
    WHERE hpc.hunting_place_id = ?
    ORDER BY state.state = 'completed', COALESCE(pc.charm_points, 0) DESC, COALESCE(state.target_kill_count, pc.total_kills, 999999) - COALESCE(state.current_kill_count, 0), creature_name
    LIMIT 8
  `).all(publicHuntingPlaceId) as Array<Record<string, unknown>>;

  return {
    status: "available",
    available: true,
    reason: rows.length ? "Bestiary state can be compared with this place's known creatures." : "No local creature composition is available for bestiary matching yet.",
    public_hunting_place_id: publicHuntingPlaceId,
    summary: {
      matching_creatures: rows.length,
      incomplete: rows.filter((row) => row.state !== "completed" && row.state !== "ignored").length,
      charm_points: rows.reduce((sum, row) => sum + Number(row.charm_points || 0), 0)
    },
    items: rows
  };
}

export function getHuntingPlaceDetail(db: Database.Database, publicHuntingPlaceIdInput: unknown): HuntingPlaceDetailResult {
  const publicHuntingPlaceId = asPositiveInteger(publicHuntingPlaceIdInput) ?? 0;
  if (!publicHuntingPlaceId) {
    return { ok: false, error: "Invalid public_hunting_place_id", public_hunting_place_id: publicHuntingPlaceId };
  }

  const place = fetchPlace(db, publicHuntingPlaceId);
  if (!place) {
    return { ok: false, error: "Hunting place not found", public_hunting_place_id: publicHuntingPlaceId };
  }

  const placePayload = parseJsonObject(place.payload_json);
  const placeFreshness = buildFreshness(latestIso(place.last_updated, place.last_seen, place.fetched_at), {
    staleAfterHours: STALE_REFERENCE_HOURS,
    agingAfterHours: AGING_REFERENCE_HOURS
  });
  const placeSource = provenance("public_tibia_reference", {
    source_ref: entityRef("hunting_place", { id: place.id, name: place.name, normalized_name: place.normalized_name }),
    source_id: place.id,
    imported_at: place.fetched_at
  });
  const creatures = summarizeCreatures(fetchCreatures(db, publicHuntingPlaceId));
  const expectedLoot = summarizeLoot(fetchLoot(db, publicHuntingPlaceId));
  const personalHunts = fetchPersonalHunts(db, publicHuntingPlaceId).map(summarizePersonalHunt);
  const personalSummary = summarizePersonal(personalHunts);
  const publicSessions = fetchPublicHuntSessions(db, publicHuntingPlaceId).map(summarizePublicHunt);
  const publicSessionSummary = summarizePublicSessions(publicSessions, fetchPublicHuntCreatures(db, publicHuntingPlaceId));
  const marketLoot = marketWeighted(expectedLoot);
  const suitabilitySignals = suitability(place, personalSummary);
  const dataExplanations: InsightExplanation[] = [
    ...marketLoot.explanations,
    ...personalSummary.explanations,
    ...publicSessionSummary.explanations,
    ...suitabilitySignals.signals
  ];
  if (!creatures.length) {
    dataExplanations.push(explanation("creatures missing", "warning", "No public creature list is available for this hunting place.", {
      missing_data_reason: "Public hunting-place detail enrichment may be incomplete.",
      provenance: [placeSource]
    }));
  }
  const coreFields = [place.location, place.min_level, place.max_level, place.risk_level, place.exp_stars, place.loot_stars];
  const fieldCoverage = coreFields.filter((value) => value !== null && value !== "").length / coreFields.length;
  const enrichmentBonus = creatures.length > 0 ? 0.2 : 0;
  const lootBonus = expectedLoot.length > 0 ? 0.2 : 0;
  const payloadBonus = Object.keys(placePayload).length > 0 ? 0.1 : 0;
  const overallConfidence = buildConfidence(Math.min(1, 0.25 + fieldCoverage * 0.25 + enrichmentBonus + lootBonus + payloadBonus), {
    estimated: true
  });

  return {
    ok: true,
    public_hunting_place_id: publicHuntingPlaceId,
    place: {
      public_hunting_place_id: place.id,
      name: place.name,
      normalized_name: place.normalized_name,
      location: place.location,
      min_level: place.min_level,
      max_level: place.max_level,
      exp_stars: place.exp_stars,
      loot_stars: place.loot_stars,
      bestiary_stars: place.bestiary_stars,
      risk_level: place.risk_level,
      source: "public_reference",
      provenance: [placeSource],
      freshness: placeFreshness,
      confidence: buildConfidence(0.8 + Math.min(0.15, fieldCoverage * 0.15), { estimated: true })
    },
    reference: {
      creatures,
      expected_loot: expectedLoot,
      market_weighted_loot_value: marketLoot
    },
    personal: {
      hunts: personalHunts,
      summary: personalSummary
    },
    public_sessions: {
      sessions: publicSessions,
      summary: publicSessionSummary
    },
    suitability: suitabilitySignals,
    integrations: {
      bestiary: bestiaryRelevance(db, publicHuntingPlaceId),
      taskboard: taskboardRelevance(db, publicHuntingPlaceId)
    },
    data_quality: {
      confidence: overallConfidence,
      freshness: buildFreshness(latestIso(placeFreshness.last_updated, marketLoot.freshness.last_updated, personalSummary.freshness.last_updated, publicSessionSummary.freshness.last_updated), {
        staleAfterHours: STALE_REFERENCE_HOURS,
        agingAfterHours: AGING_REFERENCE_HOURS
      }),
      explanations: dataExplanations,
      provenance: [placeSource, ...marketLoot.provenance, ...personalSummary.provenance, ...publicSessionSummary.provenance]
    }
  };
}
