import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../../config";

export type MarketRow = Record<string, unknown> & {
  id?: unknown;
  time?: unknown;
};

export type ItemMetadata = Record<string, unknown> & {
  id?: unknown;
  name?: unknown;
  wiki_name?: unknown;
  category?: unknown;
  tier?: unknown;
  npc_buy?: unknown;
  npc_sell?: unknown;
};

export type WorldDataRow = Record<string, unknown> & {
  name?: unknown;
  last_update?: unknown;
};

export class TibiaMarketClient {
  private readonly requestTimeoutMs = config.requestTimeoutMs;
  private readonly maxRetries = config.maxRetries;

  private async getJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const query = new URLSearchParams();
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        query.set(key, String(value));
      }
    }

    const url = `${config.apiBase}${path}${query.size > 0 ? `?${query.toString()}` : ""}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });

        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const retrySeconds = Math.max(1.5 * attempt, Number(retryAfter ?? "0") || 0);
          if (attempt < this.maxRetries) {
            await sleep(Math.ceil(retrySeconds * 1000));
            continue;
          }
        }

        if (!response.ok) {
          throw new Error(`GET ${url} failed with ${response.status}`);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await sleep(700 * attempt);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error(`GET ${url} failed after ${this.maxRetries} attempts: ${String(lastError)}`);
  }

  getMarketValues(server: string, skip: number, limit: number): Promise<MarketRow[]> {
    return this.getJson<MarketRow[]>("/market_values", { server, skip, limit });
  }

  async getAllMarketValues(server: string): Promise<MarketRow[]> {
    const allRows: MarketRow[] = [];
    const seenIds = new Set<number>();
    let skip = 0;

    while (true) {
      const chunk = await this.getMarketValues(server, skip, config.pageLimit);
      if (!Array.isArray(chunk) || chunk.length === 0) {
        break;
      }

      const freshRows: MarketRow[] = [];
      for (const row of chunk) {
        const itemId = typeof row?.id === "number" ? row.id : null;
        if (typeof itemId === "number" && !seenIds.has(itemId)) {
          seenIds.add(itemId);
          freshRows.push(row);
        }
      }

      if (freshRows.length === 0) {
        break;
      }

      allRows.push(...freshRows);

      if (chunk.length < config.pageLimit) {
        break;
      }

      skip += config.pageLimit;
      await sleep(config.pagePauseMs);
    }

    return allRows;
  }

  getItemMetadata(): Promise<ItemMetadata[]> {
    return this.getJson<ItemMetadata[]>("/item_metadata");
  }

  getWorldData(servers?: string): Promise<WorldDataRow[]> {
    if (!servers) {
      return this.getJson<WorldDataRow[]>("/world_data");
    }
    return this.getJson<WorldDataRow[]>("/world_data", { servers });
  }

  getEvents(): Promise<Record<string, unknown>[]> {
    return this.getJson<Record<string, unknown>[]>("/events", {
      start_days_ago: 365,
      end_days_ago: -1
    });
  }

  getItemHistory(server: string, itemId: number, startDaysAgo: number): Promise<Record<string, unknown>[]> {
    return this.getJson<Record<string, unknown>[]>("/item_history", {
      server,
      item_id: itemId,
      start_days_ago: startDaysAgo
    });
  }
}
