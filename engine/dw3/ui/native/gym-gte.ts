// The libgte helpers the gym's scaled picture uses (resident F0x8002B65C RotMatrix,
// F0x8002B23C ScaleMatrix, F0x8002B1DC ApplyMatrixSV), as plain arithmetic on the object's
// 5-word matrix. ScaleMatrix is the naming screen's (native/wizard-misc.ts scaleMatrix);
// ApplyMatrixSV is the memory screen's and the wizard's rotation multiply: each output is the
// row's dot product with the (x, y, z) input, shifted right 12 and saturated to 16 bits.
// The gym never sets a rotation (its actors' angle words stay zero), so RotMatrix is the
// identity; a nonzero angle throws instead of being guessed.
import { scaleMatrix, type MatrixMemory } from "./wizard-misc.ts";

export { scaleMatrix };

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x8002B65C(angles, matrix) for zero angles: the identity matrix. */
export function rotMatrixZero(mem: MatrixMemory & { write32(a: number, v: number): void }, angles: number, matrix: number): void {
  for (const off of [0, 2, 4]) {
    if (mem.read16(angles + off) !== 0) throw new Error("RotMatrix with a nonzero angle is not translated");
  }
  mem.write32(matrix + 0x0, 0x1000);
  mem.write32(matrix + 0x4, 0);
  mem.write32(matrix + 0x8, 0x1000);
  mem.write32(matrix + 0xc, 0);
  mem.write32(matrix + 0x10, 0x1000);
}

/** F0x8002B1DC(matrix, (x, y, 0)): the transformed x and y. */
export function applyMatrixXY(mem: MatrixMemory, matrix: number, x: number, y: number): [number, number] {
  const m = [0, 1, 2, 3, 4].map((i) => mem.read32(matrix + i * 4) | 0);
  const rows = [
    [s16(m[0]!), s16(m[0]! >> 16), s16(m[1]!)],
    [s16(m[1]! >> 16), s16(m[2]!), s16(m[2]! >> 16)],
  ];
  const out = rows.map((row) => {
    const sum = row[0]! * s16(x) + row[1]! * s16(y);
    return Math.max(-0x8000, Math.min(0x7fff, Math.floor(sum / 4096)));
  });
  return [out[0]!, out[1]!];
}
