// Anime4K on the GPU (WebGPU) for sprite-filter-lab.html only: runs a model on a crop and gives back
// a 4x ImageData plus the time.  anime4k-webgpu 1.0.0 (MIT, Anime4K by bloc97, WebGPU port by
// Anime4KWebBoost), loaded from the CDN only when the lab asks for it.
const CDN = "https://cdn.jsdelivr.net/npm/anime4k-webgpu@1.0.0/lib/index.js";

// WebGPU flag values from the spec (the repo's name check does not know the GPU* globals)
const TEX = { COPY_SRC: 0x01, COPY_DST: 0x02, TEXTURE_BINDING: 0x04, RENDER_ATTACHMENT: 0x10 };
const BUF = { MAP_READ: 0x01, COPY_DST: 0x08 };
const MAP_READ = 0x01;

let ready = null;
function loadLib() {
  if (window["anime4k-webgpu"]) return Promise.resolve(window["anime4k-webgpu"]);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CDN;
    s.onload = () => resolve(window["anime4k-webgpu"]);
    s.onerror = () => reject(new Error("could not load anime4k-webgpu"));
    document.head.appendChild(s);
  });
}

/** { lib, device } or throws with a plain reason (no WebGPU, no adapter, CDN down). */
export function anime4kReady() {
  ready ??= (async () => {
    if (!navigator.gpu) throw new Error("this browser has no WebGPU");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("no WebGPU adapter");
    const device = await adapter.requestDevice();
    return { lib: await loadLib(), device };
  })();
  return ready;
}

// rgba16float output -> rgba8unorm texture we can read back
const BLIT = `
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return clamp(textureLoad(src, vec2i(pos.xy), 0), vec4f(0), vec4f(1));
}`;

/**
 * Run Anime4K models on `canvas` (the native crop).  `steps` is a list of pipeline class names run one
 * after the other (CNNx2M twice = 4x).  Returns { image: ImageData, ms, msCold } where ms is a second,
 * warm run (shaders already built) measured until the GPU finished.
 */
export async function anime4k(canvas, steps) {
  const { lib, device } = await anime4kReady();
  const w = canvas.width, h = canvas.height;
  const input = device.createTexture({
    size: [w, h, 1], format: "rgba8unorm",
    usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture: input }, [w, h]);

  const t0 = performance.now();
  const pipes = [];
  let tex = input;
  for (const name of steps) {
    const p = new lib[name]({ device, inputTexture: tex });
    pipes.push(p);
    tex = p.getOutputTexture();
  }
  const runOnce = async () => {
    const enc = device.createCommandEncoder();
    for (const p of pipes) p.pass(enc);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  };
  await runOnce();
  const msCold = performance.now() - t0;
  const t1 = performance.now();
  await runOnce();
  const ms = performance.now() - t1;

  const ow = tex.width, oh = tex.height;
  const out = device.createTexture({
    size: [ow, oh, 1], format: "rgba8unorm",
    usage: TEX.RENDER_ATTACHMENT | TEX.COPY_SRC,
  });
  const module = device.createShaderModule({ code: BLIT });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: "rgba8unorm" }] },
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: tex.createView() }],
  });
  const rowBytes = Math.ceil(ow * 4 / 256) * 256;
  const buf = device.createBuffer({ size: rowBytes * oh, usage: BUF.COPY_DST | BUF.MAP_READ });
  const enc = device.createCommandEncoder();
  const pass = enc.beginRenderPass({
    colorAttachments: [{ view: out.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.draw(3);
  pass.end();
  enc.copyTextureToBuffer({ texture: out }, { buffer: buf, bytesPerRow: rowBytes }, [ow, oh, 1]);
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(MAP_READ);
  const bytes = new Uint8Array(buf.getMappedRange());
  const image = new ImageData(ow, oh);
  for (let y = 0; y < oh; y++) image.data.set(bytes.subarray(y * rowBytes, y * rowBytes + ow * 4), y * ow * 4);
  buf.unmap();
  for (const t of [input, out]) t.destroy();
  buf.destroy();
  return { image, ms, msCold };
}
