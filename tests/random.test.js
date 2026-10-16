import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { checkData } from '../scripts/check-data.mjs';
import { generatePuzzle, CATEGORIES, SIZES } from '../src/generator.js';
import { validateClueBank } from '../src/clue-bank.js';
import { validateLevel, GameSession } from '../src/game.js';
import { boardSubmission, valuesHash } from '../src/random-protocol.js';
import { validateRandomBoard } from '../worker/random-validation.js';
import { randomPool } from '../worker/pool.generated.js';
import { qrMatrix, GAME_URL } from '../src/export.js';
import worker from '../worker/index.js';
import { AnalyticsClient } from '../src/analytics.js';
const {bank,characters}=await checkData();
const puzzle=options=>generatePuzzle({bank,characters,difficulty:'beginner',answerLanguage:'en',boardSize:'small',seed:123,...options});
const allValues=p=>validateRandomBoard({difficulty:p.difficulty,boardSize:p.boardSize,board:boardSubmission(p)},randomPool);
test('all 16 combinations generate connected, legal grids with exact direction counts over varied seeds',()=>{
 for(const difficulty of CATEGORIES)for(const answerLanguage of ['en','ja'])for(const boardSize of ['small','large'])for(const seed of [0,1,2,47,999,0xffffffff]){
  const p=puzzle({difficulty,answerLanguage,boardSize,seed});validateLevel(p,characters);
  assert.equal(new Set(p.entries.map(e=>e.characterId)).size,SIZES[boardSize]*2);
  for(const d of ['across','down'])assert.equal(p.entries.filter(e=>e.direction===d).length,SIZES[boardSize]);
  for(const e of p.entries)assert.ok(bank.records.find(r=>r.characterId===e.characterId).categories.includes(difficulty));
 }
});
test('same seed reproduces a grid, different seeds change it, and recent clues are avoided per character',()=>{
 const first=puzzle(),same=puzzle();assert.deepEqual(first,same);
 const next=puzzle({seed:124});assert.notDeepEqual(first.grid,next.grid);assert.notDeepEqual(first.entries.map(e=>e.characterId).sort(),next.entries.map(e=>e.characterId).sort());
 const previousClues=Object.fromEntries(first.entries.map(e=>[e.characterId,e.clueId]));
 const refreshed=puzzle({previousClues});assert.deepEqual(first.grid,refreshed.grid);
 const clueById=new Map(bank.records.flatMap(r=>r.clues).map(c=>[c.id,c]));
 const auxiliary=c=>['horse-record','music'].includes(c.dimension);
 for(const e of refreshed.entries)if(e.clueId===previousClues[e.characterId]){
  assert.equal(refreshed.entries.filter(x=>auxiliary(clueById.get(x.clueId))).length,3);
  const alternatives=bank.records.find(r=>r.characterId===e.characterId).clues.filter(c=>c.categories.includes('beginner')&&c.id!==e.clueId);
  assert.ok(alternatives.length&&alternatives.every(auxiliary));
 }
});
test('bad settings and undersized pools fail clearly; no disconnected fallback is returned',()=>{
 for(const settings of [{difficulty:'easy'},{boardSize:'huge'},{answerLanguage:'zh-CN'},{seed:-1},{seed:1.2}])assert.throws(()=>puzzle(settings));
 assert.throws(()=>puzzle({bank:{records:[]}}),/Not enough/);
});
test('clues are localized, sourced, category-scoped, and duplicates cannot point to another character',()=>{
 for(const r of bank.records)for(const category of r.categories){const clues=r.clues.filter(c=>c.categories.includes(category));assert.ok(clues.length>=(category==='epithets'?1:2));}
 const broken=structuredClone(bank);const a=broken.records.find(r=>r.categories.includes('beginner')),b=broken.records.find(r=>r!==a&&r.categories.includes('beginner'));b.clues.push({...a.clues.find(c=>c.categories.includes('beginner')),id:'duplicate-test',factKey:'cross-character-duplicate'});
 assert.throws(()=>validateClueBank(broken,characters),/duplicate clue/i);
 const missing=structuredClone(bank);delete missing.records[0].clues[0].text.ja;assert.throws(()=>validateClueBank(missing,characters),/translation/);

});
const origin='https://umamusume-crossword.pages.dev';
const migration=await readFile(new URL('../worker/migrations/0002_random_stats.sql',import.meta.url),'utf8');
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(migration);
 const DB={prepare(text){const statement=sql.prepare(text);let args=[];const prepared={bind(...values){args=values;return prepared;},async first(){return statement.get(...args)||null;},async run(){return{success:true,meta:statement.run(...args)};}};return prepared;}};
 const send=(path,data)=>worker.fetch(new Request('https://test.example'+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),{DB,ALLOWED_ORIGINS:origin});
 const start=p=>({runId:crypto.randomUUID(),difficulty:p.difficulty,boardSize:p.boardSize,board:boardSubmission(p)});
 const finish=(run,p,extra={})=>({runId:run.runId,difficulty:run.difficulty,boardSize:run.boardSize,outcome:'solved',elapsedMs:50000,values:allValues(p),...extra});
 const stats=(p)=>send(`/api/v2/stats?difficulty=${p.difficulty}&boardSize=${p.boardSize}`).then(r=>r.json());return{sql,send,start,finish,stats};
}
test('new statistics group scripts together, isolate all eight scopes, and omit unfinished games from averages',async()=>{
 const f=fixture();const zero=await f.stats(puzzle());assert.equal(zero.averageMs,null);
 for(const difficulty of CATEGORIES)for(const boardSize of ['small','large']){
  for(const [answerLanguage,elapsedMs] of [['en',50000],['ja',90000]]){const p=puzzle({difficulty,boardSize,answerLanguage}),r=f.start(p);assert.equal((await f.send('/api/v2/runs/start',r)).status,200);assert.equal((await f.send('/api/v2/runs/finish',f.finish(r,p,{elapsedMs}))).status,200);}
  const p=puzzle({difficulty,boardSize});assert.deepEqual(await f.stats(p),{difficulty,boardSize,starts:2,solved:2,averageMs:70000});
 }
 const p=puzzle(),run=f.start(p);await f.send('/api/v2/runs/start',run);await f.send('/api/v2/runs/finish',f.finish(run,p,{outcome:'revealed',elapsedMs:999000}));assert.equal((await f.stats(p)).averageMs,70000);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM category_stats').get().n,8);
 assert.ok(!Object.keys(f.sql.prepare('SELECT * FROM random_game_runs LIMIT 1').get()).includes('values'));
});
test('random API rejects wrong boards and results, retries count once, and additive migrations preserve data',async()=>{
 const f=fixture(),p=puzzle(),run=f.start(p);assert.equal((await f.send('/api/v2/runs/start',run)).status,200);assert.equal((await f.send('/api/v2/runs/start',run)).status,200);
 const broken=structuredClone(run);broken.board.entries[0].row=99;broken.runId=crypto.randomUUID();assert.equal((await f.send('/api/v2/runs/start',broken)).status,422);
 assert.equal((await f.send('/api/v2/runs/finish',f.finish(run,p,{values:{}}))).status,422);
 assert.equal((await f.send('/api/v2/runs/finish',f.finish(run,p,{elapsedMs:-1}))).status,400);
 assert.equal((await f.send('/api/v2/runs/finish',f.finish(run,p,{boardSize:'large'}))).status,409);
 const end=f.finish(run,p);await f.send('/api/v2/runs/finish',end);await f.send('/api/v2/runs/finish',end);assert.equal((await f.stats(p)).solved,1);
 f.sql.exec(migration);assert.equal((await f.stats(p)).starts,1);assert.equal((await f.stats(p)).solved,1);
 const newP=puzzle({seed:9});assert.equal((await f.send('/api/v2/runs/start',{...f.start(newP),runId:run.runId})).status,409);
});
test('client sends random puzzle statistics through v2 while keeping legacy records supported',async()=>{
 const f=fixture();const client=new AnalyticsClient({apiBaseUrl:origin,fetcher:(url,options)=>{const request=new Request(url,options);request.headers.set('Origin',origin);return worker.fetch(request,{DB:{prepare(text){const statement=f.sql.prepare(text);let args=[];return{bind(...v){args=v;return this;},async first(){return statement.get(...args)||null;},async run(){return statement.run(...args);}};}},ALLOWED_ORIGINS:origin});}});
 const p=puzzle(),session=new GameSession(p,'easy',()=>1000),handle=client.begin(session);await handle.ready;await client.flush();session.update(allValues(p));await client.end(handle,session);await client.flush();
 const stats=await client.stats(p,true);assert.equal(stats.status,'ok');assert.equal(stats.starts,1);assert.equal(stats.solved,1);assert.equal(stats.averageMs,0);client.dispose();
 assert.equal(await valuesHash({b:'X',a:'Y'}),await valuesHash({a:'Y',b:'X'}));
});
test('offline QR encoding is deterministic, square, and uses the public game URL',()=>{
 const matrix=qrMatrix();assert.equal(GAME_URL,'https://umamusume-crossword.pages.dev/');assert.ok(matrix.length>=21);assert.ok(matrix.every(row=>row.length===matrix.length));assert.deepEqual(matrix,qrMatrix(GAME_URL));assert.notDeepEqual(matrix,qrMatrix('https://example.com'));
 assert.ok(matrix[0][0]);assert.ok(matrix[0][6]);assert.ok(!matrix[1][1]);assert.ok(matrix[3][3]);
});


