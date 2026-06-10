import crypto from "node:crypto";

export function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumberOrNull(value: unknown): number | null {
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (!match) {
      return null;
    }
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asBooleanInt(value: unknown): number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value ? 1 : 0;
  }
  return null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asText(value).trim();
    if (text) {
      return text;
    }
  }
  return null;
}

export function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = asNumberOrNull(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

export function normalizeLootItemName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\s+/g, " ");
}

export function coerceExcludedItemNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeLootItemName(asText(entry)))
        .filter(Boolean)
    )
  ).slice(0, 100);
}

export function coerceTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asText(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 20);
}
