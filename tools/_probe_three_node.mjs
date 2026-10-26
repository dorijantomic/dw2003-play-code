// Throwaway probe: does three.module.min.js import in plain node (no DOM)?
import * as THREE from "../web/lib3d/three.module.min.js";
console.log("three ok:", typeof THREE.OrthographicCamera, typeof THREE.WebGLRenderer, typeof THREE.Scene);
