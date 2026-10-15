import { generatePuzzle } from './generator.js';
self.onmessage = ({ data }) => {
  try { const started = performance.now(); const puzzle = generatePuzzle({ ...data, onProgress:progress => { if (progress.attempt % 8 === 0) self.postMessage({progress}); } }); self.postMessage({puzzle, elapsedMs:performance.now() - started}); }
  catch (error) { self.postMessage({error:error.message}); }
};
