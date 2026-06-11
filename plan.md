# Implementation Plan

## Decisions Locked In

- Use Vitest and Playwright when they are the right fit.
- Backend tests can use a mocked database boundary.
- Backend tests should mock prepared statement calls directly.
- Keep recorded fixtures copied from real external item-detail responses.
- First hunt analyser module split must be behavior-preserving.
- Hydration state should be shown with icons rather than text-heavy labels:
  - cached/resolved: tick icon
  - missing/needs lookup: question mark icon
  - unavailable/error: exclamation/error icon
- Only the app-generated in-game `itemprices.json` matters now.
- The old `itemsprices.json`, `itemsprices.detailed.json`, and `itemsprices.meta.json` exports can be removed.
- Avoid frontend Playwright coverage until after the UI overhaul, because the current UI structure is likely to be replaced.
- Do a full theme/style pass before improving individual UI workflows.
- Gather visual concepts before implementing the UI overhaul, either through generated layout concepts or reference sites.
- Assess whether the expanded frontend scope justifies moving from Vue to a fuller app stack such as SvelteKit or Next.js.
- Refactor each app area into reusable components as that area is redesigned.
- Filtering/sorting is a good early analytics feature because it is mostly client-side.
- Phase 3 visual direction should combine the two favored concepts:
  - HuntLens (`samples/concepts/ChatGPT Image Jun 10, 2026, 09_00_19 PM.png`): focused hunt detail workspace with left navigation, dense metric strips, loot/monster analysis, and a right-side saved-hunt edit drawer.
  - HuntOps (`samples/concepts/ChatGPT Image Jun 10, 2026, 09_00_10 PM.png`): broader market and hunt operations console with compact top filters, weekly summary metrics, tabbed analytics, market tables, and alert/status panels.
- Character lookup and event detection need new backend endpoints.
- Normalization and safety rating need more product rules before implementation.
- Delete obsolete `itemsprices.*` files if they are no longer used after generation is removed.
- `public-api.json` is the TibiaData OpenAPI contract, not a direct data dump; use it to build typed import clients, migrations, and staging scripts for TibiaWiki-backed reference data.
- Creature, hunting-place, quest, spell, bestiary, bosstiary, NPC, location, and Wheel of Destiny data can turn the app from hunt logging into a richer planning/recommendation tool.
- Playwright should first cover the add-new-hunt workflow.
- Public reference data should be stored in normalized tables, retaining endpoint `last_updated`/source timestamp style fields where available.
- Automatic hunting-place matching should auto-assign high-confidence matches and support fuzzy matching for travel kills, partial/sub-area hunts, surface-only hunts, and floor-specific hunts.

## Phase 1: Stabilize Hunt Backend Structure - Completed

1. [x] Add a backend test harness with Vitest.
   - Add server-side `test` script.
   - Keep tests runnable without a real app database.
   - Use mocked DB/query boundaries for focused hunt logic tests.
   - Store recorded external item-detail payloads as fixtures.

2. [x] Split `server/src/lib/hunts/huntAnalyser.ts` without changing behavior.
   - Move raw hunt parsing, text cleanup, signatures, and count parsing into `server/src/lib/hunts/parser.ts`.
   - Move item-detail cache read/write, fixture-shaped parsing, and hydration fetch helpers into `server/src/lib/hunts/itemDetailCache.ts`.
   - Move loot lookup, enrichment, value logic, gp/oz logic, and suggestions into `server/src/lib/hunts/lootEnrichment.ts`.
   - Move hunt upload create/update/delete/list/get/import identity persistence into `server/src/lib/hunts/repository.ts`.
   - Keep public exports from `huntAnalyser.ts` stable for `server/src/server.ts` during the first pass.

3. [x] Add focused backend tests after the split.
   - Cache-first parse does not call remote item-detail fetches.
   - Missing item details return `item_detail_status: "missing"`.
   - Hydration fetches, caches, and returns normalized names using recorded fixtures.
   - Unknown-value suggestions stay visible.
   - Existing create/update/delete semantics remain unchanged.

4. [x] Verification gate for this phase.
   - `npm --prefix server run build`
   - `npm --prefix server test`

## Phase 2: Remove Obsolete Pricing Parity Exports

1. [x] Keep only the generated in-game `itemprices.json` output.
   - [x] Remove generation of `itemsprices.json`.
   - [x] Remove generation of `itemsprices.detailed.json`.
   - [x] Remove generation of `itemsprices.meta.json`.

