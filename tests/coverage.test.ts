import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePlan,requireCoverage} from '../src/core/flashcards';
test('dense source covers 18 independent knowledge points without the old eight-card cap',()=>{
 const points=Array.from({length:18},(_,i)=>({id:'p'+i,objective:'知识点'+i,priority:'core' as const,block:'b',quote:'证据'+i+'。'}));
 const batch=[{id:'b',text:points.map(p=>p.quote).join('')}];
 const plan=validatePlan({points},batch).points;
 const cards=points.map(p=>({point:p.id,question:'问题'+p.id,answer:'回答',block:'b',quote:p.quote}));
 assert.equal(plan.length,18);
 assert.equal(requireCoverage({cards},plan).missing.length,0);
 // Missing points are reported, the cards that were produced are kept.
 const partial=requireCoverage({cards:cards.slice(0,8)},plan);
 assert.equal(partial.cards.length,8);assert.equal(partial.missing.length,10);
});
test('one bad knowledge point never rejects the plan',()=>{
 const good={id:'p1',objective:'定义',priority:'core',block:'b',quote:'原文'};
 const r=validatePlan({points:[good,{...good},{id:'p2',objective:''},{...good,id:'p3',priority:' Core ',extra:1},{...good,id:'p4',quote:'不在原文'}]},[{id:'b',text:'原文'}]);
 assert.deepEqual(r.points.map(p=>p.id),['p1','p1~2','p3','p4']);   // duplicate renamed, malformed dropped
 assert.equal(r.points[2].priority,'core');                          // padded enum accepted, extra key ignored
 assert.equal(r.warnings.length,1);assert.match(r.warnings[0],/1 个知识点格式不完整/);
 assert.throws(()=>validatePlan({nothing:true},[]));                 // unusable envelope still throws
});
test('one malformed card never rejects its siblings',()=>{
 const plan=validatePlan({points:[{id:'p1',objective:'a',priority:'core',block:'b',quote:'q'}]},[]).points;
 const r=requireCoverage({cards:[{point:'p1',question:'问',answer:'答',block:'b',quote:'q',priority:'core'},{point:'p1',question:''},{point:'zz',question:'问2',answer:'答2'}]},plan);
 assert.equal(r.cards.length,2);assert.equal(r.malformed,1);assert.equal(r.missing.length,0);
});
