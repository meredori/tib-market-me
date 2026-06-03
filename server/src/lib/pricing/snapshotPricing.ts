export type PricingResult = {
  fair_price: number;
  suggested_list_price: number;
  trend: "rising" | "falling" | "stable" | "unknown";
  trend_score: number;
  liquidity: number;
  confidence: number;
};

function valid(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundNice(value: number): number {
  let step = 1;
  if (value > 100_000) {
    step = 100;
  } else if (value > 10_000) {
    step = 50;
  } else if (value > 1_000) {
    step = 10;
  } else if (value > 100) {
    step = 5;
  }
  return Math.round(value / step) * step;
}

function trendScore(row: Record<string, unknown>): number {
  const monthSell = valid(row.month_average_sell);
  const daySell = valid(row.day_average_sell);
  const sellOffer = valid(row.sell_offer);
  const monthSold = valid(row.month_sold);
  const daySold = valid(row.day_sold);

  let score = 0;
  if (monthSell && daySell) {
    score += (daySell - monthSell) / monthSell;
  }
  if (monthSell && sellOffer) {
    score += 0.5 * ((sellOffer - monthSell) / monthSell);
  }
  if (monthSold !== null && daySold !== null) {
    const baselineDay = Math.max(monthSold / 30, 1);
    score += 0.3 * ((daySold - baselineDay) / baselineDay);
  }

  return clamp(score, -1, 1);
}

function liquidity(row: Record<string, unknown>): number {
  const monthSold = valid(row.month_sold) ?? 0;
  const daySold = valid(row.day_sold) ?? 0;
  const active = valid(row.active_traders) ?? 0;
  const raw = monthSold / 120 + daySold / 20 + active / 30;
  return 1 - Math.exp(-raw);
}

export function computeSnapshotPricing(row: Record<string, unknown>): PricingResult {
  const anchors: Array<[number, number]> = [];

  const monthAvgSell = valid(row.month_average_sell);
  const dayAvgSell = valid(row.day_average_sell);
  const sellOffer = valid(row.sell_offer);
  const buyOffer = valid(row.buy_offer);

  if (monthAvgSell) {
    anchors.push([monthAvgSell, 0.5]);
  }

  if (dayAvgSell) {
    let dayWeight = 0.28;
    if (monthAvgSell && Math.abs(dayAvgSell - monthAvgSell) / monthAvgSell > 0.35) {
      dayWeight *= 0.35;
    }
    anchors.push([dayAvgSell, dayWeight]);
  }

  if (sellOffer) {
    anchors.push([sellOffer, 0.15]);
  }

  if (buyOffer) {
    anchors.push([buyOffer, 0.07]);
  }

  if (anchors.length === 0) {
    return {
      fair_price: -1,
      suggested_list_price: -1,
      trend: "unknown",
      trend_score: 0,
      liquidity: 0,
      confidence: 0
    };
  }

  const weightedSum = anchors.reduce((acc, [value, weight]) => acc + value * weight, 0);
  const totalWeight = anchors.reduce((acc, [, weight]) => acc + weight, 0);
  let base = weightedSum / totalWeight;

  const lowerCandidates = [valid(row.month_lowest_sell), valid(row.day_lowest_sell), buyOffer].filter(
    (value): value is number => value !== null
  );
  const upperCandidates = [valid(row.month_highest_sell), valid(row.day_highest_sell), sellOffer].filter(
    (value): value is number => value !== null
  );

  const lowBound = lowerCandidates.length > 0 ? Math.max(...lowerCandidates) * 0.88 : null;
  const highBound = upperCandidates.length > 0 ? Math.min(...upperCandidates) * 1.12 : null;

  if (lowBound !== null && highBound !== null && lowBound <= highBound) {
    base = clamp(base, lowBound, highBound);
  } else if (lowBound !== null) {
    base = Math.max(base, lowBound);
  } else if (highBound !== null) {
    base = Math.min(base, highBound);
  }

  const score = trendScore(row);
  const liq = liquidity(row);
  let trend: PricingResult["trend"] = "stable";
  if (score > 0.08) {
    trend = "rising";
  } else if (score < -0.08) {
    trend = "falling";
  }

  let listing = base;
  if (trend === "rising") {
    listing *= 1.02 + 0.03 * liq;
  } else if (trend === "falling") {
    listing *= 0.99 - 0.02 * (1 - liq);
  }

  const conf = Math.min(1, 0.35 + 0.35 * liq + 0.1 * anchors.length);

  return {
    fair_price: roundNice(base),
    suggested_list_price: roundNice(Math.max(listing, 1)),
    trend,
    trend_score: Number(score.toFixed(4)),
    liquidity: Number(liq.toFixed(4)),
    confidence: Number(conf.toFixed(4))
  };
}