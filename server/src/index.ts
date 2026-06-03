import { config } from "./config";
import { openDatabase } from "./lib/db/database";
import { applyMigrations } from "./lib/db/migrations";
import { runMarketSync } from "./lib/sync/updatePrices";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  const db = openDatabase();
  applyMigrations(db);

  if (command === "migrate") {
    console.log("Migrations applied.");
    db.close();
    return;
  }

  if (command === "sync") {
    const result = await runMarketSync(db);
    console.log(JSON.stringify(result, null, 2));
    db.close();
    return;
  }

  const app = buildServer(db);
  await app.listen({ host: config.host, port: config.port });
  console.log(`Server listening on http://${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});