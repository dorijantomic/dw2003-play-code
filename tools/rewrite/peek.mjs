import {readFileSync} from "node:fs";
const L=readFileSync(process.argv[2],"utf8").trim().split("\n").map(JSON.parse);
const uniq=(f)=>[...new Set(L.map(f))].slice(0,12);
console.log("menuOpen",uniq(r=>r.game.menuOpen),"menu",uniq(r=>r.menu),"textbox",uniq(r=>r.textbox));
console.log("battleActive",uniq(r=>r.battleActive),"battle.state",uniq(r=>r.battle?.state));
console.log("player hp",uniq(r=>r.player?.hp),"enemy hp",uniq(r=>r.enemy?.hp));
console.log("keys",uniq(r=>r.keys.join()));
