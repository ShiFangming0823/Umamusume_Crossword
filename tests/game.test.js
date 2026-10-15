import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkData } from '../scripts/check-data.mjs';
import { GameSession, entryCells, feedbackFor, evaluate, normalizeAnswer, searchCharacters, validateLevel, formatTime, LANGUAGES } from '../src/game.js';
import { messages, translate } from '../src/i18n.js';
const {levels,characters}=await checkData();
const base=levels.find((e)=>e.id==='beginner-1-en'), advanced=levels.find((e)=>e.id==='advanced-1-en'), kana=levels.find((e)=>e.id==='beginner-1-kana'), advancedKana=levels.find((e)=>e.id==='advanced-1-kana');
const solution=(level)=>Object.fromEntries(level.entries.flatMap((e)=>entryCells(e).map((key,i)=>[key,[...e.answer][i]])));

test('all eight levels validate, with 11 across and 11 down and three clues each',()=>{
  assert.equal(levels.length,8);assert.equal(characters.length,173);
  for(const level of levels){
    assert.equal(level.entries.filter((e)=>e.direction==='across').length,11);
    assert.equal(level.entries.filter((e)=>e.direction==='down').length,11);
    for(const e of level.entries)for(const lang of LANGUAGES)assert.ok(e.clues[lang]);
  }
  assert.equal(base.answerLanguage,'en');assert.equal(advanced.difficulty,'advanced');assert.equal(kana.answerLanguage,'ja');
});
test('migrations preserve the original boards, positions, answers and Chinese clues',async()=>{
  // The original dimensions and character/clue correspondence are fixed fixtures.
  const totals=[base,advanced,kana].map((l)=>({id:l.id,rows:l.grid.rows,cols:l.grid.columns,entries:l.entries.length}));
  assert.deepEqual(totals,[{id:'beginner-1-en',rows:24,cols:24,entries:22},{id:'advanced-1-en',rows:25,cols:25,entries:22},{id:'beginner-1-kana',rows:19,cols:20,entries:22}]);
  const englishCharacters=new Set(base.entries.map((e)=>e.characterId));
  assert.deepEqual(new Set(kana.entries.map((e)=>e.characterId)),englishCharacters);
  for(const e of kana.entries)assert.equal(e.clues['zh-CN'].replace('名字意为','英文名是').replace('“双涡轮”。','“双涡轮”的意思。'),base.entries.find((x)=>x.characterId===e.characterId).clues['zh-CN']);
});

test('each of the four collections has both scripts, and advanced kana matches the advanced English puzzle',()=>{
  for(const collection of ['beginner','advanced','epithets','cinderella'])for(const script of ['en','ja']){
    assert.equal(levels.filter((l)=>l.difficulty===collection&&l.answerLanguage===script).length,1);
  }
  assert.equal(kana.difficulty,'beginner');assert.equal(advancedKana.difficulty,'advanced');
  assert.deepEqual(new Set(advanced.entries.map((e)=>e.characterId)),new Set(advancedKana.entries.map((e)=>e.characterId)));
  assert.notDeepEqual(new Set(kana.entries.map((e)=>e.characterId)),new Set(advancedKana.entries.map((e)=>e.characterId)));
  for(const e of advanced.entries)assert.deepEqual(advancedKana.entries.find((x)=>x.characterId===e.characterId).clues,e.clues);
});

test('Cinderella Chinese display names and clue references follow the requested translations while old queries still work',async()=>{
  const requested={
    'dicta-striker':'狄杜射手','ellerslie-pride':'艾勒斯利荣耀','obey-your-master':'听命汝主',
    'belno-light':'崭新光辉','michelle-my-baby':'米歇尔宝贝','moonlight-lunacy':'月光狂气',
  };
  const source=JSON.parse(await readFile(new URL('../data/cinderella-gray.json',import.meta.url),'utf8'));
  for(const [id,name] of Object.entries(requested)){
    assert.equal(characters.find((c)=>c.id===id).names['zh-CN'],name);
    assert.equal(source.entries.find((c)=>c.characterId===id).names['zh-CN'],name);
    assert.equal(searchCharacters(characters,name)[0].id,id);
  }
  for(const level of levels.filter((l)=>l.difficulty==='cinderella'))assert.match(level.entries.find((e)=>e.characterId==='gold-city').clues['zh-CN'],/艾勒斯利荣耀/);
  for(const [query,id] of [['迪克塔斯强袭','dicta-striker'],['贝尔诺之光','belno-light'],['艾勒斯利骄傲','ellerslie-pride'],['服从命令','obey-your-master']])assert.equal(searchCharacters(characters,query)[0].id,id);
});
test('invalid crossings, missing translations and missing character references are rejected',()=>{
  const missing=structuredClone(base);delete missing.entries[0].clues.ja;assert.throws(()=>validateLevel(missing,characters),/Missing clue/);
  const ref=structuredClone(base);ref.entries[0].characterId='missing';assert.throws(()=>validateLevel(ref,characters),/mismatch/);
  const crossing=structuredClone(base);crossing.entries[0].column++;assert.throws(()=>validateLevel(crossing,characters));
});

