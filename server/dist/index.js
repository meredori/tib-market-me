"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const database_1 = require("./lib/db/database");
const migrations_1 = require("./lib/db/migrations");
const updatePrices_1 = require("./lib/sync/updatePrices");
const server_1 = require("./server");
async function main() {
    const command = process.argv[2] ?? "serve";
    const db = (0, database_1.openDatabase)();
    (0, migrations_1.applyMigrations)(db);
    if (command === "migrate") {
        console.log("Migrations applied.");
        db.close();
        return;
    }
    if (command === "sync") {
        const result = await (0, updatePrices_1.runMarketSync)(db);
        console.log(JSON.stringify(result, null, 2));
        db.close();
        return;
    }
    const app = (0, server_1.buildServer)(db);
    await app.listen({ host: config_1.config.host, port: config_1.config.port });
    console.log(`Server listening on http://${config_1.config.host}:${config_1.config.port}`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
