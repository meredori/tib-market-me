export type ItemValueOverrideMode = "auto" | "ignore" | "market" | "npc";

export type LootLogicPreview = {
  strategy: "market" | "npc_sell" | "npc_buy" | "ignore";
  override_mode?: ItemValueOverrideMode;
  trend_display: string;
  reason: string;
  market_allowed: boolean;
  list_price: number;
  min_list_price: number;
  price: number;
  min_price: number;
  market_sell_offer: number;
  undercut_price: number;
};

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function withNpcSaleFloor(value: number, npcBuy: number): number {
  return npcBuy > 0 ? Math.max(value, npcBuy) : value;
}

export function coerceOverrideMode(value: unknown): ItemValueOverrideMode {
  return value === "ignore" || value === "market" || value === "npc" ? value : "auto";
}

export function buildLootLogicPreview(row: Record<string, unknown>): LootLogicPreview {
  const listPrice = asInt(row.suggested_list_price, -1);
  const marketSellOffer = asInt(row.sell_offer, -1);
  const trend = asText(row.trend) || "unknown";
  const liquidity = typeof row.liquidity === "number" ? row.liquidity : 0;
  const confidence = typeof row.confidence === "number" ? row.confidence : 0;
  const monthSold = asInt(row.month_sold, -1);
  const daySold = asInt(row.day_sold, -1);
  const npcBuy = asInt(row.npc_buy, 0);

  const veryLowVolume = monthSold >= 0 && monthSold < 6;
  const staleAndThin = daySold === 0 && monthSold >= 0 && monthSold < 25 && liquidity < 0.2;
  const lowMarketQuality = liquidity < 0.1 || confidence < 0.6 || veryLowVolume || staleAndThin;
  const hasMarketEvidence = marketSellOffer > 0 || monthSold > 0 || daySold > 0;
  const slowValuableMarket = listPrice >= 10_000 && hasMarketEvidence && confidence >= 0.45;
  const marketAllowed = listPrice > 0 && (!lowMarketQuality || slowValuableMarket);

  if (!marketAllowed) {
    if (npcBuy > 0) {
      return {
        strategy: "npc_buy",
        trend_display: "n/a",
        reason: "Market ignored due to low volume/quality; using NPC sale fallback.",
        market_allowed: false,
        list_price: listPrice,
        min_list_price: listPrice,
        price: npcBuy,
        min_price: -1,
        market_sell_offer: marketSellOffer,
        undercut_price: -1
      };
    }

    return {
      strategy: "ignore",
      trend_display: "n/a",
      reason: "Market ignored due to low volume/quality and no known sell value.",
      market_allowed: false,
      list_price: listPrice,
      min_list_price: listPrice,
      price: -1,
      min_price: -1,
      market_sell_offer: marketSellOffer,
      undercut_price: -1
    };
  }

  const minListPrice = Math.max(1, Math.floor(listPrice * 0.9));
  const flooredListPrice = withNpcSaleFloor(listPrice, npcBuy);
  const flooredMinListPrice = withNpcSaleFloor(minListPrice, npcBuy);

  let undercutPrice = flooredListPrice;
  if (marketSellOffer > 0) {
    if (marketSellOffer >= listPrice) {
      undercutPrice = flooredListPrice;
    } else if (marketSellOffer > minListPrice) {
      undercutPrice = withNpcSaleFloor(marketSellOffer - 1, npcBuy);
    } else {
      undercutPrice = flooredMinListPrice;
    }
  }

  return {
    strategy: npcBuy > listPrice ? "npc_buy" : "market",
    trend_display: trend,
    reason: npcBuy > listPrice
      ? "NPC sale value is above market; using NPC sale floor."
      : slowValuableMarket && lowMarketQuality
        ? "Slow high-value market with price evidence; keeping calculated market value."
        : "Market has sufficient volume/quality; list at list price, undercut down to min price, then hold at min.",
    market_allowed: true,
    list_price: listPrice,
    min_list_price: flooredMinListPrice,
    price: flooredListPrice,
    min_price: flooredMinListPrice,
    market_sell_offer: marketSellOffer,
    undercut_price: undercutPrice
  };
}

export function getEffectiveLootLogicPreview(row: Record<string, unknown>): LootLogicPreview {
  return applyLootLogicOverride(row, buildLootLogicPreview(row), coerceOverrideMode(row.override_mode));
}

function applyLootLogicOverride(
  row: Record<string, unknown>,
  base: LootLogicPreview,
  overrideMode: ItemValueOverrideMode
): LootLogicPreview {
  if (overrideMode === "auto") {
    return { ...base, override_mode: "auto" };
  }

  const listPrice = asInt(row.suggested_list_price, -1);
  const fairPrice = asInt(row.fair_price, -1);
  const clientValue = asInt(row.client_value, -1);
  const npcBuy = asInt(row.npc_buy, 0);
  const marketSellOffer = asInt(row.sell_offer, -1);
  const trend = asText(row.trend) || base.trend_display || "unknown";

  if (overrideMode === "ignore") {
    return {
      ...base,
      override_mode: "ignore",
      strategy: "ignore",
      trend_display: "n/a",
      reason: "Manual override: ignore this item for loot value calculations.",
      market_allowed: false,
      price: -1,
      min_price: -1,
      undercut_price: -1
    };
  }

  if (overrideMode === "npc") {
    return {
      ...base,
      override_mode: "npc",
      strategy: npcBuy > 0 ? "npc_buy" : "ignore",
      trend_display: "n/a",
      reason: npcBuy > 0
        ? "Manual override: use NPC sale value."
        : "Manual override requested NPC value, but no NPC sale value is known.",
      market_allowed: false,
      price: npcBuy > 0 ? npcBuy : -1,
      min_price: npcBuy > 0 ? npcBuy : -1,
      undercut_price: -1
    };
  }

  const marketValue = [listPrice, fairPrice, clientValue].find((value) => value > 0) ?? -1;
  const minMarketValue = marketValue > 0 ? Math.max(1, Math.floor(marketValue * 0.9)) : -1;
  return {
    ...base,
    override_mode: "market",
    strategy: marketValue > 0 ? "market" : "ignore",
    trend_display: trend,
    reason: marketValue > 0
      ? "Manual override: use market value even if automatic quality rules would choose another mode."
      : "Manual override requested market value, but no market value is known.",
    market_allowed: marketValue > 0,
    list_price: marketValue,
    min_list_price: minMarketValue,
    price: marketValue,
    min_price: minMarketValue,
    market_sell_offer: marketSellOffer,
    undercut_price: marketValue
  };
}
