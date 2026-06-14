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
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      display_status: "matched",
      matched_hunting_place: { id: 100, name: "Dragon Lair" }
    });
  });

  it("keeps unmatched imports in review and supports ignore review action", async () => {
    const pages = new Map<string, string>([
      ["https://www.hunt-analyser.com/hunt_sessions?hunt_sessions_by=is_public", listHtml()],
      ["https://www.hunt-analyser.com/hunt_sessions/48541", detailHtml()]
    ]);
    await checkPublicHunts(db, {
      limit: 1,
      throttleMs: 0,
      fetcher: async (url) => pages.get(url) ?? ""
    });

    const queue = listPublicHuntReviewQueue(db).items as Array<Record<string, unknown>>;
    expect(queue).toHaveLength(1);
    expect((queue[0].match as Record<string, unknown>).status).toBe("blocked");

    const reviewed = reviewPublicHunt(db, queue[0].id, { action: "ignore" });
    expect(reviewed.ok).toBe(true);
    expect(getPublicHuntStatus(db).counts).toMatchObject({ ignored: 1 });
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
