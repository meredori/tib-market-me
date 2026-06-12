# Implementation Plan

## Completed Foundation Summary

- Hunt backend structure, parser/cache/enrichment/repository split, and focused Vitest coverage are complete.
- Obsolete pricing parity exports are removed; `itemprices.json` is the only supported generated pricing export.
- Vue/Vite remains the frontend stack.
- HuntLens/HuntOps shell, dashboard, hunt workspace, history, item lookup, settings, modals, and component split are complete.
- Character lookup groundwork is complete, including cached TibiaData character search and character context on saved hunts.
- Existing Hunt History filtering/sorting is already delivered and is no longer a future phase.
- Playwright smoke tests are intentionally deferred until the larger product surfaces settle.

## Decisions Locked In

- Use Vitest and Playwright when they are the right fit.
- Backend tests can use mocked database boundaries or in-memory SQLite where that gives better migration/query confidence.
- Keep recorded or fixture-shaped external API payloads in tests.
- Store public Tibia reference data in normalized SQLite tables while retaining source payload JSON and source timestamps.
- Start public reference import narrowly with creatures, creature loot, and hunting places before wider quest/spell/NPC/location data.
- Keep Tibia market price data separate from public metadata.
- Keep existing hunt create/update/delete and item override behavior stable.
- Keep `itemprices.json` generation unchanged.

## Phase 1: Public Reference Data Foundation - Completed

1. [x] Add normalized local tables for public TibiaData-backed core reference data.
   - Store creatures, creature loot, hunting places, hunting-place creatures, hunting-place area summaries, and sync run history.
   - Preserve source payload JSON and source `last_updated` / `last_seen` style timestamps where available.

2. [x] Build the first public TibiaData import client.
   - Use the `public-api.json` endpoint shape for creatures and hunting places.
   - Fetch the paged creature catalog first with the API's 100-item maximum page size, then hydrate details by id/name only when requested.
   - Keep the parser tolerant of small payload envelope differences.

3. [x] Add sync tooling that can be safely rerun.
   - Add CLI command `npm --prefix server run sync:public`.
   - Add `GET /api/public-reference/status`.
   - Add `POST /api/public-reference/sync`.
   - Add Settings controls to sync public reference data into the local database and show local counts/status.
   - Prioritize never-synced creatures and hunting places before refreshing existing local rows.
   - Keep Settings sync catalog-first to avoid a large burst of detail/loot API calls.
   - Make creature, loot, hunting-place, and child-table writes idempotent.

4. [x] Add backend tests using fixture-shaped public API responses.
   - Creature normalization and timestamp retention.
   - Hunting-place normalization and timestamp retention.
   - End-to-end sync of creature details, creature loot, hunting places, area summaries, and idempotent reruns.

5. [x] Verification gate for this phase.
   - [x] `npm --prefix server test`
   - [x] `npm --prefix server run build`
   - [x] `npm --prefix server run migrate`

## Phase 2: Hunt-To-Hunting-Place Matching - Completed

1. [x] Map saved hunts to staged hunting places.
   - Score candidates using monster overlap, location text, aliases, level/vocation hints, and fuzzy matching.
   - Avoid letting travel kills dominate the match.
   - Support partial/sub-area, surface-only, lower-level, and floor-specific hunts.
   - Hydrate missing creature or hunting-place details on demand when a hunt needs them.

2. [x] Store and expose match results.
   - Store selected hunting-place id, confidence, match reasons, and alternate candidates on saved hunts.
   - Auto-assign only high-confidence matches.
   - Surface ambiguous or low-confidence matches for review.
   - Add a manual correction path in the hunt detail/edit workflow.

3. [x] Verification gate for this phase.
   - [x] Backend matching tests for exact overlap, partial overlap, aliases, travel-kill noise, and low-confidence no-match cases.
   - [x] `npm --prefix server test`
   - [x] `npm --prefix server run build`
   - [x] `npm --prefix ui-app run build`
   - [x] `npm --prefix server run migrate`

## Phase 3: Market Intelligence Dashboard - Completed

1. [x] Add backend market dashboard summary endpoints.
   - Historically cheap items compared against median/reference bands.
   - Looted items that look hot or worth listing.
   - Overall market activity/quietness from latest sync volume, item activity, and world freshness.
   - Recent notable movers and stale/low-confidence data warnings.

2. [x] Expand the Dashboard view into a market operations surface.
   - Show explainable reason labels such as `below historical band`, `high looted value`, and `low recent volume`.
   - Keep the existing home dashboard metrics and recent-hunt affordances separate from the Market view.
   - Add persisted market favorites/watchlist support from market rows, item lookup, and item details.
   - Move market operations into a dedicated `Market` navigation item that includes item lookup.

3. [x] Verification gate for this phase.
   - [x] Backend summary tests.
   - [x] `npm --prefix server test`
   - [x] `npm --prefix server run build`
   - [x] `npm --prefix server run migrate`
   - [x] `npm --prefix ui-app run build`

