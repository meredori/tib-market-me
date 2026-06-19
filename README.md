# Tibia HuntOps

Tibia HuntOps is a local-first Tibia operations tool for market decisions, hunt analysis, loot selling, taskboard planning, bestiary progress, and hunting-place intelligence.

The app runs as a Vue frontend, Fastify backend, and local SQLite database. Market, hunt, character, public reference, and public hunt data stay local unless a sync/import action explicitly fetches from an external source.

## Documentation

- `tibia_huntops_roadmap.md` is the product roadmap, current phase tracker, definition of done, and agent guidance.
- `docs/UI_STYLE_GUIDE.md` is the frontend UI rulebook for shared layout, tables, badges, metrics, and screen priority.
- `docs/AGENT_UI_INSPECTION.md` explains how agents can inspect the local UI with Playwright MCP or another browser tool.
- This README is the practical setup and workflow reference.

Keep documentation sparse. Update one of these files when a durable rule, workflow, or product direction changes; avoid adding new planning docs unless the existing anchors cannot hold the information cleanly.

## Current Capabilities

- Market sync from TibiaMarket into local SQLite.
- Snapshot pricing, item lookup, watchlist/favorites, item details, and `itemprices.json` export.
- Hunt Analyser import, saved hunts, hunt history, editing/deletion, character context, and item overrides.
- Loot Inbox guidance for sell, hold, NPC/vendor, watch, review, and unknown-price decisions.
- Public reference catalog sync and detail enrichment with Data Health status.
- Hunt-to-hunting-place matching with linked/custom location handling and manual correction.
- Taskboard helper for weekly creature and delivery item offers.
- Bestiary checklist and charm progress support.
- Hunting-place intelligence pages with public/reference data, personal linked hunts, public hunt imports, area breakdowns, and taskboard/bestiary hooks.

## Install

```bash
npm install
npm --prefix server install
npm --prefix ui-app install
```

## Local Asset Setup

This repository does not track the copied Tibia client asset dump.

- Copy your local Tibia `assets/` folder into the project root as `assets/`.
- Copy `graphics_resources.rcc` into the project root if you use tooling that reads it.
- Run `npm run generate:items` to build the full archive from Tibia assets.
- Run `npm run stage:items` to copy only market item IDs (plus manual tracked IDs) into `ui-app/public/items/`.
- Manual tracked item IDs are defined in `assets/manual-item-images.json` (defaults include coins: `3043`, `3048`, `3052`).

## Common Commands

```bash
# Run frontend and backend together
npm run dev

# Run frontend and backend on stable local inspection hosts
npm run dev:inspect

# Build backend and frontend
npm --prefix server run build
npm --prefix ui-app run build

# Run database migrations
npm --prefix server run migrate

# Sync market data and generate pricing
npm run sync:be

# Generate Tibia client item prices
curl -X POST http://127.0.0.1:8787/api/itemprices/generate
```

On Windows PowerShell, use `npm.cmd` in place of `npm` if execution policy blocks `npm.ps1`.

## Local App

Architecture:
- Fastify backend in `server/`
- Vite + Vue frontend in `ui-app/`
- SQLite via `better-sqlite3`
- During dev, Vite proxies `/api` to Fastify at `127.0.0.1:8787`

Run frontend + backend together:

```bash
npm run dev
```

Agent/browser-inspection workflow:

```bash
npm run dev:inspect
```

Then point Playwright MCP or another browser tool at `http://127.0.0.1:5173`. See `docs/AGENT_UI_INSPECTION.md` for MCP config and visual QA expectations.

Manual backend only:

```bash
npm --prefix server run dev
```

Then open:
- FE dev server: http://127.0.0.1:5173
- BE direct (optional): http://127.0.0.1:8787

## Suggested Workflow

1. Run `npm run dev` for the full web UI + API workflow.
2. Refresh/sync market data when you need newer prices.
3. Paste Hunt Analyser output into the Hunts workflow and save useful sessions.
4. Use Loot Inbox after hunts to decide what to sell, hold, NPC/vendor, watch, or review.
5. Keep public reference data healthy from Settings when working on Taskboard, Bestiary, Places, or matching.
6. Generate `itemprices.json` from Settings when you want to update the Tibia client export.

## External Data Sources

- TibiaMarket API for market values, metadata, world freshness, and pricing inputs.
- TibiaData/public reference endpoints for creatures, hunting places, character lookup, and related reference details.
- Public Hunt Analyser pages only through the manual, provenance-labelled public hunt import workflow described in the roadmap.

Imported public/reference data must not change personal hunt totals, character totals, personal trends, streaks, or dashboard metrics unless a future feature explicitly designs and labels that behavior.
