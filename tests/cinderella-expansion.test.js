import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkData} from '../scripts/check-data.mjs';
import {validateCinderellaSources} from '../scripts/check-cinderella.mjs';
import {generatePuzzle} from '../src/generator.js';
import {normalizeAnswer,searchCharacters} from '../src/game.js';
import {randomPool} from '../worker/pool.generated.js';
import {validateRandomBoard} from '../worker/random-validation.js';
import {boardSubmission} from '../src/random-protocol.js';

const {characters,bank,roster,cinderellaRoster}=await checkData();
const evidence=JSON.parse(await readFile(new URL('../docs/evidence/cinderella-scenes.json',import.meta.url),'utf8'));
const records=bank.records.filter(r=>r.categories.includes('cinderella'));
const clues=records.flatMap(r=>r.clues.filter(c=>c.categories.includes('cinderella')));

test('Cinderella expansion has reviewed story identities and the same English/kana server pool',()=>{
  assert.equal(records.length,46);assert.equal(clues.length,150);
  assert.equal(cinderellaRoster.characters.filter(c=>c.kind==='main').length,15);
  assert.equal(cinderellaRoster.characters.filter(c=>c.kind==='original').length,31);
  assert.deepEqual(new Set(randomPool.categories.cinderella),new Set(records.map(r=>r.characterId)));
  for(const id of ['black-ale','meikun-tsukasa','kraft-univer','god-hannibal','akitsu-teio','sirius-symboli',
    'dynamu-heroine','lord-royal','yamano-thousand','folkqueen','mill-wakaba','bamboo-memory','mejiro-ryan','mejiro-mcqueen']){
    assert.ok(records.some(r=>r.characterId===id),`Missing story candidate ${id}`);
  }
  for(const id of ['dyna-actress','mejiro-durren','neo-universe','line-craft'])assert.ok(!records.some(r=>r.characterId===id));
  for(const id of ['luna-swallow','shirley-sky','top-shunbetsu','be-true-on-pulse','clarizza']){
    assert.ok(!characters.some(c=>c.id===id));
    assert.ok(!bank.records.some(r=>r.characterId===id));
    assert.ok(!evidence.records.some(r=>r.characterId===id));
    for(const ids of Object.values(randomPool.categories))assert.ok(!ids.includes(id));
  }
  assert.ok(!characters.some(c=>c.names.en==='Jo Kitahara'));
});

test('every Cinderella clue has a specific reviewed reference and a distinct fact key',()=>{
  assert.equal(evidence.records.length,clues.length);
  for(const record of records){
    const own=record.clues.filter(c=>c.categories.includes('cinderella'));
    assert.ok(own.length>=2);assert.equal(new Set(own.map(c=>c.factKey)).size,own.length);
    for(const clue of own){
      assert.equal(clue.dimension,'story');assert.ok(clue.factKey.startsWith('cinderella-'));
      for(const text of Object.values(clue.text))assert.ok(text.trim().length>15);
      assert.ok(!clue.text['zh-CN'].includes('原型'));
      assert.ok(!clue.sources.every(source=>source.startsWith('https://umamusume.jp/character/')));
    }
  }
});

test('Cinderella source validation rejects missing members, mismatched sources and unsupported media',()=>{
  const validate=(c,e)=>validateCinderellaSources(c,e,characters,bank,roster);
  const missing=structuredClone(cinderellaRoster);missing.characters.pop();
  assert.throws(()=>validate(missing,evidence),/coverage/);
  const identity=structuredClone(cinderellaRoster);identity.characters[0].nameJa='サンプル';
  assert.throws(()=>validate(identity,evidence),/identity/);
  for(const mutate of [
    e=>e.records.pop(),e=>{e.records[0].characterId='folkqueen';},
    e=>{e.records[0].sources=['https://example.com/incorrect'];},
    e=>{e.records[0].scene.medium='game';},e=>{e.records[0].scene.reference='';},
  ]){const copy=structuredClone(evidence);mutate(copy);assert.throws(()=>validate(cinderellaRoster,copy),/coverage|mismatch/);}
});

test('new story names normalize in both scripts and preserve the requested existing Chinese names',()=>{
  for(const id of ['folkqueen','thief-crow','carries-room','face-no-more','yamano-thousand','shirogane-adieu']){
    const c=characters.find(c=>c.id===id);
    assert.match(normalizeAnswer(c.names.en,'en'),/^[A-Z]+$/);
    assert.match(normalizeAnswer(c.names.ja,'ja'),/^[ァ-ヿー]+$/);
    for(const name of Object.values(c.names))assert.ok(searchCharacters(characters,name).some(row=>row.id===id));
  }
  assert.equal(characters.find(c=>c.id==='face-no-more').names.en,'Faith No More');
  assert.equal(characters.find(c=>c.id==='yamano-thousand').names.en,'Yamano Southern');
  for(const [id,name]of [['dicta-striker','狄杜射手'],['belno-light','崭新光辉'],['michelle-my-baby','米歇尔宝贝'],
    ['moonlight-lunacy','月光狂气'],['obey-your-master','听命汝主'],['ellerslie-pride','艾勒斯利荣耀']]){
    assert.equal(characters.find(c=>c.id===id).names['zh-CN'],name);
  }
});

test('all expanded Cinderella candidates can be drawn in both scripts and pass statistics validation',()=>{
  for(const answerLanguage of ['en','ja']){
    const appeared=new Set();
    for(let seed=1;seed<=100;seed++){
      const p=generatePuzzle({characters,bank,difficulty:'cinderella',answerLanguage,boardSize:seed%2?'small':'large',seed});
      p.entries.forEach(e=>appeared.add(e.characterId));
      validateRandomBoard({difficulty:p.difficulty,boardSize:p.boardSize,board:boardSubmission(p)},randomPool);
    }
    assert.deepEqual(appeared,new Set(records.map(r=>r.characterId)));
  }
});
