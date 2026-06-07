# Tibia Market Helper (Victoris)

This project now uses a Node + TypeScript backend for market sync and API serving.

Current migration slice scope:
- pull market + metadata + world freshness from TibiaMarket API
- compute snapshot pricing
- persist to local SQLite
- keep JSON exports for parity checks

Current JSON output for Tibia:
- `itemprices.json`: configurable Tibia client value export (`conservative_min` or `sell_offer`)

Internal generated outputs:
- `itemsprices.json`: flat parity/debug map of `item_id -> conservative client value`
- `itemsprices.detailed.json`: detailed snapshot pricing rows
- `itemsprices.meta.json`: local run + world freshness metadata

Current item image workflow:
- full item sprite generation now goes to `assets/generated/items-archive/`
- only DB-needed item IDs are copied into `ui-app/public/items/`
- manual tracked IDs in `assets/manual-item-images.json` are always included

Planning and migration docs:
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/SQLITE_SCHEMA.md`

## Install

```bash
npm install
npm --prefix server install
```

## Local Asset Setup

This repository does not track the copied Tibia client asset dump.

- Copy your local Tibia `assets/` folder into the project root as `assets/`.
- Copy `graphics_resources.rcc` into the project root if you use tooling that reads it.
- Run `npm run generate:items` to build the full archive from Tibia assets.
- Run `npm run stage:items` to copy only market item IDs (plus manual tracked IDs) into `ui-app/public/items/`.
- Manual tracked item IDs are defined in `assets/manual-item-images.json` (defaults include coins: `3043`, `3048`, `3052`).

## Generate Prices (Victoris)

```bash
npm run sync:be
```

The sync command stores:
- local run start/finish timestamps
- world last update timestamp from `world_data`
- raw market payloads and normalized fields in SQLite

## Local UI

Run a local web UI to:
- search specific items from local detailed data
- upload scaffolded hunt summaries
- compare uploaded hunts by xpm and gpm in a previous-hunts checker
- manage run status/refresh and generate `itemprices.json` in Settings

Architecture:
- Vite + Vue frontend in `ui-app/`
- Fastify backend in `server/`
- SQLite via `better-sqlite3`
- During dev, Vite proxies `/api` to Fastify at `127.0.0.1:8787`

Run frontend + backend together:

```bash
npm run dev
```

Manual backend only:

```bash
npm --prefix server run dev
```

Then open:
- FE dev server: http://127.0.0.1:5173
- BE direct (optional): http://127.0.0.1:8787

## Notes

- API source: https://api.tibiamarket.top/docs#/
- Snapshot pricing is the only pricing model in this migration slice.
- Hunt recommendation endpoint is not implemented in this slice.

## Suggested Workflow

1. Run `npm run dev` for the full web UI + API workflow.
2. Refresh prices from the UI/API (`/api/refresh`) when needed.
3. Use `/api/search` for item lookup against the latest synced run.
4. Save hunt summary scaffolds in the Hunt Analyser tab and compare results in Previous Hunts.
5. Generate `itemprices.json` from Settings or API (`POST /api/itemprices/generate`) with mode `conservative_min` or `sell_offer`.

## Roadmap

### 3) Hunt Analyser (Potential Profit + Loot Per Hour)
- Parse large hunt logs with timestamps and loot entries.
- Compute potential profit using local fair/list/NPC valuations.
- Infer hunt duration from first and last kill timestamps.
- Report per-hunt totals plus loot per hour and expected net per hour.

### 4) Local Hunt Database
- Persist hunt analyser outputs locally as structured records.
- Support lookup and filtering by date range, creature, and tags.
- Keep raw log text plus normalized parsed records for reprocessing.

### 5) Location/Boost Normalization
- Add mandatory location tagging when saving hunt records.
- Track boosts and modifiers (bonus exp, boosts, prey, stamina state).
- Normalize metrics so xp/h and gpm can be compared between hunts.
- Surface aggregated location performance across historical hunts.
