import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrations";
import { getHuntingPlaceDetail } from "../huntingPlaces/intelligence";
import {
  checkPublicHunts,
  getPublicHuntStatus,
  listPublicHuntReviewQueue,
  parsePublicHuntDetail,
  parsePublicHuntList,
  reviewPublicHunt
} from ".";

let db: Database.Database;

function createDb(): Database.Database {
  const database = new Database(":memory:");
  applyMigrations(database);
  return database;
}

function seedPlace(): void {
  db.prepare(`
    INSERT INTO public_hunting_places (
      id, name, normalized_name, location, min_level, max_level, exp_stars, loot_stars,
      bestiary_stars, risk_level, last_updated, last_seen, fetched_at, payload_json
    ) VALUES (100, 'Dragon Lair', 'dragon lair', 'Venore', 80, 200, 3, 3, 2, 'medium', ?, ?, ?, '{}')
  `).run("2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z", "2026-06-01T00:00:00Z");
  db.prepare(`
    INSERT INTO public_hunting_place_creatures (
      hunting_place_id, creature_id, creature_name, normalized_creature_name, occurrence, payload_json
    ) VALUES (100, 200, 'Dragon', 'dragon', 'common', '{}')
  `).run();
}

function listHtml(): string {
  return `
    <div data-row-click-url-value="/hunt_sessions/48541">
      <h3>Dragon Lair Test</h3>
    </div>
    <div class="text-xs text-brand-ink-soft">
      Displaying hunt sessions <b>1&nbsp;-&nbsp;20</b> of <b>3,390</b> in total
    </div>
    <a href="/hunt_sessions?direction=&hunt_sessions_by=is_public&page=2&sort=">Next</a>
  `;
}

function detailHtml(id = 48541, title = "Dragon Lair Test"): string {
  return `
    <div id="hunt_session_${id}">
      <h1>${title}<a href="/hunt_sessions?hunt_sessions_by=is_public&search=Tester">by Tester</a></h1>
      <p class="text-sm text-brand-ink-soft">Jun 10, 2026 21:35</p>
      <div class="ha-panel">
        <h3>Hunt Summary</h3>
        <div>Session Duration</div><div>01:00h</div>
        <div>XP Gain:</div><div>1,200,000</div>
        <div>Balance:</div><div>250,000</div>
        <div>XP/h:</div><div>1,200,000</div>
        <div>Raw XP/h:</div><div>800,000</div>
        <span class="font-semibold">EK</span> <span class="font-mono text-[10px] font-semibold">120</span>
      </div>
      <div class="ha-panel">
        <h2>Monster Killed</h2>
        <table>
          <tr><th>#</th><th>Monster</th><th>Killed</th></tr>
          <tr><td>#1</td><td><img alt="Dragon" />Dragon</td><td>600</td></tr>
        </table>
      </div>
    </div>
  `;
}

beforeEach(() => {
  db = createDb();
});

afterEach(() => {
  db.close();
});

describe("public hunt parsing", () => {
  it("parses list entries and pagination metadata", () => {
    const parsed = parsePublicHuntList(listHtml());
    expect(parsed.total_count).toBe(3390);
    expect(parsed.next_page).toBe(2);
    expect(parsed.entries[0]).toMatchObject({
      source_session_id: "48541",
      source_url: "https://www.hunt-analyser.com/hunt_sessions/48541",
      title: "Dragon Lair Test"
    });
  });

  it("parses core detail fields and monster kills", () => {
    const parsed = parsePublicHuntDetail(detailHtml(), "https://www.hunt-analyser.com/hunt_sessions/48541", "48541");
    expect(parsed).toMatchObject({
      title: "Dragon Lair Test",
      author_label: "Tester",
      duration_minutes: 60,
      total_xp: 1200000,
      raw_xp_per_hour: 800000,
      xp_per_hour: 1200000,
      balance_gold: 250000,
      profit_per_hour: 250000,
      party_size: 1
    });
    expect(parsed.monsters).toEqual([{ name: "Dragon", count: 600 }]);
  });
});

