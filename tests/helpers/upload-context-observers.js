// The caller oracles substitute the context's methods, while retaining the
// shipped constructor. Discover its installed targets instead of assuming the
// synthetic addresses once provided by NativeStageRuntime's field-only stub.
import assert from 'node:assert/strict';

export function observeUploadContext(rt, observers) {
    const scratch = 0x801ef000;
    rt.cpu.call(0x8001ffa8, [scratch], 10000);
    for (const [slot, observe] of Object.entries(observers)) {
        const target = rt.mem.read32(scratch + Number(slot)) >>> 0;
        assert.notEqual(target, 0, `upload context has no method at ${slot}`);
        rt.cpu.setStub(target, observe);
    }
}
