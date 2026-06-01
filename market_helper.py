#!/usr/bin/env python3
"""
Tibia Market helper for Victoris.

Features:
- Pull market + metadata from https://api.tibiamarket.top
- Build guarded "should sell for" prices (not just current offer)
- Write itemsprices.json for client upload
- Parse hunt loot text and recommend NPC / list now / list later
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


API_BASE = "https://api.tibiamarket.top"
DEFAULT_SERVER = "Victoris"
TIME_PREFIX_RE = re.compile(r"^\s*\d{1,2}:\d{2}\s+(.+)$", re.IGNORECASE)
LOOT_LINE_RE = re.compile(r"^loot of\s+[^:]+:\s*(.+)$", re.IGNORECASE)
DEFAULT_WEIGHTS_JSON = "item_weights.json"
DEFAULT_MIN_UNIT_VALUE = 20
DEFAULT_MIN_COIN_PER_OZ = 12.0
DEFAULT_MIN_MARKET_UNIT_NET = 500
DEFAULT_MIN_MARKET_LIQUIDITY = 0.12
DEFAULT_MIN_MARKET_CONFIDENCE = 0.65
DEFAULT_MIN_MARKET_MONTH_SOLD = 6
DEFAULT_MIN_PICKUP_NPC_VALUE = 50


@dataclass
class Config:
    server: str = DEFAULT_SERVER
    sales_tax_pct: float = 8.0
    request_timeout_sec: int = 20
    max_retries: int = 6
    limit: int = 250
    dxp_window_days: int = 14
    page_pause_sec: float = 0.35
    verbose: bool = False


class TibiaMarketClient:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.session = requests.Session()

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{API_BASE}{path}"
        last_err: Optional[Exception] = None
        for attempt in range(1, self.config.max_retries + 1):
            try:
                response = self.session.get(url, params=params, timeout=self.config.request_timeout_sec)
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    wait_s = 1.5 * attempt
                    if retry_after:
                        try:
                            wait_s = max(wait_s, float(retry_after))
                        except ValueError:
                            pass
                    if attempt < self.config.max_retries:
                        if self.config.verbose:
                            print(
                                f"Rate limited on {path}. Waiting {wait_s:.1f}s before retry {attempt + 1}...",
                                file=sys.stderr,
                            )
                        time.sleep(wait_s)
                        continue
                response.raise_for_status()
                return response.json()
            except Exception as exc:  # requests exceptions are runtime and network related
                last_err = exc
                if attempt < self.config.max_retries:
                    time.sleep(0.7 * attempt)
                else:
                    raise RuntimeError(f"GET {url} failed after {attempt} attempts: {exc}") from exc
        raise RuntimeError(f"GET {url} failed: {last_err}")

    def get_market_values(self, server: str, skip: int, limit: int) -> List[Dict[str, Any]]:
        return self._get(
            "/market_values",
            {
                "server": server,
                "skip": skip,
                "limit": limit,
            },
        )

    def get_all_market_values(self, server: str) -> List[Dict[str, Any]]:
        all_rows: List[Dict[str, Any]] = []
        seen_ids: set[int] = set()
        skip = 0
        limit = self.config.limit
        while True:
            chunk = self.get_market_values(server=server, skip=skip, limit=limit)
            if not chunk:
                break

            fresh_rows: List[Dict[str, Any]] = []
            for row in chunk:
                item_id = row.get("id") if isinstance(row, dict) else None
                if isinstance(item_id, int) and item_id not in seen_ids:
                    seen_ids.add(item_id)
                    fresh_rows.append(row)

            # Protect against APIs that may repeat pages under heavy throttling or skip limits.
            if not fresh_rows:
                if self.config.verbose:
                    print(
                        f"No new item IDs returned at skip={skip}; stopping pagination safely.",
                        file=sys.stderr,
                    )
                break

            all_rows.extend(fresh_rows)
            if self.config.verbose:
                print(f"Fetched {len(all_rows)} market rows...", file=sys.stderr)
            if len(chunk) < limit:
                break
            skip += limit
            time.sleep(self.config.page_pause_sec)
        return all_rows

    def get_item_metadata(self) -> List[Dict[str, Any]]:
        return self._get("/item_metadata", {})

    def get_events(self) -> List[Dict[str, Any]]:
        # Wide range so future known events (if published) are included.
        return self._get("/events", {"start_days_ago": 365, "end_days_ago": -1})

    def get_world_data(self, servers: Optional[str] = None) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {}
        if servers:
            params["servers"] = servers
        return self._get("/world_data", params)


class PriceEngine:
    def __init__(self, config: Config):
        self.config = config

    @staticmethod
    def _valid(v: Any) -> Optional[float]:
        if isinstance(v, (int, float)) and v > 0:
            return float(v)
        return None

    @staticmethod
    def _clamp(v: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, v))

    @staticmethod
    def _round_nice(value: float) -> int:
        if value <= 100:
            step = 1
        elif value <= 1_000:
            step = 5
        elif value <= 10_000:
            step = 10
        elif value <= 100_000:
            step = 50
        else:
            step = 100
        return int(round(value / step) * step)

    def _trend_score(self, row: Dict[str, Any]) -> float:
        month_sell = self._valid(row.get("month_average_sell"))
        day_sell = self._valid(row.get("day_average_sell"))
        sell_offer = self._valid(row.get("sell_offer"))
        month_sold = self._valid(row.get("month_sold"))
        day_sold = self._valid(row.get("day_sold"))

        score = 0.0
        if month_sell and day_sell:
            score += (day_sell - month_sell) / month_sell
        if month_sell and sell_offer:
            score += 0.5 * ((sell_offer - month_sell) / month_sell)
        if month_sold is not None and day_sold is not None:
            baseline_day = max(month_sold / 30.0, 1.0)
            score += 0.3 * ((day_sold - baseline_day) / baseline_day)

        return self._clamp(score, -1.0, 1.0)

    def _liquidity(self, row: Dict[str, Any]) -> float:
        month_sold = self._valid(row.get("month_sold")) or 0.0
        day_sold = self._valid(row.get("day_sold")) or 0.0
        active = self._valid(row.get("active_traders")) or 0.0

        # Saturating liquidity formula; tuned to avoid overreacting to one noisy metric.
        raw = (month_sold / 120.0) + (day_sold / 20.0) + (active / 30.0)
        return 1.0 - math.exp(-raw)

    def fair_price(self, row: Dict[str, Any]) -> Dict[str, Any]:
        anchors: List[Tuple[float, float]] = []

        month_avg_sell = self._valid(row.get("month_average_sell"))
        day_avg_sell = self._valid(row.get("day_average_sell"))
        sell_offer = self._valid(row.get("sell_offer"))
        buy_offer = self._valid(row.get("buy_offer"))

        if month_avg_sell:
            anchors.append((month_avg_sell, 0.50))
        if day_avg_sell:
            day_weight = 0.28
            if month_avg_sell and abs(day_avg_sell - month_avg_sell) / month_avg_sell > 0.35:
                # Reduce one-day shock influence when it diverges too far from month baseline.
                day_weight *= 0.35
            anchors.append((day_avg_sell, day_weight))
        if sell_offer:
            anchors.append((sell_offer, 0.15))
        if buy_offer:
            anchors.append((buy_offer, 0.07))

        if not anchors:
            return {
                "fair_price": -1,
                "suggested_list_price": -1,
                "trend": "unknown",
                "trend_score": 0.0,
                "liquidity": 0.0,
                "confidence": 0.0,
            }

        weighted_sum = sum(v * w for v, w in anchors)
        total_weight = sum(w for _, w in anchors)
        base = weighted_sum / total_weight

        lower_candidates = [
            self._valid(row.get("month_lowest_sell")),
            self._valid(row.get("day_lowest_sell")),
            buy_offer,
        ]
        upper_candidates = [
            self._valid(row.get("month_highest_sell")),
            self._valid(row.get("day_highest_sell")),
            sell_offer,
        ]

        lowers = [v for v in lower_candidates if v is not None]
        uppers = [v for v in upper_candidates if v is not None]
        low_bound = max(lowers) * 0.88 if lowers else None
        high_bound = min(uppers) * 1.12 if uppers else None

        if low_bound is not None and high_bound is not None and low_bound <= high_bound:
            base = self._clamp(base, low_bound, high_bound)
        elif low_bound is not None:
            base = max(base, low_bound)
        elif high_bound is not None:
            base = min(base, high_bound)

        trend_score = self._trend_score(row)
        liquidity = self._liquidity(row)

        if trend_score > 0.08:
            trend = "rising"
        elif trend_score < -0.08:
            trend = "falling"
        else:
            trend = "stable"

        # Suggested listing adjusts from fair value using trend + liquidity.
        listing = base
        if trend == "rising":
            listing *= 1.02 + 0.03 * liquidity
        elif trend == "falling":
            listing *= 0.99 - 0.02 * (1.0 - liquidity)

        confidence = min(1.0, 0.35 + 0.35 * liquidity + 0.1 * len(anchors))

        return {
            "fair_price": self._round_nice(base),
            "suggested_list_price": self._round_nice(max(listing, 1.0)),
            "trend": trend,
            "trend_score": round(trend_score, 4),
            "liquidity": round(liquidity, 4),
            "confidence": round(confidence, 4),
        }


def parse_event_date(value: str) -> Optional[dt.datetime]:
    try:
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        parsed = dt.datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed
    except ValueError:
        return None


def next_dxp_date(events: List[Dict[str, Any]]) -> Optional[dt.datetime]:
    now = dt.datetime.now(dt.timezone.utc)
    needles = ("double xp", "dxp", "double experience")
    upcoming: List[dt.datetime] = []

    for entry in events:
        date_raw = entry.get("date")
        names = [str(x).lower() for x in entry.get("events", [])]
        if not isinstance(date_raw, str) or not names:
            continue
        if not any(any(n in ev for n in needles) for ev in names):
            continue
        when = parse_event_date(date_raw)
        if when and when > now:
            upcoming.append(when)

    if not upcoming:
        return None
    return min(upcoming)


def best_npc_buy_price(meta_row: Dict[str, Any]) -> int:
    npc_buy = meta_row.get("npc_buy") or []
    prices = [x.get("price") for x in npc_buy if isinstance(x, dict) and isinstance(x.get("price"), int)]
    return max(prices) if prices else 0


def build_name_index(metadata: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    index: Dict[str, Dict[str, Any]] = {}

    def register(name: Optional[str], row: Dict[str, Any]) -> None:
        if not name:
            return
        key = name.strip().lower()
        if key:
            index[key] = row

    for row in metadata:
        register(row.get("name"), row)
        register(row.get("wiki_name"), row)
    return index


def singularize(name: str) -> str:
    # Lightweight singularization for common loot text patterns.
    if name.endswith("ies") and len(name) > 4:
        return name[:-3] + "y"
    if name.endswith("es") and len(name) > 3:
        return name[:-2]
    if name.endswith("s") and len(name) > 2:
        return name[:-1]
    return name


def strip_chat_prefix(line: str) -> str:
    clean = line.strip().lstrip("'\"")
    m_time = TIME_PREFIX_RE.match(clean)
    if m_time:
        return m_time.group(1).strip()
    return clean


def normalize_log_text(raw: str) -> str:
    text = raw.strip()
    if not text:
        return text

    # Handle payloads where newlines were escaped before reaching parser.
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n")

    # Remove one outer quote pair if whole payload is quoted.
    if (text.startswith("\"") and text.endswith("\"")) or (text.startswith("'") and text.endswith("'")):
        text = text[1:-1]

    # Some paste sources flatten logs into one line; split before timestamp markers.
    timestamp_hits = re.findall(r"\b\d{1,2}:\d{2}\s", text)
    if len(timestamp_hits) > 5 and text.count("\n") <= 1:
        text = re.sub(r"\s+(?=\d{1,2}:\d{2}\s)", "\n", text)

    return text


def extract_loot_payloads(text: str) -> List[str]:
    payloads: List[str] = []
    for raw in text.splitlines():
        message = strip_chat_prefix(raw)
        if not message:
            continue
        m_loot = LOOT_LINE_RE.match(message)
        if not m_loot:
            continue
        payloads.append(m_loot.group(1).strip().rstrip("."))
    return payloads


def parse_hunt_log_summary(text: str) -> Dict[str, Any]:
    normalized = normalize_log_text(text)
    lines = [line for line in normalized.splitlines() if line.strip()]
    loot_lines = 0
    parsed_items: List[Tuple[int, str]] = []
    first_time: Optional[str] = None
    last_time: Optional[str] = None

    for raw in lines:
        m_time = re.match(r"^\s*(\d{1,2}:\d{2})\b", raw)
        if m_time:
            stamp = m_time.group(1)
            if first_time is None:
                first_time = stamp
            last_time = stamp

        message = strip_chat_prefix(raw)
        m_loot = LOOT_LINE_RE.match(message)
        if not m_loot:
            continue

        loot_lines += 1
        payload = m_loot.group(1).strip().rstrip(".")
        if payload.lower() == "nothing":
            continue

        for part in [p.strip() for p in payload.split(",") if p.strip()]:
            entry = parse_loot_fragment(part)
            if entry:
                parsed_items.append(entry)

    item_counts = aggregate_item_counts(parsed_items)
    return {
        "total_lines": len(lines),
        "loot_lines": loot_lines,
        "ignored_lines": max(len(lines) - loot_lines, 0),
        "first_timestamp": first_time,
        "last_timestamp": last_time,
        "items": item_counts,
    }


def parse_loot_fragment(fragment: str) -> Optional[Tuple[int, str]]:
    clean = fragment.strip().rstrip(".").lower()
    if not clean:
        return None
    if clean.startswith("and "):
        clean = clean[4:].strip()

    m_count = re.match(r"^(\d+)\s+(.+)$", clean)
    if m_count:
        return int(m_count.group(1)), m_count.group(2).strip()

    m_article = re.match(r"^(?:an?|the)\s+(.+)$", clean)
    if m_article:
        return 1, m_article.group(1).strip()

    return 1, clean


def normalize_loot_item_name(name: str) -> str:
    key = name.strip().lower().rstrip(".")
    if key.endswith(" coins"):
        return key[:-1]
    if key == "gold":
        return "gold coin"
    return key


def load_item_weights(path: str) -> Dict[str, float]:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        payload = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    out: Dict[str, float] = {}
    for k, v in payload.items():
        try:
            weight = float(v)
        except (TypeError, ValueError):
            continue
        if weight > 0:
            out[str(k).strip().lower()] = weight
    return out


def resolve_item_weight_oz(
    item_id: Optional[int],
    item_name: Optional[str],
    wiki_name: Optional[str],
    weights: Dict[str, float],
) -> Optional[float]:
    keys: List[str] = []
    if isinstance(item_id, int):
        keys.append(str(item_id))
    if item_name:
        keys.append(normalize_loot_item_name(item_name))
    if wiki_name:
        keys.append(normalize_loot_item_name(wiki_name))

    for key in keys:
        if key in weights:
            return float(weights[key])
    return None


def effective_coin_per_oz_floor(weights: Dict[str, float], fallback: float = DEFAULT_MIN_COIN_PER_OZ) -> float:
    gold_weight = weights.get("gold coin")
    if not isinstance(gold_weight, (int, float)) or gold_weight <= 0:
        return fallback
    gold_density = 1.0 / float(gold_weight)
    return min(fallback, gold_density)


def aggregate_item_counts(items: List[Tuple[int, str]]) -> List[Tuple[int, str]]:
    counts: Dict[str, int] = {}
    order: List[str] = []
    for count, name in items:
        key = normalize_loot_item_name(name)
        if not key:
            continue
        if key not in counts:
            counts[key] = 0
            order.append(key)
        counts[key] += int(count)
    return [(counts[key], key) for key in order]


def parse_loot_text(loot_text: str) -> List[Tuple[int, str]]:
    raw = normalize_log_text(loot_text)
    if not raw:
        return []

    # If a whole hunt log is pasted, only process explicit loot lines and ignore all others.
    summary = parse_hunt_log_summary(raw)
    if summary.get("loot_lines", 0) > 0:
        return summary.get("items", [])

    # Fallback path for single loot lines or compact user input.
    text = strip_chat_prefix(raw).replace("\n", " ").strip().rstrip(".")
    m_loot = LOOT_LINE_RE.match(text)
    if m_loot:
        text = m_loot.group(1).strip()
    elif ":" in text:
        text = text.split(":", 1)[1].strip()

    if not text or text.lower() == "nothing":
        return []

    parts = [p.strip() for p in text.split(",") if p.strip()]
    parsed_single: List[Tuple[int, str]] = []
    for part in parts:
        entry = parse_loot_fragment(part)
        if entry:
            parsed_single.append(entry)
    return aggregate_item_counts(parsed_single)


def recommend_action(
    item_row: Dict[str, Any],
    pricing_row: Dict[str, Any],
    count: int,
    sales_tax_pct: float,
    next_dxp: Optional[dt.datetime],
    dxp_window_days: int,
    market_context: Optional[Dict[str, Any]] = None,
    weight_oz: Optional[float] = None,
    min_unit_value: int = DEFAULT_MIN_UNIT_VALUE,
    min_coin_per_oz: float = DEFAULT_MIN_COIN_PER_OZ,
    min_market_unit_net: int = DEFAULT_MIN_MARKET_UNIT_NET,
    min_market_liquidity: float = DEFAULT_MIN_MARKET_LIQUIDITY,
    min_market_confidence: float = DEFAULT_MIN_MARKET_CONFIDENCE,
    min_market_month_sold: int = DEFAULT_MIN_MARKET_MONTH_SOLD,
) -> Dict[str, Any]:
    market_context = market_context or {}
    list_price = int(pricing_row.get("suggested_list_price", -1))
    fair_price = int(pricing_row.get("fair_price", -1))
    trend = pricing_row.get("trend", "unknown")
    trend_score = float(pricing_row.get("trend_score", 0.0))
    liquidity = float(pricing_row.get("liquidity", 0.0))
    confidence = float(pricing_row.get("confidence", 0.0))
    month_sold = int(market_context.get("month_sold", -1)) if market_context.get("month_sold") is not None else -1
    day_sold = int(market_context.get("day_sold", -1)) if market_context.get("day_sold") is not None else -1
    sell_offer_raw = market_context.get("sell_offer")
    sell_offer = int(sell_offer_raw) if isinstance(sell_offer_raw, int) else None

    npc_buy = best_npc_buy_price(item_row)
    market_net = int(round(max(list_price, fair_price, 0) * (1.0 - sales_tax_pct / 100.0)))

    now = dt.datetime.now(dt.timezone.utc)
    dxp_days: Optional[int] = None
    if next_dxp:
        dxp_days = (next_dxp - now).days

    action = "List Now"
    reason = "Market net value is favorable versus guaranteed NPC value."

    weak_volume = (month_sold >= 0 and month_sold < min_market_month_sold) or (day_sold >= 0 and day_sold == 0)
    weak_market_quality = liquidity < min_market_liquidity or confidence < min_market_confidence or weak_volume
    market_eligible = market_net >= min_market_unit_net and not weak_market_quality
    is_unlisted = sell_offer == 0

    if npc_buy > 0 and (market_net <= 0 or npc_buy >= int(market_net * 0.95)):
        action = "NPC"
        reason = "Guaranteed NPC return is at or above expected market net value."
    elif npc_buy > 0 and weak_market_quality and npc_buy >= int(market_net * 0.7):
        action = "NPC"
        reason = "Low confidence/liquidity/volume makes this listing risky versus NPC certainty."
    elif not market_eligible:
        if npc_buy > 0:
            action = "NPC"
            reason = "Fails minimum market thresholds; prefer guaranteed NPC sale."
        elif is_unlisted and market_net >= min_market_unit_net and confidence >= 0.50 and (month_sold < 0 or month_sold >= 1):
            action = "List One"
            reason = "Item is currently unlisted; list a single unit only and avoid bulk risk."
        else:
            action = "Skip Market"
            reason = "Fails market threshold (value/liquidity/confidence/volume). Do not list."
    elif dxp_days is not None and 0 <= dxp_days <= dxp_window_days and trend_score > 0.04:
        action = "List Later"
        reason = f"Uptrend + upcoming DXP in ~{dxp_days} days; waiting may improve sale price."
    elif liquidity < 0.15 and trend == "falling":
        action = "NPC" if npc_buy > 0 else "Skip Market"
        reason = "Low liquidity and falling trend increase market risk."

    total_npc = npc_buy * count
    total_market_net = market_net * count
    target_time = None

    if action == "List Later" and dxp_days is not None and next_dxp:
        target = next_dxp - dt.timedelta(days=2)
        target_time = target.isoformat()

    best_unit_realizable = max(npc_buy, market_net)
    if action == "Skip Market" and npc_buy <= 0:
        best_unit_realizable = 0
    suggested_market_quantity = 1 if action == "List One" else (count if action in {"List Now", "List Later"} else 0)
    coin_per_oz: Optional[float] = None
    should_pickup = best_unit_realizable >= int(min_unit_value)
    pickup_reason = ""
    low_npc_value = npc_buy > 0 and npc_buy <= DEFAULT_MIN_PICKUP_NPC_VALUE
    low_density = False

    if weight_oz is not None and weight_oz > 0:
        coin_per_oz = round(best_unit_realizable / weight_oz, 2)
        low_density = coin_per_oz < min_coin_per_oz
        if low_npc_value and low_density:
            should_pickup = False
            pickup_reason = (
                f"Low NPC value ({npc_buy} gp) and low value density ({coin_per_oz} gp/oz < {min_coin_per_oz} gp/oz threshold)."
            )
        elif coin_per_oz < min_coin_per_oz:
            should_pickup = False
            pickup_reason = (
                f"Low value density ({coin_per_oz} gp/oz < {min_coin_per_oz} gp/oz threshold)."
            )
        elif should_pickup:
            pickup_reason = f"Value density is acceptable at {coin_per_oz} gp/oz."
    elif should_pickup:
        pickup_reason = "No weight configured; kept by unit-value threshold."
    else:
        pickup_reason = f"Unit value below threshold ({best_unit_realizable} < {min_unit_value})."

    if action == "Skip Market":
        should_pickup = False
        if pickup_reason:
            pickup_reason = f"Skip Market: {pickup_reason}"
        else:
            pickup_reason = "Skip Market: do not keep for loot filter."

    cap_remove_optional = False
    if action == "NPC" and should_pickup and coin_per_oz is not None and weight_oz is not None:
        cap_remove_optional = npc_buy >= 20 and coin_per_oz <= (min_coin_per_oz * 1.5)

    if action == "NPC":
        display_recommendation = (
            "Sell NPC / Optional remove (Cap remove)" if cap_remove_optional else "Sell NPC"
        )
    elif action == "List Later":
        trigger_price = sell_offer if isinstance(sell_offer, int) and sell_offer > 0 else max(list_price, fair_price, market_net)
        display_recommendation = f"List when cheapest is {trigger_price:,}"
    elif action == "List One":
        display_recommendation = "List Now"
    elif action == "List Now":
        display_recommendation = "List Now"
    elif action == "Skip Market":
        display_recommendation = "Remove from Loot Filter"
    else:
        display_recommendation = action

    if should_pickup and action != "Skip Market" and npc_buy == 0 and display_recommendation == "Sell NPC":
        display_recommendation = "List Now"

    return {
        "action": action,
        "display_recommendation": display_recommendation,
        "cap_remove_optional": cap_remove_optional,
        "reason": reason,
        "count": count,
        "unit": {
            "npc_buy": npc_buy,
            "fair_price": fair_price,
            "suggested_list_price": list_price,
            "individual_list_price": list_price,
            "expected_market_net": market_net,
        },
        "total": {
            "npc_buy": total_npc,
            "expected_market_net": total_market_net,
        },
        "market_quality": {
            "confidence": confidence,
            "month_sold": month_sold,
            "day_sold": day_sold,
            "sell_offer": sell_offer,
            "weak_market_quality": weak_market_quality,
            "market_eligible": market_eligible,
        },
        "pickup": {
            "recommended": should_pickup,
            "remove_from_loot_list": not should_pickup,
            "weight_oz": weight_oz,
            "coin_per_oz": coin_per_oz,
            "unit_value_used": best_unit_realizable,
            "reason": pickup_reason,
            "coin_per_oz_floor": min_coin_per_oz,
        },
        "suggested_market_quantity": suggested_market_quantity,
        "trend": trend,
        "liquidity": liquidity,
        "list_target_time": target_time,
    }


def cmd_update_prices(args: argparse.Namespace) -> int:
    run_started_at = dt.datetime.now(dt.timezone.utc)
    config = Config(
        server=args.server,
        sales_tax_pct=args.sales_tax_pct,
        limit=args.page_limit,
        page_pause_sec=args.page_pause_sec,
        verbose=args.verbose,
    )
    client = TibiaMarketClient(config)
    engine = PriceEngine(config)

    market_rows = client.get_all_market_values(config.server)
    metadata_rows = client.get_item_metadata()
    world_rows = client.get_world_data(servers=config.server)

    metadata_by_id: Dict[int, Dict[str, Any]] = {
        int(r["id"]): r for r in metadata_rows if isinstance(r, dict) and isinstance(r.get("id"), int)
    }

    flat_prices: Dict[str, int] = {}
    detailed_rows: List[Dict[str, Any]] = []

    for row in market_rows:
        if not isinstance(row, dict):
            continue
        item_id = row.get("id")
        if not isinstance(item_id, int):
            continue

        meta = metadata_by_id.get(item_id, {})
        pricing = engine.fair_price(row)
        npc_buy = best_npc_buy_price(meta)

        list_price = int(pricing.get("suggested_list_price", -1))
        fair_price = int(pricing.get("fair_price", -1))

        # Client flat price uses conservative expected value, not raw listing ask.
        expected_net = int(round(max(list_price, fair_price, 0) * (1.0 - config.sales_tax_pct / 100.0)))
        client_value = max(expected_net, npc_buy)

        if client_value > 0:
            flat_prices[str(item_id)] = int(client_value)

        detailed_rows.append(
            {
                "id": item_id,
                "name": meta.get("name"),
                "wiki_name": meta.get("wiki_name"),
                "npc_buy": npc_buy,
                "pricing": pricing,
                "market_snapshot": {
                    "month_sold": row.get("month_sold", -1),
                    "day_sold": row.get("day_sold", -1),
                    "month_average_sell": row.get("month_average_sell", -1),
                    "day_average_sell": row.get("day_average_sell", -1),
                    "sell_offer": row.get("sell_offer", -1),
                    "buy_offer": row.get("buy_offer", -1),
                },
                "client_value": client_value,
            }
        )

    out_flat = Path(args.out)
    out_detail = Path(args.detail_out)
    out_meta = Path(args.meta_out)

    out_flat.write_text(json.dumps(flat_prices, indent=2, sort_keys=True), encoding="utf-8")

    run_finished_at = dt.datetime.now(dt.timezone.utc)

    detail_payload = {
        "generated_at": run_finished_at.isoformat(),
        "server": config.server,
        "pricing_model": "robust-v1",
        "sales_tax_pct": config.sales_tax_pct,
        "item_count": len(detailed_rows),
        "items": detailed_rows,
    }
    out_detail.write_text(json.dumps(detail_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    selected_world = None
    for world in world_rows:
        if not isinstance(world, dict):
            continue
        if str(world.get("name", "")).lower() == config.server.lower():
            selected_world = world
            break
    if selected_world is None and world_rows:
        selected_world = world_rows[0]

    meta_payload = {
        "server": config.server,
        "local_run": {
            "started_at": run_started_at.isoformat(),
            "finished_at": run_finished_at.isoformat(),
        },
        "world_data": {
            "queried_at": run_finished_at.isoformat(),
            "server": selected_world.get("name") if isinstance(selected_world, dict) else config.server,
            "last_update": selected_world.get("last_update") if isinstance(selected_world, dict) else None,
        },
        "outputs": {
            "flat_prices": str(out_flat),
            "detailed_prices": str(out_detail),
        },
        "counts": {
            "market_rows": len(market_rows),
            "priced_items": len(flat_prices),
        },
    }
    out_meta.write_text(json.dumps(meta_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {len(flat_prices)} item prices to {out_flat}")
    print(f"Wrote detailed pricing to {out_detail}")
    print(f"Wrote run metadata to {out_meta}")
    return 0


def cmd_recommend_loot(args: argparse.Namespace) -> int:
    config = Config(
        server=args.server,
        sales_tax_pct=args.sales_tax_pct,
        dxp_window_days=args.dxp_window_days,
        verbose=args.verbose,
    )
    client = TibiaMarketClient(config)

    detail_path = Path(args.detail_json)
    if not detail_path.exists():
        raise FileNotFoundError(
            f"{detail_path} not found. Run update-prices first to create detailed pricing data."
        )

    detail = json.loads(detail_path.read_text(encoding="utf-8"))
    pricing_items = detail.get("items", [])

    pricing_by_id: Dict[int, Dict[str, Any]] = {}
    for row in pricing_items:
        if isinstance(row, dict) and isinstance(row.get("id"), int):
            pricing_by_id[row["id"]] = row

    item_weights = load_item_weights(args.weights_json)
    pickup_coin_per_oz_floor = effective_coin_per_oz_floor(item_weights, args.min_coin_per_oz)

    metadata_rows = client.get_item_metadata()
    name_index = build_name_index(metadata_rows)
    metadata_by_id = {
        int(r["id"]): r for r in metadata_rows if isinstance(r, dict) and isinstance(r.get("id"), int)
    }

    if args.loot_file:
        loot_text = Path(args.loot_file).read_text(encoding="utf-8")
    elif args.loot_text:
        loot_text = args.loot_text
    else:
        print("Paste loot text, then press Ctrl+Z and Enter (Windows) or Ctrl+D (Unix):")
        loot_text = sys.stdin.read()

    parse_summary = parse_hunt_log_summary(loot_text)
    parsed = parse_summary.get("items", []) if parse_summary.get("loot_lines", 0) > 0 else parse_loot_text(loot_text)
    if not parsed:
        print("No loot items found in pasted text.")
        return 0

    events = client.get_events()
    upcoming_dxp = next_dxp_date(events)

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
                    "reason": "No pricing data for this item. Re-run update-prices.",
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
            sales_tax_pct=config.sales_tax_pct,
            next_dxp=upcoming_dxp,
            dxp_window_days=config.dxp_window_days,
            market_context=market_snapshot,
            weight_oz=weight_oz,
            min_unit_value=args.min_unit_value,
            min_coin_per_oz=pickup_coin_per_oz_floor,
            min_market_unit_net=args.min_market_unit_net,
            min_market_liquidity=args.min_market_liquidity,
            min_market_confidence=args.min_market_confidence,
            min_market_month_sold=args.min_market_month_sold,
        )

        report_rows.append(
            {
                "item": meta.get("name") or raw_name,
                "id": item_id,
                **rec,
            }
        )

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "server": config.server,
        "dxp_next": upcoming_dxp.isoformat() if upcoming_dxp else None,
        "pickup_thresholds": {
            "min_unit_value": args.min_unit_value,
            "min_coin_per_oz": pickup_coin_per_oz_floor,
            "weights_json": args.weights_json,
        },
        "market_thresholds": {
            "min_market_unit_net": args.min_market_unit_net,
            "min_market_liquidity": args.min_market_liquidity,
            "min_market_confidence": args.min_market_confidence,
            "min_market_month_sold": args.min_market_month_sold,
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

    if args.out:
        Path(args.out).write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Wrote loot recommendation report to {args.out}")
    else:
        print(json.dumps(payload, indent=2, ensure_ascii=False))

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Tibia Market helper (Victoris)")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--server", default=DEFAULT_SERVER, help="Tibia server name (default: Victoris)")
    common.add_argument("--sales-tax-pct", type=float, default=8.0, help="Estimated market sales tax percent")
    common.add_argument("--verbose", action="store_true", help="Enable verbose progress logs")

    p_update = sub.add_parser(
        "update-prices",
        help="Fetch market data and write price JSON files",
        parents=[common],
    )
    p_update.add_argument("--out", default="itemsprices.json", help="Output path for flat client prices JSON")
    p_update.add_argument("--page-limit", type=int, default=250, help="API page size for market_values pagination")
    p_update.add_argument("--page-pause-sec", type=float, default=0.35, help="Pause between market_values pages")
    p_update.add_argument(
        "--detail-out",
        default="itemsprices.detailed.json",
        help="Output path for detailed analytics JSON",
    )
    p_update.add_argument(
        "--meta-out",
        default="itemsprices.meta.json",
        help="Output path for run metadata (local run + world update times)",
    )
    p_update.set_defaults(func=cmd_update_prices)

    p_loot = sub.add_parser(
        "recommend-loot",
        help="Recommend NPC/List Now/List Later for pasted loot",
        parents=[common],
    )
    p_loot.add_argument(
        "--detail-json",
        default="itemsprices.detailed.json",
        help="Detailed pricing JSON from update-prices command",
    )
    p_loot.add_argument("--loot-file", help="Path to text file containing hunt loot line(s)")
    p_loot.add_argument("--loot-text", help="Loot text inline")
    p_loot.add_argument("--dxp-window-days", type=int, default=14, help="Days before DXP to consider list-later")
    p_loot.add_argument("--weights-json", default=DEFAULT_WEIGHTS_JSON, help="JSON file for item weights in oz")
    p_loot.add_argument("--min-unit-value", type=int, default=DEFAULT_MIN_UNIT_VALUE, help="Minimum unit value to keep item")
    p_loot.add_argument(
        "--min-coin-per-oz",
        type=float,
        default=DEFAULT_MIN_COIN_PER_OZ,
        help="Minimum value density (gp/oz) to keep item when weight is known",
    )
    p_loot.add_argument(
        "--min-market-unit-net",
        type=int,
        default=DEFAULT_MIN_MARKET_UNIT_NET,
        help="Minimum expected market net to suggest market listing",
    )
    p_loot.add_argument(
        "--min-market-liquidity",
        type=float,
        default=DEFAULT_MIN_MARKET_LIQUIDITY,
        help="Minimum liquidity to suggest market listing",
    )
    p_loot.add_argument(
        "--min-market-confidence",
        type=float,
        default=DEFAULT_MIN_MARKET_CONFIDENCE,
        help="Minimum confidence score to suggest market listing",
    )
    p_loot.add_argument(
        "--min-market-month-sold",
        type=int,
        default=DEFAULT_MIN_MARKET_MONTH_SOLD,
        help="Minimum monthly sold volume to suggest market listing",
    )
    p_loot.add_argument("--out", help="Output JSON report path (prints to stdout if omitted)")
    p_loot.set_defaults(func=cmd_recommend_loot)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
