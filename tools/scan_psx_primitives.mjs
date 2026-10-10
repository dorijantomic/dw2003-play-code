#!/usr/bin/env node
// Scan a 2 MiB PS1 RAM dump for already-built GPU rectangle/copy packets.
// Intended for bounded runtime captures where dynarec breakpoints cannot
// reliably observe the packet-submission function.

import fs from "node:fs";

const args = process.argv.slice(2);
const groupsOnly = args.includes("--groups");
const screenArg = args.find(arg => arg.startsWith("--screen="));
const forcedScreen = screenArg ? Number(screenArg.slice("--screen=".length)) >>> 0 : 0;
const bufferArg = args.find(arg => arg.startsWith("--buffer="));
const forcedBuffer = bufferArg ? Number(bufferArg.slice("--buffer=".length)) : null;
const files = args.filter(arg => arg !== "--groups" && !arg.startsWith("--screen=") &&
  !arg.startsWith("--buffer="));
if (!files.length) {
  console.error("usage: node tools/scan_psx_primitives.mjs [--groups] [--screen=0xADDR] [--buffer=0|1] <ram-dump> [...]");
  process.exit(2);
}

function s16(v) { return v & 0x8000 ? v - 0x10000 : v; }
function hex(v, n = 8) { return (v >>> 0).toString(16).padStart(n, "0"); }
function plausibleXY(x, y) { return x >= -1024 && x <= 1024 && y >= -1024 && y <= 1024; }
function plausibleWH(w, h) { return w > 0 && w <= 1024 && h > 0 && h <= 1024; }

