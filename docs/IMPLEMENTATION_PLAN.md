# Implementation Plan

## Goals

- Migrate the project from a Python + JS split to a JS-first architecture without regressing the current market sync behavior.
- Replace JSON files as the primary data store with a lightweight local database.
- Rebuild hunt ingestion around richer hunt session inputs and persist historical hunt data for later analysis.
- Use stored market and hunt history to support better insights and future recommendation logic.

## Guiding Decisions

- The TibiaMarket API sync and pricing pipeline are a straight migration first, not a redesign.
- SQLite should become the source of truth; JSON can remain as an export or compatibility artifact.
- The current loot-labeling and recommendation parser should not be ported as-is.
- Hunt ingestion should be rebuilt around structured hunt-session imports such as `samples/hunt-analyser/hunt-analyser-session-a.txt`.
- Pricing should support two models:
  - a snapshot model based only on the latest full market pull
  - a historical model that adjusts or extrapolates pricing from stored prior pulls

## Chosen Stack

- Frontend: keep the existing Vue + Vite app in `ui-app/`
- Backend runtime: Node.js
- Backend language: TypeScript
- HTTP framework: Fastify
- Database: SQLite
- SQLite driver: `better-sqlite3`
- Migrations: raw `.sql` files
- Validation: `zod` for request and payload validation where helpful

## Stack Rationale

- The existing frontend is already API-driven and does not need a framework rewrite.
- Fastify is mature, simple, and predictable for a small JSON API.
- TypeScript reduces mapping mistakes when ingesting TibiaMarket payloads.
- `better-sqlite3` is a good fit for a local SQLite-backed app and is simpler than a heavier ORM-first approach.
- Raw SQL migrations fit the schema-driven approach already documented in `docs/SQLITE_SCHEMA.md`.

## Phase 0: Lock Current Behavior

### Step 0.1: Capture the current inputs and outputs

- Keep the existing sample files as migration fixtures:
  - `samples/hunt-analyser/hunt-analyser-session-a.txt`
  - `samples/hunt-analyser/hunt-analyser-session-b.txt`
- Add a short note describing what each fixture is used to verify.

### Step 0.2: Define parity targets for the straight migration

- The JS market sync must preserve:
  - paginated TibiaMarket fetching
  - retry and rate-limit handling
  - metadata joins
  - pricing output shape
  - world freshness metadata
- The first JS port should match current output fields even if the storage backend changes underneath.
- The current pricing model becomes `snapshot pricing` and remains the baseline parity target.

### Exit Criteria

- There is a fixed set of files and output contracts the migration will be compared against.

## Phase 1: Set Up the JS Backend Skeleton

### Step 1.1: Choose the runtime and backend shape

- Use Node.js for the backend runtime.
- Create a backend app structure that separates:
  - `market sync`
  - `storage`
  - `hunt import`
  - `analytics`
  - `http api`

### Step 1.2: Create initial folders/modules

- Add a backend source folder such as `src/` or `server/`.
- Create placeholder modules for:
  - TibiaMarket client
  - pricing engine
  - SQLite access
  - hunt importer
  - API routes
- Prefer a structure similar to:
  - `server/src/app.ts`
  - `server/src/routes/`
  - `server/src/lib/tibiamarket/`
  - `server/src/lib/pricing/`
  - `server/src/lib/db/`
  - `server/db/migrations/`

### Step 1.3: Establish a minimal dev workflow

- Replace the Python backend dev command with a Node backend dev command.
- Keep the Vue frontend workflow unchanged initially.
- Continue proxying `/api` from Vite to the backend.

### Exit Criteria

- The repo can run a Node backend in development alongside the existing frontend.

## Phase 2: Port the TibiaMarket API Client and Digestion Pipeline

### Step 2.1: Port the HTTP client

- Implement JS equivalents for:
  - `get_market_values`
  - `get_item_metadata`
  - `get_all_market_values`
  - `get_events`
  - `get_world_data`
