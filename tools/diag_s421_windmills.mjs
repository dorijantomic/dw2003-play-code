// Scratch: verify the s421 windmill actor (flag 0x1a0a -> point-record mode).
import { readFileSync } from "node:fs";
const dir = "web/assets/native";
const manifest = JSON.parse(readFileSync(dir + "/manifest.json", "utf8"));
const exeTables = JSON.parse(readFileSync(dir + "/exe_tables.json", "utf8"));
const fieldstg = new Uint8Array(readFileSync(dir + "/fieldstg.bin"));
const { NativeStageRuntime } = await import("../engine/native/runtime.ts");

for (const flagVal of [0, 1]) {
  const host = {
    setFlag() {},
    getFlag: () => flagVal,
    rand16: () => 0x777,
    startEvent(id) { console.log("  startEvent 0x" + id.toString(16)); },
  };
  const rt = new NativeStageRuntime(
    new Uint8Array(readFileSync(dir + "/s421.bin")), manifest.s421, host, exeTables, fieldstg);
  console.log("flag=" + flagVal, "boot:", rt.boot());
  for (let f = 0; f < 5; f++) rt.tick(1);
  const pt = rt.mem.read32(0x80099d90) >>> 0;
  console.log("  pointTable: 0x" + pt.toString(16), "traps:", rt.disabled.map((d) => d.reason));
  if (pt) {
    let off = pt, n = 0;
    const modes = new Set();
    while (rt.mem.read8(off + 2) !== 0 && n < 64) {
      if (rt.mem.read8(off + 1) === 1) modes.add(rt.mem.read8(off + 5));
      off += 18; n++;
    }
    console.log("  records:", n, "tagged modes:", [...modes]);
  }
}
