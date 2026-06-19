import { describe, expect, it } from "vitest";
import { buildLootLogicPreview, getEffectiveLootLogicPreview } from "./lootLogic";

describe("loot logic", () => {
  it("keeps items with meaningful monthly sales on the market path", () => {
    const preview = buildLootLogicPreview({
      fair_price: 2500,
      suggested_list_price: 2600,
      client_value: 2500,
      sell_offer: -1,
      month_sold: 20,
      day_sold: 0,
      liquidity: 0.05,
      confidence: 0.5,
      trend: "stable",
      npc_buy: 1200
    });

    expect(preview.strategy).toBe("market");
    expect(preview.market_allowed).toBe(true);
    expect(preview.max_list_price).toBe(2600);
    expect(preview.fair_sale_price).toBe(2500);
  });

  it("uses suggested list price as shared max list price evidence", () => {
    const preview = buildLootLogicPreview({
      fair_price: 6220,
      suggested_list_price: 7390,
      client_value: 6220,
      sell_offer: -1,
      month_highest_sell: -1,
      day_highest_sell: -1,
      month_sold: 253,
      day_sold: 0,
      liquidity: 0.2,
      confidence: 0.8,
      trend: "stable",
      npc_buy: 0
    });

    expect(preview.max_list_price).toBe(7390);
    expect(preview.min_list_price).toBe(5598);
    expect(preview.fair_sale_price).toBe(6220);
  });

  it("does not use fair sale price as max list price without max evidence", () => {
    const preview = buildLootLogicPreview({
      fair_price: 2500,
      suggested_list_price: -1,
      client_value: 2500,
      sell_offer: -1,
      month_highest_sell: -1,
      day_highest_sell: -1,
      month_sold: 20,
      day_sold: 0,
      liquidity: 0.2,
      confidence: 0.8,
      trend: "stable",
      npc_buy: 1200
    });

    expect(preview.strategy).toBe("market");
    expect(preview.max_list_price).toBe(-1);
    expect(preview.fair_sale_price).toBe(2500);
    expect(preview.min_list_price).toBe(2250);
  });

  it("uses observed high sale evidence as max list price", () => {
    const preview = buildLootLogicPreview({
      fair_price: 2500,
      suggested_list_price: -1,
      client_value: 2500,
      sell_offer: -1,
      month_highest_sell: 4100,
      day_highest_sell: -1,
      month_sold: 20,
      day_sold: 0,
      liquidity: 0.2,
      confidence: 0.8,
      trend: "stable",
      npc_buy: 1200
    });

    expect(preview.max_list_price).toBe(4100);
    expect(preview.fair_sale_price).toBe(2500);
  });

  it("does not expose market list prices for NPC fallback recommendations", () => {
    const preview = buildLootLogicPreview({
      fair_price: 2500,
      suggested_list_price: 2600,
      client_value: 2500,
      sell_offer: -1,
      month_sold: 2,
      day_sold: 0,
      liquidity: 0.02,
      confidence: 0.4,
      trend: "stable",
      npc_buy: 1200
    });

    expect(preview.strategy).toBe("npc_buy");
    expect(preview.market_allowed).toBe(false);
    expect(preview.max_list_price).toBe(-1);
    expect(preview.fair_sale_price).toBe(1200);
  });

  it("values ignored automatic items at zero when there is no NPC buyer", () => {
    const preview = buildLootLogicPreview({
      fair_price: 2500,
      suggested_list_price: 2600,
      client_value: 2500,
      sell_offer: -1,
      month_sold: 2,
      day_sold: 0,
      liquidity: 0.02,
      confidence: 0.4,
      trend: "stable",
      npc_buy: 0
    });

    expect(preview.strategy).toBe("ignore");
    expect(preview.max_list_price).toBe(-1);
    expect(preview.fair_sale_price).toBe(0);
    expect(preview.min_list_price).toBe(0);
  });

  it("uses NPC value for manual ignore when an NPC buyer is available", () => {
    const preview = getEffectiveLootLogicPreview({
      fair_price: 2500,
      suggested_list_price: 2600,
      client_value: 2500,
      sell_offer: 2500,
      month_sold: 20,
      day_sold: 0,
      liquidity: 0.2,
      confidence: 0.8,
      trend: "stable",
      npc_buy: 1200,
      override_mode: "ignore"
    });

    expect(preview.strategy).toBe("ignore");
    expect(preview.market_allowed).toBe(false);
    expect(preview.max_list_price).toBe(-1);
    expect(preview.fair_sale_price).toBe(1200);
    expect(preview.min_list_price).toBe(1200);
  });
});