## Phase 4: Item Detail Modal Redesign

1. [ ] Redesign the item modal around high-value visible sections.
   - Item identity and image.
   - Current value and sale strategy.
   - Historical price range.
   - Market activity/liquidity.
   - Loot relevance from saved hunts where available.
   - Public metadata such as dropped by, NPC/vendor context, category, weight, and restrictions once staged data exists.

2. [ ] Move item override controls into Advanced.
   - Keep override save behavior unchanged.
   - Keep item lookup and loot-table item links opening the same modal.

3. [ ] Verification gate for this phase.
   - `npm --prefix ui-app run build`
   - Focused manual check from Item Lookup and loot-table item links.

## Phase 5: Market-Weighted Hunt Recommendations

1. [ ] Suggest hunting areas using staged hunting-place data plus current market pricing of expected drops.
   - Weight by selected/known character level, vocation where available, risk profile, expected loot value, XP/profit intent, and recent personal hunt performance.
   - Show why each area is recommended: matching level range, valuable drops, known risks, missing access requirements, and confidence.

2. [ ] Support recommendation modes.
   - Profit farming.
   - XP.
   - Bestiary progress.
   - Boss/bosstiary.
   - Quest unlock preparation.

3. [ ] Verification gate for this phase.
   - Backend recommendation tests with fixture characters, fixture market prices, and staged hunting-place data.
   - `npm --prefix server run build`
   - `npm --prefix ui-app run build`

## Phase 6: Bestiary, Bosstiary, And Taskboard Planning

1. [ ] Add bestiary and bosstiary planning data.
   - Stage categories, kill requirements, charm points, boss points, difficulty, and level requirements.
   - Add completion dashboards and hunt suggestions that can advance unfinished entries.

2. [ ] Add the weekly taskboard helper.
   - Player enters task monsters, task items, desired quantities, and optional character context.
   - Monster tasks suggest hunting areas that contain the monster.
   - Item tasks suggest monsters that drop the item and then relevant hunting areas.
   - Show market buy cost versus hunting estimate.
   - Label rough kill estimates clearly when drop data is sparse or uncertain.

3. [ ] Verification gate for this phase.
   - Backend planner tests for monster tasks, item tasks, market buy-vs-hunt calculations, and sparse drop-rate handling.
   - `npm --prefix server run build`
   - `npm --prefix ui-app run build`

## Phase 7: Quest, Unlock, And Progression Roadmaps

1. [ ] Stage quest, achievement, unlock, location, NPC, key, book, object, mount, and outfit data.
2. [ ] Build longer-term progression checklists.
3. [ ] Link unlocks back to relevant hunting places, items, NPCs, and recommendation warnings where source data supports it.
4. [ ] Track manual character/account unlock notes until a reliable character-specific source exists.
5. [ ] Verification gate: import tests, recommendation warning tests, server build, and UI build.

## Phase 8: Vocation Build And Character-Aware Planning

1. [ ] Stage spell and Wheel of Destiny data.
2. [ ] Add vocation-aware hunt recommendation filters.
3. [ ] Add required level checks, spell/tooling notes, and future build comparison views.
4. [ ] Verification gate: fixture tests for vocation/level filtering, server build, and UI build.

## Phase 9: World, Location, NPC, And Route Context

1. [ ] Add city, route, NPC, house/building, and location context around hunts, quests, vendors, and item sources.
2. [ ] Treat this as an experience layer after hunting-place matching and recommendation confidence are reliable.
3. [ ] Verification gate: import tests for location/NPC data, server build, and UI build.

## Phase 10: Hunt Analytics Product Rules

1. [ ] Define and implement normalized hunt rates.
   - Decide minimum duration thresholds, downtime handling, smoothing, and whether raw and normalized values appear together.

2. [ ] Define and implement hunt safety ratings.
   - Decide supply thresholds, waste-heavy intentional hunt handling, level-range behavior, and rating labels.
   - Add sorting/filtering by normalized metrics and safety rating once rules are locked.

3. [ ] Verification gate: backend analytics tests, server build, and UI build.

## Phase 11: Frontend Smoke Tests And Hardening

1. [ ] Add Playwright after major UI/product surfaces settle.
   - Add-new-hunt flow.
   - Paste/import hunt analyser text.
   - Parse preview.
   - Hydration result display.
   - Hide/restore loot rows.
   - Save new hunt.
   - Open/edit/save/delete previous hunt.
   - Market dashboard smoke path.
   - Item modal advanced override path.

2. [ ] Verification gate.
   - `npm --prefix ui-app run build`
   - Playwright smoke test command once added.

## Open Questions Before Later Phases

1. Define exact normalized-rate rules before Phase 10.
2. Define exact safety-rating labels and thresholds before Phase 10.
