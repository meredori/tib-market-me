import type Database from "better-sqlite3";
import { config } from "../../config";
import { confidence as buildConfidence, entityRef, explanation, freshness as buildFreshness, provenance } from "../intelligence/metadata";
import type { InsightExplanation } from "../intelligence/types";
import type {
  HuntRecommendation,
  RecommendationFeedbackAction,
  RecommendationMode,
  RecommendationQuery,
  RecommendationRange
} from "./types";

const MODES: RecommendationMode[] = ["profit", "xp", "balanced", "bestiary", "taskboard", "safe", "short_session", "revisit", "new"];
const FEEDBACK_ACTIONS = new Set<RecommendationFeedbackAction>(["save", "reject", "not_interested", "access_unavailable", "too_risky"]);

type PlaceRow = {
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
  fetched_at: string | null;
  creature_count: number;
};

type CreatureRow = {
  hunting_place_id: number;
  creature_id: number | null;
  creature_name: string;
  normalized_creature_name: string;
  occurrence: string | null;
  experience: number | null;
};

type LootRow = {
  hunting_place_id: number;
  item_id: number | null;
  item_name: string;
  chance_percent: number | null;
  min_count: number | null;
  max_count: number | null;
  rarity: string | null;
  client_value: number | null;
  market_confidence: number | null;
  market_finished_at: string | null;
};

type HuntRow = {
  public_hunting_place_id: number;
  hunt_count: number;
  last_hunted_at: string | null;
  avg_profit_per_hour: number | null;
  avg_xp_per_hour: number | null;
  avg_duration_minutes: number | null;
};

type FeedbackRow = {
  public_hunting_place_id: number;
  mode: string;
  action: RecommendationFeedbackAction;
  created_at: string;
};

type TaskboardRow = {
  entry_type: string;
  normalized_name: string;
  matched_name: string | null;
};

