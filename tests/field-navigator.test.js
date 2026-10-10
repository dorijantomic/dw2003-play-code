import test from 'node:test';
import assert from 'node:assert/strict';
import { fromJSON } from '../web/vendor/engine.js';
import { planRoute, clearSegment, visibleWaypoint } from '../tools/field-navigator.mjs';
test('route goes around a corner with swept foot clearance',()=>{
  const grid=fromJSON({cell:16,cols:6,rows:6,blocked:['111111','100001','101101','101101','100001','111111']});
  const a={x:24,y:32},b={x:72,y:72};
  assert.equal(clearSegment(grid,a,b),false);
  const path=planRoute(grid,a,b);
  assert.deepEqual(path.at(-1),b);
  for(let i=1;i<path.length;i++)assert.ok(clearSegment(grid,path[i-1],path[i]));
});
test('rejects a point-walkable corridor too narrow for the feet',()=>{
  const blocked=Array.from({length:12},()=> '111011111111');
  const grid=fromJSON({cell:4,cols:12,rows:12,blocked});
  assert.throws(()=>planRoute(grid,{x:14,y:12},{x:14,y:36}),/No route/);
});
test('advances past a reached corner even when the corridor is longer than lookahead',()=>{
  const grid=fromJSON({cell:16,cols:10,rows:4,blocked:['1111111111','1000000001','1000000001','1111111111']});
  const path=[{x:24,y:32},{x:120,y:32}];
  assert.equal(visibleWaypoint(grid,{x:25,y:33},path,0),1);
});
