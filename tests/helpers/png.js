// Minimal PNG reader for tests that need to check shipped ART against decoded
// data (e.g. the fishing pattern strips vs the pattern table).
//
// Deliberately narrow: 8-bit RGBA, non-interlaced, which is what the asset
// pipeline writes. Anything else throws rather than guessing, so a pipeline
// change that alters the format fails loudly instead of silently passing.

import { inflateSync } from "node:zlib";

const PNG_MAGIC = "89504e470d0a1a0a";

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** `{ width, height, at(x, y) -> [r, g, b, a] }` for an 8-bit RGBA PNG. */
export function decodePng(buf) {
  if (buf.subarray(0, 8).toString("hex") !== PNG_MAGIC) throw new Error("not a PNG");

  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  const idat = [];
  for (let off = 8; off + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("latin1");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len; // len + type + data + crc
  }
  if (!(depth === 8 && (colorType === 6 || colorType === 2) && interlace === 0))
    throw new Error(`unsupported PNG: depth ${depth} colorType ${colorType} interlace ${interlace}`);

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      const x = line[i];
      cur[i] =
        filter === 0 ? x
        : filter === 1 ? (x + a) & 0xff
        : filter === 2 ? (x + b) & 0xff
        : filter === 3 ? (x + ((a + b) >> 1)) & 0xff
        : filter === 4 ? (x + paeth(a, b, c)) & 0xff
        : (() => { throw new Error(`bad PNG filter ${filter}`); })();
    }
  }
  return {
    width,
    height,
    at(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height)
        throw new Error(`pixel (${x},${y}) out of ${width}x${height}`);
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2], bpp === 4 ? out[i + 3] : 255];
    },
  };
}
