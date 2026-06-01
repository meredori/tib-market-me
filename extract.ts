/**
 * Extract files from a Qt binary resource container (.rcc).
 *
 * The .rcc format stores files in three sections:
 *   - Tree: hierarchical node descriptors
 *   - Names: UTF-16BE strings with 2-byte length + 4-byte hash prefix
 *   - Data: raw or zlib-compressed file contents
 *
 * Usage:
 *   npx tsx extract-rcc.ts --rcc=client-files/<version>/graphics_resources.rcc
 *   npx tsx extract-rcc.ts --rcc=client-files/15.24.845104/graphics_resources.rcc --out=client-files/15.24.845104/resource-export
 *
 * Output defaults to client-files/<version>/resource-export/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

// ── Args ───────────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('=') as [string, string])
);

if (!args['rcc']) {
  console.error('Usage: npx tsx extract-rcc.ts --rcc=<path/to/graphics_resources.rcc> [--out=<output-dir>]');
  process.exit(1);
}

const RCC_PATH = path.resolve(args['rcc']);
const OUT_DIR = path.resolve(
  args['out'] ?? path.join(path.dirname(RCC_PATH), 'resource-export')
);

const MAGIC = Buffer.from('qres');

const FLAG_COMPRESSED      = 0x01;
const FLAG_DIRECTORY       = 0x02;
const FLAG_COMPRESSED_ZSTD = 0x04;

interface RccHeader {
  version:    number;
  treeOff:    number;
  dataOff:    number;
  namesOff:   number;
  nodeSize:   number;
}

function readHeader(buf: Buffer): RccHeader {
  if (!buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Not a valid .rcc file (missing "qres" magic)');
  }
  const version  = buf.readUInt32BE(4);
  const treeOff  = buf.readUInt32BE(8);
  const dataOff  = buf.readUInt32BE(12);
  const namesOff = buf.readUInt32BE(16);
  if (version < 1 || version > 3) {
    throw new Error(`Unsupported .rcc format version: ${version}`);
  }
  const nodeSize = version >= 2 ? 22 : 14;
  return { version, treeOff, dataOff, namesOff, nodeSize };
}

function readName(buf: Buffer, namesOff: number, nameOffset: number): string {
  const base = namesOff + nameOffset;
  const length = buf.readUInt16BE(base); // char count (not bytes)
  // skip 4-byte hash at base+2
  const strStart = base + 6;
  const raw = buf.subarray(strStart, strStart + length * 2);
  return raw.toString('utf16le').split('').map((_, i) =>
    // utf16le on LE platform, but the data is BE — swap bytes per char
    String.fromCharCode(raw.readUInt16BE(i * 2))
  ).join('');
}

interface FileEntry {
  path:       string;
  dataOff:    number;   // byte offset into data section (past the 4-byte size field)
  storedSize: number;   // bytes in the data section (compressed or raw)
  realSize:   number;   // uncompressed size as stated in data section header
  compressed: boolean;
  zstd:       boolean;
}

function walkTree(buf: Buffer, hdr: RccHeader): FileEntry[] {
  const entries: FileEntry[] = [];

  function visit(nodeIdx: number, parts: string[]): void {
    const off      = hdr.treeOff + nodeIdx * hdr.nodeSize;
    const nameOff  = buf.readUInt32BE(off);
    const flags    = buf.readUInt16BE(off + 4);
    const name     = readName(buf, hdr.namesOff, nameOff);

    if (flags & FLAG_DIRECTORY) {
      const childCount = buf.readUInt32BE(off + 6);
      const firstChild = buf.readUInt32BE(off + 10);
      for (let i = 0; i < childCount; i++) {
        visit(firstChild + i, parts.concat(name));
      }
    } else {
      const dataOffset = buf.readUInt32BE(off + 10);
      // The data section entry: [4-byte uncompressed-size][payload]
      const realSize = buf.readUInt32BE(hdr.dataOff + dataOffset);
      // We don't know stored size here... pass offset+4 for the payload start
      const filePath = parts.slice(1).concat(name).join('/'); // drop leading ''
      entries.push({
        path:       filePath,
        dataOff:    hdr.dataOff + dataOffset + 4,
        storedSize: 0, // filled below
        realSize,
        compressed: !!(flags & FLAG_COMPRESSED),
        zstd:       !!(flags & FLAG_COMPRESSED_ZSTD),
      });
    }
  }

  visit(0, []);
  return entries;
}

function extractData(buf: Buffer, entry: FileEntry): Buffer {
  if (entry.zstd) {
    throw new Error(`zstd compression not supported for: ${entry.path}`);
  }
  if (entry.compressed) {
    // Qt uses qCompress which prepends an extra 4-byte big-endian uncompressed
    // size before the standard zlib stream. Skip those 4 bytes before inflating.
    const payload = buf.subarray(entry.dataOff + 4);
    return zlib.inflateSync(payload);
  }
  // Uncompressed: realSize bytes follow the 4-byte header
  return buf.subarray(entry.dataOff, entry.dataOff + entry.realSize);
}

function main(): void {
  if (!fs.existsSync(RCC_PATH)) {
    console.error(`File not found: ${RCC_PATH}`);
    process.exit(1);
  }

  console.log(`Reading ${RCC_PATH} ...`);
  const buf = fs.readFileSync(RCC_PATH);
  console.log(`  ${(buf.length / 1024 / 1024).toFixed(2)} MB`);

  const hdr = readHeader(buf);
  console.log(`  Format version ${hdr.version}, ${hdr.nodeSize}-byte nodes`);

  const entries = walkTree(buf, hdr);
  console.log(`  ${entries.length} files found\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let saved = 0;
  let skipped = 0;

  for (const entry of entries) {
    const outPath = path.join(OUT_DIR, entry.path);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    try {
      const data = extractData(buf, entry);
      fs.writeFileSync(outPath, data);
      const tag = entry.zstd ? '[zstd]' : entry.compressed ? '[zlib]' : '      ';
      console.log(`${tag}  ${String(data.length).padStart(9)}  ${entry.path}`);
      saved++;
    } catch (err: any) {
      console.warn(`[SKIP] ${entry.path}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone — ${saved} file(s) extracted to ${OUT_DIR}${skipped ? `, ${skipped} skipped` : ''}`);
}

main();