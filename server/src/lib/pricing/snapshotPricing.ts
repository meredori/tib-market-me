export type PricingResult = {
  fair_price: number;
  suggested_list_price: number;
  trend: "rising" | "falling" | "stable" | "unknown";
  trend_score: number;
  liquidity: number;
  confidence: number;
};

export type HistoricalPricingContext = {
  source_run_count: number;
  reference_price: number | null;
  low_band: number | null;
  high_band: number | null;
};

export type HistoricalPricingAdjustment = {
  historical_reference_price: number | null;
  final_adjusted_price: number | null;
  divergence_pct: number | null;
  adjustment_reason: string | null;
  source_run_count: number;
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

export function applyHistoricalPricingAdjustment(
  pricing: PricingResult,
  row: Record<string, unknown>,
  history: HistoricalPricingContext
): HistoricalPricingAdjustment {
  const currentPrice = pricing.suggested_list_price > 0 ? pricing.suggested_list_price : pricing.fair_price;
  const reference = history.reference_price;
  const lowBand = history.low_band;
  const highBand = history.high_band;
  const sellOffer = valid(row.sell_offer);
  const monthSold = valid(row.month_sold) ?? 0;
  const daySold = valid(row.day_sold) ?? 0;

  if (currentPrice <= 0 || reference === null || lowBand === null || highBand === null) {
    return {
      historical_reference_price: reference,
      final_adjusted_price: null,
      divergence_pct: null,
      adjustment_reason: history.source_run_count > 0 ? "insufficient_history" : null,
      source_run_count: history.source_run_count
    };
  }

  const hasCurrentSellEvidence = sellOffer !== null || monthSold > 0 || daySold > 0;
  if (!hasCurrentSellEvidence) {
    return {
      historical_reference_price: reference,
      final_adjusted_price: null,
      divergence_pct: Number((((currentPrice - reference) / reference) * 100).toFixed(2)),
      adjustment_reason: "no_current_sell_evidence",
      source_run_count: history.source_run_count
    };
  }

  const divergencePct = Number((((currentPrice - reference) / reference) * 100).toFixed(2));
  if (currentPrice >= lowBand && currentPrice <= highBand) {
    return {
      historical_reference_price: reference,
      final_adjusted_price: currentPrice,
      divergence_pct: divergencePct,
      adjustment_reason: "within_historical_band",
      source_run_count: history.source_run_count
    };
  }

  const currentConfidence = pricing.confidence;
  const correctionStrength = currentConfidence >= 0.8 ? 0.25 : currentConfidence >= 0.6 ? 0.45 : 0.65;
  const target = currentPrice > highBand ? highBand : lowBand;
  const adjusted = roundNice(currentPrice + (target - currentPrice) * correctionStrength);

  return {
    historical_reference_price: reference,
    final_adjusted_price: adjusted,
    divergence_pct: divergencePct,
    adjustment_reason: currentPrice > highBand
      ? "capped_toward_historical_high_band"
      : "raised_toward_historical_low_band",
    source_run_count: history.source_run_count
  };
}
