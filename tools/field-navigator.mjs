// Browser-test navigation only. Reuses the shipped collision predicate; never
// changes the player position, story state, or collision map.
import { rectBlocked, moveWithCollision, fieldDirectionDelta, terrainCodeAt } from '../web/vendor/engine.js';

export const FOOT = { w: 12, h: 8 }; // web/game.js moveWithCollision call
export function visibleWaypoint(grid, position, path, index) {
  for(let j=index;j<path.length;j++) {
    if(clearSegment(grid,position,path[j])) index=j;
  }
  return index;
}
export function clearSegment(grid, a, b) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x-a.x, b.y-a.y)));
  for (let i=0; i<=n; i++) {
    const x=a.x+(b.x-a.x)*i/n, y=a.y+(b.y-a.y)*i/n;
    if (rectBlocked(grid,x-FOOT.w/2,y-FOOT.h,x+FOOT.w/2,y)) return false;
  }
  return true;
}

export function planRoute(grid, start, goal) {
  // Fine lattice keeps narrow passages available; swept feet reject corners
  // that a point-based tile search would incorrectly accept.
  const step=4, cols=Math.ceil(grid.cols*grid.cell/step), rows=Math.ceil(grid.rows*grid.cell/step);
  const points=new Map(), parents=new Map(), queue=[];
  const key=(c,r)=>r*cols+c;
  for(let r=Math.max(0,Math.floor(start.y/step)-2);r<=Math.min(rows-1,Math.floor(start.y/step)+2);r++)
    for(let c=Math.max(0,Math.floor(start.x/step)-2);c<=Math.min(cols-1,Math.floor(start.x/step)+2);c++) {
      const p={x:c*step,y:r*step}, corner={x:p.x,y:start.y};
      if(clearSegment(grid,start,corner)&&clearSegment(grid,corner,p)) {
        const k=key(c,r);points.set(k,p);parents.set(k,null);queue.push(k);
      }
    }
  let found=null;
  for(let head=0;head<queue.length;head++) {
    const k=queue[head], p=points.get(k);
    if(Math.hypot(p.x-goal.x,p.y-goal.y)<=4 && clearSegment(grid,p,{x:goal.x,y:p.y}) && clearSegment(grid,{x:goal.x,y:p.y},goal)) { found=k;break; }
    const c=k%cols,r=Math.floor(k/cols);
    for(const [dc,dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc=c+dc,nr=r+dr,nk=key(nc,nr);
      if(nc<0||nr<0||nc>=cols||nr>=rows||parents.has(nk))continue;
      const np={x:nc*step,y:nr*step};
      if(!clearSegment(grid,p,np))continue;
      points.set(nk,np);parents.set(nk,k);queue.push(nk);
    }
  }
  if(found===null)throw Error('No route with foot clearance');
  const path=[];
  for(let k=found;k!==null;k=parents.get(k))path.push(points.get(k));
  path.reverse();
  path.unshift(start,{x:path[0].x,y:start.y});
  path.push({x:goal.x,y:path.at(-1).y},goal);
  const compact=[];
  for(const p of path) {
    if(compact.length && p.x===compact.at(-1).x && p.y===compact.at(-1).y)continue;
    while(compact.length>1) {
      const a=compact.at(-2), b=compact.at(-1);
      if(!((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y)))break;
      compact.pop();
    }
    compact.push(p);
  }
  return compact;
}

export async function navigate(page, goal, { log=()=>{}, timeout=90000 }={}) {
  const read=()=>page.evaluate(()=>{const s=window.__state;return {
    x:s.x,y:s.y,map:s.manifest.maps[s.mapIdx].id,
    blocked:!!(window.__textbox?.isOpen?.()||window.__cutscene?.isActive?.()||window.__battle?.isActive?.())
  };});
  const first=await read();
  const raw=await page.evaluate(()=>{const s=window.__state,g=s.collision[s.manifest.maps[s.mapIdx].id];return {cell:g.cell,cols:g.cols,rows:g.rows,cells:Array.from(g.cells),terrain:g.terrain?.map(b=>Array.from(b))};});
  const grid={...raw,cells:Uint8Array.from(raw.cells),terrain:raw.terrain?.map(b=>Uint8Array.from(b))};
  let path=planRoute(grid,first,goal), index=1, stalls=0, replans=0;
  const deadline=Date.now()+timeout;
  log({type:'plan',map:first.map,goal,path});
  while(Date.now()<deadline) {
    const p=await read();
    if(p.map!==first.map||p.blocked)throw Error('Navigation interrupted by map change, dialogue, cutscene, or battle');
    if(Math.hypot(p.x-goal.x,p.y-goal.y)<3) { log({type:'arrived',...p,goal,replans});return p; }
    // Only skip a corner when the entire swept foot rectangle can reach
    // the later waypoint. A distance tolerance alone cuts into walls.
    index=visibleWaypoint(grid,p,path,index);
    const target=path[index];
    if(!target)throw Error('Route exhausted before arrival');
    const actions=[['up',['ArrowUp']],['down',['ArrowDown']],['left',['ArrowLeft']],['right',['ArrowRight']],
      ['up-left',['ArrowUp','ArrowLeft']],['up-right',['ArrowUp','ArrowRight']],
      ['down-left',['ArrowDown','ArrowLeft']],['down-right',['ArrowDown','ArrowRight']]];
    // Predict the actual terrain-dependent displacement and wall sliding.
    // This is selection of keyboard input, not a write to the game's state.
    let best=null;
    for(const [direction,keys] of actions) {
      const delta=fieldDirectionDelta(direction,undefined,terrainCodeAt(grid,p.x,p.y));
      const predicted=moveWithCollision(grid,p.x,p.y,delta.x,delta.y,FOOT);
      if(Math.hypot(predicted.x-p.x,predicted.y-p.y)<0.1)continue;
      const cost=Math.hypot(predicted.x-target.x,predicted.y-target.y);
      if(!best||cost<best.cost)best={keys,cost};
    }
    if(!best)throw Error('No legal keyboard movement from current position');
    const key=best.keys.join('+'),hold=20;
    for(const k of best.keys)await page.keyboard.down(k);
    try { await page.waitForTimeout(hold); } finally { for(const k of best.keys)await page.keyboard.up(k); }
    const q=await read();
    log({type:'move',key,hold,from:p,to:q,target});
    stalls=Math.hypot(q.x-p.x,q.y-p.y)<0.1?stalls+1:0;
    if(stalls>=6) {
      if(++replans>2)throw Error('Predicted route disagrees with live movement; stopping without random nudges');
      path=planRoute(grid,q,goal);index=1;stalls=0;log({type:'replan',path});
    }
  }
  throw Error('Navigation deadline exceeded');
}