2. [x] Update status/docs around generated files.
   - [x] Remove obsolete files from `getStatus.files`.
   - [x] Update README references so `itemprices.json` is clearly the only supported generated pricing export.
   - [x] Keep database-backed status/history as the source for internal inspection.

3. [x] Verification gate for this phase.
   - [x] `npm --prefix server run build`

## Phase 3: Frontend Stack and UI Overhaul Before Automation - Completed

### Phase 3A: Stack Decision Memo - Completed

1. [x] Compare current Vue/Vite against SvelteKit and Next.js using current and final-state needs.
   - Current repo facts: small Vite app, no router, one large `App.vue`, existing Fastify JSON API boundary.
   - Final-state needs considered: dense hunt workspace, operations dashboard, client-side discovery filters, future endpoint-backed analytics, and Playwright smoke tests.
   - Decision: keep Vue/Vite for the overhaul because the final-state app still fits a local API-driven SPA and does not currently need full-stack routing/server rendering.

### Phase 3B: Shared App Shell and Theme - Completed

1. [x] Establish the HuntLens/HuntOps dark professional foundation.
   - Added left navigation, compact toolbar, dense metric strips, segmented tabs, tables, drawer/detail panel, status badges, and icon buttons.
   - Added `@lucide/vue` for UI icons after confirming `lucide-vue-next` is deprecated.

### Phase 3C: HuntLens Full Hunt Workspace - Completed

1. [x] Redesign the hunt workflow as the first complete slice.
   - Hunt Analyser remains create/import/preview oriented.
   - Previous Hunts remains the edit/delete surface for existing hunts.
   - Added HuntLens-style central hunt workspace, dense metrics, loot/monster analysis, hydration-state icons, and saved-hunt edit drawer.
   - Extracted hunt workflow state into `ui-app/src/composables/useHunts.js`.

### Phase 3D: HuntOps Dashboard and Analytics Shell - Completed

1. [x] Add the HuntOps-style operations dashboard using existing data.
   - Added high-level metrics, recent previous hunts, profit sparkline, hunting area summary, and active-hunt loot summary.
   - Used existing endpoints only; no backend API changes were needed.
   - Used lightweight SVG for the trend visual; no chart library was added.

### Phase 3E: Cleanup, Verification, and Plan Handoff - Completed

1. [x] Replace old layout paths after preserving workflow behavior.
   - Removed the old parchment/tab layout in favor of the shared shell.
   - Kept item lookup, settings, item override, itemprices generation, hunt import, save, edit, delete, and area views available.
   - Left Playwright smoke tests for Phase 4.

2. [x] Verification gate for this phase.
   - `npm --prefix ui-app run build`

### Phase 3F: Component Scope Addendum - Completed

1. [x] Split large frontend surfaces into smaller component scopes before Phase 4 tests.
   - Extracted the persistent app navigation/topbar frame into `ui-app/src/components/AppShell.vue`.
   - Split shell internals into `ui-app/src/components/shell/AppNavigation.vue`, `AppNavItem.vue`, and `AppTopbar.vue`.
   - Added shared UI primitives in `ui-app/src/components/common/MetricCard.vue` and `SectionHeader.vue`.
   - Moved Dashboard, Hunts workspace, Item Lookup, Hunt History, and Settings into view components under `ui-app/src/components/views/`.
   - Moved new-hunt, item-assignment, and item-details modals into focused components under `ui-app/src/components/modals/`.
   - Split `ui-app/src/components/HuntSummary.vue` into focused hunt metrics, monster, loot table, and suggestion components under `ui-app/src/components/hunts/`.
   - Kept hunt workflow state in `ui-app/src/composables/useHunts.js` so future frontend tests can target components without moving save/edit/delete behavior.
   - Confirmed the current component names fit their scope: shell components own layout/navigation, view components match nav surfaces, modals own focused overlays, common components are reusable UI primitives, and hunt components own HuntSummary internals.

2. [x] Verification gate for this addendum.
   - `npm --prefix ui-app run build`

## Selected Phase 3 UI Direction

1. HuntLens-inspired hunt workspace:
   - Reference asset: `samples/concepts/ChatGPT Image Jun 10, 2026, 09_00_19 PM.png`.
   - Left app navigation, central hunt detail surface, compact metric strips, tabbed detail sections, dense loot and monster tables, clear parser/data-quality status, and a right-side saved-hunt edit drawer.
   - Use this direction for Hunt Analyser, saved hunt detail, Previous Hunts edit/delete workflows, and loot analysis.

