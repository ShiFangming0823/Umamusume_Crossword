import test from 'node:test';
import assert from 'node:assert/strict';
import { checkData } from '../scripts/check-data.mjs';
import { validateClueBank } from '../src/clue-bank.js';
import { selectPuzzleClues, isBeginnerAuxiliary, isBeginnerPrimary } from '../src/clue-policy.js';
import { generatePuzzle } from '../src/generator.js';
import { boardSubmission } from '../src/random-protocol.js';
import { randomPool } from '../worker/pool.generated.js';
import { validateRandomBoard } from '../worker/random-validation.js';

const {bank,characters,roster}=await checkData();
const byClue=new Map(bank.records.flatMap(r=>r.clues).map(c=>[c.id,c]));
const originals=new Set(roster.storyCharacterIds);

test('Starter caps race and music together at three, even when recent history favors auxiliary clues',()=>{
  for(const size of [12,20]){
    const entries=Array.from({length:size},(_,i)=>({characterId:`runner-${i}`,record:{clues:
      ['profile','horse-record','music'].map(d=>({id:`${i}-${d}`,dimension:d,categories:['beginner','advanced']}))}}));
    const history=Object.fromEntries(entries.map(e=>[e.characterId,e.record.clues[0].id]));
    const selected=[...selectPuzzleClues(entries,'beginner',history,()=>.999).values()];
    assert.equal(selected.filter(isBeginnerAuxiliary).length,3);
    assert.equal(selected.filter(isBeginnerPrimary).length,size-3);
    assert.equal([...selectPuzzleClues(entries,'advanced',history,()=>.999).values()].filter(isBeginnerAuxiliary).length,size);
  }
});

test('Starter profiles and story receive more weight than race and music',()=>{
  const entries=[{characterId:'runner',record:{clues:['profile','story','horse-record','music'].map(d=>({id:d,dimension:d,categories:['beginner']}))}}];
  let primary=0;
  for(let i=0;i<140;i++)if(isBeginnerPrimary(selectPuzzleClues(entries,'beginner',{},()=>(i+.5)/140).get('runner')))primary++;
  assert.equal(primary,120);
});

test('both scripts and board sizes enforce Starter quotas and exclude story-only runners across seeds',()=>{
  let storyClues=0,auxiliaryClues=0;
  for(const answerLanguage of ['en','ja'])for(const boardSize of ['small','large'])for(let seed=0;seed<60;seed++){
    const previousClues=Object.fromEntries(bank.records.map(r=>[r.characterId,r.clues.find(c=>c.categories.includes('beginner')&&isBeginnerPrimary(c))?.id]));
    const puzzle=generatePuzzle({bank,characters,difficulty:'beginner',answerLanguage,boardSize,seed,previousClues});
    const clues=puzzle.entries.map(e=>byClue.get(e.clueId));
    assert.ok(clues.filter(isBeginnerAuxiliary).length<=3);
    assert.ok(puzzle.entries.every(e=>!originals.has(e.characterId)));
    storyClues+=clues.filter(c=>c.dimension==='story').length;
    auxiliaryClues+=clues.filter(isBeginnerAuxiliary).length;
    validateRandomBoard({difficulty:'beginner',boardSize,board:boardSubmission(puzzle)},randomPool);
  }
  assert.ok(storyClues>0);assert.ok(auxiliaryClues>0);
});

test('every Starter runner must retain a profile or story fallback for a full auxiliary quota',()=>{
  const copy=structuredClone(bank),record=copy.records.find(r=>r.categories.includes('beginner')&&r.clues.filter(c=>c.categories.includes('beginner')&&isBeginnerAuxiliary(c)).length>=2);
  record.clues=record.clues.filter(c=>!c.categories.includes('beginner')||!isBeginnerPrimary(c));
  assert.throws(()=>validateClueBank(copy,characters),/Beginner profile or story clue required/);
  for(const id of originals){
    const record=bank.records.find(r=>r.characterId===id);
    assert.deepEqual(record.categories,['cinderella']);
    assert.ok(record.clues.every(c=>!c.categories.includes('beginner')&&!c.categories.includes('advanced')));
  }
});
