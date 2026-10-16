import { CATEGORIES, SIZES } from './generator.js';
import { LANGUAGES } from './game.js';
import { isBeginnerPrimary } from './clue-policy.js';
export const CLUE_DIMENSIONS = ['profile', 'horse-record', 'story', 'epithet', 'music', 'horse-life', 'official-program'];
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const sourceURL = value => {
  try { return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
};
export function validateClueBank(bank, characters) {
  if(bank.schemaVersion!==1||!Array.isArray(bank.records))throw new Error('Invalid clue bank');
  const known=new Set(characters.map(c=>c.id)),seen=new Set(),ids=new Set(),texts=new Map();
  const unknown = [...new Set(bank.records.filter(record => !known.has(record.characterId)).map(record => record.characterId))];
  if (unknown.length) throw new Error(`Unknown clue-bank character(s): ${unknown.join(', ')}. Each characterId in data/clues.json must exist in data/characters.json.`);
  for(const record of bank.records){
    if(seen.has(record.characterId))throw new Error(`Duplicate clue-bank character: ${record.characterId}`);seen.add(record.characterId);
    if(!record.categories?.length||record.categories.some(c=>!CATEGORIES.includes(c))||!record.clues?.length)throw new Error('Invalid clue-bank categories');
    const facts = new Set();
    for(const clue of record.clues){
      if(!clue.id||ids.has(clue.id)||!CLUE_DIMENSIONS.includes(clue.dimension)||(!clue.sources?.length||clue.sources.some(s=>!sourceURL(s)))||!clue.categories?.length||clue.categories.some(c=>!record.categories.includes(c)))throw new Error(`Invalid clue: ${clue.id}`);ids.add(clue.id);
      if (clue.factKey !== undefined) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(clue.factKey) || facts.has(clue.factKey)) throw new Error(`Duplicate or invalid fact: ${clue.id}`);
        facts.add(clue.factKey);
      }
      if (clue.verifiedAt !== undefined && !validDate(clue.verifiedAt)) throw new Error(`Invalid verification date: ${clue.id}`);
      if (clue.asOf !== undefined && (!validDate(clue.asOf) || !validDate(clue.verifiedAt) || clue.asOf > clue.verifiedAt)) throw new Error(`Invalid reference date: ${clue.id}`);
      if (clue.dimension === 'horse-life' && !clue.asOf) throw new Error(`Dated horse-life clue required: ${clue.id}`);
      for(const lang of LANGUAGES){
        if(typeof clue.text?.[lang]!=='string'||!clue.text[lang].trim())throw new Error(`Missing clue translation: ${clue.id}/${lang}`);
        for(const c of clue.categories){const key=`${c}:${lang}:${clue.text[lang].trim()}`,previous=texts.get(key);if(previous&&previous!==record.characterId)throw new Error(`Ambiguous duplicate clue: ${clue.id}`);texts.set(key,record.characterId);}
      }
    }
    for(const c of record.categories)if(record.clues.filter(h=>h.categories.includes(c)).length<(c==='epithets'?1:2))throw new Error('Insufficient clue variety');
    if (record.categories.includes('beginner') && !record.clues.some(clue => clue.categories.includes('beginner') && isBeginnerPrimary(clue))) {
      throw new Error(`Beginner profile or story clue required: ${record.characterId}`);
    }
  }
  for(const c of CATEGORIES)if(bank.records.filter(r=>r.categories.includes(c)).length<SIZES.large*2)throw new Error(`Not enough candidates: ${c}`);
  return bank;
}
