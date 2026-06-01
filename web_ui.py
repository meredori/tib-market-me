#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Flask, jsonify, request, send_from_directory

from market_helper import (
    Config,
    DEFAULT_MIN_COIN_PER_OZ,
    DEFAULT_MIN_MARKET_CONFIDENCE,
    DEFAULT_MIN_MARKET_LIQUIDITY,
    DEFAULT_MIN_MARKET_MONTH_SOLD,
    DEFAULT_MIN_MARKET_UNIT_NET,
    DEFAULT_MIN_UNIT_VALUE,
    DEFAULT_WEIGHTS_JSON,
    TibiaMarketClient,
    build_name_index,
    load_item_weights,
    next_dxp_date,
    normalize_loot_item_name,
    parse_hunt_log_summary,
    parse_loot_text,
    recommend_action,
    resolve_item_weight_oz,
    singularize,
    effective_coin_per_oz_floor,
)


def build_app(
    server: str,
    detail_json: str,
    prices_json: str,
    meta_json: str,
    sales_tax_pct: float,
    dxp_window_days: int,
) -> Flask:
    app = Flask(__name__)
    workspace_dir = Path(__file__).parent
    ui_dir = workspace_dir / "ui-app" / "dist"

    detail_path = Path(detail_json)
    prices_path = Path(prices_json)
    meta_path = Path(meta_json)

    def _read_json(path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default

    def _status() -> Dict[str, Any]:
        detail = _read_json(detail_path, {})
        meta = _read_json(meta_path, {})
        return {
            "server": server,
            "local_run": meta.get("local_run", {}),
            "world_data": meta.get("world_data", {}),
            "item_count": int(detail.get("item_count", 0) or 0),
            "generated_at": detail.get("generated_at"),
            "files": {
                "prices": str(prices_path),
                "detail": str(detail_path),
                "meta": str(meta_path),
            },
        }

    def _search_items(query: str, limit: int = 80) -> List[Dict[str, Any]]:
        detail = _read_json(detail_path, {})
        items = detail.get("items", [])
        q = query.strip().lower()
        if not q:
            return []

        out: List[Dict[str, Any]] = []
        for row in items:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "")
            wiki_name = str(row.get("wiki_name") or "")
            if q not in name.lower() and q not in wiki_name.lower() and q not in str(row.get("id", "")):
                continue
            pricing = row.get("pricing") or {}
            out.append(
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "wiki_name": row.get("wiki_name"),
                    "client_value": row.get("client_value"),
                    "npc_buy": row.get("npc_buy"),
                    "fair_price": pricing.get("fair_price"),
                    "suggested_list_price": pricing.get("suggested_list_price"),
                    "trend": pricing.get("trend"),
                    "liquidity": pricing.get("liquidity"),
                }
            )
            if len(out) >= limit:
                break
        return out

    def _refresh_prices() -> Dict[str, Any]:
        cfg = Config(server=server, sales_tax_pct=sales_tax_pct, verbose=False)
        client = TibiaMarketClient(cfg)

        from market_helper import cmd_update_prices

        class Args:
            pass

        args = Args()
        args.server = server
        args.sales_tax_pct = sales_tax_pct
        args.page_limit = 250
        args.page_pause_sec = 0.35
        args.verbose = False
        args.out = str(prices_path)
        args.detail_out = str(detail_path)
        args.meta_out = str(meta_path)

        cmd_update_prices(args)

        world_rows = client.get_world_data(servers=server)
        world_last = None
        if world_rows and isinstance(world_rows[0], dict):
            world_last = world_rows[0].get("last_update")

        return {
            "ok": True,
            "refreshed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "world_last_update": world_last,
            "status": _status(),
        }

    def _recommend_from_loot(loot_text: str) -> Dict[str, Any]:
        detail = _read_json(detail_path, {})
        pricing_items = detail.get("items", [])
        pricing_by_id: Dict[int, Dict[str, Any]] = {}
        for row in pricing_items:
            if isinstance(row, dict) and isinstance(row.get("id"), int):
                pricing_by_id[row["id"]] = row

        item_weights = load_item_weights(DEFAULT_WEIGHTS_JSON)
        pickup_coin_per_oz_floor = effective_coin_per_oz_floor(item_weights, DEFAULT_MIN_COIN_PER_OZ)

        cfg = Config(server=server, sales_tax_pct=sales_tax_pct, dxp_window_days=dxp_window_days)
        client = TibiaMarketClient(cfg)
        metadata_rows = client.get_item_metadata()
        events = client.get_events()
        upcoming_dxp = next_dxp_date(events)

        name_index = build_name_index(metadata_rows)
        metadata_by_id = {
            int(r["id"]): r for r in metadata_rows if isinstance(r, dict) and isinstance(r.get("id"), int)
        }

        parse_summary = parse_hunt_log_summary(loot_text)
        parsed = parse_summary.get("items", []) if parse_summary.get("loot_lines", 0) > 0 else parse_loot_text(loot_text)
        report_rows: List[Dict[str, Any]] = []

        for count, raw_name in parsed:
            key = normalize_loot_item_name(raw_name)
            meta = name_index.get(key)
            if meta is None:
                meta = name_index.get(singularize(key))
            if meta is None:
                alias = {
                    "gold": "gold coin",
                    "gold coin": "gold coin",
                }.get(key)
                if alias:
                    meta = name_index.get(alias)

            if meta is None:
                report_rows.append(
                    {
                        "item": raw_name,
                        "count": count,
                        "action": "Unknown",
                        "reason": "Item name not matched in item metadata.",
                    }
                )
                continue

            item_id = int(meta["id"])
            detail_row = pricing_by_id.get(item_id)
            if not detail_row:
                report_rows.append(
                    {
                        "item": meta.get("name") or raw_name,
                        "count": count,
                        "action": "Unknown",
                        "reason": "No pricing data for this item. Refresh local data first.",
                    }
                )
                continue

            pricing = detail_row.get("pricing", {})
            market_snapshot = detail_row.get("market_snapshot", {})
            weight_oz = resolve_item_weight_oz(
                item_id=item_id,
                item_name=meta.get("name"),
                wiki_name=meta.get("wiki_name"),
                weights=item_weights,
            )

            rec = recommend_action(
                item_row=metadata_by_id[item_id],
                pricing_row=pricing,
                count=count,
                sales_tax_pct=sales_tax_pct,
                next_dxp=upcoming_dxp,
                dxp_window_days=dxp_window_days,
                market_context=market_snapshot,
                weight_oz=weight_oz,
                min_unit_value=DEFAULT_MIN_UNIT_VALUE,
                min_coin_per_oz=pickup_coin_per_oz_floor,
                min_market_unit_net=DEFAULT_MIN_MARKET_UNIT_NET,
                min_market_liquidity=DEFAULT_MIN_MARKET_LIQUIDITY,
                min_market_confidence=DEFAULT_MIN_MARKET_CONFIDENCE,
                min_market_month_sold=DEFAULT_MIN_MARKET_MONTH_SOLD,
            )

            report_rows.append(
                {
                    "item": meta.get("name") or raw_name,
                    "id": item_id,
                    **rec,
                }
            )

        report_rows.sort(key=lambda r: int(r.get("count", 0)), reverse=True)

        return {
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "server": server,
            "dxp_next": upcoming_dxp.isoformat() if upcoming_dxp else None,
            "pickup_thresholds": {
                "min_unit_value": DEFAULT_MIN_UNIT_VALUE,
                "min_coin_per_oz": pickup_coin_per_oz_floor,
                "weights_json": DEFAULT_WEIGHTS_JSON,
            },
            "market_thresholds": {
                "min_market_unit_net": DEFAULT_MIN_MARKET_UNIT_NET,
                "min_market_liquidity": DEFAULT_MIN_MARKET_LIQUIDITY,
                "min_market_confidence": DEFAULT_MIN_MARKET_CONFIDENCE,
                "min_market_month_sold": DEFAULT_MIN_MARKET_MONTH_SOLD,
            },
            "parser": {
                "total_lines": parse_summary.get("total_lines"),
                "loot_lines": parse_summary.get("loot_lines"),
                "ignored_lines": parse_summary.get("ignored_lines"),
                "first_timestamp": parse_summary.get("first_timestamp"),
                "last_timestamp": parse_summary.get("last_timestamp"),
            },
            "results": report_rows,
        }

    @app.get("/")
    def home() -> Any:
        if not ui_dir.exists():
            return jsonify({"error": "Frontend build not found. Run: npm --prefix ui-app run build"}), 503
        return send_from_directory(ui_dir, "index.html")

    @app.get("/<path:asset_path>")
    def ui_assets(asset_path: str) -> Any:
        if asset_path.startswith("api/"):
            return jsonify({"error": "Not found"}), 404
        if not ui_dir.exists():
            return jsonify({"error": "Frontend build not found. Run: npm --prefix ui-app run build"}), 503
        return send_from_directory(ui_dir, asset_path)

    @app.get("/api/status")
    def api_status() -> Any:
        return jsonify(_status())

    @app.get("/api/search")
    def api_search() -> Any:
        query = str(request.args.get("q", ""))
        return jsonify({"results": _search_items(query=query)})

    @app.post("/api/refresh")
    def api_refresh() -> Any:
        try:
            return jsonify(_refresh_prices())
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc)}), 500

    @app.post("/api/recommend")
    def api_recommend() -> Any:
        payload = request.get_json(force=True, silent=True) or {}
        loot_text = str(payload.get("loot_text", ""))
        if not loot_text.strip():
            return jsonify({"error": "loot_text is required"}), 400
        try:
            return jsonify(_recommend_from_loot(loot_text))
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    return app


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local Tibia Market Helper UI")
    parser.add_argument("--server", default="Victoris")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--detail-json", default="itemsprices.detailed.json")
    parser.add_argument("--prices-json", default="itemsprices.json")
    parser.add_argument("--meta-json", default="itemsprices.meta.json")
    parser.add_argument("--sales-tax-pct", type=float, default=8.0)
    parser.add_argument("--dxp-window-days", type=int, default=14)
    args = parser.parse_args()

    app = build_app(
        server=args.server,
        detail_json=args.detail_json,
        prices_json=args.prices_json,
        meta_json=args.meta_json,
        sales_tax_pct=args.sales_tax_pct,
        dxp_window_days=args.dxp_window_days,
    )

    app.run(host=args.host, port=args.port, debug=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
