import { boardSubmission } from './random-protocol.js';
import { MAX_RUN_MS, levelRevision } from './analytics-protocol.js';

const PREFIX = 'tracen-stats-pending-v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AnalyticsClient {
  constructor({ apiBaseUrl = '', fetcher = globalThis.fetch?.bind(globalThis), storage = null,
    now = Date.now, uuid = () => crypto.randomUUID(), onChange = () => {}, enabled = true } = {}) {
    this.base = apiBaseUrl.replace(/\/$/, ''); this.enabled = enabled && Boolean(this.base);
    this.fetcher = fetcher; this.storage = storage; this.now = now; this.uuid = uuid; this.onChange = onChange;
    this.pending = new Map(); this.cache = new Map(); this.reads = new Map(); this.epochs = new Map(); this.busy = null; this.retry = null; this.failures = 0; this.flushAgain = false;
    if (this.enabled) this.restore();
  }
  restore() {
    try {
      const keys = Array.from({ length: this.storage?.length || 0 }, (_, i) => this.storage.key(i)).filter((key) => key?.startsWith(PREFIX));
      for (const key of keys) {
        try {
          const record = JSON.parse(this.storage.getItem(key));
          if (UUID.test(record?.runId) && key === PREFIX + record.runId && record.createdAt >= this.now() - MAX_RUN_MS && this.pending.size < 50) this.pending.set(record.runId, record);
          else this.storage.removeItem(key);
        } catch { this.storage.removeItem(key); }
      }
    } catch { /* Storage is optional; play must not depend on it. */ }
  }
  persist(record, remove = false) {
    try { if (remove) this.storage?.removeItem(PREFIX + record.runId); else this.storage?.setItem(PREFIX + record.runId, JSON.stringify(record)); } catch { /* Best effort outbox. */ }
  }
  begin(session) {
    if (!this.enabled) return null;
    if(session.level.random){
      const record={protocol:2,runId:this.uuid(),difficulty:session.level.difficulty,boardSize:session.level.boardSize,board:boardSubmission(session.level),createdAt:this.now(),startSent:false,finish:null};
      this.pending.set(record.runId,record);this.persist(record);void this.flush();return{record,ready:Promise.resolve(record)};
    }
    const record = { runId: this.uuid(), levelId: session.level.id, startMode: session.mode,
      createdAt: this.now(), startSent: false, finish: null, revision: null };
    const handle = { record, ready: levelRevision(session.level).then((revision) => {
      record.revision = revision; this.pending.set(record.runId, record); this.persist(record); void this.flush(); return record;
    }).catch(() => null) };
    return handle;
  }
  end(handle, session) {
    if (!handle || !session.completed || !['solved', 'revealed'].includes(session.finishReason) || handle.ended) return Promise.resolve();
    handle.ended = true;
    // Snapshot before a new game can replace the current session.
    const finish = { outcome: session.finishReason, elapsedMs: Math.round(session.elapsed), finishedMode: session.finishedMode,
      everAssisted: session.everAssisted, lookupCount: session.lookupCount, revealCount: session.revealedEntries.size };
    if(handle.record.protocol===2){delete finish.finishedMode;delete finish.everAssisted;delete finish.lookupCount;delete finish.revealCount;}
    if (finish.outcome === 'solved') finish.values = { ...session.values };
    return handle.ready.then((record) => {
      if (!record) return;
      record.finish = finish; this.pending.set(record.runId, record); this.persist(record); return this.flush();
    });
  }
  async request(path, body) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetcher(`${this.base}${path}`, { method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit', cache: 'no-store', signal: controller.signal, keepalive: Boolean(body) });
      if (!response.ok) { const error = new Error(`Statistics HTTP ${response.status}`); error.permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status); throw error; }
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  flush() {
    if (!this.enabled) return Promise.resolve();
    if (this.busy) { this.flushAgain = true; return this.busy; }
    clearTimeout(this.retry); this.retry = null;
    this.busy = this.drain().finally(() => { this.busy = null; if (this.flushAgain) { this.flushAgain = false; void this.flush(); } });
    return this.busy;
  }
  async drain() {
    let retryNeeded = false;
    for (const record of this.pending.values()) {
      if (this.now() - record.createdAt > MAX_RUN_MS) { this.pending.delete(record.runId); this.persist(record, true); continue; }
      try {
        if (!record.startSent) {
          await this.request(record.protocol===2?'/api/v2/runs/start':'/api/runs/start',record.protocol===2?{runId:record.runId,difficulty:record.difficulty,boardSize:record.boardSize,board:record.board}:{runId:record.runId,levelId:record.levelId,revision:record.revision,startMode:record.startMode});
          record.startSent = true; this.persist(record);
          this.invalidate(record);
        }
        if (record.finish) {
          await this.request(record.protocol===2?'/api/v2/runs/finish':'/api/runs/finish',record.protocol===2?{runId:record.runId,difficulty:record.difficulty,boardSize:record.boardSize,...record.finish}:{runId:record.runId,levelId:record.levelId,revision:record.revision,...record.finish});
          this.invalidate(record);
        }
        this.pending.delete(record.runId); this.persist(record, true);
      } catch (error) {
        if (error.permanent) { this.pending.delete(record.runId); this.persist(record, true); }
        else { retryNeeded = true; break; }
      }
    }
    if (retryNeeded) {
      this.retry = setTimeout(() => { this.retry = null; void this.flush(); }, Math.min(60000, 2000 * 2 ** Math.min(this.failures++, 5)));
      this.retry.unref?.();
    } else this.failures = 0;
  }
  invalidate(record) {
    const key=record.protocol===2?`random:${record.difficulty}:${record.boardSize}`:`${record.levelId}:${record.revision}`;
    this.cache.delete(key); this.reads.delete(key); this.epochs.set(key,(this.epochs.get(key) || 0) + 1); this.onChange(record.levelId);
  }
  async stats(level, force = false) {
    if (!this.enabled) return { status: 'disabled' };
    try {
      const random=Boolean(level.random),revision=random?'':await levelRevision(level),key=random?`random:${level.difficulty}:${level.boardSize}`:`${level.id}:${revision}`,cached=this.cache.get(key);
      if (!force && cached && this.now() - cached.at < 30000) return { status: 'ok', ...cached.data };
      if (!this.reads.has(key)) {
        const epoch = this.epochs.get(key) || 0;
        const pending = this.request(random?`/api/v2/stats?difficulty=${encodeURIComponent(level.difficulty)}&boardSize=${encodeURIComponent(level.boardSize)}`:`/api/stats?levelId=${encodeURIComponent(level.id)}&revision=${revision}`).then((data) => {
          if (!Number.isSafeInteger(data.starts) || !Number.isSafeInteger(data.solved) || data.solved > data.starts ||
              (!random&&(!Number.isSafeInteger(data.challengeSolved)||data.challengeSolved>data.solved)) || data.starts<0 || data.solved<0 ||
              !(data.averageMs === null || (Number.isFinite(data.averageMs)&&data.averageMs>=0)) || (!random&&!(data.challengeAverageMs === null || Number.isFinite(data.challengeAverageMs))) || (random&&(data.difficulty!==level.difficulty||data.boardSize!==level.boardSize))) throw new Error('Invalid statistics response');
          if ((this.epochs.get(key) || 0) === epoch) this.cache.set(key, { at: this.now(), data }); return data;
        }).finally(() => { if (this.reads.get(key) === pending) this.reads.delete(key); });
        this.reads.set(key, pending);
      }
      return { status: 'ok', ...await this.reads.get(key) };
    } catch { return { status: 'error' }; }
  }
  dispose() { clearTimeout(this.retry); }
}