test('epithet puzzles use the same 22 characters and all three clues in both answer scripts',()=>{
  const en=levels.find((l)=>l.id==='epithets-1-en'),ja=levels.find((l)=>l.id==='epithets-1-kana');
  assert.equal(en.difficulty,'epithets');assert.equal(ja.difficulty,'epithets');
  assert.equal(en.answerLanguage,'en');assert.equal(ja.answerLanguage,'ja');
  assert.deepEqual(new Set(en.entries.map((e)=>e.characterId)),new Set(ja.entries.map((e)=>e.characterId)));
  for(const e of en.entries)assert.deepEqual(e.clues,ja.entries.find((x)=>x.characterId===e.characterId).clues);
  for(const name of ['西沙里奥','大鸣大放','莱茵力量','果敢之心','迷人景致'])assert.ok(searchCharacters(characters,name).length);
});

test('Cinderella Gray boards share 22 story clues, including original characters rather than real-horse names',async()=>{
  const en=levels.find((l)=>l.id==='cinderella-1-en'),ja=levels.find((l)=>l.id==='cinderella-1-kana');
  const source=JSON.parse(await readFile(new URL('../data/cinderella-gray.json',import.meta.url),'utf8'));
  assert.equal(source.entries.length,22);assert.equal(new Set(source.entries.map((r)=>r.characterId)).size,22);
  assert.equal(en.difficulty,'cinderella');assert.equal(ja.difficulty,'cinderella');
  assert.equal(en.answerLanguage,'en');assert.equal(ja.answerLanguage,'ja');
  assert.deepEqual(new Set(en.entries.map((e)=>e.characterId)),new Set(ja.entries.map((e)=>e.characterId)));
  for(const r of source.entries){
    const e=en.entries.find((e)=>e.characterId===r.characterId),j=ja.entries.find((e)=>e.characterId===r.characterId);
    assert.ok(e&&j);assert.deepEqual(e.clues,j.clues);assert.deepEqual(e.clues,r.clues);assert.ok(r.scene&&r.sources.length);
  }
  assert.equal(en.entries.find((e)=>e.characterId==='dicta-striker').answer,'DICTASTRIKER');
  assert.equal(en.entries.find((e)=>e.characterId==='obey-your-master').answer,'OBEYYOURMASTER');
  assert.equal(en.entries.find((e)=>e.characterId==='toni-bianca').answer,'TONIBIANCA');
  assert.equal(ja.entries.find((e)=>e.characterId==='mini-the-lady').answer,'ミニーザレディ');
  assert.ok(!en.entries.some((e)=>['SOCCERBOY','PAYTHEBUTLER','TONYBIN'].includes(e.answer)));
  assert.match(en.entries.find((e)=>e.characterId==='inari-one').clues['zh-CN'],/漫画/);
});

test('Cinderella Gray character lookup includes Chinese variants, English spellings and kana',()=>{
  for(const query of ['贝尔诺光','Belno','ベルノ','べるの'])assert.equal(searchCharacters(characters,query)[0].id,'belno-light');
  for(const query of ['藤正进行曲','Fujimasa','フジマサ'])assert.equal(searchCharacters(characters,query)[0].id,'fujimasa-march');
  assert.equal(searchCharacters(characters,'Minnie the Lady')[0].id,'mini-the-lady');
  assert.equal(searchCharacters(characters,'Tony Bianca')[0].id,'toni-bianca');
});