test('every random epithet keeps both authentic source titles when present',async()=>{
 const source=JSON.parse(await readFile(new URL('../data/epithets.json',import.meta.url),'utf8'));
 for(const row of source.records.filter(r=>r.characterId)){const record=bank.records.find(r=>r.characterId===row.characterId),clue=record.clues.find(c=>c.categories.includes('epithets'));
 assert.equal(clue.text.ja,[row.gameEpithetJa&&'二つ名：'+row.gameEpithetJa,row.towelEpithetJa&&'タオルの二つ名：'+row.towelEpithetJa].filter(Boolean).join('\n'));assert.ok(!/[\u3040-\u30ff]/.test(clue.text.en));}
});

 test('new migration preserves legacy runs and totals alongside new random tables',async()=>{
  const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../worker/migrations/0001_stats.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO game_runs(run_id,level_id,revision,start_mode,started_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(),'old-fixture','old-revision','hard',1);
  db.exec(migration);db.exec(migration);
  assert.equal(db.prepare('SELECT count(*) n FROM game_runs').get().n,1);assert.equal(db.prepare('SELECT starts FROM level_stats').get().starts,1);assert.equal(db.prepare('SELECT count(*) n FROM category_stats').get().n,0);
 });
 test('random-puzzle outbox survives offline completion and retries exactly once',async()=>{
  const f=fixture(),p=puzzle(),store=new Map(),storage={get length(){return store.size;},key(i){return [...store.keys()][i];},getItem(k){return store.get(k)||null;},setItem(k,v){store.set(k,String(v));},removeItem(k){store.delete(k);}};
  let offline=true;const fetcher=async(url,options)=>{if(offline)throw new Error('offline');const u=new URL(url);return f.send(u.pathname+u.search,options.body?JSON.parse(options.body):undefined);};
  const client=new AnalyticsClient({apiBaseUrl:origin,storage,fetcher}),session=new GameSession(p,'hard',()=>1000),handle=client.begin(session);await handle.ready;await client.flush();session.update(allValues(p));await client.end(handle,session);client.dispose();assert.equal(store.size,1);
  offline=false;const restored=new AnalyticsClient({apiBaseUrl:origin,storage,fetcher});await restored.flush();await restored.flush();restored.dispose();const stats=await f.stats(p);assert.equal(stats.starts,1);assert.equal(stats.solved,1);assert.equal(store.size,0);
 });
