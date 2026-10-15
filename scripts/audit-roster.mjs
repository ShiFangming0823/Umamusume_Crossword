import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Read only the public JSON payload. Never execute scripts from a source page.
export function parseOfficialRoster(html) {
  const payload = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!payload) throw new Error('Official roster payload not found; review the site format.');
  const values = JSON.parse(payload[1]);
  if (!Array.isArray(values)) throw new Error('Unexpected official roster format.');
  const entries = values.filter(value => value && typeof value === 'object' && !Array.isArray(value)
    && ['id', 'name', 'en', 'cv', 'detail', 'category'].every(key => Object.hasOwn(value, key)))
    .map(value => ({
      officialId: values[value.id], nameJa: values[value.name], nameEn: values[value.en], voiceJa: values[value.cv],
      category: values[values[value.category]?.[0]],
    }));
  if (!entries.length || entries.some(entry => !/^[a-z0-9]+$/.test(entry.officialId)
    || typeof entry.nameJa !== 'string' || typeof entry.nameEn !== 'string'
    || typeof entry.voiceJa !== 'string' || typeof entry.category !== 'string') || new Set(entries.map(e => e.officialId)).size !== entries.length) {
    throw new Error('Invalid or duplicate official roster entries.');
  }
  return entries;
}

export function compareOfficialRoster(current, snapshot) {
  const reviewed = [...snapshot.officialCharacters, ...snapshot.excluded];
  return {
    added: current.filter(entry => !reviewed.some(row => row.officialId === entry.officialId)),
    removed: reviewed.filter(row => !current.some(entry => entry.officialId === row.officialId)),
    renamed: reviewed.flatMap(row => {
      const entry = current.find(entry => entry.officialId === row.officialId);
      return entry && (entry.nameJa !== row.nameJa || (row.nameEn && entry.nameEn !== row.nameEn))
        ? [{ officialId: row.officialId, previousJa: row.nameJa, previousEn: row.nameEn, ...entry }] : [];
    }),
    updatedVoices: snapshot.officialCharacters.filter(row => current.some(entry => entry.officialId === row.officialId && entry.voiceJa !== row.voiceJa)),
    categoryChanges: reviewed.filter(row => current.some(entry => entry.officialId === row.officialId
      && (entry.category === 'ウマ娘') !== (row.kind === 'main'))),
  };
}

export function validateRosterCoverage(snapshot, characters, bank) {
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (snapshot.schemaVersion !== 1 || !validDate(snapshot.verifiedAt)
    || snapshot.source !== 'https://umamusume.jp/character'
    || !Array.isArray(snapshot.officialCharacters) || !Array.isArray(snapshot.storyCharacterIds)
    || !Array.isArray(snapshot.excluded)) throw new Error('Invalid roster snapshot.');
  const officialIds = new Set(), ids = new Set();
  for (const row of snapshot.officialCharacters) {
    if (!/^[a-z0-9]+$/.test(row.officialId) || officialIds.has(row.officialId)
      || ids.has(row.characterId) || !['main', 'support'].includes(row.kind)
      || row.source !== `https://umamusume.jp/character/${row.officialId}`) throw new Error('Invalid roster member.');
    officialIds.add(row.officialId); ids.add(row.characterId);
    const character = characters.find(character => character.id === row.characterId);
    if (!character || character.names.ja !== row.nameJa
      || ![character.names.en, ...character.aliases].includes(row.nameEn) || !row.voiceJa) throw new Error('Roster name mismatch.');
  }
  for (const id of snapshot.storyCharacterIds) {
    if (ids.has(id) || !characters.some(c => c.id === id)
      || !bank.records.some(r => r.characterId === id && r.categories.includes('cinderella'))) throw new Error('Invalid story roster member.');
    ids.add(id);
  }
  for (const row of snapshot.excluded) {
    if (!/^[a-z0-9]+$/.test(row.officialId) || officialIds.has(row.officialId)
      || !row.nameJa || !row.reason) throw new Error('Invalid roster exclusion.');
    officialIds.add(row.officialId);
  }
  if (characters.length !== ids.size || characters.some(c => !ids.has(c.id))) throw new Error('Unclassified roster member.');
  for (const category of ['beginner', 'advanced']) {
    const candidates = bank.records.filter(r => r.categories.includes(category));
    if (candidates.length !== ids.size || candidates.some(r => !ids.has(r.characterId))) throw new Error(`Incomplete ${category} roster.`);
  }
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const snapshot = JSON.parse(await readFile(new URL('../data/roster.json', import.meta.url), 'utf8'));
  const response = await fetch(snapshot.source, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Cannot audit official roster: ${response.status}`);
  const current = parseOfficialRoster(await response.text());
  const result = compareOfficialRoster(current, snapshot);
  console.log(JSON.stringify({ snapshotDate: snapshot.verifiedAt, officialEntries: current.length, ...result }, null, 2));
  // A changed name or new face needs sourced clues and human review, never automatic publication.
  if (Object.values(result).some(list => list.length)) process.exitCode = 1;
}
