import { supportedLevels } from './levels.generated.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_LIMIT = 32768;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function need(condition, message, status = 400) { if (!condition) throw new HttpError(status, message); }
function levelFor(levelId, revision) {
  const level = supportedLevels.find((level) => level.id === levelId && level.revision === revision);
  need(level, 'Unknown level or revision', 422); return level;
}
async function readBody(request) {
  need(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json', 'Expected application/json', 415);
  need(Number(request.headers.get('Content-Length') || 0) <= BODY_LIMIT, 'Request too large', 413);
  const reader = request.body?.getReader(); need(reader, 'Missing JSON body');
  let size = 0, chunks = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > BODY_LIMIT) { await reader.cancel(); throw new HttpError(413, 'Request too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid JSON'); }
  need(isObject(data), 'Expected a JSON object'); return data;
}
export function validateFinish(data, level) {
  need(['solved', 'revealed'].includes(data.outcome), 'Invalid outcome');
  need(integer(data.elapsedMs, MAX_MS), 'Invalid elapsed time');
  need(['easy', 'hard'].includes(data.finishedMode), 'Invalid finished mode');
  need(typeof data.everAssisted === 'boolean', 'Invalid assistance flag');
  need(integer(data.lookupCount, 100000) && integer(data.revealCount, level.entryCount), 'Invalid help counts');
  need(data.everAssisted || (data.finishedMode === 'hard' && data.revealCount === 0 && data.lookupCount <= 3), 'Inconsistent challenge record');
  if (data.outcome === 'solved') {
    need(isObject(data.values) && Object.keys(data.values).length === Object.keys(level.solution).length &&
      Object.entries(level.solution).every(([key, letter]) => data.values[key] === letter), 'Board is not solved', 422);
  }
}
async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    await env.DB.prepare('SELECT 1 AS ready').first(); return { ok: true, version: 1 };
  }
  if (request.method === 'GET' && url.pathname === '/api/stats') {
    const level = levelFor(url.searchParams.get('levelId'), url.searchParams.get('revision'));
    const row = await env.DB.prepare('SELECT * FROM level_stats WHERE level_id = ? AND revision = ?').bind(level.id, level.revision).first();
    const starts = row?.starts || 0, solved = row?.solved || 0, challengeSolved = row?.challenge_solved || 0;
    return { levelId: level.id, revision: level.revision, starts, solved,
      averageMs: solved ? Math.round(row.elapsed_total_ms / solved) : null, challengeSolved,
      challengeAverageMs: challengeSolved ? Math.round(row.challenge_elapsed_ms / challengeSolved) : null };
  }
  need(request.method === 'POST' && ['/api/runs/start', '/api/runs/finish'].includes(url.pathname), 'Not found', 404);
  const data = await readBody(request); need(UUID.test(data.runId), 'Invalid run ID');
  const level = levelFor(data.levelId, data.revision);
  if (url.pathname === '/api/runs/start') {
    need(['easy', 'hard'].includes(data.startMode), 'Invalid start mode');
    await env.DB.prepare(`INSERT INTO game_runs(run_id, level_id, revision, start_mode, started_at, ever_assisted)
      VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING`).bind(data.runId, level.id, level.revision, data.startMode, Date.now(), Number(data.startMode === 'easy')).run();
    const existing = await env.DB.prepare('SELECT level_id, revision, start_mode FROM game_runs WHERE run_id = ?').bind(data.runId).first();
    need(existing && existing.level_id === level.id && existing.revision === level.revision && existing.start_mode === data.startMode, 'Run ID conflict', 409);
    return { ok: true };
  }
  validateFinish(data, level);
  const run = await env.DB.prepare('SELECT level_id, revision, start_mode, status FROM game_runs WHERE run_id = ?').bind(data.runId).first();
  need(run && run.level_id === level.id && run.revision === level.revision, 'Start this run first', 409);
  need(run.start_mode !== 'easy' || data.everAssisted, 'Assistance history cannot be removed');
  if (run.status !== 'active') { need(run.status === data.outcome, 'Run has already ended', 409); return { ok: true, duplicate: true }; }
  await env.DB.prepare(`UPDATE game_runs SET status = ?, finished_at = ?, elapsed_ms = ?, finished_mode = ?,
    ever_assisted = ?, lookup_count = ?, reveal_count = ? WHERE run_id = ? AND status = 'active'`)
    .bind(data.outcome, Date.now(), data.elapsedMs, data.finishedMode, Number(data.everAssisted), data.lookupCount, data.revealCount, data.runId).run();
  return { ok: true };
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || 'https://umamusume-crossword.pages.dev').split(',').map((value) => value.trim()).filter(Boolean);
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' };
    if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if ((origin && !allowed.includes(origin)) || (!origin && !['GET', 'HEAD'].includes(request.method))) return reply({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    try { return reply(await route(request, env)); }
    catch (error) { return reply({ error: error instanceof HttpError ? error.message : 'Statistics temporarily unavailable' }, error instanceof HttpError ? error.status : 503); }
  },
};