2. HuntOps-inspired operations console:
   - Reference asset: `samples/concepts/ChatGPT Image Jun 10, 2026, 09_00_10 PM.png`.
   - Compact shell with server/character/date filters, high-level weekly metrics, tabbed analytics, previous hunts table, profit-over-time chart, market overview, loot analysis, and latest price alerts.
   - Use this direction for dashboard, Hunt History, market summary, filtering/sorting, and future analytics views.

3. Shared design rules:
   - Dense dark professional UI with restrained accents and strong scanability.
   - Small metric cards/strips rather than oversized hero content.
   - Tables, tabs, drawers, filters, icons, and status badges should carry the workflow.
   - Keep Tibia/game context visible through item names, icons, stats, and hunt language rather than fantasy decoration.

## UI Concept Prompt Starters

1. Dense hunt analytics tool:
   - "A desktop web app dashboard for a Tibia hunt analytics tool, dense professional layout, dark neutral theme with restrained accent colors, left navigation, compact tables, metric strips, loot analysis panel, previous hunts list, game-tool aesthetic without fantasy decoration, practical SaaS-style interface, high fidelity UI mockup"

2. Market and hunt operations console:
   - "A high fidelity desktop UI concept for a game market and hunt tracking operations console, compact app shell, sortable data grids, item price status indicators, hunt profitability metrics, tabbed workflows, subtle iconography, clean dark theme, information-dense but readable"

3. Tactical analysis workspace:
   - "A modern analytics workspace for MMORPG hunting performance, split-pane layout, hunt parser preview, editable saved hunt drawer, loot table with value and weight columns, status icons for data quality, muted dark interface with clear contrast, no marketing hero, no decorative fantasy art"

4. Light professional variant:
   - "A light theme desktop dashboard for a game analytics companion app, compact navigation, spreadsheet-like tables, metric cards kept small, filters and segmented controls, item lookup and hunt history workflows, calm professional style, high fidelity product UI"

5. Hybrid reference board:
   - "A UI moodboard for a dense game analytics web app, combining professional data dashboards, compact admin tools, and MMORPG item management interfaces, showing navigation, tables, filters, metric summaries, status badges, and detail panels"

## Phase 4: Frontend Smoke Tests After UI Settles

1. Add Playwright only after the redesigned UI flow is stable.
   - Cover the add-new-hunt workflow first.
   - Cover paste/import hunt analyser text.
   - Cover parse preview.
   - Cover hydration result display.
   - Cover hide/restore loot rows before saving.
   - Cover saving the hunt as a new saved hunt.
   - Add previous-hunt open, edit, save, and delete coverage after the new-hunt flow is stable.

2. Keep frontend tests workflow-focused.
   - Avoid brittle assertions against layout details.
   - Prefer stable labels, roles, and state changes.
   - Use seeded or mocked backend data where practical.

3. Verification gate for this phase.
   - `npm --prefix ui-app run build`
   - Playwright smoke test command once added.

## Phase 5: Client-Side Hunt Discovery Improvements

1. Add filtering and sorting before endpoint-heavy analytics.
   - Previous Hunts filters: location, character if available, date range, XP/H, GP/H, profit, duration.
   - Previous Hunts sorting: date, location, XP/H, GP/H, profit, duration.
   - Hunt History area filters/sorting: area, hunt count, averages, best/worst metrics, latest hunt.

2. Keep this phase mostly client-side.
   - Use existing loaded hunt and area data first.
   - Add backend query support only if the dataset becomes too large for client filtering.

## Phase 6: Endpoint-Backed Analytics

1. Stage public Tibia reference data into the local database.
   - Add migrations for public creatures, creature loot statistics, hunting places, hunting-place area creature summaries, hunting-place recommendations, quests, spells, locations, NPCs, bestiary entries, and bosstiary entries.
   - Build a typed TibiaData client from the `public-api.json` contract or a small hand-maintained subset of the relevant endpoints.
   - Add sync tooling that can fetch list endpoints first, hydrate details by id/name, and record `last_updated`/source timestamps where the API exposes them.
   - Store normalized tables as the durable query model, retaining endpoint `last_updated`/source timestamp style fields where available.
   - Start with creatures and hunting places before importing the wider content set.

2. Map saved hunts to hunting places automatically.
   - Match hunt analyser monster names against staged creature aliases/details.
   - Score candidate hunting places by overlapping creatures, location text, player-entered hunt location, level/vocation ranges, and known hunting-place creature summaries.
   - Use fuzzy matching so travel kills do not dominate the match, and so surface-only, lower-level, specific-floor, or other subsection hunts can still map to the broader hunting place with useful confidence.
   - Prefer auto-assigning high-confidence matches while preserving confidence, match reasons, and ambiguous alternatives.
   - Store the selected hunting-place id on saved hunts, with confidence and an override path for manual correction.
   - Surface low-confidence matches as review prompts instead of silently assigning the wrong place.

