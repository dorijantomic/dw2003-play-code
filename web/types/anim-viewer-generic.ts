// Types only: the shapes web/anim-viewer-generic.ts reads and builds. Nothing here is emitted
// (node's strip mode erases it), so this file must never hold runtime code.

/** The deep link one generated motion opens (`?generic=<motion>&model=<folder>`). */
export interface AnimGenericQuery {
  motion?: string;
  folder?: string;
}

/** A fetch that already has the generator rewrite in front of it (installGenericFetch marks it). */
export type GenericFetch = typeof fetch & { __genericShim?: boolean };
