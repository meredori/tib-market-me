import type Database from "better-sqlite3";
import { confidence as buildConfidence, entityRef, explanation, provenance } from "../intelligence/metadata";
import type { Confidence, InsightExplanation, Provenance } from "../intelligence/types";
import {
  normalizePublicName,
  PublicTibiaDataClient,
  replacePublicHuntingPlaceChildren,
  upsertPublicHuntingPlace
} from "../tibiadata/publicReference";
import type { ParsedHuntText } from "./types";
import { asNumber, asNumberOrNull, asText } from "./utils";

export type HuntingPlaceCandidate = {
  id: number;
  name: string;
  location: string | null;
  confidence: number;
  status: "auto" | "review" | "unmatched";
  reasons: string[];
  explanations: InsightExplanation[];
  confidence_detail: Confidence;
  provenance: Provenance[];
  matched_monsters: string[];
  missing_monsters: string[];
};

export type HuntingPlaceMatchResult = {
  selected_hunting_place_id: number | null;
  selected_hunting_place_name: string | null;
  confidence: number;
  status: "auto" | "review" | "unmatched" | "manual" | "mixed_route" | "blocked";
  readiness: "ready" | "blocked" | "review" | "auto" | "manual" | "mixed_route" | "unmatched";
  readiness_reason: string | null;
  reasons: string[];
  explanations: InsightExplanation[];
  confidence_detail: Confidence;
  provenance: Provenance[];
  candidates: HuntingPlaceCandidate[];
  noise_creatures: string[];
};

type PlaceRow = {
  id: number;
  name: string;
  normalized_name: string;
  location: string | null;
  min_level: number | null;
  max_level: number | null;
  detail_status: string | null;
  area_names_json: string;
  creatures_json: string;
};

type HuntMonster = {
  name: string;
  normalized_name: string;
  count: number;
  weight: number;
};

const AUTO_CONFIDENCE = 0.72;
const REVIEW_CONFIDENCE = 0.46;
const AUTO_MARGIN = 0.12;
const NOISE_WEIGHT = 0.05;
const NOISE_COUNT = 5;

