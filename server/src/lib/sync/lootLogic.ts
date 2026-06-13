export type ItemValueOverrideMode = "auto" | "ignore" | "market" | "npc";

export type LootLogicPreview = {
  strategy: "market" | "npc_sell" | "npc_buy" | "ignore";
  override_mode?: ItemValueOverrideMode;
  trend_display: string;
  reason: string;
  market_allowed: boolean;
  max_list_price: number;
  fair_sale_price: number;
  min_list_price: number;
  market_sell_offer: number;
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

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const numeric = asInt(value, -1);
    if (numeric > 0) {
      return numeric;
    }
  }
  return -1;
}

export function coerceOverrideMode(value: unknown): ItemValueOverrideMode {
  return value === "ignore" || value === "market" || value === "npc" ? value : "auto";
}

export function buildLootLogicPreview(row: Record<string, unknown>): LootLogicPreview {
  const suggestedListPrice = asInt(row.suggested_list_price, -1);
  const fairPrice = asInt(row.fair_price, -1);
  const maxListEvidence = firstPositive(row.month_highest_sell, row.day_highest_sell, suggestedListPrice);
  const marketSellOffer = asInt(row.sell_offer, -1);
  const trend = asText(row.trend) || "unknown";
  const liquidity = typeof row.liquidity === "number" ? row.liquidity : 0;
  const confidence = typeof row.confidence === "number" ? row.confidence : 0;
  const monthSold = asInt(row.month_sold, -1);
  const daySold = asInt(row.day_sold, -1);
  const npcBuy = asInt(row.npc_buy, 0);
  const marketFairSalePrice = firstPositive(fairPrice, row.client_value, suggestedListPrice);
  const fairSalePrice = withNpcSaleFloor(marketFairSalePrice, npcBuy);
  const maxListPrice = firstPositive(Math.max(maxListEvidence, fairSalePrice), fairSalePrice);
  const minListPrice = fairSalePrice > 0
    ? withNpcSaleFloor(Math.max(1, Math.floor(fairSalePrice * 0.9)), npcBuy)
    : (npcBuy > 0 ? npcBuy : -1);

  const veryLowVolume = monthSold >= 0 && monthSold < 6;
  const staleAndThin = daySold === 0 && monthSold >= 0 && monthSold < 25 && liquidity < 0.2;
  const lowMarketQuality = liquidity < 0.1 || confidence < 0.6 || veryLowVolume || staleAndThin;
  const hasMarketEvidence = marketSellOffer > 0 || monthSold > 0 || daySold > 0;
  const slowValuableMarket = fairSalePrice >= 10_000 && hasMarketEvidence && confidence >= 0.45;
  const marketAllowed = fairSalePrice > 0 && (!lowMarketQuality || slowValuableMarket);

  if (!marketAllowed) {
    if (npcBuy > 0) {
      return {
        strategy: "npc_buy",
        trend_display: "n/a",
        reason: "Market ignored due to low volume/quality; using NPC sale fallback.",
        market_allowed: false,
        max_list_price: maxListPrice,
        fair_sale_price: npcBuy,
        min_list_price: npcBuy,
        market_sell_offer: marketSellOffer
      };
    }

    return {
      strategy: "ignore",
      trend_display: "n/a",
      reason: "Market ignored due to low volume/quality and no known sell value.",
      market_allowed: false,
      max_list_price: maxListPrice,
      fair_sale_price: fairSalePrice,
      min_list_price: minListPrice,
      market_sell_offer: marketSellOffer
    };
  }

  return {
    strategy: npcBuy > marketFairSalePrice ? "npc_buy" : "market",
    trend_display: trend,
    reason: npcBuy > marketFairSalePrice
      ? "NPC sale value is above market; using NPC sale floor."
      : slowValuableMarket && lowMarketQuality
        ? "Slow high-value market with price evidence; keeping calculated market value."
        : "Market has sufficient volume/quality; use max/min listing range and value loot at fair sale price.",
    market_allowed: true,
    max_list_price: maxListPrice,
    fair_sale_price: fairSalePrice,
    min_list_price: minListPrice,
    market_sell_offer: marketSellOffer
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

  const listPrice = firstPositive(row.month_highest_sell, row.day_highest_sell, row.suggested_list_price);
  const fairPrice = firstPositive(row.fair_price, row.client_value, row.suggested_list_price);
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
      fair_sale_price: -1,
      max_list_price: -1,
      min_list_price: -1
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
      max_list_price: npcBuy > 0 ? npcBuy : -1,
      fair_sale_price: npcBuy > 0 ? npcBuy : -1,
      min_list_price: npcBuy > 0 ? npcBuy : -1
    };
  }

  const marketValue = withNpcSaleFloor(fairPrice, npcBuy);
  const maxMarketValue = firstPositive(Math.max(listPrice, marketValue), marketValue);
  const minMarketValue = marketValue > 0 ? withNpcSaleFloor(Math.max(1, Math.floor(marketValue * 0.9)), npcBuy) : -1;
  return {
    ...base,
    override_mode: "market",
    strategy: marketValue > 0 ? "market" : "ignore",
    trend_display: trend,
    reason: marketValue > 0
      ? "Manual override: use market value even if automatic quality rules would choose another mode."
      : "Manual override requested market value, but no market value is known.",
    market_allowed: marketValue > 0,
    max_list_price: maxMarketValue,
    fair_sale_price: marketValue,
    min_list_price: minMarketValue,
    market_sell_offer: marketSellOffer
  };
}
