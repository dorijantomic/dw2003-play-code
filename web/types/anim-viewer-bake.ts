// Types only: the shapes web/anim-viewer-bake.ts reads and builds. Nothing here is emitted
// (node's strip mode erases it), so this file must never hold runtime code.

/** The deep link one baked animation opens (`?bake=<id>&table=<n>&clip=<n>`). */
export interface AnimBakeQuery {
  id?: string;
  table?: number | string | null;
  clip?: number | string | null;
}

/** A fetch that already has the bake rewrite in front of it (installBakeFetch marks its shim). */
export type BakeFetch = typeof fetch & { __bakeShim?: boolean };
