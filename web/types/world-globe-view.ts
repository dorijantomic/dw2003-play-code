// How web/world-globe-view.ts types the three.js objects it builds (the vendored three.js in web/lib3d is plain JS: TypeScript infers
// its classes from the source, which misses what the constructors add at run time). Type-only: nothing here is emitted.
import type * as THREE from "../lib3d/three.module.js";

/** What three.js's Object3D constructor adds with Object.defineProperties (its JS gives TypeScript no types for them). */
export interface GlobePlaced {
  position: THREE.Vector3;
  scale: THREE.Vector3;
}

/** The perspective camera with them. */
export type GlobeCamera = THREE.PerspectiveCamera & GlobePlaced;
/** The "you are here" sprite and the place icon sprites with them. */
export type GlobeSprite = THREE.Sprite & GlobePlaced;

/** What the globe scene holds; the JS-inferred Mesh, InstancedMesh, Sprite and Group do not pass as Object3D. */
export type GlobeSceneChild = THREE.Object3D | THREE.Mesh | THREE.InstancedMesh | THREE.Sprite | THREE.Group;
/** The group of place icons, taking sprites. */
export type GlobeGroup = THREE.Group & { add(...objects: GlobeSceneChild[]): THREE.Group };
/** The scene, taking those children, with the background the dev page gives it. */
export type GlobeThreeScene = THREE.Scene & { add(...objects: GlobeSceneChild[]): THREE.Scene; background: THREE.Color | null };

/** The renderer limits the globe reads (WebGLRenderer sets `capabilities` inside its constructor's context set-up). */
export interface GlobeRendererCaps {
  maxTextureSize: number;
  getMaxAnisotropy(): number;
}
/** The WebGL renderer with them. */
export type GlobeRenderer = THREE.WebGLRenderer & { capabilities: GlobeRendererCaps };