test('source snapshot preserves all table rows, blanks and footnotes without inventing towel epithets',async()=>{
  const source=JSON.parse(await readFile(new URL('../data/epithets.json',import.meta.url),'utf8'));
  assert.equal(source.source.url,'https://note.com/show248379/n/n81d9ed620aa4');
  assert.equal(source.records.length,145);assert.equal(new Set(source.records.map((r)=>r.characterJa)).size,145);
  assert.equal(source.records.filter((r)=>r.usable).length,140);
  assert.equal(source.records.filter((r)=>r.towelEpithetJa).length,34);
  const fine=source.records.find((r)=>r.characterJa==='ファインモーション');
  assert.equal(fine.gameCellOriginal,'気ままなお嬢様※1');assert.equal(fine.gameEpithetJa,'気ままなお嬢様');
  const emperor=source.records.find((r)=>r.characterJa==='シンボリルドルフ');assert.equal(emperor.towelEpithetJa,null);
  for(const r of source.records.filter((r)=>!r.usable)){assert.equal(r.gameCellOriginal,'×');assert.equal(r.gameEpithetJa,null);assert.equal(r.towelEpithetJa,null);}
});

test('dual-epithet clues retain both distinct source titles in every language and both boards',()=>{
  for(const level of levels.filter((l)=>l.difficulty==='epithets')){
    const cesario=level.entries.find((e)=>e.characterId==='cesario');
    assert.equal(cesario.clues.ja,'二つ名：明星の麗人\nタオルの二つ名：双国の女王');
    assert.equal(cesario.clues['zh-CN'],'二つ名：明星丽人\n毛巾二つ名：双国女王');
    assert.equal(cesario.clues.en,'Epithet: The Starlit Beauty\nTowel epithet: Queen of Two Nations');
    assert.equal(level.entries.filter((e)=>e.clues.ja.includes('タオルの二つ名：')).length,7);
    const single=level.entries.find((e)=>e.characterId==='symboli-rudolf');assert.equal(single.clues.ja,'二つ名：皇帝');
    for(const entry of level.entries)for(const lang of LANGUAGES)assert.equal(entry.clues[lang].split('\n').length,entry.clues.ja.split('\n').length);
  }
});
test('English and kana normalization preserves distinct small kana and composes voiced letters',()=>{
  assert.equal(normalizeAnswer('Mejiro McQueen'),'MEJIROMCQUEEN');
  assert.equal(normalizeAnswer('ｖｏｄｋａ'),'VODKA');
  assert.equal(normalizeAnswer('すぺしゃるうぃーく','ja'),'スペシャルウィーク');
  assert.equal(normalizeAnswer('ｳｵｯｶ','ja'),'ウオッカ');
  assert.equal(normalizeAnswer('か\u3099 は\u309a','ja'),'ガパ');
  assert.notEqual(normalizeAnswer('キャ','ja'),normalizeAnswer('キヤ','ja'));
  assert.equal([...normalizeAnswer('キャー','ja')].length,3);
});
test('Assisted feedback requires a fully correct word and disappears in Challenge',()=>{
  for(const level of [base,advanced,kana]){
    const e=level.entries[0], keys=entryCells(e), chars=[...e.answer];
    const values=Object.fromEntries(keys.slice(0,-1).map((k,i)=>[k,chars[i]]));
    assert.equal(feedbackFor(level.entries,values,'easy').greenCells.size,0);
    values[keys.at(-1)]=chars.at(-1);
    const feedback=feedbackFor(level.entries,values,'easy');assert.ok(feedback.solved.has(e.id));assert.ok(keys.every((key)=>feedback.greenCells.has(key)));
    assert.equal(feedbackFor(level.entries,values,'hard').solved.size,0);
    assert.equal(feedbackFor(level.entries,values,'hard').greenCells.size,0);
    values[keys[0]]=level.answerLanguage==='ja'?'ア':'X';
    if(values[keys[0]]===chars[0])values[keys[0]]=level.answerLanguage==='ja'?'イ':'Y';
    assert.ok(!feedbackFor(level.entries,values,'easy').solved.has(e.id));
  }
});
test('language-independent session and play-mode changes preserve time, letters and lookup usage',()=>{
  let time=1000;const session=new GameSession(base,'hard',()=>time);
  const e=base.entries[0], key=entryCells(e)[0];session.update({[key]:e.answer[0]});
  session.query(characters,'小栗帽');time=10000;session.setMode('easy');
  assert.equal(session.elapsed,9000);assert.equal(session.values[key],e.answer[0]);assert.equal(session.hardSearches,1);
  session.setMode('hard');assert.equal(session.elapsed,9000);assert.equal(session.hardSearches,1);
});
test('all three name scripts, partial names, hiragana and fullwidth Latin can be searched',()=>{
  for(const query of ['小栗帽','Oguri Cap','Ｏｇｕｒｉ','オグリ','おぐり'])assert.equal(searchCharacters(characters,query)[0].id,'oguri-cap');
  assert.equal(searchCharacters(characters,'皮皮船')[0].id,'gold-ship');
  assert.equal(searchCharacters(characters,'優秀素質')[0].id,'nice-nature');
  assert.equal(searchCharacters(characters,'北部玄驹')[0].names.en,'Kitasan Black');
  assert.equal(searchCharacters(characters,'no_such_runner').length,0);
});
test('Challenge allows only three submitted searches; empty input does not count, misses do',()=>{
  const session=new GameSession(base,'hard');
  assert.equal(session.query(characters,'  ').status,'empty');assert.equal(session.hardSearches,0);
  assert.equal(session.query(characters,'小栗帽').status,'ok');
  assert.equal(session.query(characters,'doesnotexist').status,'ok');
  assert.equal(session.query(characters,'オグリ').status,'ok');assert.equal(session.hardSearches,3);
  assert.equal(session.query(characters,'Oguri').status,'limit');
  session.setMode('easy');for(let i=0;i<10;i++)assert.equal(session.query(characters,'小栗帽').status,'ok');
  assert.equal(session.hardSearches,3);session.setMode('hard');assert.equal(session.query(characters,'Oguri').status,'limit');
});
test('changing a puzzle, its collection, or its answer script restarts the session',()=>{
  let time=1000;const session=new GameSession(base,'hard',()=>time);session.query(characters,'米浴');session.update({'2,9':'M'});
  time=9000;session.restart(advanced);assert.deepEqual(session.values,{});assert.equal(session.elapsed,0);assert.equal(session.hardSearches,0);assert.equal(session.mode,'hard');
  session.query(characters,'米浴');time=15000;session.restart(kana);assert.equal(session.elapsed,0);assert.equal(session.hardSearches,0);assert.equal(session.level.answerLanguage,'ja');
});
test('one wrong letter cannot finish; completion freezes the timer in both modes for every level',()=>{
  for(const level of levels)for(const mode of ['easy','hard']){
    let time=1000;const session=new GameSession(level,mode,()=>time), all=solution(level),key=Object.keys(all)[0];
    const wrong={...all,[key]:level.answerLanguage==='ja'?'ヲ':'Q'};if(wrong[key]===all[key])wrong[key]='Z';
    time=10000;session.update(wrong);assert.equal(session.completed,false);assert.equal(evaluate(level.entries,wrong).filledWords,22);
    time=15000;session.update({[key]:all[key]});assert.equal(session.completed,true);assert.equal(session.elapsed,14000);
    time=50000;session.setMode(mode==='easy'?'hard':'easy');assert.equal(session.elapsed,14000);assert.equal(session.finishedMode,mode);
  }
});
test('translations have identical complete key sets and all HTML keys resolve in every language',async()=>{
  const keys=Object.keys(messages['zh-CN']).sort();
  for(const lang of LANGUAGES){assert.deepEqual(Object.keys(messages[lang]).sort(),keys);for(const key of keys)assert.ok(translate(lang,key));}
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const [,key] of html.matchAll(/data-i18n="([^"]+)"/g))for(const lang of LANGUAGES)assert.ok(translate(lang,key));
  assert.equal(translate('en','searchRemaining',{n:2}),'Challenge · 2 / 3 searches remaining');
  assert.equal(formatTime(3600000),'1:00:00');
});