3. Generate hunt recommendations from staged reference data.
   - Use character level/vocation, recent hunt performance, staged hunting-place level ranges, vocation recommendations, expected loot/XP stars, creature difficulty, and quest access requirements.
   - Show why each recommendation was made: matching creatures, level range, expected XP/loot, missing prerequisites, and known risk flags.
   - Separate "try next", "farm profit", "complete bestiary", "boss/bosstiary", and "quest unlock" recommendation modes.

4. Character lookup.
   - Add endpoint to search/select known characters.
   - On hunt import, detect or select the character.
   - Look up approximate level at hunt time.
   - Store character and level context with saved hunts.

5. Event detection.
   - Add endpoint or data source for double XP, boosted spawn, and similar event windows.
   - Detect whether a hunt overlaps an event.
   - Surface event context on hunt detail and area summaries.
   - Decide whether event-normalized rates should be stored or computed at read time.

6. Quest and unlock context.
   - Link staged quest requirements/rewards to hunting-place recommendations where the source data exposes access constraints.
   - Track account/character unlock notes manually until a reliable character-specific source exists.
   - Flag recommendations that may need access quests, premium status, or level requirements.

7. Verification gate for this phase.
   - Backend migration/app build.
   - Focused sync-client tests using recorded public API fixtures.
   - Hunt-place matching tests for exact creature overlap, partial overlap, aliases, and low-confidence no-match cases.

## Phase 7: Analytics That Need More Product Rules

1. Normalize hunt rates.
   - Define how aggressive downtime correction should be.
   - Decide whether short hunts should be smoothed, flagged as low confidence, or left raw.
   - Define minimum duration thresholds.
   - Replace current Hunt History location leaderboards' raw averages with normalized averages that give longer hunts more weight.
   - Decide whether normalized values are shown beside raw values or used as defaults.

2. Hunt safety rating.
   - Define supply usage thresholds.
   - Decide how to treat waste-heavy but intentional hunts.
   - Decide whether safety is per hunt, per area, per character level range, or all three.
   - Define rating labels and whether they should affect sorting/filtering.

## Future Public Data Expansion Ideas

1. Bestiary and bosstiary planning.
   - Use staged bestiary/bosstiary categories, difficulty, charm points, boss point rewards, kill requirements, and level requirements to create completion dashboards.
   - Suggest hunts that advance unfinished bestiary entries while still matching character level and desired profit/XP goals.

2. Quest, achievement, and unlock roadmaps.
   - Use quests, achievements, locations, NPCs, keys, books, objects, and mount/outfit data to build longer-term progression checklists.
   - Link unlocks back to relevant hunting places and items when the source data provides enough relationship hints.

3. Vocation build support.
   - Use spell and Wheel of Destiny data for vocation-aware hunt recommendations, required level checks, cooldown/tooling notes, and future build comparison views.

4. Market enrichment from public item metadata.
   - Use item category, class, vocation restriction, attributes, imbuement-like fields, and images to improve market filters and loot-table explanations.
   - Keep Tibia market price data separate from public metadata so the pricing pipeline remains clear.

5. World/location/NPC context.
   - Use locations, NPCs, buildings, streets, and houses to add city/route context around hunts, quests, and vendors.
   - Treat this as a second-pass experience layer after creature and hunting-place matching is reliable.

6. Weekly taskboard helper.
   - Add a planning board where the player can enter weekly task monsters, task items, desired quantities, and optional character/vocation context.
   - For monster tasks, suggest hunting areas that contain the task monster, including stronger/weaker subsection matches where the staged hunting-place data supports floors, surface areas, or lower-level variants.
   - For item tasks, suggest monsters that drop the task item and then suggest hunting areas for those monsters.
   - Show current market price and estimated buy cost for the task item so the player can decide whether to buy it or hunt it.
   - When loot chance data is available, estimate rough kills needed for the target quantity and present it as a planning hint, for example: `56x item y`, market cost around `700,000 gp`, hunt monster `z`, rough estimate `1,000 kills`.
   - Mark estimates as rough when drop rates are sparse, source data is uncertain, or multiple monsters can drop the same item at very different rates.

## Open Questions Before Implementation

1. None currently.
