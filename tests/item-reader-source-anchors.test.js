import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const census=JSON.parse(readFileSync('docs/generated/item-native-readers.json'));

test('raw item gate anchors match original word, source line and member',()=>{
 const cache=new Map();
 const lines=source=>{if(!cache.has(source))cache.set(source,readFileSync(source,'utf8').split('\n'));return cache.get(source);};
 for(const row of census.readers) assert.equal(lines(row.source)[row.line-1],row.exact);
 for(const row of [...census.tables,...census.reserved_zero_reads]) {
  assert.ok(row.anchors.length,`${row.stage} ${row.kind}`);
  for(const anchor of row.anchors) {
   assert.equal(lines(row.source)[anchor.line-1],anchor.exact);
   assert.equal(parseInt(anchor.exact.match(/\.word 0x([\da-f]+)/)[1],16)>>>0,((row.expected<<16)|row.flag_id)>>>0);
  }
 }
});
