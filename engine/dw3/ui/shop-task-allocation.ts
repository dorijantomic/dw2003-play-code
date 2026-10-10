// Adapt the shop constructors' two allocation calls to one registered task.
// The constructors still install their own state and method fields as data.
import type { TranslatedTaskTree } from "./translated-task-tree.ts";

export interface ShopTaskAllocationHost {
  alloc(size: number): number;
}

export function constructShopTask(
  tree: TranslatedTaskTree,
  classId: number,
  objectSize: number,
  extraSize: number,
  constructor: (host: ShopTaskAllocationHost) => number,
): number {
  const object = tree.allocate(classId, objectSize, extraSize);
  const extra = tree.tasks.get(object)!.children;
  let requests = 0;
  const host: ShopTaskAllocationHost = { alloc(size) {
    const expected = requests === 0 ? objectSize : requests === 1 ? extraSize : -1;
    if (size !== expected) throw new Error(`Unexpected shop allocation ${size}, wanted ${expected}`);
    return requests++ === 0 ? object : extra;
  } };
  const result = constructor(host) >>> 0;
  if (requests !== 2 || result !== object ||
      tree.mem.read32(object + 0x20) !== extraSize / 4 ||
      (tree.mem.read32(object + 0x24) >>> 0) !== extra) {
    throw new Error("Shop constructor did not install its registered task block");
  }
  return object;
}
