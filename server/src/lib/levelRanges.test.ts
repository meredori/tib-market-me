import { describe, expect, it } from "vitest";
import { sameTibiaLevelWindow, tibiaLevelWindow } from "./levelRanges";

describe("tibiaLevelWindow", () => {
  it("uses a narrow rounded window for lower levels", () => {
    expect(tibiaLevelWindow(58)).toEqual({
      min: 55,
      max: 65,
      step: 5,
      pct_each_side: 5
    });
  });

  it("rounds higher-level windows to tens", () => {
    expect(tibiaLevelWindow(100)).toEqual({
      min: 90,
      max: 110,
      step: 10,
      pct_each_side: 5
    });
  });

  it("matches hunts inside the current level window", () => {
    expect(sameTibiaLevelWindow(58, 65)).toBe(true);
    expect(sameTibiaLevelWindow(58, 70)).toBe(false);
  });
});
