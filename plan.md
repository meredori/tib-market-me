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
- Character lookup and event detection need new backend endpoints.
- Normalization and safety rating need more product rules before implementation.
- Delete obsolete `itemsprices.*` files if they are no longer used after generation is removed.

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

1. Keep only the generated in-game `itemprices.json` output.
   - Remove generation of `itemsprices.json`.
   - Remove generation of `itemsprices.detailed.json`.
   - Remove generation of `itemsprices.meta.json`.

2. Update status/docs around generated files.
   - Remove obsolete files from `getStatus.files`.
   - Update README references so `itemprices.json` is clearly the only supported generated pricing export.
   - Keep database-backed status/history as the source for internal inspection.

3. Verification gate for this phase.
   - `npm --prefix server run build`

## Phase 3: Frontend Stack and UI Overhaul Before Automation

1. Assess frontend stack viability before committing to the overhaul.
   - Compare staying on the current Vue/Vite app against moving to SvelteKit or Next.js.
   - Evaluate routing, layouts, server/API integration, component ergonomics, state management, test tooling, local deployment complexity, and migration cost.
   - Consider whether the app should remain a separate UI talking to the existing Fastify server, or whether a new full-stack framework should own more of the app surface.
   - Decide whether the UI overhaul should happen in-place or as a new app shell that gradually replaces the current Vue UI.
   - Keep the assessment open-ended until the tradeoffs are clear.

2. Establish the app theme before redesigning individual workflows.
   - Define the general visual direction for the whole app first: density, spacing, color, typography, controls, icon style, table treatment, and panel hierarchy.
   - Gather 3-5 layout concepts before implementation.
   - Use generated mockups, reference sites, or both to compare directions.
   - Pick one direction and turn it into reusable UI primitives before deep feature work.

3. Generate or gather UI concepts.
   - Option A: create image-generation prompts for potential dashboard layouts.
   - Option B: collect reference websites/apps with strong dense dashboard, analytics, or game-tool layouts.
   - Option C: do both, then combine the best pieces into a practical local design direction.
   - Prefer layouts that feel like a focused tool, not a marketing page.

4. Rework the information architecture before adding Playwright tests.
   - Make Hunt Analyser clearly create/import/preview oriented.
   - Keep Previous Hunts as the edit/delete surface for existing hunts.
   - Improve table density and scanning for Previous Hunts and Hunting Areas.
   - Review which details should become drill-down views or modals.
   - Keep all current information available.

5. Refactor each area into reusable components as it is redesigned.
   - Extract shared layout primitives such as app shell, toolbar, tab navigation, data table, metric strip, filter bar, status icon, and detail panel.
   - Extract item lookup state into `useItemLookup` when the item lookup UI is redesigned.
   - Extract hunt state into `useHunts` when Hunt Analyser, import, and Previous Hunts flows are redesigned.
   - Split tab bodies into dedicated components as each tab is touched.
   - Avoid a large component split that preserves the old UI shape without improving it.

6. Add hydration-state icons to loot rows.
   - Tick icon for cached/resolved detail.
   - Question mark icon for missing detail/background lookup pending.
   - Exclamation/error icon for unavailable detail or hydration failure.
   - Background hydration failures should not overwrite the main hunt status message.

7. Verification gate for this phase.
   - `npm --prefix ui-app run build`

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
   - Cover parse preview.
   - Cover hydration result display.
   - Cover hide/restore loot rows.
   - Cover open, edit, save, and delete previous hunts.

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
   - Hunting Areas filters/sorting: area, hunt count, averages, best/worst metrics, latest hunt.

2. Keep this phase mostly client-side.
   - Use existing loaded hunt and area data first.
   - Add backend query support only if the dataset becomes too large for client filtering.

## Phase 6: Endpoint-Backed Analytics

1. Character lookup.
   - Add endpoint to search/select known characters.
   - On hunt import, detect or select the character.
   - Look up approximate level at hunt time.
   - Store character and level context with saved hunts.

2. Event detection.
   - Add endpoint or data source for double XP, boosted spawn, and similar event windows.
   - Detect whether a hunt overlaps an event.
   - Surface event context on hunt detail and area summaries.
   - Decide whether event-normalized rates should be stored or computed at read time.

## Phase 7: Analytics That Need More Product Rules

1. Normalize hunt rates.
   - Define how aggressive downtime correction should be.
   - Decide whether short hunts should be smoothed, flagged as low confidence, or left raw.
   - Define minimum duration thresholds.
   - Decide whether normalized values are shown beside raw values or used as defaults.

2. Hunt safety rating.
   - Define supply usage thresholds.
   - Decide how to treat waste-heavy but intentional hunts.
   - Decide whether safety is per hunt, per area, per character level range, or all three.
   - Define rating labels and whether they should affect sorting/filtering.

## Open Questions Before Implementation

1. Is Vue/Vite still the right frontend foundation for the new scope, or should the overhaul move to SvelteKit or Next.js?
2. If changing frontend stack, should the migration be a clean replacement app or a gradual side-by-side migration?
3. Which UI concept direction should be chosen after reviewing generated mockups/reference sites?