for (const file of files) {
  const b = fs.readFileSync(file);
  const records = [];
  const u32 = off => b.readUInt32LE(off & 0x1fffff);
  const manager = 0x4de10;
  const buildBufferIndex = u32(manager + 0x34) & 1;
  const bufferIndex = forcedBuffer ?? (buildBufferIndex ^ 1);
  let screen = forcedScreen;
  if (!screen) {
    for (let i = 0; i < 30; i++) {
      const id = u32(manager + 0xd8 + i * 4);
      if (id === 0x1004) { screen = u32(manager + 0x60 + i * 4); break; }
    }
  }
  const screenOff = screen & 0x1fffff;
  const otBase = screen ? u32(screenOff + 0x5c + bufferIndex * 4) & 0x1fffff : 0;
  const otCount = screen ? Math.min(u32(screenOff + 0x64), 0x10000) : 0;
  const commandOffsets = new Set();
  const visitedPackets = new Set();

  // ClearOTagR links the ordering table from its last slot back toward its
  // first. Walk that one live chain. OT slots are link words, not GPU packet
  // tags; only nodes outside the OT array contain packet-size/tag headers.
  if (otBase && otCount) {
    const otEnd = otBase + otCount * 4;
    let next = (otBase + (otCount - 1) * 4) & 0xffffff;
    let guard = 0;
    while (next !== 0xffffff && guard++ < 0x20000) {
      const off = next & 0x1fffff;
      if (off + 4 > b.length || visitedPackets.has(off)) break;
      visitedPackets.add(off);
      const tag = u32(off);
      if (off < otBase || off >= otEnd) {
        const words = tag >>> 24;
        if (words && off + 20 <= b.length) commandOffsets.add(off + 4);
      }
      next = tag & 0xffffff;
    }
  }

  for (const off of [...commandOffsets].sort((a, z) => a - z)) {
    const word = b.readUInt32LE(off);
    const cmd = word >>> 24;

    if (cmd === 0x24 || cmd === 0x25 || cmd === 0x2c || cmd === 0x2d ||
        cmd === 0x34 || cmd === 0x35 || cmd === 0x3c || cmd === 0x3d) {
      const gouraud = (cmd & 0x10) !== 0;
      const quad = (cmd & 0x08) !== 0;
      const count = quad ? 4 : 3;
      const vertices = [];
      let p = off;
      for (let i = 0; i < count; i++) {
        if (gouraud && i) p += 4;
        const xy = b.readUInt32LE(p + 4), uv = b.readUInt32LE(p + 8);
        vertices.push({ x: s16(xy & 0xffff), y: s16(xy >>> 16), u: uv & 0xff, v: (uv >>> 8) & 0xff });
        p += 8;
      }
      if (vertices.some(v => !plausibleXY(v.x, v.y))) continue;
      const uv0 = b.readUInt32LE(off + 8);
      const uv1off = gouraud ? off + 20 : off + 16;
      const uv1 = b.readUInt32LE(uv1off);
      records.push({ address: 0x80000000 + off, cmd, color: word & 0xffffff,
        clut: uv0 >>> 16, tpage: uv1 >>> 16, vertices });
    } else if (cmd === 0x64 || cmd === 0x65 || cmd === 0x66 || cmd === 0x67) {
      const xy = b.readUInt32LE(off + 4), uv = b.readUInt32LE(off + 8);
      const wh = b.readUInt32LE(off + 12);
      const x = s16(xy & 0xffff), y = s16(xy >>> 16);
      const w = wh & 0xffff, h = wh >>> 16;
      if (!plausibleXY(x, y) || !plausibleWH(w, h)) continue;
      records.push({ address: 0x80000000 + off, cmd, color: word & 0xffffff,
        x, y, u: uv & 0xff, v: (uv >>> 8) & 0xff, clut: uv >>> 16, w, h });
    } else if (cmd === 0x74 || cmd === 0x75 || cmd === 0x7c || cmd === 0x7d) {
      const xy = b.readUInt32LE(off + 4), uv = b.readUInt32LE(off + 8);
      const x = s16(xy & 0xffff), y = s16(xy >>> 16);
      if (!plausibleXY(x, y)) continue;
      const size = cmd < 0x7c ? 8 : 16;
      records.push({ address: 0x80000000 + off, cmd, color: word & 0xffffff,
        x, y, u: uv & 0xff, v: (uv >>> 8) & 0xff, clut: uv >>> 16,
        w: size, h: size });
    } else if (cmd === 0x80) {
      const src = b.readUInt32LE(off + 4), dst = b.readUInt32LE(off + 8);
      const wh = b.readUInt32LE(off + 12);
      const sx = src & 0xffff, sy = src >>> 16, dx = dst & 0xffff, dy = dst >>> 16;
      const w = wh & 0xffff, h = wh >>> 16;
      if (sx > 1023 || sy > 511 || dx > 1023 || dy > 511 || !plausibleWH(w, h)) continue;
      records.push({ address: 0x80000000 + off, cmd, sx, sy, dx, dy, w, h });
    }
  }

  console.log(`file=${file} visibleBuffer=${bufferIndex} buildBuffer=${buildBufferIndex} screen=0x${hex(screen)} ot=0x${hex(0x80000000 + otBase)} packets=${visitedPackets.size} candidates=${records.length}`);
  for (const r of groupsOnly ? [] : records) {
    if (r.cmd === 0x80) {
      console.log(`address=0x${hex(r.address)} cmd=80 src=${r.sx},${r.sy} dst=${r.dx},${r.dy} size=${r.w}x${r.h}`);
    } else if (!r.vertices) {
      console.log(`address=0x${hex(r.address)} cmd=${hex(r.cmd, 2)} color=${hex(r.color, 6)} xy=${r.x},${r.y} uv=${r.u},${r.v} clut=${r.clut} size=${r.w}x${r.h}`);
    } else {
      console.log(`address=0x${hex(r.address)} cmd=${hex(r.cmd, 2)} color=${hex(r.color, 6)} clut=${r.clut} tpage=${r.tpage} vertices=${r.vertices.map(v => `${v.x},${v.y}/${v.u},${v.v}`).join(" ")}`);
    }
  }

  const groups = new Map();
  for (const r of records.filter(r => r.cmd !== 0x80)) {
    const key = r.vertices
      ? [hex(r.cmd, 2), r.clut, r.tpage].join(":")
      : [hex(r.cmd, 2), hex(r.color, 6), r.u, r.v, r.clut, r.w, r.h].join(":");
    const g = groups.get(key) ?? { ...r, count: 0, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    g.count++;
    const points = r.vertices ?? [r];
    for (const point of points) {
      g.minX = Math.min(g.minX, point.x); g.maxX = Math.max(g.maxX, point.x);
      g.minY = Math.min(g.minY, point.y); g.maxY = Math.max(g.maxY, point.y);
    }
    groups.set(key, g);
  }
  console.log("groups:");
  for (const g of [...groups.values()].sort((a, z) => z.count - a.count)) {
    if (g.vertices) {
      console.log(`count=${g.count} cmd=${hex(g.cmd, 2)} clut=${g.clut} tpage=${g.tpage} bbox=${g.minX},${g.minY}..${g.maxX},${g.maxY}`);
    } else {
      console.log(`count=${g.count} cmd=${hex(g.cmd, 2)} color=${hex(g.color, 6)} uv=${g.u},${g.v} clut=${g.clut} size=${g.w}x${g.h} bbox=${g.minX},${g.minY}..${g.maxX},${g.maxY}`);
    }
  }
}
