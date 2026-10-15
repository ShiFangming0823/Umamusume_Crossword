import { CATEGORIES, SIZES } from './generator.js';
import { LANGUAGES } from './game.js';
export function validateClueBank(bank, characters) {
  if(bank.schemaVersion!==1||!Array.isArray(bank.records))throw new Error('Invalid clue bank');
  const known=new Set(characters.map(c=>c.id)),seen=new Set(),ids=new Set(),texts=new Map();
  for(const record of bank.records){
    if(!known.has(record.characterId)||seen.has(record.characterId))throw new Error('Unknown or duplicate clue-bank character');seen.add(record.characterId);
    if(!record.categories?.length||record.categories.some(c=>!CATEGORIES.includes(c))||!record.clues?.length)throw new Error('Invalid clue-bank categories');
    for(const clue of record.clues){
      if(!clue.id||ids.has(clue.id)||!clue.dimension||(!clue.sources?.length||clue.sources.some(s=>typeof s!=='string'||!s.trim()))||!clue.categories?.length||clue.categories.some(c=>!record.categories.includes(c)))throw new Error(`Invalid clue: ${clue.id}`);ids.add(clue.id);
      for(const lang of LANGUAGES){
        if(typeof clue.text?.[lang]!=='string'||!clue.text[lang].trim())throw new Error(`Missing clue translation: ${clue.id}/${lang}`);
        for(const c of clue.categories){const key=`${c}:${lang}:${clue.text[lang].trim()}`,previous=texts.get(key);if(previous&&previous!==record.characterId)throw new Error(`Ambiguous duplicate clue: ${clue.id}`);texts.set(key,record.characterId);}
      }
    }
    for(const c of record.categories)if(record.clues.filter(h=>h.categories.includes(c)).length<(c==='epithets'?1:2))throw new Error('Insufficient clue variety');
  }
  for(const c of CATEGORIES)if(bank.records.filter(r=>r.categories.includes(c)).length<SIZES.large*2)throw new Error(`Not enough candidates: ${c}`);
  return bank;
}
