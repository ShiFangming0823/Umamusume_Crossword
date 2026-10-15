import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { validateCharacters, validateLevel } from '../src/game.js';
import { validateClueBank } from '../src/clue-bank.js';
const root = new URL('../data/', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));
export async function checkData() {
  const registry = validateCharacters(await read('characters.json'));
  const bank = validateClueBank(await read('clues.json'),registry.characters);
  const manifest = await read('levels/index.json');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.levels) || !manifest.levels.length) throw new Error('Invalid level manifest');
  const seen = new Set(), levels = [];
  for (const item of manifest.levels) {
    if (!/^[a-z0-9-]+\.json$/.test(item.file) || seen.has(item.id)) throw new Error('Invalid or duplicate manifest entry');
    seen.add(item.id);
    const level = validateLevel(await read(`levels/${item.file}`), registry.characters);
    if (level.id !== item.id) throw new Error('Manifest id mismatch');
    levels.push(level);
  }
  for (const english of levels.filter((level) => level.answerLanguage === 'en')) {
    const kana = levels.find((level) => level.id === english.id.replace(/-en$/, '-kana'));
    if (!kana) continue;
    const roster = (level) => level.entries.map((entry) => entry.characterId).sort().join(',');
    if (kana.answerLanguage !== 'ja' || kana.difficulty !== english.difficulty || roster(kana) !== roster(english)) throw new Error(`Paired puzzle mismatch: ${english.id}`);
  }
  const epithets = await read('epithets.json');
  if (epithets.schemaVersion !== 1 || !epithets.source?.url || !Array.isArray(epithets.records)) throw new Error('Invalid epithet source catalog');
  const names = new Set();
  for (const row of epithets.records) {
    if (!row.characterJa || names.has(row.characterJa)) throw new Error('Missing or duplicate epithet character');
    names.add(row.characterJa);
    if (row.usable !== Boolean(row.gameEpithetJa || row.towelEpithetJa)) throw new Error('Invalid epithet availability');
  }
  for (const level of levels.filter((level) => level.difficulty === 'epithets')) for (const entry of level.entries) {
    const row = epithets.records.find((row) => row.characterId === entry.characterId);
    if (!row?.usable) throw new Error(`Missing epithet source: ${entry.characterId}`);
    const japaneseClue = [row.gameEpithetJa && `二つ名：${row.gameEpithetJa}`, row.towelEpithetJa && `タオルの二つ名：${row.towelEpithetJa}`].filter(Boolean).join('\n');
    if (entry.clues.ja !== japaneseClue || ['zh-CN', 'en', 'ja'].some((lang) => entry.clues[lang] !== row.clues?.[lang])) throw new Error(`Epithet clue/source mismatch: ${entry.characterId}`);
  }
  const cinderella = await read('cinderella-gray.json');
  if (cinderella.schemaVersion !== 1 || !Array.isArray(cinderella.entries)) throw new Error('Invalid Cinderella Gray source catalog');
  for (const level of levels.filter((level) => level.difficulty === 'cinderella')) for (const entry of level.entries) {
    const row = cinderella.entries.find((row) => row.characterId === entry.characterId);
    if (!row?.scene || !row.sources?.length || ['zh-CN', 'en', 'ja'].some((lang) => entry.clues[lang] !== row.clues?.[lang])) throw new Error(`Cinderella clue/source mismatch: ${entry.characterId}`);
    const character = registry.characters.find((character) => character.id === entry.characterId);
    if (['zh-CN', 'en', 'ja'].some((lang) => character.names[lang] !== row.names?.[lang])) throw new Error(`Cinderella name/source mismatch: ${entry.characterId}`);
  }
  return { characters:registry.characters,levels,manifest,bank };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {characters,levels,bank} = await checkData();
  console.log(`Validated ${characters.length} characters, ${bank.records.reduce((n,r)=>n+r.clues.length,0)} trilingual random clues and ${levels.length} legacy grids.`);
}
