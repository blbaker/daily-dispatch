// Minimal PPM (P6) reader and PNG writer, so the desktop scripts can inspect
// and publish engine screenshots with nothing but Node's standard library.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

export type Frame = { width: number; height: number; rgb: Buffer };

export function readPpm(path: string): Frame {
  const buf = readFileSync(path);
  // Header: "P6" <ws> width <ws> height <ws> maxval <single ws> pixels.
  const fields: string[] = [];
  let i = 0;
  while (fields.length < 4) {
    while (i < buf.length && /\s/.test(String.fromCharCode(buf[i]))) i++;
    if (buf[i] === 0x23) {
      while (i < buf.length && buf[i] !== 0x0a) i++;
      continue;
    }
    let tok = "";
    while (i < buf.length && !/\s/.test(String.fromCharCode(buf[i]))) tok += String.fromCharCode(buf[i++]);
    fields.push(tok);
  }
  i++;
  const [magic, w, h, max] = fields;
  if (magic !== "P6" || max !== "255") throw new Error(`${path}: not an 8-bit P6 PPM (${magic}, max ${max})`);
  const width = Number(w);
  const height = Number(h);
  const rgb = buf.subarray(i, i + width * height * 3);
  if (rgb.length !== width * height * 3) throw new Error(`${path}: truncated pixel data`);
  return { width, height, rgb };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(frame: Frame): Buffer {
  const { width, height, rgb } = frame;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function writePng(path: string, frame: Frame): void {
  writeFileSync(path, encodePng(frame));
}

export type FrameStats = {
  distinctColors: number;
  // Share of pixels that differ from the most common colour (the background).
  inkFraction: number;
};

export function frameStats(frame: Frame): FrameStats {
  const counts = new Map<number, number>();
  const { rgb } = frame;
  for (let i = 0; i < rgb.length; i += 3) {
    const key = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = rgb.length / 3;
  const top = Math.max(...counts.values());
  return { distinctColors: counts.size, inkFraction: (total - top) / total };
}

// Fraction of pixels that differ between two same-sized frames.
export function diffFraction(a: Frame, b: Frame): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let diff = 0;
  for (let i = 0; i < a.rgb.length; i += 3) {
    if (a.rgb[i] !== b.rgb[i] || a.rgb[i + 1] !== b.rgb[i + 1] || a.rgb[i + 2] !== b.rgb[i + 2]) diff++;
  }
  return diff / (a.rgb.length / 3);
}
