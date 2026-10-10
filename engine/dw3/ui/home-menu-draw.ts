// Translation of exe/fns.s:3872-3939, interior tail 0x80013350 of
// F0x8001270c. The caller owns the 0x170-byte frame; the oracle supplies it.
// Draw-context and pack resolution remain host boundaries, as in gym-partner-draw.
export interface HomeMenuDrawMemory {
    read32(address: number): number;
}
export interface HomeMenuDrawHost {
    initDrawContext(): void;
    setOrigin(x: number, y: number): void;
    setLayer(target: number, bucket: number): void;
    context98(value: number): void;
    paletteShift(value: number): void;
    packResolve(handle: number): number;
    drawSprite(pack: number, clip: number, x: number, y: number): void;
}

export function drawHomeMenuPanel(mem: HomeMenuDrawMemory, screen: number, host: HomeMenuDrawHost): void {
    host.initDrawContext();
    host.setOrigin(0x140, 0);
    host.setLayer(mem.read32(screen + 0x50), mem.read32(screen + 0x54));
    host.context98(0);
    let limit = mem.read32(screen + 0x10) | 0;
    if (limit < 0) return;
    let row = 0;
    do {
        if (row === 6) break;
        host.paletteShift(row === limit ? mem.read32(screen + 0x68) : row < 3 ? 7 : 15);
        row++;
        const pack = host.packResolve(0x02860000);
        host.drawSprite(pack, mem.read32(0x8003ef44 + (row - 1) * 4), 0, 0);
        // Reload after the host calls, matching the original's write/read order.
        limit = mem.read32(screen + 0x10) | 0;
    } while (limit >= row);
}