test('Assisted answer reveals leave the board untouched and the clock running for English and kana',()=>{
  for(const level of levels){
    let time=1000;const session=new GameSession(level,'easy',()=>time);
    const key=entryCells(level.entries[0])[0];session.update({[key]:'X'});
    const before={...session.values};time=5000;
    const result=session.reveal(level.entries[0].id);
    assert.equal(result.status,'ok');assert.equal(result.entry.answer,level.entries[0].answer);
    assert.deepEqual(session.values,before);assert.equal(session.completed,false);assert.equal(session.finishReason,null);
    time=9000;assert.equal(session.elapsed,8000);assert.equal(session.revealedEntries.size,1);
  }
});
test('Assisted can view every answer without filling the board or spending Challenge reveals',()=>{
  const session=new GameSession(base,'easy');
  for(const entry of base.entries)assert.equal(session.reveal(entry.id).status,'ok');
  assert.equal(session.revealedEntries.size,22);assert.equal(session.hardRevealedEntries.size,0);
  assert.deepEqual(session.values,{});assert.equal(session.completed,false);
  assert.equal(session.reveal(base.entries[0].id).reused,true);
  session.setMode('hard');
  for(const entry of base.entries.slice(0,3))assert.equal(session.reveal(entry.id).reused,false);
  assert.equal(session.hardRevealedEntries.size,3);assert.equal(session.reveal(base.entries[3].id).status,'limit');
  session.setMode('easy');assert.equal(session.reveal(base.entries[3].id).status,'ok');
  session.setMode('hard');assert.equal(session.reveal(base.entries[3].id).status,'limit');
  assert.equal(session.reveal(base.entries[0].id).reused,true);assert.equal(session.hardRevealedEntries.size,3);
  assert.equal(session.hardSearches,0);assert.equal(session.query(characters,'米浴').status,'ok');assert.equal(session.hardRevealedEntries.size,3);
  session.restart(advanced);assert.equal(session.revealedEntries.size,0);assert.equal(session.hardRevealedEntries.size,0);assert.equal(session.revealedCells.size,0);
});
test('invalid answer requests spend no allowance in either mode',()=>{
  for(const mode of ['easy','hard']){
    const session=new GameSession(base,mode);
    assert.equal(session.reveal('not-an-entry').status,'invalid');assert.equal(session.revealedEntries.size,0);assert.equal(session.hardRevealedEntries.size,0);
    assert.equal(session.completed,false);assert.deepEqual(session.values,{});
  }
});
test('ending either mode freezes time, reveals the whole solution, and is distinct from solving',()=>{
  for(const level of levels)for(const mode of ['easy','hard']){
    let time=1000;const session=new GameSession(level,mode,()=>time);session.update({[entryCells(level.entries[0])[0]]:'X'});
    time=9000;assert.equal(session.endAndReveal(),true);assert.equal(session.completed,true);
    assert.equal(session.finishReason,'revealed');assert.equal(session.finishedMode,mode);assert.deepEqual(session.values,solution(level));
    const frozen={...session.values};time=20000;assert.equal(session.elapsed,8000);
    assert.equal(session.update({[entryCells(level.entries[0])[0]]:'Z'}),false);assert.deepEqual(session.values,frozen);
    session.setMode('easy');assert.equal(session.elapsed,8000);assert.equal(session.reveal(level.entries[0].id).status,'finished');
    assert.equal(session.endAndReveal(),false);session.restart(level);assert.equal(session.finishReason,null);assert.equal(session.completed,false);
  }
});

