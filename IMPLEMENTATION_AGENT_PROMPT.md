# Implementation Agent Prompt

Use this prompt to start a fresh coding-agent conversation for implementation.

## Prompt

You are implementing the first slice of a JS migration for this project.

Read these files first and treat them as the source of truth:

- `IMPLEMENTATION_PLAN.md`
- `SQLITE_SCHEMA.md`
- `market_helper.py`
- `web_ui.py`
- `package.json`
- `itemsprices.detailed.json`

## Goal

Implement only the first migration slice:

1. create a Node + TypeScript backend
2. use Fastify for the HTTP server
3. use SQLite with `better-sqlite3`
4. add raw SQL migrations based on `SQLITE_SCHEMA.md`
5. port the TibiaMarket API client and the current snapshot pricing pipeline
6. keep JSON export temporarily for parity checking
7. do not implement hunt import yet
8. do not implement historical pricing yet

## Constraints

1. Keep the existing Vue frontend in `ui-app/` unchanged unless small API wiring changes are strictly necessary.
2. Preserve the current market sync behavior before redesigning anything.
3. `item_metadata` is current-only reference data and should be updated in place.
4. Store both:
   - raw market payloads
   - normalized/queryable market fields
5. The only pricing model in this first slice should be `snapshot pricing`.
6. Keep output compatibility with the current JSON artifacts as much as practical.
7. Do not build the hunt analyser or recommendation redesign in this pass.

## Scope for This Pass

Implement these pieces end to end:

1. backend project structure under `server/`
2. TypeScript config and package wiring for the backend
3. SQLite migration files for the first required tables:
   - `market_runs`
   - `market_item_raw`
   - `market_item_features`
   - `market_item_prices`
   - `item_metadata`
   - `item_npc_buy`
   - `item_npc_sell`
   - `world_data_snapshots`
4. TibiaMarket client methods for:
   - `/market_values`
   - `/item_metadata`
   - `/world_data`
   - `/events` only if needed by parity logic
5. a snapshot pricing module that matches the current Python logic
6. a sync workflow equivalent to `update-prices`
7. temporary JSON export compatible with:
   - `itemsprices.json`
   - `itemsprices.detailed.json`
   - `itemsprices.meta.json`

## API Surface for This Pass

If time permits after the sync pipeline is working, recreate these endpoints in Fastify:

1. `/api/status`
2. `/api/search`
3. `/api/refresh`

Do not implement the recommendation endpoint unless it is needed for wiring or parity scaffolding.

## Non-Goals

1. no hunt importer
2. no item alias redesign
3. no historical pricing model
4. no ORM adoption unless absolutely necessary
5. no frontend redesign

## Expected Outcome

At the end of this pass, the repo should have:

1. a working Node backend under `server/`
2. a SQLite database populated by market sync
3. snapshot pricing stored in SQLite
4. JSON export still available for parity checks
5. the project positioned for later historical pricing and hunt import work

## Implementation Notes

- Be conservative and favor boring, explicit code.
- Prefer raw SQL migrations over ORM schema generation.
- Keep functions small and keep the pricing logic easy to compare against the Python version.
- Validate with narrow checks as you go.
- Do not widen scope beyond the first migration slice.