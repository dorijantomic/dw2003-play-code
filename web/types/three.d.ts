// Ambient module for the vendored three.js build in web/lib3d (that folder is excluded from
// tsconfig.web.json and ships as plain ES module source, not types). Type-only: .d.ts never
// ships - tools/rewrite/build-web.mjs skips it and node's strip mode never sees it.
declare module "three" {
  const THREE: any;
  export = THREE;
}
