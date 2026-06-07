import type { ItemValueOverrideMode } from "../sync/lootLogic";

export function objectBody(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parsePositiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return Math.trunc(parsed);
}

export function parseItemOverrideMode(value: unknown): ItemValueOverrideMode {
  if (value === "auto" || value === "ignore" || value === "market" || value === "npc") {
    return value;
  }
  throw new Error("Invalid override mode");
}

export function parseItemPriceMode(value: unknown): "conservative_min" | "sell_offer" {
  if (value === undefined || value === null || value === "") {
    return "conservative_min";
  }
  if (value === "conservative_min" || value === "sell_offer") {
    return value;
  }
  throw new Error("Invalid item price mode");
}

export function parseString(
  value: unknown,
  label: string,
  options: { required?: boolean; maxLength?: number } = {}
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (options.required && !text) {
    throw new Error(`${label} is required`);
  }
  if (options.maxLength && text.length > options.maxLength) {
    throw new Error(`${label} must be ${options.maxLength} characters or fewer`);
  }
  return text;
}

export function parseOptionalString(
  value: unknown,
  label: string,
  options: { maxLength?: number } = {}
): string | null {
  const text = parseString(value, label, { maxLength: options.maxLength });
  return text || null;
}

export function parseStringArray(
  value: unknown,
  label: string,
  options: { maxEntries?: number; maxLength?: number } = {}
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  if (options.maxEntries && value.length > options.maxEntries) {
    throw new Error(`${label} must contain ${options.maxEntries} entries or fewer`);
  }
  return value.map((entry, index) => parseString(entry, `${label}[${index}]`, {
    required: true,
    maxLength: options.maxLength
  }));
}

export function parseHuntPayload(value: unknown): Record<string, unknown> {
  const body = objectBody(value);
  return {
    ...body,
    raw_text: parseString(body.raw_text, "raw_text", { required: true, maxLength: 200000 }),
    label: parseOptionalString(body.label, "label", { maxLength: 120 }),
    location_name: parseOptionalString(body.location_name, "location_name", { maxLength: 120 }),
    tags: parseStringArray(body.tags, "tags", { maxEntries: 20, maxLength: 40 }),
    excluded_item_names: parseStringArray(body.excluded_item_names, "excluded_item_names", {
      maxEntries: 100,
      maxLength: 120
    })
  };
}

export function parseHydrateItemsPayload(value: unknown): { item_names: string[] } {
  const body = objectBody(value);
  return {
    item_names: parseStringArray(body.item_names, "item_names", { maxEntries: 60, maxLength: 120 })
  };
}