- Treat `item_metadata` as a required sync input, not an optional enrichment.
- Preserve retry behavior and throttling safeguards.

### Step 2.2: Port the pricing engine

- Translate the current pricing model directly as the first pricing model.
- Preserve the current fields for:
  - fair price
  - suggested list price
  - trend and trend score
  - liquidity
  - confidence
  - client value

### Step 2.3: Expose pricing model boundaries explicitly

- Name the direct ported model `snapshot pricing`.
- Keep its inputs limited to the latest fetched pull and metadata join.
- Return pricing metadata that makes the source of the value clear, including:
  - pricing model name
  - market run id
  - world last update timestamp
  - local pull timestamp
  - snapshot age at read time

### Step 2.4: Port the update-prices workflow

- Rebuild the pipeline that:
  - fetches market rows
  - fetches item metadata
  - fetches world data
  - joins rows by item id
  - computes pricing output
  - persists the result
- Keep the raw market payload and the item metadata payload independently recoverable for later reprocessing.

### Step 2.5: Keep JSON export compatibility temporarily

- Continue writing the current JSON artifacts during this phase.
- Treat those exports as compatibility outputs, not the long-term source of truth.

### Exit Criteria

- The JS pipeline can generate the same practical market outputs as the Python implementation.

## Phase 3: Introduce SQLite as the System of Record

### Step 3.1: Define the first database schema

- Create initial tables for:
  - `market_runs`
  - `market_items`
  - `item_metadata`
  - `hunt_sessions`
  - `hunt_monsters`
  - `hunt_loot_items`
  - `item_aliases`
- Ensure the market schema stores enough information for historical pricing, including:
  - one immutable row per item per market run
  - raw snapshot fields used by the snapshot model
  - derived snapshot pricing outputs
  - timestamps needed to measure data age and trend windows

### Step 3.2: Store market sync runs

- Every market pull should create a new `market_runs` record.
- Every priced item in that pull should create a `market_items` row linked to the run.
- Item metadata should be stored separately from market snapshots so canonical item info can be reused across runs.
- Keep world freshness and pricing model version with the run.

### Step 3.3: Store and version item metadata

- Persist the raw `item_metadata` payload for each item.
- Persist queryable metadata fields such as:
  - item id
  - name
  - wiki name
  - category
  - tier
  - NPC buy list
  - NPC sell list
- Update metadata in place so it always reflects the most current canonical game information.
- Treat metadata as current reference data rather than historical analytical data.

### Step 3.4: Add read models for the existing UI/API

- Build queries that can still satisfy:
  - status
  - item search
  - current price lookup
- Use the latest successful market run as the default active snapshot.
- Make room in the API contract for multiple price views per item, even if only snapshot pricing is implemented first.

### Step 3.5: Downgrade JSON to export/cache status

- Make JSON export optional or secondary.
- Keep it only for compatibility with external consumers or manual inspection.

### Exit Criteria

- SQLite is the canonical store for market data.
- The existing UI/API no longer depends on reading JSON files directly.

## Phase 4: Replace the Current API Layer

### Step 4.1: Recreate the current endpoints in JS

- Implement the current API surface:
  - `/api/status`
  - `/api/search`
  - `/api/refresh`
  - any transitional recommendation endpoints still needed by the UI

### Step 4.2: Point the frontend at the JS backend only

- Update scripts and deployment flow so the Python backend is no longer needed.
- Keep frontend behavior stable while the backend changes under it.

### Exit Criteria

- The app runs fully with the Node backend and Vue frontend.

## Phase 5: Rebuild Hunt Ingestion Around Session Imports

### Step 5.1: Define the new hunt import contract

- Use `samples/hunt-analyser/hunt-analyser-session-a.txt` as the primary example of the desired ingestion format.
- Parse and persist:
  - session start/end
  - session duration
  - XP gain and XP/h
  - loot, supplies, and balance
  - damage and healing
  - killed monsters
  - looted items

### Step 5.2: Build a dedicated hunt-session importer

