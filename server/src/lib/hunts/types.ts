import type { ItemHistorySummary } from "../pricing/itemHistory";
import type { LootLogicPreview } from "../sync/updatePrices";

export type HuntInput = {
  label: string;
  duration_minutes: number;
  raw_total_xp: number;
  total_xp: number;
  total_loot_gold: number;
  total_supply_cost: number;
  started_at: string | null;
  ended_at: string | null;
  location_name: string | null;
  character_name: string | null;
  character_vocation: string | null;
  character_level: number | null;
  character_world: string | null;
  character_lookup_at: string | null;
  tags: string[];
  excluded_item_names: string[];
  raw_text: string;
  processed_json: string;
  raw_text_hash: string;
};

export type ParsedHuntText = {
  label: string | null;
  duration_minutes: number | null;
  raw_total_xp: number | null;
  total_xp: number | null;
  total_loot_gold: number | null;
  total_supply_cost: number | null;
  started_at: string | null;
  ended_at: string | null;
  hunt_date: string | null;
  monsters: Array<{ name: string; count: number }>;
  loot_items: Array<{ name: string; quantity: number; normalized_name: string }>;
};

export type LootLookupRow = {
  item_id: number;
  name: string | null;
  wiki_name: string | null;
  client_value: number;
  suggested_list_price: number;
  fair_price: number;
  trend: string;
  liquidity: number;
  confidence: number;
  month_sold: number;
  day_sold: number;
  sell_offer: number;
  npc_buy: number;
  npc_sell: number;
  override_mode: string;
};

export type ItemDetailCacheRow = {
  normalized_name: string;
  requested_name: string;
  actual_name: string | null;
  plural: string | null;
  category_slug: string | null;
  category_name: string | null;
  stackable: number | null;
  marketable: number | null;
  npc_price: number | null;
  npc_value: number | null;
  value: number | null;
  weight_oz: number | null;
  item_ids: number[];
  wiki_url: string | null;
  payload_json: string;
  last_fetched_at: string;
};

export type EnrichedLootItem = {
  name: string;
  normalized_name: string;
  quantity: number;
  item_id: number | null;
  resolved_name: string | null;
  unit_value: number | null;
  excluded: boolean;
  excluded_value: number;
  total_value: number;
  weight_oz: number | null;
  gp_per_oz: number | null;
  contribution_pct: number;
  gp_oz_efficiency: "high" | "normal" | "low" | "unknown";
  trend: string | null;
  loot_logic: LootLogicPreview | null;
  history: ItemHistorySummary | null;
  lookup: LootLookupRow | null;
  item_detail: ItemDetailCacheRow | null;
  item_detail_status: "cached" | "missing" | "unavailable";
  value_source: "coin" | "loot_logic" | "unknown";
};
