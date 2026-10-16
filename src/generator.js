import { normalizeAnswer, validateLevel } from './game.js';
import { selectPuzzleClues } from './clue-policy.js';

export const CATEGORIES = ['beginner', 'advanced', 'epithets', 'cinderella'];
export const SIZES = { small: 6, large: 10 };
export const GENERATOR_VERSION = 2;
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const shuffle = (items, random) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};
const key = (r, c) => `${r},${c}`;
function placements(word, direction, grid, placed, maxEdge) {
  const dr = direction === 'down' ? 1 : 0, dc = 1 - dr, candidates = [], seen = new Set();
  for (const [position, cell] of grid) {
    if (cell[direction]) continue;
    const [rr, cc] = position.split(',').map(Number);
    for (let cross = 0; cross < word.answer.length; cross++) {
      if (word.answer[cross] !== cell.letter) continue;
      const row = rr - dr * cross, column = cc - dc * cross, start = key(row, column);
      if (seen.has(start)) continue; seen.add(start);
      if (grid.has(key(row - dr, column - dc)) || grid.has(key(row + dr * word.answer.length, column + dc * word.answer.length))) continue;
      let intersections = 0, legal = true;
      for (let i = 0; i < word.answer.length; i++) {
        const r = row + dr * i, c = column + dc * i, existing = grid.get(key(r, c));
        if (existing) { if (existing.letter !== word.answer[i] || existing[direction]) { legal = false; break; } intersections++; }
        else if (grid.has(key(r - dc, c - dr)) || grid.has(key(r + dc, c + dr))) { legal = false; break; }
      }
      if (!legal || !intersections) continue;
      const minR = Math.min(row, ...placed.map(e => e.row)), minC = Math.min(column, ...placed.map(e => e.column));
      const maxR = Math.max(row + dr * (word.answer.length - 1), ...placed.map(e => e.row + (e.direction === 'down' ? e.answer.length - 1 : 0)));
      const maxC = Math.max(column + dc * (word.answer.length - 1), ...placed.map(e => e.column + (e.direction === 'across' ? e.answer.length - 1 : 0)));
      const height = maxR - minR + 1, width = maxC - minC + 1;
      if (height > maxEdge || width > maxEdge) continue;
      candidates.push({ ...word, row, column, direction, score: height * width + Math.abs(height - width) * 8 - intersections * 25 });
    }
  }
  return candidates;
}
function add(grid, entry) {
  for (let i = 0; i < entry.answer.length; i++) {
    const k = key(entry.row + (entry.direction === 'down' ? i : 0), entry.column + (entry.direction === 'across' ? i : 0));
    grid.set(k, { ...(grid.get(k) || { letter: entry.answer[i] }), [entry.direction]: true });
  }
}
export function generatePuzzle({ bank, characters, difficulty, answerLanguage, boardSize, seed, previousClues = {}, onProgress = () => {} }) {
  if (!CATEGORIES.includes(difficulty) || !['en', 'ja'].includes(answerLanguage) || !SIZES[boardSize] || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid generation settings');
  const random = seededRandom(seed), target = SIZES[boardSize], count = target * 2;
  const byId = new Map(characters.map(c => [c.id, c]));
  const pool = bank.records.filter(r => r.categories.includes(difficulty)).map(record => ({ characterId:record.characterId,
    answer:normalizeAnswer(byId.get(record.characterId).names[answerLanguage], answerLanguage), record }));
  if (pool.length < count) throw new Error('Not enough characters for this collection');
  // Bounded randomized restarts: sample the roster first, then search legal crossings.
  // Candidate scores prefer compact grids and multiple crossings. No disconnected fallback.
  for (let attempt = 0; attempt < 160; attempt++) {
    onProgress({ attempt, total:160 });
    const sampled = shuffle(pool, random).slice(0, count);
    for (let layoutTry = 0; layoutTry < 3; layoutTry++) {
      const order = shuffle(sampled, random), first = order.shift(), direction = random() < .5 ? 'across' : 'down';
      const placed = [{ ...first, row:0, column:0, direction }], grid = new Map(); add(grid, placed[0]);
      let remaining = order;
      while (remaining.length) {
        const counts = { across:placed.filter(e => e.direction === 'across').length, down:placed.filter(e => e.direction === 'down').length };
        let best = null;
        for (const word of remaining) for (const d of ['across', 'down']) {
          if (counts[d] >= target) continue;
          for (const candidate of placements(word, d, grid, placed, boardSize === 'small' ? 30 : 40)) {
            const score = candidate.score + (counts[d] - counts[d === 'across' ? 'down' : 'across']) * 8 + random() * 45;
            if (!best || score < best.score) best = { ...candidate, score };
          }
        }
        if (!best) break;
        placed.push(best); add(grid, best); remaining = remaining.filter(w => w.characterId !== best.characterId);
      }
      if (remaining.length) continue;
      const minR = Math.min(...placed.map(e => e.row)), minC = Math.min(...placed.map(e => e.column));
      const entries = placed.map(e => ({ ...e, row:e.row - minR, column:e.column - minC })).sort((a,b) => a.row - b.row || a.column - b.column || a.direction.localeCompare(b.direction));
      const rows = Math.max(...entries.map(e => e.row + (e.direction === 'down' ? e.answer.length : 1)));
      const columns = Math.max(...entries.map(e => e.column + (e.direction === 'across' ? e.answer.length : 1)));
      const layout = Array.from({length:rows}, () => Array(columns).fill('#'));
      const selectedClues = selectPuzzleClues(shuffle(entries, random), difficulty, previousClues, random);
      let number = 0, lastStart = '';
      const result = entries.map(e => {
        const start = key(e.row, e.column); if (start !== lastStart) { number++; lastStart = start; }
        const selected = selectedClues.get(e.characterId);
        for (let i = 0; i < e.answer.length; i++) layout[e.row + (e.direction === 'down' ? i : 0)][e.column + (e.direction === 'across' ? i : 0)] = '.';
        return { id:`${number}-${e.direction}`, number, direction:e.direction, row:e.row, column:e.column, characterId:e.characterId, answer:e.answer, clues:selected.text, clueId:selected.id };
      });
      const puzzle = { schemaVersion:1, id:`random-${difficulty}-${boardSize}-${answerLanguage}-${seed}`, random:true, generatorVersion:GENERATOR_VERSION,
        seed, boardSize, difficulty, answerLanguage, title:{'zh-CN':'随机棋盘',en:'Random crossword',ja:'ランダム問題'},
        description:{'zh-CN':'每局随机抽取角色与提示。',en:'New runners and clues each game.',ja:'毎回、ウマ娘とヒントをランダムに選びます。'},
        grid:{rows, columns, layout:layout.map(r => r.join(''))}, entries:result };
      validateLevel(puzzle, characters); return puzzle;
    }
  }
  throw new Error('Could not generate a connected crossword. Please try another seed.');
}
