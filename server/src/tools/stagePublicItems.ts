import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../lib/db/database";
import { config } from "../config";

type ManualTrack = {
  itemIds?: number[];
};

const MANUAL_TRACK_PATH = path.resolve(config.workspaceRoot, "assets", "manual-item-images.json");

function parseArgs(argv: string[]): { source: string; destination: string } {
  let source = path.resolve(config.workspaceRoot, "assets", "generated", "items-archive");
  let destination = config.itemImagesDir;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === "-s" || arg === "--source") && argv[i + 1]) {
      source = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "-d" || arg === "--destination") && argv[i + 1]) {
      destination = path.resolve(argv[i + 1]);
      i += 1;
    }
  }

  return { source, destination };
}

function loadManualIds(): number[] {
  if (!fs.existsSync(MANUAL_TRACK_PATH)) {
    return [3043, 3048, 3052];
  }

  const raw = fs.readFileSync(MANUAL_TRACK_PATH, "utf-8");
  const parsed = JSON.parse(raw) as ManualTrack;
  const ids = Array.isArray(parsed.itemIds) ? parsed.itemIds : [];
  const normalized = ids
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function loadDatabaseIds(): number[] {
  const db = openDatabase();

  try {
    const latestRun = db.prepare("SELECT id FROM market_runs ORDER BY id DESC LIMIT 1").get() as
      | { id: number }
      | undefined;

    if (latestRun?.id) {
      const rows = db
        .prepare(
          `SELECT DISTINCT item_id
           FROM market_item_prices
           WHERE run_id = ?
           ORDER BY item_id ASC`
        )
        .all(latestRun.id) as Array<{ item_id: number }>;

      if (rows.length > 0) {
        return rows.map((row) => row.item_id);
      }
    }

    const metadataRows = db
      .prepare("SELECT item_id FROM item_metadata ORDER BY item_id ASC")
      .all() as Array<{ item_id: number }>;
    return metadataRows.map((row) => row.item_id);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function clearDestinationPngs(destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(destination, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) {
      continue;
    }
    fs.unlinkSync(path.join(destination, entry.name));
  }
}

function stageImages(source: string, destination: string, ids: number[]): {
  copied: number;
  missing: number[];
} {
  let copied = 0;
  const missing: number[] = [];

  for (const itemId of ids) {
    const sourcePath = path.join(source, `${itemId}.png`);
    const destinationPath = path.join(destination, `${itemId}.png`);

    if (!fs.existsSync(sourcePath)) {
      missing.push(itemId);
      continue;
    }

    fs.copyFileSync(sourcePath, destinationPath);
    copied += 1;
  }

  return { copied, missing };
}

function main(): void {
  const { source, destination } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(source)) {
    throw new Error(`Archive source directory not found: ${source}`);
  }

  const manualIds = loadManualIds();
  const dbIds = loadDatabaseIds();
  const ids = Array.from(new Set([...dbIds, ...manualIds])).sort((a, b) => a - b);

  clearDestinationPngs(destination);
  const result = stageImages(source, destination, ids);

  console.log(
    [
      `staged ${result.copied} item images to ${destination}`,
      `db ids: ${dbIds.length}`,
      `manual ids: ${manualIds.length}`,
      `total selected ids: ${ids.length}`
    ].join(" | ")
  );

  if (result.missing.length > 0) {
    const preview = result.missing.slice(0, 20).join(", ");
    console.warn(
      `missing ${result.missing.length} archive images. First missing item ids: ${preview}${
        result.missing.length > 20 ? ", ..." : ""
      }`
    );
  }
}

main();