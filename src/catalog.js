import { validateCharacters, validateLevel } from './game.js';
import { validateClueBank } from './clue-bank.js';
async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cannot load ${url.pathname}: ${response.status}`);
  return response.json();
}
export async function loadCatalog() {
  const root = new URL('../data/', import.meta.url);
  const [registry, bank] = await Promise.all([getJSON(new URL('characters.json', root)), getJSON(new URL('clues.json', root))]);
  validateCharacters(registry);
  validateClueBank(bank,registry.characters);
  return {bank,characters:registry.characters};
}
// Historical fixed grids remain available to maintenance tools and regression fixtures.
export async function loadLegacyCatalog() {
  const root = new URL('../data/', import.meta.url);
  const [registry, manifest] = await Promise.all([getJSON(new URL('characters.json', root)), getJSON(new URL('levels/index.json', root))]);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.levels)) throw new Error('Invalid level manifest');
  const ids = new Set();
  const levels = await Promise.all(manifest.levels.filter((e) => e.enabled !== false).map(async (entry) => {
    if (!/^[a-z0-9-]+\.json$/.test(entry.file) || ids.has(entry.id)) throw new Error('Invalid level manifest entry');
    ids.add(entry.id);
    const level = await getJSON(new URL(`levels/${entry.file}`, root));
    if (level.id !== entry.id) throw new Error('Level id does not match manifest');
    return validateLevel(level, registry.characters);
  }));
  if (!levels.length) throw new Error('No enabled levels');
  return { levels, characters: registry.characters };
}
