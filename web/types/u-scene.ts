// Scene unit (biome + built + built/place): no cross-folder types were needed, so this file holds
// none. The types this unit added live next to the code that uses them —
//   web/biome/types.ts        toon/material/ground/sky option bags, LOD levels, scatter results
//   web/built/types.ts        day light, slot items, sand/soil/post/lake info bags
//   web/built/place/types.ts  the place slot descriptor and the ground palette
//   web/types/three.d.ts      the ambient `three` module (web/lib3d ships no types)
// Nothing here runs: strip mode erases it, so the .js build-web.mjs writes for it is empty.
