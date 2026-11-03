// One Chromium launcher for the built-arena verifiers.
//
// This box has a real GPU: the Windows host's AMD Radeon RX 9060 XT is reachable from
// WSL through /dev/dxg, and Mesa's gallium d3d12 driver renders on it (tools/run-playwright.sh
// exports GALLIUM_DRIVER=d3d12). Before that, every verifier forced SwiftShader and a single
// arena check took minutes instead of seconds.
//
// VERIFY_GPU=0 forces the old software path, so an old result can be reproduced exactly.
// "auto" (the default) uses the GPU and falls back to software when no device is reachable.
import { chromium } from "playwright";

const SOFTWARE = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const HARDWARE = ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--enable-gpu"];

export const gpuMode = () => (process.env.VERIFY_GPU === "0" ? "software" : "hardware");

/** Args for chromium.launch(); a verifier that prints the renderer string says which it got. */
export function launchOpts() {
  return { args: gpuMode() === "software" ? SOFTWARE : HARDWARE };
}

export async function launch() {
  return chromium.launch(launchOpts());
}