function tokenize(value: string): string[] {
  return normalizePublicName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function textSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of aTokens) {
    let tokenScore = 0;
    for (const candidate of bTokens) {
      if (candidate === token) {
        tokenScore = 1;
        break;
      }
      if (candidate.startsWith(token) || token.startsWith(candidate)) {
        tokenScore = Math.max(tokenScore, 0.82);
      }
    }
    overlap += tokenScore;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function parseJsonArray(value: unknown): string[] {
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

function huntMonsterSignature(monsters: ParsedHuntText["monsters"]): { core: HuntMonster[]; noise: HuntMonster[] } {
  const total = monsters.reduce((sum, monster) => sum + Math.max(0, asNumber(monster.count, 0)), 0);
  if (total <= 0) {
    return { core: [], noise: [] };
  }
  const relevant = monsters
    .map((monster) => ({
      name: asText(monster.name),
      normalized_name: normalizePublicName(asText(monster.name)),
      count: Math.max(0, asNumber(monster.count, 0)),
      weight: Math.max(0, asNumber(monster.count, 0)) / total
    }))
    .filter((monster) => monster.normalized_name && monster.count > 0)
    .sort((a, b) => b.count - a.count);

  const noise = relevant.filter((monster) => monster.weight < NOISE_WEIGHT && monster.count < NOISE_COUNT);
  const core = relevant.filter((monster) => monster.weight >= NOISE_WEIGHT || monster.count >= NOISE_COUNT);
  return {
    core: (core.length ? core : relevant.slice(0, 8)).slice(0, 12),
    noise
  };
}

function loadPlaceRows(db: Database.Database): PlaceRow[] {
  return db
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
          SELECT json_group_array(area_name)
          FROM public_hunting_place_area_summaries area
          WHERE area.hunting_place_id = place.id
        ), '[]') AS area_names_json,
        COALESCE((
          SELECT json_group_array(normalized_creature_name)
          FROM public_hunting_place_creatures creature
          WHERE creature.hunting_place_id = place.id
        ), '[]') AS creatures_json
      FROM public_hunting_places place
      ORDER BY place.name
    `
    )
    .all() as PlaceRow[];
}

export async function hydrateMissingHuntingPlaceDetailsForMatch(
  db: Database.Database,
  parsed: ParsedHuntText | null,
  locationName: string | null
): Promise<number> {
  if (!parsed?.monsters.length && !locationName) {
    return 0;
  }

  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = db
      .prepare(
        `
        SELECT
          place.id,
          place.name,
          place.location,
          COALESCE((
            SELECT COUNT(*)
            FROM public_hunting_place_creatures creature
            WHERE creature.hunting_place_id = place.id
          ), 0) AS creature_count,
          COALESCE((
            SELECT json_group_array(area_name)
            FROM public_hunting_place_area_summaries area
            WHERE area.hunting_place_id = place.id
          ), '[]') AS area_names_json
        FROM public_hunting_places place
        ORDER BY place.name
      `
      )
      .all() as Array<Record<string, unknown>>;
  } catch {
    return 0;
  }

  const candidates = rows
    .filter((row) => asNumber(row.creature_count, 0) === 0)
    .map((row) => {
      const names = [asText(row.name), asText(row.location), ...parseJsonArray(row.area_names_json)].filter(Boolean);
      const score = locationName ? Math.max(...names.map((name) => textSimilarity(locationName, name)), 0) : 0;
      return { id: asNumber(row.id, 0), name: asText(row.name), score };
    })
    .filter((row) => row.id > 0 && row.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  if (!candidates.length) {
    return 0;
  }

  const client = new PublicTibiaDataClient();
  let hydrated = 0;
  for (const candidate of candidates) {
    try {
      const payload = await client.getHuntingPlace(candidate.id || candidate.name);
      const place = upsertPublicHuntingPlace(db, payload);
      if (place) {
        replacePublicHuntingPlaceChildren(db, place.id, payload);
        hydrated += 1;
      }
    } catch {
      // Matching should still return staged candidates when live detail hydration is unavailable.
    }
  }

  return hydrated;
}

function scorePlace(
  row: PlaceRow,
  huntMonsters: HuntMonster[],
  locationName: string | null,
  characterLevel: number | null,
  sourceType: "personal_hunt" | "public_hunt_import" = "personal_hunt"
): HuntingPlaceCandidate {
  const placeCreatures = new Set(parseJsonArray(row.creatures_json));
  const matched = huntMonsters.filter((monster) => placeCreatures.has(monster.normalized_name));
  const missing = huntMonsters.filter((monster) => !placeCreatures.has(monster.normalized_name));
  const overlapWeight = matched.reduce((sum, monster) => sum + monster.weight, 0);
  const matchedRatio = huntMonsters.length ? matched.length / huntMonsters.length : 0;
  const monsterScore = Math.min(1, overlapWeight * 0.72 + matchedRatio * 0.28);

  const areaNames = parseJsonArray(row.area_names_json);
  const names = [row.name, row.location ?? "", ...areaNames].filter(Boolean);
  const locationScore = locationName
    ? Math.max(...names.map((name) => textSimilarity(locationName, name)), 0)
    : 0;

  let levelScore = 0;
  if (characterLevel !== null && (row.min_level !== null || row.max_level !== null)) {
    const min = row.min_level ?? 0;
    const max = row.max_level ?? Number.POSITIVE_INFINITY;
    if (characterLevel >= min && characterLevel <= max) {
      levelScore = 1;
    } else if (characterLevel < min) {
      levelScore = characterLevel >= min - 30 ? 0.45 : 0;
    } else if (Number.isFinite(max)) {
      levelScore = characterLevel <= max + 80 ? 0.35 : 0.1;
    }
  }

  const confidence = Number(Math.min(1, monsterScore * 0.74 + locationScore * 0.2 + levelScore * 0.06).toFixed(4));
  const reasons: string[] = [];
  if (matched.length) {
    reasons.push(`${matched.length} matching monster${matched.length === 1 ? "" : "s"}`);
  }
  if (locationScore >= 0.5) {
    reasons.push("location text matches staged place or sub-area");
  }
  if (levelScore >= 1) {
    reasons.push("character level fits staged range");
  }
  if (missing.length && overlapWeight >= 0.45) {
    reasons.push("partial overlap, possible sub-area/floor variant");
  }

  const status = confidence >= AUTO_CONFIDENCE ? "auto" : confidence >= REVIEW_CONFIDENCE ? "review" : "unmatched";
  const placeRef = entityRef("hunting_place", { id: row.id, name: row.name, normalized_name: row.normalized_name });
  const matchProvenance = [
    provenance("public_tibia_reference", { source_ref: placeRef }),
    provenance(sourceType),
    provenance("derived_calculation", { source_ref: placeRef })
  ];
  const explanations = reasons.length
    ? reasons.map((reason) => explanation(reason, status === "unmatched" ? "warning" : "neutral", reason, {
      source_refs: [placeRef],
      provenance: matchProvenance
    }))
    : [explanation("candidate needs review", "warning", "Candidate exists but needs review before it should be trusted.", {
      source_refs: [placeRef],
      provenance: matchProvenance
    })];

  return {
    id: asNumber(row.id, 0),
    name: asText(row.name),
    location: row.location ?? null,
    confidence,
    status,
    reasons,
    explanations,
    confidence_detail: buildConfidence(confidence, { estimated: true }),
    provenance: matchProvenance,
    matched_monsters: matched.map((monster) => monster.name),
    missing_monsters: missing.slice(0, 5).map((monster) => monster.name)
  };
}

export function scoreHuntingPlaceForHunt(
  db: Database.Database,
  placeId: number,
  parsed: ParsedHuntText | null,
  options: {
    locationName?: string | null;
    characterLevel?: number | null;
    sourceType?: "personal_hunt" | "public_hunt_import";
  } = {}
): HuntingPlaceCandidate | null {
  const signature = huntMonsterSignature(parsed?.monsters ?? []);
  const huntMonsters = signature.core;
  if (!huntMonsters.length) {
    return null;
  }
  let rows: PlaceRow[] = [];
  try {
    rows = loadPlaceRows(db);
  } catch {
    return null;
  }
  const row = rows.find((entry) => entry.id === Math.trunc(placeId));
  if (!row || !parseJsonArray(row.creatures_json).length) {
    return null;
  }
  return scorePlace(row, huntMonsters, options.locationName ?? null, options.characterLevel ?? null, options.sourceType ?? "personal_hunt");
}

function manualPlaceCandidate(row: PlaceRow, confidence = 1): HuntingPlaceCandidate {
  const placeRef = entityRef("hunting_place", { id: row.id, name: row.name, normalized_name: row.normalized_name });
  const matchProvenance = [
    provenance("manual_input", { manual: true, source_ref: placeRef }),
    provenance("public_tibia_reference", { source_ref: placeRef })
  ];
  return {
    id: asNumber(row.id, 0),
    name: asText(row.name),
    location: row.location ?? null,
    confidence,
    status: "auto",
    reasons: ["selected hunting spot"],
    explanations: [explanation("selected hunting spot", "neutral", "The user selected this hunting spot from imported reference data.", {
      source_refs: [placeRef],
      provenance: matchProvenance
    })],
    confidence_detail: buildConfidence(confidence, { manual: true }),
    provenance: matchProvenance,
    matched_monsters: [],
    missing_monsters: []
  };
}

function manualMatch(
  row: PlaceRow,
  candidates: HuntingPlaceCandidate[],
  noiseCreatures: string[],
  mode: "auto" | "suggest_only" | "mixed_route" | undefined
): HuntingPlaceMatchResult {
  const manual = candidates.find((candidate) => candidate.id === row.id) ?? manualPlaceCandidate(row);
  return {
    selected_hunting_place_id: manual.id,
    selected_hunting_place_name: manual.name,
    confidence: manual.confidence,
    status: mode === "mixed_route" ? "mixed_route" : "manual",
    readiness: mode === "mixed_route" ? "mixed_route" : "manual",
    readiness_reason: mode === "mixed_route" ? "User marked this hunt as a mixed route or travel hunt." : null,
    reasons: ["selected hunting spot", ...manual.reasons.filter((reason) => reason !== "selected hunting spot")],
    explanations: [
      explanation("selected hunting spot", "neutral", "The user selected this hunting spot from imported reference data.", {
        source_refs: [entityRef("hunting_place", { id: manual.id, name: manual.name })],
        provenance: [provenance("manual_input", { manual: true })]
      }),
      ...manual.explanations
    ],
    confidence_detail: buildConfidence(manual.confidence, { manual: true }),
    provenance: [provenance("manual_input", { manual: true }), ...manual.provenance],
    candidates: candidates.some((candidate) => candidate.id === manual.id) ? candidates : [manual, ...candidates].slice(0, 5),
    noise_creatures: noiseCreatures
  };
}

function blockedMatch(
  reason: string,
  detail: string,
  sourceType: "personal_hunt" | "public_hunt_import" = "personal_hunt"
): HuntingPlaceMatchResult {
  const sourceProvenance = [provenance("public_tibia_reference"), provenance(sourceType), provenance("derived_calculation")];
  return {
    selected_hunting_place_id: null,
    selected_hunting_place_name: null,
    confidence: 0,
    status: "blocked",
    readiness: "blocked",
    readiness_reason: detail,
    reasons: [reason],
    explanations: [explanation(reason, "blocked", detail, {
      missing_data_reason: detail,
      provenance: sourceProvenance
    })],
    confidence_detail: buildConfidence(0, { estimated: true, missingDataReason: detail }),
    provenance: sourceProvenance,
    candidates: [],
    noise_creatures: []
  };
}

export function matchHuntToHuntingPlaces(
  db: Database.Database,
  parsed: ParsedHuntText | null,
  options: {
    locationName?: string | null;
    characterLevel?: number | null;
    manualHuntingPlaceId?: number | null;
    mode?: "auto" | "suggest_only" | "mixed_route";
    sourceType?: "personal_hunt" | "public_hunt_import";
  } = {}
): HuntingPlaceMatchResult {
  const sourceType = options.sourceType ?? "personal_hunt";
  const signature = huntMonsterSignature(parsed?.monsters ?? []);
  const huntMonsters = signature.core;
  const noiseCreatures = signature.noise.map((monster) => monster.name);
  if (!huntMonsters.length) {
    return {
      selected_hunting_place_id: null,
      selected_hunting_place_name: null,
      confidence: 0,
      status: "unmatched",
      readiness: "blocked",
      readiness_reason: "No parsed monsters were found in the hunt text.",
      reasons: ["no parsed monsters"],
      explanations: [explanation("no parsed monsters", "blocked", "Automatic hunting-place matching needs parsed monster kills.", {
        missing_data_reason: "No parsed monsters were found in the hunt text.",
        provenance: [provenance(sourceType), provenance("derived_calculation")]
      })],
      confidence_detail: buildConfidence(0, { estimated: true, missingDataReason: "No parsed monsters were found." }),
      provenance: [provenance(sourceType), provenance("derived_calculation")],
      candidates: [],
      noise_creatures: noiseCreatures
    };
  }

  let rows: PlaceRow[] = [];
  try {
    rows = loadPlaceRows(db);
  } catch {
    return blockedMatch("public hunting-place data is not staged yet", "Run public reference sync before matching can rely on hunting-place data.", sourceType);
  }

  if (!rows.length) {
    return blockedMatch("public hunting-place data is not staged yet", "Run public reference sync before matching can rely on hunting-place data.", sourceType);
  }

  const manualId = options.manualHuntingPlaceId && options.manualHuntingPlaceId > 0
    ? Math.trunc(options.manualHuntingPlaceId)
    : null;
  const manualRow = manualId ? rows.find((row) => row.id === manualId) ?? null : null;

  const enrichedRows = rows.filter((row) => parseJsonArray(row.creatures_json).length > 0);
  if (!enrichedRows.length && !manualRow) {
    return blockedMatch("missing enriched hunting-place creature data", "Run public reference enrichment before matching can compare hunt monsters to hunting places.", sourceType);
  }

  const candidates = enrichedRows
    .map((row) => scorePlace(row, huntMonsters, options.locationName ?? null, options.characterLevel ?? null, sourceType))
    .filter((candidate) => candidate.confidence >= REVIEW_CONFIDENCE || candidate.matched_monsters.length > 0)
    .sort((a, b) => b.confidence - a.confidence || b.matched_monsters.length - a.matched_monsters.length || a.name.localeCompare(b.name))
    .slice(0, 5);

  if (manualRow) {
    return manualMatch(manualRow, candidates, noiseCreatures, options.mode);
  }

  if (options.mode === "mixed_route") {
    return {
      selected_hunting_place_id: null,
      selected_hunting_place_name: null,
      confidence: candidates[0]?.confidence ?? 0,
      status: "mixed_route",
      readiness: "mixed_route",
      readiness_reason: "User marked this hunt as a mixed route or travel hunt.",
      reasons: ["mixed route/travel hunt"],
      explanations: [explanation("mixed route/travel hunt", "neutral", "The user marked this hunt as a mixed route or travel hunt.", {
        provenance: [provenance("manual_input", { manual: true }), provenance("derived_calculation")]
      })],
      confidence_detail: buildConfidence(candidates[0]?.confidence ?? 0, { manual: true }),
      provenance: [provenance("manual_input", { manual: true }), provenance("derived_calculation")],
      candidates,
      noise_creatures: noiseCreatures
    };
  }

  const best = candidates[0] ?? null;
  const runnerUp = candidates[1] ?? null;
  const runnerUpConfidence = runnerUp?.confidence ?? 0;
  const onlyHighCandidate = Boolean(best && best.confidence >= 0.75 && runnerUpConfidence < 0.75);
  const auto = Boolean(best && best.confidence >= AUTO_CONFIDENCE && (best.confidence - runnerUpConfidence >= AUTO_MARGIN || onlyHighCandidate));

  return {
    selected_hunting_place_id: auto && best ? best.id : null,
    selected_hunting_place_name: auto && best ? best.name : null,
    confidence: best?.confidence ?? 0,
    status: auto ? "auto" : best && best.confidence >= REVIEW_CONFIDENCE ? "review" : "unmatched",
    readiness: auto ? "auto" : best && best.confidence >= REVIEW_CONFIDENCE ? "review" : "unmatched",
    readiness_reason: best ? null : "No enriched hunting-place candidate matched the parsed monsters.",
    reasons: best?.reasons.length ? best.reasons : best ? ["candidate needs review"] : ["no staged hunting-place candidate matched"],
    explanations: best?.explanations.length
      ? best.explanations
      : [explanation(best ? "candidate needs review" : "no match", best ? "warning" : "blocked", best ? "Candidate needs review before it should be trusted." : "No staged hunting-place candidate matched.", {
        missing_data_reason: best ? null : "No staged hunting-place candidate matched the parsed monsters.",
        provenance: [provenance("public_tibia_reference"), provenance(sourceType), provenance("derived_calculation")]
      })],
    confidence_detail: buildConfidence(best?.confidence ?? 0, {
      estimated: true,
      missingDataReason: best ? null : "No staged hunting-place candidate matched the parsed monsters."
    }),
    provenance: best?.provenance ?? [provenance("public_tibia_reference"), provenance(sourceType), provenance("derived_calculation")],
    candidates,
    noise_creatures: noiseCreatures
  };
}
