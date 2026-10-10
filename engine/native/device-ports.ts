// The PlayStation hardware registers the screen paths poll, served to the
// interpreter.
//
// The browser model is flat RAM: a read of a hardware register returns whatever
// byte happens to sit at that RAM offset, and the console's GPU queue drain
// (F0x80027C30) then spins forever on the "DMA ready" bit of GPUSTAT. The
// accepted `loadimage-chain-contract` answer (researcher A, 2026-09-15) names
// the exact contract this serves:
//
//   read  GPUSTAT 0x1f801814 -> bit 26 (0x04000000) set, so the send's and the
//                              drain's polls pass
//   write GP1     0x1f801814 -> absorbed (nothing consumes it)
//   write GP0     0x1f801810 -> absorbed; the pixels are already recorded by the
//                              LoadImage host service (engine/native/vram.ts)
//   read/write DMA2 0x1f8010a0/a4 -> scratch (MADR/BCR)
//   read/write DMA2 0x1f8010a8 (CHCR) -> bit 24 clear (the transfer is not busy)
//
// Anything outside the hardware window falls through to RAM untouched.

import type { NativeMemory } from "./memory.ts";

/** The PS1 hardware-register window. */
export const HARDWARE_BASE = 0x1f801000;
export const HARDWARE_END = 0x1f802000;

export const GP0 = 0x1f801810;
export const GPUSTAT = 0x1f801814;
export const DMA2_MADR = 0x1f8010a0;
export const DMA2_BCR = 0x1f8010a4;
export const DMA2_CHCR = 0x1f8010a8;

/** GPUSTAT bit 26: the DMA/command path is ready. */
export const GPUSTAT_DMA_READY = 0x04000000;

export interface DeviceRegisterPorts {
    read(addr: number): number | undefined;
    /** Return true when the write was absorbed by a device. */
    write(addr: number, value: number): boolean;
}

/** Install the hardware-register service on a memory image. */
export function installDevicePorts(mem: NativeMemory): void {
    const scratch = { madr: 0, bcr: 0, chcr: 0 };
    mem.devices = {
        read(addr) {
            switch (addr >>> 0) {
                case GPUSTAT:
                    return GPUSTAT_DMA_READY | 0x1c000000;
                case GP0:
                    return 0;
                case DMA2_MADR:
                    return scratch.madr | 0;
                case DMA2_BCR:
                    return scratch.bcr | 0;
                case DMA2_CHCR:
                    // bit 24 (start/busy) always clear: the browser has already
                    // recorded the transfer, so the queue never waits on it.
                    return scratch.chcr & ~0x01000000;
                default:
                    return undefined;
            }
        },
        write(addr, value) {
            switch (addr >>> 0) {
                case GP0:
                case GPUSTAT:
                    return true; // GP0/GP1 writes are device state, not RAM
                case DMA2_MADR:
                    scratch.madr = value | 0;
                    return true;
                case DMA2_BCR:
                    scratch.bcr = value | 0;
                    return true;
                case DMA2_CHCR:
                    // a DMA start would copy here; the LoadImage host service
                    // already copied the pixels, so the transfer is a no-op
                    scratch.chcr = value | 0;
                    return true;
                default:
                    return false;
            }
        },
    };
}
