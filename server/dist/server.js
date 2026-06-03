"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServer = buildServer;
const fastify_1 = __importDefault(require("fastify"));
const static_1 = __importDefault(require("@fastify/static"));
const config_1 = require("./config");
const updatePrices_1 = require("./lib/sync/updatePrices");
function buildServer(db) {
    const app = (0, fastify_1.default)({ logger: false });
    app.register(static_1.default, {
        root: config_1.config.itemImagesDir,
        prefix: "/items/",
        cacheControl: true,
        maxAge: "7d",
        immutable: true,
        decorateReply: false
    });
    app.get("/api/status", async () => (0, updatePrices_1.getStatus)(db));
    app.get("/api/search", async (request) => {
        const startedAt = Date.now();
        const q = typeof request.query === "object" && request.query !== null
            ? String(request.query.q ?? "")
            : "";
        const results = (0, updatePrices_1.searchLatestItems)(db, q, 80);
        return { results, elapsed_ms: Date.now() - startedAt };
    });
    app.get("/api/item/:id", async (request, reply) => {
        const rawId = request.params.id;
        const itemId = Number(rawId);
        if (!Number.isFinite(itemId)) {
            reply.code(400);
            return { error: "Invalid item id" };
        }
        const details = (0, updatePrices_1.getItemDetails)(db, itemId);
        if (!details) {
            reply.code(404);
            return { error: "Item not found in latest market run" };
        }
        return details;
    });
    app.post("/api/refresh", async (request, reply) => {
        try {
            const preflight = await (0, updatePrices_1.preflightRefresh)(db);
            if (!preflight.should_refresh) {
                return {
                    ok: true,
                    skipped: true,
                    message: preflight.message,
                    world_last_update: preflight.remote_world_last_update,
                    status: (0, updatePrices_1.getStatus)(db)
                };
            }
            const refresh = await (0, updatePrices_1.runMarketSync)(db);
            return {
                ...refresh,
                skipped: false,
                message: preflight.message,
                status: (0, updatePrices_1.getStatus)(db)
            };
        }
        catch (error) {
            reply.code(500);
            return {
                ok: false,
                error: String(error)
            };
        }
    });
    app.get("/", async () => ({
        name: "tibia-market-server",
        server: config_1.config.serverName,
        status: "ok"
    }));
    return app;
}