describe("public hunt import", () => {
  it("imports new public hunts, dedupes source ids, and auto-accepts strong matches", async () => {
    seedPlace();
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listHtml()],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml()]
    ]);
    const fetcher = async (url: string) => {
      const value = pages.get(url);
      if (!value) {
        throw new Error(`Unexpected URL ${url}`);
      }
      return value;
    };

    const first = await checkPublicHunts(db, { limit: 1, fetcher, throttleMs: 0 });
    const second = await checkPublicHunts(db, { limit: 1, fetcher, throttleMs: 0 });
    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);

    const status = getPublicHuntStatus(db);
    expect(status.counts).toMatchObject({ total: 1, accepted: 1, matched: 1 });
    const queue = listPublicHuntReviewQueue(db).items as Array<Record<string, unknown>>;
    expect(queue).toHaveLength(0);
  });

  it("imports all public hunt pages and loads details concurrently", async () => {
    const listPage = (entries: string[], nextPage: number | null) => `
      ${entries.map((id) => `<div data-row-click-url-value="/hunt_sessions/${id}"><h3>Public Hunt ${id}</h3></div>`).join("\n")}
      <div class="text-xs text-brand-ink-soft">Displaying hunt sessions <b>1&nbsp;-&nbsp;20</b> of <b>3</b> in total</div>
      ${nextPage ? `<a href="/hunt_sessions?direction=&hunt_sessions_by=is_public&page=${nextPage}&sort=">Next</a>` : ""}
    `;
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listPage(["48541", "48542"], 2)],
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public&page=2", listPage(["48543"], null)],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml(48541, "Public Hunt 48541")],
      ["https://www.hunt-analyser.com/hunt_sessions/48542", detailHtml(48542, "Public Hunt 48542")],
      ["https://www.hunt-analyser.com/hunt_sessions/48543", detailHtml(48543, "Public Hunt 48543")]
    ]);
    let activeDetails = 0;
    let maxActiveDetails = 0;
    const result = await checkPublicHunts(db, {
      throttleMs: 0,
      concurrency: 2,
      fetcher: async (url) => {
        if (url.includes("/hunt_sessions/4854")) {
          activeDetails += 1;
          maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeDetails -= 1;
        }
        const value = pages.get(url);
        if (!value) {
          throw new Error(`Unexpected URL ${url}`);
        }
        return value;
      }
    });

    expect(result).toMatchObject({ imported: 3, skipped: 0, discovered: 3 });
    expect(maxActiveDetails).toBeGreaterThan(1);
    expect(getPublicHuntStatus(db).counts).toMatchObject({ total: 3 });
  });

  it("stops routine public hunt checks after the newest page is already imported", async () => {
    const listPage = (entries: string[], nextPage: number | null) => `
      ${entries.map((id) => `<div data-row-click-url-value="/hunt_sessions/${id}"><h3>Public Hunt ${id}</h3></div>`).join("\n")}
      <div class="text-xs text-brand-ink-soft">Displaying hunt sessions <b>1&nbsp;-&nbsp;20</b> of <b>4</b> in total</div>
      ${nextPage ? `<a href="/hunt_sessions?direction=&hunt_sessions_by=is_public&page=${nextPage}&sort=">Next</a>` : ""}
    `;
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listPage(["48541", "48542"], 2)],
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public&page=2", listPage(["48543", "48544"], null)],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml(48541, "Public Hunt 48541")],
      ["https://www.hunt-analyser.com/hunt_sessions/48542", detailHtml(48542, "Public Hunt 48542")],
      ["https://www.hunt-analyser.com/hunt_sessions/48543", detailHtml(48543, "Public Hunt 48543")],
      ["https://www.hunt-analyser.com/hunt_sessions/48544", detailHtml(48544, "Public Hunt 48544")]
    ]);
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      const value = pages.get(url);
      if (!value) {
        throw new Error(`Unexpected URL ${url}`);
      }
      return value;
    };

    const first = await checkPublicHunts(db, { throttleMs: 0, concurrency: 2, fetcher });
    requested.length = 0;
    const second = await checkPublicHunts(db, { throttleMs: 0, concurrency: 2, fetcher });

    expect(first).toMatchObject({ imported: 4, discovered: 4 });
    expect(second).toMatchObject({ imported: 0, skipped: 2, discovered: 2 });
    expect(requested).toEqual(["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public"]);
    expect(second.job.metadata).toMatchObject({ stop_reason: "known_pages", scope: "freshness_scan" });
  });

  it("continues past known newest pages when the older public hunt backfill has not completed", async () => {
    const listPage = (entries: string[], nextPage: number | null) => `
      ${entries.map((id) => `<div data-row-click-url-value="/hunt_sessions/${id}"><h3>Public Hunt ${id}</h3></div>`).join("\n")}
      <div class="text-xs text-brand-ink-soft">Displaying hunt sessions <b>1&nbsp;-&nbsp;20</b> of <b>4</b> in total</div>
      ${nextPage ? `<a href="/hunt_sessions?direction=&hunt_sessions_by=is_public&page=${nextPage}&sort=">Next</a>` : ""}
    `;
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listPage(["48541", "48542"], 2)],
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public&page=2", listPage(["48543", "48544"], null)],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml(48541, "Public Hunt 48541")],
      ["https://www.hunt-analyser.com/hunt_sessions/48542", detailHtml(48542, "Public Hunt 48542")],
      ["https://www.hunt-analyser.com/hunt_sessions/48543", detailHtml(48543, "Public Hunt 48543")],
      ["https://www.hunt-analyser.com/hunt_sessions/48544", detailHtml(48544, "Public Hunt 48544")]
    ]);
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      const value = pages.get(url);
      if (!value) {
        throw new Error(`Unexpected URL ${url}`);
      }
      return value;
    };

    const partial = await checkPublicHunts(db, { limit: 2, throttleMs: 0, concurrency: 2, fetcher });
    requested.length = 0;
    const backfill = await checkPublicHunts(db, { throttleMs: 0, concurrency: 2, fetcher });

    expect(partial).toMatchObject({ imported: 2, discovered: 2 });
    expect(partial.job.metadata).toMatchObject({ stop_reason: "limit_reached", scope: "limited" });
    expect(backfill).toMatchObject({ imported: 2, skipped: 2, discovered: 4 });
    expect(requested).toEqual([
      "https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public",
      "https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public&page=2",
      "https://www.hunt-analyser.com/hunt_sessions/48543",
      "https://www.hunt-analyser.com/hunt_sessions/48544"
    ]);
    expect(backfill.job.metadata).toMatchObject({ stop_reason: "end_of_pages", scope: "backfill_scan" });
  });

  it("keeps unmatched imports in review with a best guess and supports review actions", async () => {
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listHtml()],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml()]
    ]);
    await checkPublicHunts(db, {
      limit: 1,
      throttleMs: 0,
      fetcher: async (url) => pages.get(url) ?? ""
    });

    seedPlace();
    db.prepare(`
      UPDATE public_hunt_sessions
      SET hunting_place_alternates_json = ?,
        hunting_place_match_status = 'review',
        hunting_place_match_readiness = 'review'
      WHERE source_session_id = '48541'
    `).run(JSON.stringify([{ id: 100, name: "Dragon Lair", location: "Venore", confidence: 0.74 }]));

    const queue = listPublicHuntReviewQueue(db).items as Array<Record<string, unknown>>;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      current_hunting_place: { id: 100, name: "Dragon Lair", source: "best_guess" }
    });

    const reviewed = reviewPublicHunt(db, queue[0].id, { action: "accept_match" });
    expect(reviewed.ok).toBe(true);
    expect(getPublicHuntStatus(db).counts).toMatchObject({ accepted: 1, matched: 1 });
    expect(listPublicHuntReviewQueue(db).items).toHaveLength(0);

    const ignored = reviewPublicHunt(db, queue[0].id, { action: "ignore" });
    expect(ignored.ok).toBe(true);
    expect(getPublicHuntStatus(db).counts).toMatchObject({ ignored: 1 });
    expect(listPublicHuntReviewQueue(db).items).toHaveLength(0);
  });

  it("adds accepted public sessions to hunting-place intelligence without changing personal totals", async () => {
    seedPlace();
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listHtml()],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml()]
    ]);
    await checkPublicHunts(db, {
      limit: 1,
      throttleMs: 0,
      fetcher: async (url) => pages.get(url) ?? ""
    });

    const detail = getHuntingPlaceDetail(db, 100);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      expect(detail.personal.summary.hunt_count).toBe(0);
      expect(detail.public_sessions.summary.session_count).toBe(1);
      expect(detail.public_sessions.summary.median_xp_per_hour).toBe(1200000);
      expect(detail.public_sessions.summary.top_creatures[0]).toMatchObject({ name: "Dragon", kills: 600 });
    }
  });
});