- Create a new parser for structured hunt summary input.
- Store both:
  - the raw imported text
  - the normalized parsed records
- Avoid reusing the current loot parser as the primary ingestion path.

### Step 5.3: Add idempotent import behavior

- Prevent accidental duplicate session imports.
- Define how duplicate or edited imports are handled.

### Exit Criteria

- Hunt session text can be imported into the database as structured records.

## Phase 6: Redesign Item Matching and Label Resolution

### Step 6.1: Split matching from parsing

- Parsing should only extract raw item labels and quantities.
- Matching should resolve those labels to canonical item ids separately.

### Step 6.2: Introduce alias and canonicalization rules

- Use a dedicated alias table or ruleset instead of a flat overwrite-based index.
- Support:
  - canonical item id
  - canonical item name
  - raw label
  - confidence/source of match

### Step 6.3: Resolve unknowns explicitly

- Keep unmatched labels as unresolved records instead of silently forcing bad matches.
- Add a workflow for reviewing and fixing unresolved items later.

### Exit Criteria

- Item matching is explicit, reviewable, and no longer tied to the current brittle singularization logic.

## Phase 7: Build Historical Analytics and Reporting

### Step 7.1: Add per-hunt derived metrics

- Compute and persist derived values such as:
  - expected market value
  - NPC value
  - estimated realized value
  - profit per hour
  - loot per hour

### Step 7.2: Add historical pricing as a second pricing model

- Build a `historical pricing` model from stored market snapshots.
- Use prior pulls to dampen obvious one-off manipulation or stale-snapshot distortions.
- Keep the model conservative and explainable rather than opaque.
- Store enough output to compare:
  - snapshot price
  - historical price
  - divergence amount
  - reason or confidence for the adjustment

### Step 7.3: Add historical views

- Support queries by:
  - date range
  - creature
  - location
  - item
  - tag

### Step 7.4: Add aggregated performance insights

- Compare hunts by location and monster mix.
- Surface trends in item frequency and value over time.
- Use historical market snapshots where helpful rather than only the latest pull.

### Step 7.5: Decide which pricing model is primary for each surface

- Use snapshot pricing where parity with the current tool is required.
- Use historical pricing where recommendation quality matters more than strict parity.
- Expose both values in analytics views when disagreement is meaningful.

### Exit Criteria

- The app supports historical hunt analysis, not just one-off recommendation output.

## Phase 8: Rebuild Recommendations on Top of Stored History

### Step 8.1: Reintroduce item recommendation logic only after storage is stable

- Rebuild recommendation logic against:
  - canonical item matches
  - current market data
  - historical hunt context

### Step 8.2: Expand recommendation scope

- Move beyond “sell now vs NPC” where useful.
- Support richer insight such as:
  - recurring low-value pickup traps
  - hunt efficiency by area
  - item volatility across sessions
  - buy/flip opportunities when live market listings are below NPC fallback or a configured flip threshold

### Exit Criteria

- Recommendations are derived from stable stored data instead of being the primary product surface.

## Suggested Execution Order

1. Freeze fixtures and output contracts.
2. Create the Node backend skeleton.
3. Port TibiaMarket sync and pricing logic.
4. Introduce SQLite and store market runs.
5. Replace the existing API layer.
6. Build the new hunt-session importer.
7. Redesign item matching and canonicalization.
8. Add the second historical pricing model.
9. Add historical analytics.
10. Rebuild recommendation logic on top of the new data model.

## Immediate Next Implementation Slice

The first practical slice should be:

1. Create the Node backend structure.
2. Port the TibiaMarket client and pagination logic.
3. Port snapshot pricing and the price digestion pipeline.
4. Keep parity checks in SQLite-backed status/history instead of legacy JSON exports.
5. Add SQLite persistence for market runs once parity is verified.
6. Delay historical pricing until enough snapshot history exists to support it.

That sequence preserves current value, reduces migration risk, and avoids blocking on the hunt-analyser redesign.
