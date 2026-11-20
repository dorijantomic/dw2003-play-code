// moved by tools/rewrite/split.mjs: still exported from here
export {
  bakeRetargetGeometry,
  buildBoneMap,
  normaliseRoots,
  restPose,
  rolesOf,
} from "./anim-retarget/rig-basics.js";
export { K16, rigOf, roleBoneMap, shouldMirror } from "./anim-retarget/k16-rig.js";
export { bakeRetargetByRole } from "./anim-retarget/by-role.js";
export { bakeRetargetWorld } from "./anim-retarget/world.js";
export {
  CAST_GATE,
  MOTION_KIT,
  applyCastBake,
  bakeRetarget,
  castGate,
  handPoint,
} from "./anim-retarget/cast-gate.js";

