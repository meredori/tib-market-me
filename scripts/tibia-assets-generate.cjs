#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { Generator, Enums } = require("tibia-assets");

function parseArgs(argv) {
  const options = {
    protobuf: "",
    catalog: "",
    output: "./generated-assets",
    mode: "items",
    itemRange: undefined,
    outfitRange: undefined,
    direction: "south",
    animation: "idle",
    lookHead: 0,
    lookBody: 0,
    lookLegs: 0,
    lookFeet: 0,
    lookAddons: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-p" || arg === "--protobuf") options.protobuf = argv[++i] || "";
    else if (arg === "-c" || arg === "--catalog") options.catalog = argv[++i] || "";
    else if (arg === "-o" || arg === "--output") options.output = argv[++i] || "";
    else if (arg === "-m" || arg === "--mode") options.mode = argv[++i] || "items";
    else if (arg === "-r" || arg === "--item-range") options.itemRange = argv[++i] || "";
    else if (arg === "-or" || arg === "--outfit-range") options.outfitRange = argv[++i] || "";
    else if (arg === "-d" || arg === "--direction") options.direction = (argv[++i] || "south").toLowerCase();
    else if (arg === "-a" || arg === "--animation") options.animation = (argv[++i] || "idle").toLowerCase();
    else if (arg === "--look-head") options.lookHead = parseInt(argv[++i] || "0", 10) || 0;
    else if (arg === "--look-body") options.lookBody = parseInt(argv[++i] || "0", 10) || 0;
    else if (arg === "--look-legs") options.lookLegs = parseInt(argv[++i] || "0", 10) || 0;
    else if (arg === "--look-feet") options.lookFeet = parseInt(argv[++i] || "0", 10) || 0;
    else if (arg === "--look-addons") options.lookAddons = parseInt(argv[++i] || "0", 10) || 0;
  }

  return options;
}

function parseRange(rangeStr) {
  const out = new Set();
  if (!rangeStr) return [];

  for (const chunk of String(rangeStr).split(",")) {
    const token = chunk.trim();
    if (!token) continue;
    if (token.includes("-")) {
      const [startRaw, endRaw] = token.split("-");
      const start = parseInt(startRaw, 10);
      const end = parseInt(endRaw, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      for (let i = from; i <= to; i++) out.add(i);
    } else {
      const value = parseInt(token, 10);
      if (Number.isFinite(value)) out.add(value);
    }
  }

  return Array.from(out).sort((a, b) => a - b);
}

function toDirection(direction) {
  if (direction === "north") return Enums.Direction.North;
  if (direction === "east") return Enums.Direction.East;
  if (direction === "west") return Enums.Direction.West;
  return Enums.Direction.South;
}

function toAnimation(animation) {
  if (animation === "moving") return Enums.OutfitAnimation.Moving;
  return Enums.OutfitAnimation.Idle;
}

function validateCatalogAssets(catalogPath) {
  const catalogDir = path.dirname(catalogPath);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf-8"));
  const spriteEntries = catalog.filter((row) => row && row.type === "sprite" && row.file);
  const missing = [];

  for (const row of spriteEntries) {
    const filePath = path.join(catalogDir, row.file);
    if (!fs.existsSync(filePath)) {
      missing.push(filePath);
      if (missing.length >= 3) break;
    }
  }

  if (missing.length > 0) {
    const sample = missing.map((m) => `  - ${m}`).join("\n");
    throw new Error(
      `Catalog references sprite files that are not present. Add the full Tibia sprite bundle next to catalog-content.json.\nMissing examples:\n${sample}`
    );
  }
}

async function generateItems(generator, options) {
  const itemIds = options.itemRange
    ? parseRange(options.itemRange)
    : (generator.assets?.object || []).map((obj) => obj.id).filter((id) => id > 0);

  let generated = 0;
  let skipped = 0;

  for (const itemId of itemIds) {
    const outputPath = path.join(options.output, `${itemId}.png`);
    if (fs.existsSync(outputPath)) {
      skipped += 1;
      continue;
    }
    await generator.getItem(itemId, outputPath);
    generated += 1;
  }

  console.log(`Items complete: total=${itemIds.length}, generated=${generated}, skipped=${skipped}`);
}

async function generateOutfits(generator, options) {
  const outfitIds = options.outfitRange
    ? parseRange(options.outfitRange)
    : (generator.assets?.outfit || []).map((obj) => obj.id).filter((id) => id > 0);

  const direction = toDirection(options.direction);
  const animation = toAnimation(options.animation);

  let generated = 0;
  let skipped = 0;

  for (const outfitId of outfitIds) {
    const fileName = `${outfitId}_${options.direction}_${options.animation}_h${options.lookHead}_b${options.lookBody}_l${options.lookLegs}_f${options.lookFeet}_a${options.lookAddons}.png`;
    const outputPath = path.join(options.output, fileName);
    if (fs.existsSync(outputPath)) {
      skipped += 1;
      continue;
    }

    await generator.getOutfit(
      {
        lookType: outfitId,
        lookHead: options.lookHead,
        lookBody: options.lookBody,
        lookLegs: options.lookLegs,
        lookFeet: options.lookFeet,
        lookAddons: options.lookAddons,
      },
      direction,
      animation,
      outputPath
    );
    generated += 1;
  }

  console.log(`Outfits complete: total=${outfitIds.length}, generated=${generated}, skipped=${skipped}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const originalCwd = process.cwd();
  const protobufPath = path.resolve(options.protobuf);
  const catalogPath = path.resolve(options.catalog);
  const outputPath = path.resolve(options.output);
  const catalogDir = path.dirname(catalogPath);

  if (!options.protobuf || !options.catalog) {
    console.error("Missing required args: -p/--protobuf and -c/--catalog");
    process.exit(1);
  }

  if (!fs.existsSync(protobufPath)) {
    console.error(`Protobuf file not found: ${protobufPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(catalogPath)) {
    console.error(`Catalog file not found: ${catalogPath}`);
    process.exit(1);
  }

  fs.mkdirSync(outputPath, { recursive: true });
  validateCatalogAssets(catalogPath);
  options.output = outputPath;

  // The library resolves sprite sheet file names from process.cwd().
  process.chdir(catalogDir);

  const generator = new Generator(protobufPath, catalogPath, false);
  await generator.init();

  if (options.mode === "items") {
    await generateItems(generator, options);
  } else if (options.mode === "outfits") {
    await generateOutfits(generator, options);
  } else if (options.mode === "both") {
    await generateItems(generator, options);
    await generateOutfits(generator, options);
  } else {
    console.error(`Unsupported mode: ${options.mode}`);
    process.exit(1);
  }

  process.chdir(originalCwd);
}

main().catch((err) => {
  console.error("Generation failed:", err?.message || err);
  process.exit(1);
});
