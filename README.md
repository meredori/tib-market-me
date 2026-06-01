# Tibia Market Helper (Victoris)

This tool pulls data from the TibiaMarket API and builds practical sell prices for your client.

It is designed to avoid simply mirroring the current listing price.
Instead, it computes a guarded fair value and a suggested listing price using:
- month/day averages
- current buy/sell offers
- liquidity (sales + traders)
- trend direction
- outlier dampening and bounds

It then exports:
- `itemsprices.json`: flat map of `item_id -> conservative client value`
- `itemsprices.detailed.json`: full analytics used for recommendations
- `itemsprices.meta.json`: run metadata including local run timestamps and world_data freshness

## Install

```bash
pip install -r requirements.txt
npm install
```

## Local Asset Setup

This repository does not track the copied Tibia client asset dump.

- Copy your local Tibia `assets/` folder into the project root as `assets/`.
- Copy `graphics_resources.rcc` into the project root if you use tooling that reads it.
- The curated frontend item images in `ui-app/public/items/` are tracked and should remain in the repository.

## Generate Prices (Victoris)

```bash
python market_helper.py update-prices --server Victoris
```

Optional:

```bash
python market_helper.py update-prices --server Victoris --sales-tax-pct 8 --out itemsprices.json --detail-out itemsprices.detailed.json --meta-out itemsprices.meta.json --page-limit 250 --page-pause-sec 0.35 --verbose
```

This command stores:
- local run start/finish timestamps
- world last update timestamp from the `world_data` endpoint
- the time world_data was queried locally

## Loot Recommendations

Supports recommendations per loot item:
- `NPC` (guaranteed value is best / safer)
- `List Now`
- `List Later` (for example if DXP is near and trend is rising)
- `List One` (item is unlisted but demand is thin; only probe with 1)
- `Skip Market` (fails minimum market quality/value gates)

Recommendation cleanup logic now also includes:
- per-item unit listing price and expected net
- market quality checks (liquidity/confidence/volume)
- NPC fallback for weak-volume items where market listing is risky
- minimum market suggestion thresholds (`unit net`, `liquidity`, `confidence`, `month sold`)
- pickup filtering by unit value and value density (`gp/oz`) when weight is known

### Example with inline text

```bash
python market_helper.py recommend-loot --server Victoris --loot-text "Loot of a dragon: 2 green dragon leathers, a steel helmet, 45 gold coins."
```

### Example with file

```bash
python market_helper.py recommend-loot --server Victoris --loot-file loot.txt --out loot-recommendation.json
```

With weight and pickup thresholds:

```bash
python market_helper.py recommend-loot --server Victoris --loot-file loot.txt --weights-json item_weights.json --min-unit-value 20 --min-coin-per-oz 12 --out loot-recommendation.json
```

With additional market suggestion thresholds:

```bash
python market_helper.py recommend-loot --server Victoris --loot-file loot.txt --min-market-unit-net 500 --min-market-liquidity 0.12 --min-market-confidence 0.65 --min-market-month-sold 6 --out loot-recommendation.json
```

Weight configuration file:
- `item_weights.json` maps item name (or item id) to weight in oz.
- Used to compute `coin_per_oz` and decide `remove_from_loot_list`.

## Local UI

Run a local web UI to:
- check local run status and world freshness
- refresh price data from server
- search specific items from local detailed data
- paste loot for recommendation

Architecture:
- Vite + Vue frontend in `ui-app/`
- Python/Flask middleware serves API endpoints
- During dev, Vite proxies `/api` to Flask at `127.0.0.1:8787`
- For deployment, Flask serves built frontend from `ui-app/dist` only
- Business logic and market access remain in Python

Run frontend + backend together:

```bash
npm run dev
```

Manual backend only:

```bash
python web_ui.py --server Victoris --host 127.0.0.1 --port 8787
```

Then open:
- FE dev server: http://127.0.0.1:5173
- BE direct (optional): http://127.0.0.1:8787

## Notes

- API source: https://api.tibiamarket.top/docs#/
- If an item has strong NPC buy value, that floor is respected.
- Flat client price is conservative expected net value after tax, with NPC floor fallback.
- You can tune `--sales-tax-pct` and `--dxp-window-days`.

## Suggested Workflow

1. Run `npm run dev` for the full web UI + API workflow.
2. Refresh prices from the UI/API (`/api/refresh`) when needed.
3. Paste hunt loot in the UI (`/api/recommend`) to decide NPC/List Now/List One/List Later/Skip Market.

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
