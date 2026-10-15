import { normalizeAnswer, validateLevel, entryCells } from '../src/game.js';
import { CATEGORIES, SIZES } from '../src/generator.js';
export function validateRandomBoard({difficulty,boardSize,board},pool) {
  if(!CATEGORIES.includes(difficulty)||!SIZES[boardSize]||!board||!['en','ja'].includes(board.answerLanguage)||!Array.isArray(board.entries)||board.entries.length!==SIZES[boardSize]*2)throw new Error('Invalid random board settings');
  const maxEdge=boardSize==='small'?30:40;if(!board.grid||board.grid.rows>maxEdge||board.grid.columns>maxEdge)throw new Error('Board exceeds size limit');
  const allowed=new Set(pool.categories[difficulty]),characters=pool.characters;
  const names=new Map(characters.map(c=>[c.id,c]));
  const text={'zh-CN':'验证',en:'Validation',ja:'検証'};
  const level={schemaVersion:1,id:'random-validation',difficulty,answerLanguage:board.answerLanguage,title:text,description:text,grid:board.grid,
    entries:board.entries.map(e=>{if(!allowed.has(e.characterId))throw new Error('Character outside category');return {...e,id:`${e.number}-${e.direction}`,answer:normalizeAnswer(names.get(e.characterId).names[board.answerLanguage],board.answerLanguage),clues:text};})};
  if(new Set(level.entries.map(e=>e.characterId)).size!==level.entries.length||['across','down'].some(d=>level.entries.filter(e=>e.direction===d).length!==SIZES[boardSize]))throw new Error('Invalid word counts');
  validateLevel(level,characters);
  return Object.fromEntries(level.entries.flatMap(e=>entryCells(e).map((key,i)=>[key,[...e.answer][i]])));
}
