// Types only: the WebGPU entry point the Anime4K lab needs. Nothing here is emitted (node's strip
// mode erases it), so this file must never hold runtime code.

/**
 * `navigator` with WebGPU on it: lib.dom has no GPU types, and the lab only asks for an adapter and
 * hands the adapter's device straight to the anime4k-webgpu library, so the device stays opaque here.
 */
export interface GpuNavigator extends Navigator {
  gpu?: { requestAdapter(): Promise<{ requestDevice(): Promise<unknown> } | null> };
}
