import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClueBank } from '../src/clue-bank.js';

test('missing character references list every affected ID and the files to repair', () => {
  const bank = { schemaVersion: 1, records: [
    { characterId: 'deleted-runner-a' }, { characterId: 'deleted-runner-b' }, { characterId: 'deleted-runner-a' },
  ] };
  assert.throws(() => validateClueBank(bank, []), error => {
    assert.match(error.message, /Unknown clue-bank character\(s\): deleted-runner-a, deleted-runner-b\./);
    assert.match(error.message, /data\/clues\.json/);
    assert.match(error.message, /data\/characters\.json/);
    return true;
  });
});

test('duplicate character records identify the duplicated ID separately from missing names', () => {
  const record = { characterId: 'runner', categories: ['epithets'], clues: [{
    id: 'runner-title', categories: ['epithets'], dimension: 'epithet',
    text: { 'zh-CN': '独有称号', en: 'Unique title', ja: '固有の二つ名' }, sources: ['https://example.com/title'],
  }] };
  assert.throws(() => validateClueBank({ schemaVersion: 1, records: [record, record] }, [{ id: 'runner' }]),
    /Duplicate clue-bank character: runner/);
});
