import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkData } from '../scripts/check-data.mjs';
import { parseOfficialRoster, compareOfficialRoster, validateRosterCoverage } from '../scripts/audit-roster.mjs';
import { validateClueBank } from '../src/clue-bank.js';
import { generatePuzzle } from '../src/generator.js';
import { normalizeAnswer, searchCharacters } from '../src/game.js';
import { randomPool } from '../worker/pool.generated.js';
import { validateRandomBoard } from '../worker/random-validation.js';
import { boardSubmission } from '../src/random-protocol.js';

const { bank, characters, roster } = await checkData();

test('both ordinary pools cover the reviewed main, supporting and original story rosters', () => {
  assert.equal(roster.officialCharacters.filter(r => r.kind === 'main').length, 145);
  assert.equal(roster.officialCharacters.filter(r => r.kind === 'support').length, 17);
  assert.equal(roster.storyCharacterIds.length, 36);
  assert.equal(characters.length, 198);
  for (const category of ['beginner', 'advanced']) {
    assert.equal(bank.records.filter(r => r.categories.includes(category)).length, 198);
    assert.deepEqual(new Set(randomPool.categories[category]), new Set(characters.map(c => c.id)));
  }
  assert.ok(characters.some(c => c.id === 'phalaenopsis'));
  assert.ok(characters.some(c => c.id === 'casino-drive'));
  assert.ok(!characters.some(c => c.names.ja === '樫本理子'));
  const incomplete = structuredClone(bank);
  incomplete.records.find(r => r.characterId === 'casino-drive').categories = ['advanced'];
  assert.throws(() => validateRosterCoverage(roster, characters, incomplete), /Incomplete beginner/);
});

test('expanded names work in both answer scripts, including punctuation and search aliases', () => {
  for (const c of characters) {
    assert.match(normalizeAnswer(c.names.en, 'en'), /^[A-Z]+$/);
    assert.match(normalizeAnswer(c.names.ja, 'ja'), /^[ァ-ヿー]+$/);
  }
  for (const [query, id] of [['防暴装束', 'blast-onepiece'], ['ブラストワンピース', 'blast-onepiece'],
    ['Blast Onepiece', 'blast-onepiece'], ['高尚骏逸', 'cheval-grand'], ['Rhein Kraft', 'line-craft']]) {
    assert.ok(searchCharacters(characters, query).some(c => c.id === id));
  }
});

test('all candidates appear across varied generated games and expanded boards pass server validation', () => {
  for (const answerLanguage of ['en', 'ja']) {
    const appeared = new Set();
    for (let seed = 1; seed <= 250; seed++) {
      const p = generatePuzzle({ bank, characters, difficulty: 'beginner', answerLanguage, boardSize: 'small', seed });
      p.entries.forEach(e => appeared.add(e.characterId));
      validateRandomBoard({ difficulty: p.difficulty, boardSize: p.boardSize, board: boardSubmission(p) }, randomPool);
    }
    assert.equal(appeared.size, 198, `Missing candidates in ${answerLanguage}`);
  }
});

test('fact keys, source schemes and dated horse-life clues are enforced', () => {
  const all = bank.records.flatMap(r => r.clues);
  assert.ok(all.length >= 900);
  assert.ok(all.filter(c => c.dimension === 'music').length >= 100);
  assert.equal(all.filter(c => c.dimension === 'official-program').length, 10);
  const life = all.filter(c => c.dimension === 'horse-life');
  assert.equal(life.length, 5);
  for (const c of life) {
    assert.ok(c.asOf <= c.verifiedAt);
    for (const text of Object.values(c.text)) assert.ok(text.includes(c.asOf.slice(0, 4)));
  }
  for (const mutate of [
    c => { delete c.asOf; }, c => { c.asOf = '2026-02-30'; },
    c => { c.asOf = '2027-01-01'; }, c => { c.verifiedAt = 'yesterday'; },
    c => { c.dimension = 'unreviewed'; }, c => { c.sources = ['javascript:alert(1)']; },
  ]) {
    const copy = structuredClone(bank), clue = copy.records.flatMap(r => r.clues).find(c => c.dimension === 'horse-life');
    mutate(clue); assert.throws(() => validateClueBank(copy, characters));
  }
  const copy = structuredClone(bank), r = copy.records.find(r => r.clues.some(c => c.factKey));
  const c = r.clues.find(c => c.factKey);
  r.clues.push({ ...c, id: 'different-id-same-fact' });
  assert.throws(() => validateClueBank(copy, characters), /Duplicate or invalid fact/);
});

test('official audit reports additions, removals and renamed entries without importing them', () => {
  const payload = [
    { id: 1, name: 2, en: 3, detail: 4, category: 5, cv: 7 },
    'sampleuma', 'サンプル', 'Sample Uma', 'ignored source text', [6], 'ウマ娘', '演者',
  ];
  const current = parseOfficialRoster(`<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`);
  assert.deepEqual(current, [{ officialId: 'sampleuma', nameJa: 'サンプル', nameEn: 'Sample Uma', voiceJa: '演者', category: 'ウマ娘' }]);
  const snapshot = { officialCharacters: [{ officialId: 'olduma', nameJa: '旧名' }], excluded: [] };
  assert.equal(compareOfficialRoster(current, snapshot).added.length, 1);
  assert.equal(compareOfficialRoster(current, snapshot).removed.length, 1);
  snapshot.officialCharacters = [{ officialId: 'sampleuma', nameJa: '旧名', nameEn: 'Old Name' }];
  assert.equal(compareOfficialRoster(current, snapshot).renamed.length, 1);
  assert.throws(() => parseOfficialRoster('<script>throw Error("do not execute")</script>'), /payload/);
  assert.throws(() => parseOfficialRoster('<script id="__NUXT_DATA__">[]</script>'), /Invalid/);
});

test('Japanese voice-actor clues use the spelling from the official roster', () => {
  const compact = text => text.normalize('NFKC').replace(/\s+/g, '');
  for (const row of roster.officialCharacters) {
    const record = bank.records.find(r => r.characterId === row.characterId);
    for (const clue of record.clues.filter(c => c.text.ja.includes('が演じる'))) {
      assert.ok(compact(clue.text.ja).includes(compact(row.voiceJa)), `Voice credit mismatch: ${clue.id}`);
    }
  }
});

test('race and music evidence is linked to real bank records, including historical grades', async () => {
  const races = JSON.parse(await readFile(new URL('../docs/evidence/race-results.json', import.meta.url)));
  const music = JSON.parse(await readFile(new URL('../docs/evidence/music-credits.json', import.meta.url)));
  const all = bank.records.flatMap(r => r.clues.map(c => ({ ...c, characterId: r.characterId })));
  for (const record of [...races.records, ...music.records]) {
    assert.ok(all.some(c => c.characterId === record.characterId && c.sources.includes(record.source)));
  }
  const sheema = all.find(c => c.characterId === 'stay-gold' && c.text.ja.includes('2001年ドバイシーマ'));
  assert.match(sheema.text.ja, /GⅡ/);
});
