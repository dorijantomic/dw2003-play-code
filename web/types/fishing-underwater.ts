// How web/fishing-underwater.ts types the three.js objects it builds.
import type * as THREE from "../lib3d/three.module.js";

/** What three.js's Object3D constructor adds with Object.defineProperties (its JS gives TypeScript no types for them). */
export interface UwPlaced { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3 }

/** A mesh with the position, rotation and scale three.js defines at run time. */
export type UwMesh = THREE.Mesh & UwPlaced;
/** A group with them. */
export type UwGroup = THREE.Group & UwPlaced;
/** The perspective camera with them. */
export type UwCamera = THREE.PerspectiveCamera & UwPlaced;
/** The sun light with them. */
export type UwSun = THREE.DirectionalLight & UwPlaced;
/** The shared WebGL renderer with the canvas its constructor sets at run time. */
export type UwRenderer = THREE.WebGLRenderer & { domElement: HTMLCanvasElement };

/** Anything three.js lets a scene hold; its JS-inferred Mesh, InstancedMesh, Points and Line do not pass as Object3D. */
export type UwSceneChild = THREE.Object3D | THREE.Mesh | THREE.InstancedMesh | THREE.Points | THREE.Line;
/** The scene, taking those children, with the background colour it is always given. */
export type UwScene = THREE.Scene & { add(...objects: UwSceneChild[]): THREE.Scene; background: THREE.Color };
/** The group of light shafts, whose children are placed objects. */
export type UwShafts = THREE.Group & { children: (THREE.Object3D & UwPlaced)[] };
