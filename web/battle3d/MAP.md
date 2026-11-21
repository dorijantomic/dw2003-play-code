# web/battle3d
The 3D fight scene's building blocks: GL helpers, skeletal models, pose math, camera shots, shaders.
Entry: web/battle3d.ts re-exports these modules; core/ supplies makeX(B$) closures it assigns into B$.

| file | lines | job | main exports |
|---|---|---|---|
| camera-fit.ts | 370 | decides when the fight camera may run, picks and fits each fighter's near shot | stagingRecordsReady, arenaShotFor, nearCameraFor, fitNearCamera, modelFrameSize |
| camera-shots.ts | 251 | op5 preset table, shot slots, loss cam, slow-mo, arena-slot lookups | OP5_PRESETS, arenaSlot, modelKeyFromFolder, reactionCamFromActions, LOSS_CAM |
| core/ (folder) | - | the fight-scene closures makeX(B$); see core/MAP.md | - |
| gl.ts | 345 | WebGL plumbing: programs, textures, quad/skeletal/op6-layer draws, fighter tint | drawSkeletalMesh, loadTexture, createProgram, drawProjLayer, fighterTint |
| math.ts | 159 | mat4/vector helpers plus PS1<->render space conversion and MODEL_SCALE | mat4Perspective, ps1AnglesToMat3, ps1ToRender, MODEL_SCALE, normalize |
| rotation.ts | 403 | ch2 bone rotation sampling: quaternion slerp, span warp, world matrices | buildBoneWorldMatrices, ch2ToQuat, quatSlerp, localRotationAt, smoothTimeWarp |
| shaders.ts | 161 | GLSL source strings for the sky/sprite, toon hull and coloured draws | VERT_SRC, FRAG_SRC, TOON_HULL_VERT_SRC, VERT_COL_SRC, FRAG_COL_SRC |
| skeleton.ts | 219 | loads and caches a Digimon skeletal model, builds/updates its VBOs | loadSkeletalModel, buildSkeletalGLBuffers, _updateSkeletalVBOGL, posedVertex |
| state.ts | 46 | the shared S flags object (slerp, animation experiments) read everywhere | S |
| types.ts | 10 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- shader text or matrix/PS1-axis conventions -> shaders.ts, math.ts
- loading a Digimon model or pushing posed vertices -> skeleton.ts, rotation.ts
- which shot a fight opens on / refitting a giant -> camera-fit.ts, then core/camera.ts
- op5 preset numbers, loss camera, arena slot for a folder -> camera-shots.ts
- the actual per-frame draw pass -> core/render.ts
