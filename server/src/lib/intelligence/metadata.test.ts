import { describe, expect, it } from "vitest";
import { confidence, entityRef, explanation, freshness, labelsFromExplanations, provenance } from "./metadata";

describe("intelligence metadata helpers", () => {
  it("maps confidence scores to stable levels", () => {
    expect(confidence(0.9)).toMatchObject({ level: "high", score: 0.9 });
    expect(confidence(0.5)).toMatchObject({ level: "medium", score: 0.5 });
    expect(confidence(0.2)).toMatchObject({ level: "low", score: 0.2 });
    expect(confidence(null, { missingDataReason: "no data" })).toMatchObject({
      level: "unknown",
      missing_data_reason: "no data"
    });
  });

  it("describes freshness with stale and missing states", () => {
    const now = Date.parse("2026-06-13T00:00:00.000Z");

    expect(freshness("2026-06-12T18:00:00.000Z", { nowMs: now, staleAfterHours: 24 }).status).toBe("fresh");
    expect(freshness("2026-06-10T00:00:00.000Z", { nowMs: now, staleAfterHours: 24 }).status).toBe("stale");
    expect(freshness(null).status).toBe("missing");
  });

  it("creates explanation labels from shared provenance and entity refs", () => {
    const item = entityRef("item", { id: 123, name: "Crystal Sword" });
    const source = provenance("market_sync", { source_ref: item });
    const entries = [
      explanation("active market", "positive", "Market activity is strong.", { source_refs: [item], provenance: [source] }),
      explanation("stale snapshot", "warning", "Market data is old.", { source_refs: [item], provenance: [source] })
    ];

    expect(labelsFromExplanations(entries, "positive")).toEqual(["active market"]);
    expect(labelsFromExplanations(entries, "warning")).toEqual(["stale snapshot"]);
  });
});
