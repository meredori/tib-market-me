export type TibiaLevelWindow = {
  min: number | null;
  max: number | null;
  step: number | null;
  pct_each_side: number;
};

export function tibiaLevelWindow(level: number | null | undefined): TibiaLevelWindow {
  if (level === null || level === undefined || !Number.isFinite(level) || level <= 0) {
    return { min: null, max: null, step: null, pct_each_side: 5 };
  }

  const roundedLevel = Math.round(level);
  const step = roundedLevel >= 100 ? 10 : 5;
  const min = Math.max(1, Math.floor((roundedLevel * 0.95) / step) * step);
  const max = Math.max(min, Math.ceil((roundedLevel * 1.05) / step) * step);
  return { min, max, step, pct_each_side: 5 };
}

export function sameTibiaLevelWindow(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return true;
  }
  const window = tibiaLevelWindow(a);
  return window.min === null || window.max === null || (b >= window.min && b <= window.max);
}
