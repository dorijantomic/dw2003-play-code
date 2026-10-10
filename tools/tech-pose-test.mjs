/**
 * Drive a Renamon vs Agumon tech attack in battle3d.js and report
 * what pose each digimon has before, during, and after.
 *
 * Usage: node tools/tech-pose-test.mjs
 */

import { createBattle3D, resolveModelFolder, setTechTable } from "../web/battle3d.js";
import { techRecord, techToClip } from "../web/fight/fight-tables.js";

const canvas = {
  width: 640,
  height: 480,
  getContext: () => null,  // no WebGL needed for animation state check
};

// Create battle3d mock
let renderer3d = null;

try {
  renderer3d = createBattle3D(canvas);
} catch (e) {
  console.log("Could not create battle3d (no WebGL):", e.message);
}

// Load models
async function test() {
  const playerFolder = await resolveModelFolder("Renamon");
  const enemyFolder = await resolveModelFolder("Agumon");
  
  console.log("Player folder:", playerFolder);
  console.log("Enemy folder:", enemyFolder);
  
  if (!playerFolder || !enemyFolder) {
    console.log("Models not found");
    return;
  }
  
  await renderer3d.setPlayerDigimon(playerFolder);
  await renderer3d.setEnemyDigimon(enemyFolder);
  
  // Wait for async model loading
  await new Promise(r => setTimeout(r, 500));
  
  // Check what's loaded
  console.log("Player anim:", renderer3d.playerAnimator?.vm?.clip);
  console.log("Enemy anim:", renderer3d.enemyAnimator?.vm?.clip);
  console.log("Player frame:", renderer3d.playerAnimator?.frame);
  console.log("Enemy frame:", renderer3d.enemyAnimator?.frame);
  console.log("Timeline table:", renderer3d.playerAnimator?.timelineTable);
  
  // Now test a tech attack (signature move)
  // Renamon tech 59 = Diamond Storm (signature)
  // Let's see what clip it maps to
  const techId = 59;
  const techRec = techRecord(techId);
  const clip = techToClip(techId);
  
  console.log("\n=== Tech 59 (Diamond Storm) ===");
  console.log("  techRecord:", techRec ? JSON.stringify(techRec).substring(0, 200) : "null");
  console.log("  techToClip:", clip);
  
  // Start the attack
  const result = renderer3d.playerAttack(techId, { lethal: false });
  console.log("  playerAttack result:", result);
  
  // Wait for async
  await new Promise(r => setTimeout(r, 200));
  
  // Check animation states
  console.log("\n  After playerAttack (before tick):");
  console.log("    Player anim:", renderer3d.playerAnimator?.vm ? "VM active" : "idle");
  console.log("    Player clip:", renderer3d.playerAnimator?._clip);
  console.log("    Enemy anim:", renderer3d.enemyAnimator?.vm ? "VM active" : "idle");
  console.log("    Enemy clip:", renderer3d.enemyAnimator?._clip);
  console.log("    Player frame:", renderer3d.playerAnimator?.frame);
  console.log("    Enemy frame:", renderer3d.enemyAnimator?.frame);
  console.log("    Enemy timeline table:", renderer3d.enemyAnimator?.timelineTable);
  
  // Check if defender has the correct reaction clip set
  const enemyVM = renderer3d.enemyAnimator?.vm;
  const enemyClip = renderer3d.enemyAnimator?._clip;
  console.log("    Enemy VM clip (should be 2 for survive, 3 for death):", enemyClip);
  
  // Step through a few ticks to see if the reaction clip gets set
  for (let i = 0; i < 20; i++) {
    renderer3d.coordinator?.tick(1);
    await new Promise(r => setTimeout(r, 0));
    
    const playerClip = renderer3d.playerAnimator?._clip;
    const enemyClip = renderer3d.enemyAnimator?._clip;
    const playerFrame = renderer3d.playerAnimator?.frame;
    const enemyFrame = renderer3d.enemyAnimator?.frame;
    const playerTable = renderer3d.playerAnimator?.timelineTable;
    const enemyTable = renderer3d.enemyAnimator?.timelineTable;
    
    console.log(`  Tick ${i + 1}: P-clip=${playerClip} P-frame=${playerFrame} P-tbl=${playerTable} | E-clip=${enemyClip} E-frame=${enemyFrame} E-tbl=${enemyTable}`);
    
    // Check if the attack has ended
    if (!renderer3d.coordinator?.active) {
      console.log("  ** Attack ended at tick", i + 1);
      break;
    }
  }
  
  // Final state
  console.log("\n=== Final state after attack finishes ===");
  console.log("  Player anim:", renderer3d.playerAnimator?.vm ? "VM active" : "idle");
  console.log("  Enemy anim:", renderer3d.enemyAnimator?.vm ? "VM active" : "idle");
  console.log("  Player frame:", renderer3d.playerAnimator?.frame);
  console.log("  Enemy frame:", renderer3d.enemyAnimator?.frame);
  console.log("  Player timeline table:", renderer3d.playerAnimator?.timelineTable);
  console.log("  Enemy timeline table:", renderer3d.enemyAnimator?.timelineTable);
  
  // Check if enemy is on the correct clip (survive = clip 2)
  if (renderer3d.enemyAnimator?._clip !== 2 && renderer3d.enemyAnimator?._clip !== 3) {
    console.log("\n** BUG: Enemy is on clip", renderer3d.enemyAnimator?._clip, "instead of clip 2 (survive) or clip 3 (death)");
  }
}

test().then(() => {
  console.log("\nDone");
}).catch(e => {
  console.error("Test failed:", e);
  console.error(e.stack);
});
