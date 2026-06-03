"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TibiaMarketClient = void 0;
const promises_1 = require("node:timers/promises");
const config_1 = require("../../config");
class TibiaMarketClient {
    requestTimeoutMs = config_1.config.requestTimeoutMs;
    maxRetries = config_1.config.maxRetries;
    async getJson(path, params) {
        const query = new URLSearchParams();
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                query.set(key, String(value));
            }
        }
        const url = `${config_1.config.apiBase}${path}${query.size > 0 ? `?${query.toString()}` : ""}`;
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                const response = await fetch(url, { signal: controller.signal });
                if (response.status === 429) {
                    const retryAfter = response.headers.get("retry-after");
                    const retrySeconds = Math.max(1.5 * attempt, Number(retryAfter ?? "0") || 0);
                    if (attempt < this.maxRetries) {
                        await (0, promises_1.setTimeout)(Math.ceil(retrySeconds * 1000));
                        continue;
                    }
                }
                if (!response.ok) {
                    throw new Error(`GET ${url} failed with ${response.status}`);
                }
                return (await response.json());
            }
            catch (error) {
                lastError = error;
                if (attempt < this.maxRetries) {
                    await (0, promises_1.setTimeout)(700 * attempt);
                    continue;
                }
            }
            finally {
                clearTimeout(timeout);
            }
        }
        throw new Error(`GET ${url} failed after ${this.maxRetries} attempts: ${String(lastError)}`);
    }
    getMarketValues(server, skip, limit) {
        return this.getJson("/market_values", { server, skip, limit });
    }
    async getAllMarketValues(server) {
        const allRows = [];
        const seenIds = new Set();
        let skip = 0;
        while (true) {
            const chunk = await this.getMarketValues(server, skip, config_1.config.pageLimit);
            if (!Array.isArray(chunk) || chunk.length === 0) {
                break;
            }
            const freshRows = [];
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
            if (chunk.length < config_1.config.pageLimit) {
                break;
            }
            skip += config_1.config.pageLimit;
            await (0, promises_1.setTimeout)(config_1.config.pagePauseMs);
        }
        return allRows;
    }
    getItemMetadata() {
        return this.getJson("/item_metadata");
    }
    getWorldData(servers) {
        if (!servers) {
            return this.getJson("/world_data");
        }
        return this.getJson("/world_data", { servers });
    }
    getEvents() {
        return this.getJson("/events", {
            start_days_ago: 365,
            end_days_ago: -1
        });
    }
}
exports.TibiaMarketClient = TibiaMarketClient;
