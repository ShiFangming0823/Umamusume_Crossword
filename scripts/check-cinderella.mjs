const webSources = values => Array.isArray(values) && values.length > 0 && values.every(value => {
  try { return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
});
const sameMembers = (left, right) => Array.isArray(left) && left.length === right.length
  && new Set(left).size === left.length && left.every(value => right.includes(value));

// Identity and scene references are reviewed data, not proof that a plot claim is true.
export function validateCinderellaSources(catalog, evidence, characters, bank, roster) {
  if (catalog.schemaVersion !== 1 || evidence.schemaVersion !== 1
    || !/^\d{4}-\d{2}-\d{2}$/.test(catalog.verifiedAt)
    || evidence.verifiedAt !== catalog.verifiedAt || !webSources(catalog.sources)
    || !Array.isArray(catalog.characters) || !Array.isArray(catalog.excluded)
    || !Array.isArray(evidence.records)) throw new Error('Invalid Cinderella source catalog.');
  const eligible = bank.records.filter(record => record.categories.includes('cinderella'));
  if (!sameMembers(catalog.characters.map(row => row.characterId), eligible.map(row => row.characterId))) {
    throw new Error('Cinderella roster coverage mismatch.');
  }
  const mainIds = new Set(roster.officialCharacters.filter(row => row.kind === 'main').map(row => row.characterId));
  const clueIds = new Set();
  for (const row of catalog.characters) {
    const character = characters.find(character => character.id === row.characterId);
    const record = eligible.find(record => record.characterId === row.characterId);
    const clues = record.clues.filter(clue => clue.categories.includes('cinderella'));
    if (!character || character.names.ja !== row.nameJa || !webSources(row.sources)
      || (row.kind !== 'main' && row.kind !== 'original')
      || (row.kind === 'main') !== mainIds.has(row.characterId)
      || (row.kind === 'original' && !roster.storyCharacterIds.includes(row.characterId))
      || !sameMembers(row.clueIds, clues.map(clue => clue.id))) throw new Error('Cinderella identity mismatch.');
    for (const clue of clues) {
      if (clue.dimension !== 'story' || !clue.factKey?.startsWith('cinderella-')
        || clue.verifiedAt !== catalog.verifiedAt) throw new Error(`Cinderella story metadata required: ${clue.id}`);
      clueIds.add(clue.id);
    }
  }
  if (!sameMembers(evidence.records.map(row => row.clueId), [...clueIds])) throw new Error('Cinderella scene coverage mismatch.');
  for (const row of evidence.records) {
    const record = eligible.find(record => record.characterId === row.characterId);
    const clue = record?.clues.find(clue => clue.id === row.clueId && clue.categories.includes('cinderella'));
    if (!clue || !['anime', 'manga', 'anime-profile'].includes(row.scene?.medium)
      || typeof row.scene.reference !== 'string' || !row.scene.reference.trim()
      || !webSources(row.sources) || !sameMembers(row.sources, clue.sources)) throw new Error(`Cinderella scene/source mismatch: ${row.clueId}`);
  }
  for (const row of catalog.excluded) {
    if (!row.nameEn || !row.reason || !webSources([row.source])) throw new Error('Invalid Cinderella exclusion.');
  }
  return catalog;
}
