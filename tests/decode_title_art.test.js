// tests/decode_title_art.test.js
// Tests for tools/decode_title_art.py -- verifies the tool runs and produces
// a valid title logo PNG with plausible dimensions and non-trivial content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const TOOL = join(PROJECT_ROOT, "tools", "decode_title_art.py");
// The tool decodes the ddw3 tree's title-logo assets; without that tree the
// two tool-run tests cannot do their job, so they skip instead of failing.
const DDW3_ROOT = process.env.DDW3_DIR || join(homedir(), "ddw3");
const TITLE_ASSET = join(DDW3_ROOT, "pack", "dw2003", "screen", "tlogousa", "1", "0.bin");
const SKIP = { skip: !existsSync(TITLE_ASSET) && "ddw3 tree not present on this machine (set DDW3_DIR or clone ddw3 to ~/ddw3)" };
// The build uses the project environment; tests must not create uv environments
// or cache files in another worker's HOME. TMPDIR can keep PNGs in this worktree.
const PYTHON = join(PROJECT_ROOT, ".venv", "bin", "python3");

/**
 * Read a PNG file and return its dimensions.
 * PNG header: bytes 0-3 = magic (0x89 PNG), 4-7 = "PNG\r\n...",
 * IHDR chunk starts at byte 8: length(4) + "IHDR"(4) + width(4) + height(4).
 */
function readPngDimensions(pngPath) {
  const buf = readFileSync(pngPath);
  // PNG magic: 8 bytes, then IHDR chunk (4+4+4+4 = 16 bytes minimum)
  if (buf.length < 24) throw new Error("File too small to be a PNG");
  const magic = buf.slice(0, 4);
  if (magic[0] !== 0x89 || magic[1] !== 0x50 || magic[2] !== 0x4e || magic[3] !== 0x47) {
    throw new Error("Not a PNG file");
  }
  // IHDR starts at offset 8; skip 4 (length) + 4 (type) = offset 16 for width
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

test("decode_title_art.py tool exists", () => {
  assert.ok(existsSync(TOOL), `Tool not found: ${TOOL}`);
});

test("decode_title_art.py runs without error and produces PNG", SKIP, () => {
  const tmpOut = join(tmpdir(), `title_logo_test_${process.pid}.png`);
  try {
    const result = spawnSync(PYTHON, [
      TOOL, "--out", tmpOut,
    ], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 30000,
    });

    if (result.error) throw result.error;
    assert.equal(result.status, 0,
      `Tool exited with status ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    assert.ok(existsSync(tmpOut), `Output PNG not created at ${tmpOut}`);

    const stat = readFileSync(tmpOut);
    assert.ok(stat.length > 1000, `Output PNG is suspiciously small: ${stat.length} bytes`);
  } finally {
    try { rmSync(tmpOut, { force: true }); } catch (_) {}
  }
});

test("decode_title_art.py output PNG has plausible dimensions", SKIP, () => {
  const tmpOut = join(tmpdir(), `title_logo_dim_test_${process.pid}.png`);
  try {
    const result = spawnSync(PYTHON, [
      TOOL, "--out", tmpOut,
    ], {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 30000,
    });

    if (result.error) throw result.error;
    assert.equal(result.status, 0,
      `Tool failed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const { width, height } = readPngDimensions(tmpOut);
    assert.ok(width >= 64, `PNG width ${width} is too small (expected >= 64)`);
    assert.ok(height >= 32, `PNG height ${height} is too small (expected >= 32)`);
    assert.ok(width <= 1024, `PNG width ${width} is suspiciously large`);
    assert.ok(height <= 1024, `PNG height ${height} is suspiciously large`);
  } finally {
    try { rmSync(tmpOut, { force: true }); } catch (_) {}
  }
});

test("web/assets/title_logo.png exists and has valid content", () => {
  const png = join(PROJECT_ROOT, "web", "assets", "title_logo.png");
  assert.ok(existsSync(png), `title_logo.png not found at ${png}`);

  const buf = readFileSync(png);
  assert.ok(buf.length > 1000, `title_logo.png is suspiciously small: ${buf.length} bytes`);

  const { width, height } = readPngDimensions(png);
  assert.ok(width >= 64, `PNG width ${width} is too small`);
  assert.ok(height >= 32, `PNG height ${height} is too small`);
});
