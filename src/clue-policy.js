export const BEGINNER_AUXILIARY_LIMIT = 3;
export const isBeginnerAuxiliary = clue => ['horse-record', 'music'].includes(clue.dimension);
export const isBeginnerPrimary = clue => ['profile', 'story'].includes(clue.dimension);

// Entries arrive in shuffled order so the shared quota does not favor early clue numbers.
export function selectPuzzleClues(entries, difficulty, previousClues, random) {
  const selected = new Map();
  let auxiliaryCount = 0;
  for (const entry of entries) {
    const eligible = entry.record.clues.filter(clue => clue.categories.includes(difficulty)
      && (difficulty !== 'beginner' || auxiliaryCount < BEGINNER_AUXILIARY_LIMIT || !isBeginnerAuxiliary(clue)));
    const fresh = eligible.filter(clue => clue.id !== previousClues[entry.characterId]);
    const choices = fresh.length ? fresh : eligible;
    if (!choices.length) throw new Error(`No eligible ${difficulty} clue for ${entry.characterId}`);
    const weight = clue => difficulty === 'beginner' ? (isBeginnerPrimary(clue) ? 6 : 1)
      : difficulty === 'advanced' ? (clue.dimension === 'horse-record' ? 3 : 1) : 1;
    let draw = random() * choices.reduce((sum, clue) => sum + weight(clue), 0), choice = choices.at(-1);
    for (const clue of choices) { draw -= weight(clue); if (draw < 0) { choice = clue; break; } }
    selected.set(entry.characterId, choice);
    if (isBeginnerAuxiliary(choice)) auxiliaryCount++;
  }
  return selected;
}