type BestiaryRow = {
  normalized_creature_name: string;
  state: string;
  current_kill_count: number;
  target_kill_count: number | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function optionalText(value: unknown, maxLength: number): string | null {
  const text = asText(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function optionalPositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

export function parseRecommendationQuery(input: Record<string, unknown>): RecommendationQuery {
  const mode = MODES.includes(input.mode as RecommendationMode) ? input.mode as RecommendationMode : "balanced";
  const risk = asText(input.risk_preference).trim().toLowerCase();
  const limit = optionalPositiveInt(input.limit) ?? 12;
  return {
    mode,
    character_name: optionalText(input.character_name, 60),
    character_level: optionalPositiveInt(input.character_level),
    character_vocation: optionalText(input.character_vocation, 60),
    risk_preference: risk === "low" || risk === "medium" || risk === "high" ? risk : "any",
    limit: Math.max(1, Math.min(30, limit))
  };
}

function latestMarketRun(db: Database.Database): { id: number; finished_at: string } | null {
  return db.prepare(`
    SELECT id, finished_at
    FROM market_runs
    WHERE server = ?
    ORDER BY finished_at DESC, id DESC
    LIMIT 1
  `).get(config.serverName) as { id: number; finished_at: string } | undefined ?? null;
}

function readPlaces(db: Database.Database): PlaceRow[] {
  return db.prepare(`
    SELECT
      hp.id, hp.name, hp.normalized_name, hp.location, hp.min_level, hp.max_level,
      hp.exp_stars, hp.loot_stars, hp.bestiary_stars, hp.risk_level,
      hp.last_updated, hp.last_seen, hp.fetched_at,
      COUNT(DISTINCT hpc.normalized_creature_name) AS creature_count
    FROM public_hunting_places hp
    LEFT JOIN public_hunting_place_creatures hpc ON hpc.hunting_place_id = hp.id
    GROUP BY hp.id
    ORDER BY hp.name
  `).all() as PlaceRow[];
}

function readCreatures(db: Database.Database): Map<number, CreatureRow[]> {
  const rows = db.prepare(`
    SELECT hpc.hunting_place_id, hpc.creature_id, hpc.creature_name, hpc.normalized_creature_name,
           hpc.occurrence, pc.experience
    FROM public_hunting_place_creatures hpc
    LEFT JOIN public_creatures pc ON pc.id = hpc.creature_id
  `).all() as CreatureRow[];
  const byPlace = new Map<number, CreatureRow[]>();
  for (const row of rows) {
    byPlace.set(row.hunting_place_id, [...(byPlace.get(row.hunting_place_id) ?? []), row]);
  }
  return byPlace;
}

function readLoot(db: Database.Database, runId: number | null): Map<number, LootRow[]> {
  if (!runId) {
    return new Map();
  }
  const rows = db.prepare(`
    SELECT hpc.hunting_place_id, pcl.item_id, pcl.item_name, pcl.chance_percent, pcl.min_count, pcl.max_count, pcl.rarity,
           mip.client_value, mip.confidence AS market_confidence, mr.finished_at AS market_finished_at
    FROM public_hunting_place_creatures hpc
    JOIN public_creature_loot pcl ON pcl.creature_id = hpc.creature_id
    LEFT JOIN market_item_prices mip
      ON mip.run_id = ?
     AND mip.item_id = pcl.item_id
     AND mip.pricing_model = ?
    LEFT JOIN market_runs mr ON mr.id = mip.run_id
    ORDER BY hpc.hunting_place_id, COALESCE(mip.client_value, 0) DESC
  `).all(runId, config.pricingModel) as LootRow[];
  const byPlace = new Map<number, LootRow[]>();
  for (const row of rows) {
    byPlace.set(row.hunting_place_id, [...(byPlace.get(row.hunting_place_id) ?? []), row]);
  }
  return byPlace;
}

function readHunts(db: Database.Database, characterName: string | null): Map<number, HuntRow> {
  const values: unknown[] = [];
  let characterWhere = "";
  if (characterName) {
    characterWhere = "AND lower(character_name) = lower(?)";
    values.push(characterName);
  }
  const rows = db.prepare(`
    SELECT
      public_hunting_place_id,
      COUNT(*) AS hunt_count,
      MAX(COALESCE(ended_at, started_at, uploaded_at)) AS last_hunted_at,
      AVG(CASE WHEN duration_minutes > 0 THEN ((total_loot_gold - total_supply_cost) * 60.0 / duration_minutes) END) AS avg_profit_per_hour,
      AVG(CASE WHEN duration_minutes > 0 THEN (total_xp * 60.0 / duration_minutes) END) AS avg_xp_per_hour,
      AVG(duration_minutes) AS avg_duration_minutes
    FROM hunt_uploads
    WHERE public_hunting_place_id IS NOT NULL
      AND COALESCE(hunting_place_match_mode, '') != 'mixed_route'
      ${characterWhere}
    GROUP BY public_hunting_place_id
  `).all(...values) as HuntRow[];
  return new Map(rows.map((row) => [row.public_hunting_place_id, row]));
}

function readFeedback(db: Database.Database): Map<number, FeedbackRow[]> {
  if (!hasTable(db, "hunt_recommendation_feedback")) {
    return new Map();
  }
  const rows = db.prepare(`
    SELECT public_hunting_place_id, mode, action, created_at
    FROM hunt_recommendation_feedback
    ORDER BY created_at DESC, id DESC
  `).all() as FeedbackRow[];
  const byPlace = new Map<number, FeedbackRow[]>();
  for (const row of rows) {
    byPlace.set(row.public_hunting_place_id, [...(byPlace.get(row.public_hunting_place_id) ?? []), row]);
  }
  return byPlace;
}

function readTaskboard(db: Database.Database): TaskboardRow[] {
  if (!hasTable(db, "taskboard_entries")) {
    return [];
  }
  return db.prepare("SELECT entry_type, normalized_name, matched_name FROM taskboard_entries").all() as TaskboardRow[];
}

function readBestiary(db: Database.Database, characterName: string | null): BestiaryRow[] {
  if (!hasTable(db, "bestiary_states")) {
    return [];
  }
  const values: unknown[] = [];
  let where = "WHERE state NOT IN ('completed', 'ignored')";
  if (characterName) {
    where += " AND (scope_type != 'character' OR lower(character_name) = lower(?))";
    values.push(characterName);
  }
  return db.prepare(`
    SELECT normalized_creature_name, state, current_kill_count, target_kill_count
    FROM bestiary_states
    ${where}
  `).all(...values) as BestiaryRow[];
}

function latestIso(...values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function rangeFrom(value: number | null | undefined, labelSuffix: string, spread = 0.2): RecommendationRange | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return {
    low: Math.max(0, Math.round(value * (1 - spread))),
    high: Math.max(0, Math.round(value * (1 + spread))),
    label: `${Math.round(value * (1 - spread)).toLocaleString()}-${Math.round(value * (1 + spread)).toLocaleString()} ${labelSuffix}`,
    estimated: true,
    missing_data_reason: null
  };
}

function nullRangeReason(reason: string): RecommendationRange {
  return { low: 0, high: 0, label: "missing", estimated: true, missing_data_reason: reason };
}

function riskScore(risk: string | null): number {
  const text = asText(risk).toLowerCase();
  if (text.includes("low")) return 1;
  if (text.includes("medium")) return 0.58;
  if (text.includes("high")) return 0.2;
  return 0.45;
}

function levelFit(place: PlaceRow, characterLevel: number | null): number {
  if (!characterLevel || (!place.min_level && !place.max_level)) {
    return 0.5;
  }
  const min = place.min_level ?? 0;
  const max = place.max_level ?? Number.POSITIVE_INFINITY;
  if (characterLevel >= min && characterLevel <= max) {
    return 1;
  }
  if (characterLevel < min) {
    return characterLevel >= min - 30 ? 0.45 : 0.05;
  }
  return Number.isFinite(max) && characterLevel <= max + 80 ? 0.45 : 0.25;
}

function lootValue(rows: LootRow[]): { value: number | null; confidence: number | null; latest: string | null } {
  const priced = rows.filter((row) => typeof row.client_value === "number" && row.client_value > 0);
  if (!priced.length) {
    return { value: null, confidence: null, latest: null };
  }
  let value = 0;
  let confidenceTotal = 0;
  for (const row of priced) {
    const chance = typeof row.chance_percent === "number" && row.chance_percent > 0
      ? Math.min(row.chance_percent, 100) / 100
      : defaultDropChance(row.rarity);
    const count = ((row.min_count ?? 1) + (row.max_count ?? row.min_count ?? 1)) / 2;
    value += (row.client_value ?? 0) * chance * count;
    confidenceTotal += row.market_confidence ?? 0.45;
  }
  return {
    value,
    confidence: confidenceTotal / priced.length,
    latest: latestIso(...priced.map((row) => row.market_finished_at))
  };
}

function defaultDropChance(rarity: string | null): number {
  const text = asText(rarity).toLowerCase();
  if (text.includes("common")) return 0.08;
  if (text.includes("uncommon")) return 0.03;
  if (text.includes("rare")) return 0.01;
  if (text.includes("very") || text.includes("semi")) return 0.005;
  return 0.005;
}

function creatureXpValue(creatures: CreatureRow[]): number | null {
  const xpRows = creatures.filter((row) => typeof row.experience === "number" && row.experience > 0);
  if (!xpRows.length) {
    return null;
  }
  return xpRows.reduce((sum, row) => sum + Number(row.experience), 0) / xpRows.length;
}

function feedbackPenalty(feedback: FeedbackRow[], mode: RecommendationMode): { score: number; blockedAccess: boolean; reasons: string[] } {
  let score = 0;
  let blockedAccess = false;
  const reasons: string[] = [];
  for (const row of feedback.slice(0, 10)) {
    const applies = row.mode === mode || row.mode === "balanced" || mode === "balanced";
    if (!applies) {
      continue;
    }
    if (row.action === "save") {
      score += 0.12;
    } else if (row.action === "reject" || row.action === "not_interested") {
      score -= 0.3;
      reasons.push(row.action === "reject" ? "recently rejected" : "marked not interested");
    } else if (row.action === "too_risky") {
      score -= 0.22;
      reasons.push("marked too risky");
    } else if (row.action === "access_unavailable") {
      score -= 0.8;
      blockedAccess = true;
      reasons.push("access marked unavailable");
    }
  }
  return { score, blockedAccess, reasons };
}

function bestiaryMatch(creatures: CreatureRow[], states: BestiaryRow[]): { score: number; names: string[] } {
  const active = new Map(states.map((row) => [row.normalized_creature_name, row]));
  const names: string[] = [];
  let score = 0;
  for (const creature of creatures) {
    const state = active.get(creature.normalized_creature_name);
    if (!state) {
      continue;
    }
    names.push(creature.creature_name);
    const target = state.target_kill_count || 1000;
    const remaining = Math.max(0, target - state.current_kill_count);
    score += state.state === "in_progress" ? 0.25 + Math.min(0.5, remaining / target) : 0.45;
  }
  return { score: Math.min(1, score), names: Array.from(new Set(names)).slice(0, 5) };
}

function taskboardMatch(creatures: CreatureRow[], taskboard: TaskboardRow[]): { score: number; entries: string[] } {
  const creatureNames = new Set(creatures.map((row) => row.normalized_creature_name));
  const entries = taskboard
    .filter((row) => row.entry_type === "creature" && creatureNames.has(row.normalized_name))
    .map((row) => row.matched_name || row.normalized_name);
  return { score: Math.min(1, entries.length * 0.45), entries: Array.from(new Set(entries)).slice(0, 5) };
}

function scoreForMode(input: {
  mode: RecommendationMode;
  place: PlaceRow;
  levelFitScore: number;
  loot: number | null;
  xp: number | null;
  personal: HuntRow | undefined;
  bestiary: number;
  taskboard: number;
  risk: number;
  feedback: number;
}): number {
  const loot = Math.min(1, (input.loot ?? Number(input.place.loot_stars ?? 0) * 120) / 900);
  const xp = Math.min(1, (input.xp ?? Number(input.place.exp_stars ?? 0) * 300) / 1400);
  const history = input.personal?.hunt_count ? Math.min(1, input.personal.hunt_count / 4) : 0;
  const revisit = history * 0.8 + (input.personal?.avg_profit_per_hour ? 0.15 : 0);
  const novelty = history ? 0.1 : 0.85;
  const short = input.personal?.avg_duration_minutes ? (input.personal.avg_duration_minutes <= 45 ? 0.85 : 0.3) : input.risk * 0.55;
  const balanced = loot * 0.25 + xp * 0.25 + input.levelFitScore * 0.2 + input.risk * 0.12 + input.bestiary * 0.09 + input.taskboard * 0.09;
  const byMode: Record<RecommendationMode, number> = {
    profit: loot * 0.48 + (input.personal?.avg_profit_per_hour ? 0.28 : 0) + input.levelFitScore * 0.14 + input.risk * 0.1,
    xp: xp * 0.5 + (input.personal?.avg_xp_per_hour ? 0.22 : 0) + input.levelFitScore * 0.18 + input.risk * 0.1,
    balanced,
    bestiary: input.bestiary * 0.55 + xp * 0.16 + input.levelFitScore * 0.16 + input.risk * 0.13,
    taskboard: input.taskboard * 0.58 + input.levelFitScore * 0.16 + input.risk * 0.14 + loot * 0.12,
    safe: input.risk * 0.55 + input.levelFitScore * 0.25 + balanced * 0.2,
    short_session: short * 0.5 + input.risk * 0.22 + input.levelFitScore * 0.18 + loot * 0.1,
    revisit: revisit * 0.62 + balanced * 0.28 + input.risk * 0.1,
    new: novelty * 0.52 + balanced * 0.32 + input.levelFitScore * 0.16
  };
  return Number(Math.max(0, Math.min(1, byMode[input.mode] + input.feedback)).toFixed(4));
}

function splitExplanations(explanations: InsightExplanation[]): HuntRecommendation["explanations"] {
  return {
    reasons: explanations.filter((item) => item.severity === "positive" || item.severity === "neutral"),
    warnings: explanations.filter((item) => item.severity === "warning"),
    blockers: explanations.filter((item) => item.severity === "blocked"),
    missing_data: explanations.filter((item) => item.missing_data_reason)
  };
}

function signature(mode: RecommendationMode, placeId: number, characterLevel: number | null, characterVocation: string | null): string {
  return `${mode}:${placeId}:${characterLevel ?? "any"}:${asText(characterVocation).toLowerCase() || "any"}`;
}

export function listHuntRecommendations(db: Database.Database, rawQuery: Record<string, unknown> = {}): Record<string, unknown> {
  const query = parseRecommendationQuery(rawQuery);
  const marketRun = latestMarketRun(db);
  const places = readPlaces(db);
  const creaturesByPlace = readCreatures(db);
  const lootByPlace = readLoot(db, marketRun?.id ?? null);
  const huntsByPlace = readHunts(db, query.character_name);
  const feedbackByPlace = readFeedback(db);
  const taskboard = readTaskboard(db);
  const bestiaryStates = readBestiary(db, query.character_name);
  const items: HuntRecommendation[] = [];

  for (const place of places) {
    const creatures = creaturesByPlace.get(place.id) ?? [];
    const lootRows = lootByPlace.get(place.id) ?? [];
    const loot = lootValue(lootRows);
    const xp = creatureXpValue(creatures);
    const personal = huntsByPlace.get(place.id);
    const feedback = feedbackPenalty(feedbackByPlace.get(place.id) ?? [], query.mode);
    const bestiaryResult = bestiaryMatch(creatures, bestiaryStates);
    const taskboardMatchResult = taskboardMatch(creatures, taskboard);
    const fit = levelFit(place, query.character_level);
    const risk = riskScore(place.risk_level);
    const explanations: InsightExplanation[] = [];
    const missingData: string[] = [];

    if (query.risk_preference !== "any" && riskScore(query.risk_preference) > risk + 0.01) {
      explanations.push(explanation("risk preference mismatch", "warning", "This place is riskier than the selected preference.", {
        source_refs: [entityRef("hunting_place", { id: place.id, name: place.name })]
      }));
    }
    if (!creatures.length) {
      missingData.push("No enriched creature list.");
      explanations.push(explanation("creatures missing", "warning", "No public creature list is available for this hunting place.", {
        missing_data_reason: "Run public reference enrichment for hunting-place creatures."
      }));
    }
    if (!lootRows.length || loot.value === null) {
      missingData.push("No priced loot estimate.");
      explanations.push(explanation("loot estimate missing", "warning", "No market-weighted loot estimate is available.", {
        missing_data_reason: "Creature loot or market prices are missing."
      }));
    }
    if (!personal) {
      missingData.push("No personal hunt history.");
    }
    if (fit < 0.2) {
      explanations.push(explanation("level mismatch", "blocked", "Character level appears far outside this place's public range.", {
        blocker: true
      }));
    } else if (fit >= 1) {
      explanations.push(explanation("level fit", "positive", "Character level fits the public hunting-place range."));
    }
    if (loot.value !== null) {
      explanations.push(explanation("market loot", "positive", "Market-priced creature loot supports this recommendation.", {
        provenance: [provenance("derived_calculation", { label: "market-weighted loot" })]
      }));
    }
    if (personal?.hunt_count) {
      explanations.push(explanation("personal history", "positive", "Your saved hunts provide a personal comparison for this place.", {
        provenance: [provenance("personal_hunt", { label: "saved hunt history" })]
      }));
    }
    for (const reason of feedback.reasons) {
      explanations.push(explanation(reason, reason.includes("access") ? "blocked" : "warning", `Feedback says this place was ${reason}.`, {
        blocker: reason.includes("access")
      }));
    }
    if (bestiaryResult.names.length) {
      explanations.push(explanation("bestiary overlap", "positive", "This place contains creatures still relevant to your Bestiary checklist."));
    }
    if (taskboardMatchResult.entries.length) {
      explanations.push(explanation("taskboard overlap", "positive", "This place overlaps with active Taskboard entries."));
    }

    const score = scoreForMode({
      mode: query.mode,
      place,
      levelFitScore: fit,
      loot: loot.value,
      xp,
      personal,
      bestiary: bestiaryResult.score,
      taskboard: taskboardMatchResult.score,
      risk,
      feedback: feedback.score
    });
    const confidenceParts = [
      place.creature_count ? 0.2 : 0,
      loot.confidence !== null ? 0.25 * loot.confidence : 0,
      personal?.hunt_count ? Math.min(0.2, personal.hunt_count * 0.05) : 0,
      fit * 0.15,
      (place.min_level || place.max_level ? 0.1 : 0),
      (place.risk_level ? 0.1 : 0)
    ];
    const confidenceScore = confidenceParts.reduce((sum, value) => sum + value, 0);
    const expectedProfitBase = personal?.avg_profit_per_hour ?? (loot.value === null ? null : loot.value * 120);
    const expectedXpBase = personal?.avg_xp_per_hour ?? (xp === null ? null : xp * 220);
    const recommendationSignature = signature(query.mode, place.id, query.character_level, query.character_vocation);

    items.push({
      id: recommendationSignature,
      signature: recommendationSignature,
      mode: query.mode,
      score,
      place: {
        id: place.id,
        name: place.name,
        location: place.location,
        min_level: place.min_level,
        max_level: place.max_level,
        risk_level: place.risk_level
      },
      primary_reason: splitExplanations(explanations).reasons[0]?.reason ?? "Ranked from available hunting-place, market, and personal signals.",
      expected_xp: rangeFrom(expectedXpBase, "XP/h") ?? nullRangeReason("No personal XP pace or creature experience data."),
      expected_profit: rangeFrom(expectedProfitBase, "gp/h") ?? nullRangeReason("No personal profit pace or priced loot data."),
      confidence: buildConfidence(confidenceScore, { estimated: true, missingDataReason: missingData[0] ?? null }),
      freshness: buildFreshness(latestIso(place.last_updated, place.last_seen, place.fetched_at, loot.latest, personal?.last_hunted_at), {
        staleAfterHours: 24 * 14,
        agingAfterHours: 24 * 4
      }),
      provenance: [
        provenance("public_tibia_reference", { label: "public hunting-place reference" }),
        provenance("derived_calculation", { label: "recommendation scoring" })
      ],
      explanations: splitExplanations(explanations),
      valuable_drops: lootRows
        .filter((row) => typeof row.client_value === "number" && row.client_value > 0)
        .slice(0, 4)
        .map((row) => ({
          item_id: row.item_id,
          name: row.item_name,
          value: row.client_value,
          confidence: buildConfidence(row.market_confidence, { estimated: true })
        })),
      relevant_creatures: creatures.slice(0, 6).map((row) => ({
        id: row.creature_id,
        name: row.creature_name,
        occurrence: row.occurrence,
        experience: row.experience
      })),
      bestiary_relevance: {
        score: bestiaryResult.score,
        label: bestiaryResult.names.length ? `${bestiaryResult.names.length} active creature(s)` : "No active checklist overlap",
        creatures: bestiaryResult.names
      },
      taskboard_relevance: {
        score: taskboardMatchResult.score,
        label: taskboardMatchResult.entries.length ? `${taskboardMatchResult.entries.length} task overlap(s)` : "No active task overlap",
        entries: taskboardMatchResult.entries
      },
      known_risks: [place.risk_level ? `${place.risk_level} risk` : "Risk unknown"].concat(feedback.reasons.filter((item) => item.includes("risky"))),
      missing_data: Array.from(new Set(missingData)),
      access_warning: feedback.blockedAccess ? "unavailable" : "unknown",
      personal_history: {
        hunt_count: personal?.hunt_count ?? 0,
        last_hunted_at: personal?.last_hunted_at ?? null,
        profit_per_hour: rangeFrom(personal?.avg_profit_per_hour, "gp/h"),
        xp_per_hour: rangeFrom(personal?.avg_xp_per_hour, "XP/h"),
        comparison_label: personal?.hunt_count ? `${personal.hunt_count} saved hunt(s)` : "No saved personal hunts"
      }
    });
  }

  const sorted = items
    .filter((item) => query.risk_preference === "any" || !item.known_risks[0]?.toLowerCase().includes("high") || query.risk_preference === "high")
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, query.limit);

  return {
    ok: true,
    mode: query.mode,
    query,
    items: sorted,
    summary: {
      total_candidates: items.length,
      returned: sorted.length,
      market_snapshot_at: marketRun?.finished_at ?? null,
      feedback_count: Array.from(feedbackByPlace.values()).reduce((sum, rows) => sum + rows.length, 0)
    }
  };
}

export function saveRecommendationFeedback(db: Database.Database, body: Record<string, unknown>): Record<string, unknown> {
  const action = body.action as RecommendationFeedbackAction;
  if (!FEEDBACK_ACTIONS.has(action)) {
    throw new Error("Invalid feedback action");
  }
  const placeId = optionalPositiveInt(body.public_hunting_place_id);
  if (!placeId) {
    throw new Error("public_hunting_place_id is required");
  }
  const mode = MODES.includes(body.mode as RecommendationMode) ? body.mode as RecommendationMode : "balanced";
  const signatureValue = optionalText(body.recommendation_signature, 180) ?? signature(mode, placeId, optionalPositiveInt(body.character_level), optionalText(body.character_vocation, 60));
  const result = db.prepare(`
    INSERT INTO hunt_recommendation_feedback (
      recommendation_signature, public_hunting_place_id, mode, action, reason, notes,
      character_name, character_level, character_vocation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signatureValue,
    placeId,
    mode,
    action,
    optionalText(body.reason, 240),
    optionalText(body.notes, 1000),
    optionalText(body.character_name, 60),
    optionalPositiveInt(body.character_level),
    optionalText(body.character_vocation, 60)
  );
  return {
    ok: true,
    item: {
      id: Number(result.lastInsertRowid),
      recommendation_signature: signatureValue,
      public_hunting_place_id: placeId,
      mode,
      action
    }
  };
}