test('Challenge reveals fill and lock only the chosen word, keep the timer running and hide other correct words',()=>{
  for(const level of levels){
    let time=1000;const session=new GameSession(level,'hard',()=>time),revealed=level.entries[0],other=level.entries.find((e)=>e.id!==revealed.id);
    session.update(Object.fromEntries(entryCells(other).map((key,i)=>[key,[...other.answer][i]])));
    time=9000;assert.equal(session.reveal(revealed.id).status,'ok');assert.equal(session.everAssisted,true);
    assert.equal(session.completed,false);time=12000;assert.equal(session.elapsed,11000);
    const feedback=feedbackFor(level.entries,session.values,'hard',session.hardRevealedEntries);
    assert.deepEqual([...feedback.solved],[revealed.id]);assert.deepEqual(feedback.greenCells,new Set(entryCells(revealed)));
    for(const key of entryCells(revealed)){const correct=session.values[key];session.update({[key]:'?'});assert.equal(session.values[key],correct);}
    session.setMode('easy');session.update({[entryCells(revealed)[0]]:''});session.setMode('hard');
    assert.ok(entryCells(revealed).every((key)=>session.values[key]));assert.equal(session.hardRevealedEntries.size,1);
  }
});

test('revealing the last missing word completes once and freezes the clock with help recorded',()=>{
  for(const level of levels){
    let time=0;const session=new GameSession(level,'hard',()=>time),entry=level.entries[0],values=solution(level);
    delete values[entryCells(entry)[0]];session.update(values);time=15000;
    assert.equal(session.reveal(entry.id).status,'ok');assert.equal(session.completed,true);assert.equal(session.finishReason,'solved');
    assert.equal(session.hardRevealedEntries.size,1);assert.equal(session.revealedEntries.size,1);assert.equal(session.everAssisted,true);
    time=30000;assert.equal(session.elapsed,15000);assert.equal(session.reveal(entry.id).status,'finished');
  }
});
test('normal completion stays a win and cannot subsequently be converted to an early ending',()=>{
  const session=new GameSession(base,'hard');session.update(solution(base));
  assert.equal(session.finishReason,'solved');assert.equal(session.endAndReveal(),false);assert.equal(session.finishReason,'solved');
});
