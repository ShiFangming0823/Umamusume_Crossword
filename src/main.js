import { loadCatalog } from './catalog.js';
import { SIZES } from './generator.js';
import { downloadPuzzle } from './export.js';
import { GameSession, cellKey, entryCells, normalizeAnswer, feedbackFor, formatTime, LANGUAGES } from './game.js';
import { translate } from './i18n.js';
import { AnalyticsClient } from './analytics.js';
import { analyticsConfig } from './analytics-config.js';

const $ = (id) => document.getElementById(id);
let language = 'zh-CN';
try { const saved = localStorage.getItem('tracen-ui-language'); if (LANGUAGES.includes(saved)) language = saved; } catch { /* Private storage may be unavailable. */ }
const t = (key, params) => translate(language, key, params);
let bank = null, characters = [], characterMap = new Map(), session = null, previewLevel = null, loadFailed = false;
let active = null, activeKey = '', activeDirection = 'across', forceRestart = false, noteKey = '';
let inputs = new Map(), containers = new Map(), members = new Map();
const automaticSize = matchMedia('(max-width: 760px)').matches ? 'small' : 'large';
let draft = { difficulty:'beginner', answerLanguage:'en', boardSize:automaticSize, mode:'easy' };
let generating=false, cellSize=automaticSize==='small'?32:30;
let clueHistory={}; try { clueHistory=JSON.parse(localStorage.getItem('tracen-last-clues')||'{}');if(!clueHistory||typeof clueHistory!=='object'||Array.isArray(clueHistory))clueHistory={}; } catch { /* Optional recent-clue history. */ }
let searchState = { status:'initial', results:[], query:'' };
let revealedEntryId = null;
let runHandle = null;
let statsStorage = null;
try { statsStorage = localStorage; } catch { /* Anonymous statistics remain optional. */ }
const localApi = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(analyticsConfig.apiBaseUrl);
const analytics = new AnalyticsClient({ ...analyticsConfig, storage: statsStorage,
  enabled: location.origin === analyticsConfig.productionOrigin || (localApi && ['localhost','127.0.0.1'].includes(location.hostname)),
  onChange: () => refreshStatistics(),
});
const statistics = new Map();
let statisticsRequest = 0;
const setup = $('start-dialog'), finish = $('finish-dialog'), searchDialog = $('search-dialog');
const currentLevel = () => session?.level || previewLevel;
const entries = () => currentLevel()?.entries || [];
const currentMode = () => session?.mode || draft.mode;
const solutionView = () => session?.finishReason === 'revealed';
const feedback = () => solutionView() ? { solved:new Set(), greenCells:new Set() } : feedbackFor(entries(), session?.values || {}, currentMode(), session?.hardRevealedEntries);
const answerVisible = (entry, solved) => solutionView() || session?.hardRevealedEntries.has(entry.id) || (currentMode()==='easy' && (solved.has(entry.id) || session?.revealedEntries.has(entry.id)));
const announce = (text) => { $('announcement').textContent = text; };

function nameCard(character, className = 'answer-names') {
  const card = document.createElement('div'); card.className = className;
  for (const [lang, label] of [['zh-CN','chineseName'],['ja','japaneseName'],['en','englishName']]) {
    const row = document.createElement('span'); row.className = 'name-row';
    const heading = document.createElement('small'); heading.textContent = t(label);
    const value = document.createElement('strong'); value.textContent = character.names[lang]; value.lang = lang;
    row.append(heading, value); card.append(row);
  }
  return card;
}

function renderStrings() {
  document.documentElement.lang = language;
  document.title = t('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((element) => { element.textContent = t(element.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach((element) => {
    const label=t(element.dataset.i18nLabel); element.setAttribute('aria-label',label); element.title=label;
  });
  for (const id of ['ui-language','setup-language']) { $(id).value = language; $(id).setAttribute('aria-label', t('uiLanguage')); }
  $('mode-switch').setAttribute('aria-label', t('modeLabel'));
  $('change-direction').setAttribute('aria-label', t('switchDirection'));
  $('search-input').placeholder = t('searchPlaceholder');
  for (const [key, input] of inputs) {
    const [row,column] = key.split(',').map(Number);
    input.setAttribute('aria-label', t('cellLabel', {row:row+1,column:column+1}));
  }
  if (bank) { renderSetup(); renderGame(); renderSearch(); renderAnswerDialog(); refreshStatistics(); }
  else $('load-status').textContent = t(loadFailed ? 'loadError' : 'loading');
}

function setLanguage(value) {
  if (!LANGUAGES.includes(value)) return;
  language = value;
  try { localStorage.setItem('tracen-ui-language', value); } catch { /* Preference only. */ }
  renderStrings();
}

function selectedScope() { return {random:true,difficulty:draft.difficulty,boardSize:draft.boardSize}; }
const statsKey=level=>level.difficulty+':'+level.boardSize;
function renderSetup() {
  if(!bank)return;
  document.querySelectorAll('[data-category]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.category===draft.difficulty));b.disabled=generating;});
  document.querySelectorAll('input[name="answer-script"]').forEach(r=>{r.checked=r.value===draft.answerLanguage;r.disabled=generating;});
  document.querySelectorAll('input[name="board-size"]').forEach(r=>{r.checked=r.value===draft.boardSize;r.disabled=generating;});
  document.querySelectorAll('input[name="mode"]').forEach(r=>{r.checked=r.value===draft.mode;r.disabled=generating;});
  $('level-description').textContent=t('setupDescription');
  $('level-summary').textContent=t('randomSummary',{n:SIZES[draft.boardSize]});
  $('selection-note').hidden=!noteKey;$('selection-note').textContent=noteKey?t(noteKey):'';
  $('start-button').disabled=generating;$('start-button').setAttribute('aria-busy',String(generating));
  const changed=!session||['difficulty','answerLanguage','boardSize'].some(k=>draft[k]!==session.level[k]);
  $('start-button-label').textContent=t(generating?'generating':!session?'start':changed||forceRestart?'startNew':'apply');
  $('cancel-setup').hidden=!session;$('cancel-setup').disabled=generating;
  void loadStatistics(selectedScope(),'setup-statistics');
}
async function generateGame() {
  if(generating||!bank)return;
  generating=true;noteKey='';if(!setup.open)setup.showModal();renderSetup();
  const slow=setTimeout(()=>{$('generation-state').hidden=false;},400);
  try {
    const seed=crypto.getRandomValues(new Uint32Array(1))[0];
    const level=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./generator-worker.js',import.meta.url),{type:'module'});
      const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Generation timeout'));},10000);
      const done=(value,error)=>{clearTimeout(timeout);worker.terminate();error?reject(error):resolve(value);};
      worker.onmessage=({data})=>{if(data.puzzle)done(data.puzzle);else if(data.error)done(null,new Error(data.error));};
      worker.onerror=error=>done(null,error);
      worker.postMessage({bank,characters,difficulty:draft.difficulty,answerLanguage:draft.answerLanguage,boardSize:draft.boardSize,seed,previousClues:clueHistory});
    });
    for(const e of level.entries)clueHistory[e.characterId]=e.clueId;
    try{localStorage.setItem('tracen-last-clues',JSON.stringify(clueHistory));}catch{/* Optional history. */}
    setup.close();launch(level,draft.mode);forceRestart=false;
  } catch(error){console.error(error);noteKey='generationFailed';if(!setup.open)setup.showModal();}
  finally{clearTimeout(slow);$('generation-state').hidden=true;generating=false;renderSetup();}
}

function paintStatistics(element, result = { status: 'loading' }) {
  element.replaceChildren();
  const heading = document.createElement('strong'); heading.className = 'statistics-title'; heading.textContent = t('statsTitle'); element.append(heading);
  if (result.status !== 'ok') {
    const note = document.createElement('p'); note.textContent = t({ loading:'statsLoading', disabled:'statsDisabled', error:'statsError' }[result.status]); element.append(note);
  } else {
    const metrics = document.createElement('dl'); metrics.className = 'statistics-metrics';
    for (const [label, value] of [['statsStarts', result.starts.toLocaleString(language)], ['statsSolved', result.solved.toLocaleString(language)],
      ['statsAverage', result.averageMs === null ? t('statsNoCompletions') : formatTime(result.averageMs)]]) {
      const item = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = t(label); dd.textContent = value; item.append(dt,dd); metrics.append(item);
    }
    element.append(metrics);

  }
  if (analytics.enabled) {
    const note = document.createElement('small'); note.textContent = t('statsPrivacy'); element.append(note);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button statistics-refresh'; button.textContent = t('statsRefresh');
    button.addEventListener('click', () => { const level = JSON.parse(element.dataset.scope || 'null'); if (level) void loadStatistics(level,element.id,true); }); element.append(button);
  }
}
async function loadStatistics(level, elementId, force = false) {
  const element = $(elementId); if (!element) return;
  const request = String(++statisticsRequest); element.dataset.request = request;
  const scopeKey=statsKey(level);element.dataset.level=scopeKey;element.dataset.scope=JSON.stringify({random:true,difficulty:level.difficulty,boardSize:level.boardSize});paintStatistics(element,force?undefined:statistics.get(scopeKey));
  const result = await analytics.stats(level, force); statistics.set(scopeKey, result);
  if (element.dataset.level === scopeKey && element.dataset.request === request) paintStatistics(element, result);
}
function refreshStatistics() {
  if (currentLevel()) void loadStatistics(currentLevel(), 'level-statistics');
  if(bank)void loadStatistics(selectedScope(),'setup-statistics');
}
window.addEventListener('online', () => { void analytics.flush(); refreshStatistics(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void analytics.flush(); refreshStatistics(); } });
void analytics.flush();

function openSetup(replay = false) {
  finish.close();
  forceRestart = replay;
  const level = currentLevel();
  if (level) draft = { difficulty:level.difficulty, answerLanguage:level.answerLanguage,boardSize:level.boardSize,mode:currentMode() };
  document.querySelector(`input[name="mode"][value="${draft.mode}"]`).checked = true;
  noteKey = ''; renderSetup(); setup.showModal();
}

function updateTimer() { $('timer').textContent = formatTime(session?.elapsed || 0); }
setInterval(updateTimer, 250);

function renderGame() {
  const level = currentLevel(); if (!level || !active) return;
  const { solved, greenCells } = feedback();
  $('level-title').textContent = t(level.difficulty)+' · '+t(level.boardSize==='small'?'smallBoard':'largeBoard');
  $('level-category').textContent = `${t(level.difficulty)} / ${t(level.answerLanguage === 'en' ? 'answerEn':'answerJa')}`;
  $('board-label').textContent = t('randomSeed')+': '+level.seed;
  $('game-status').textContent = t(!session ? 'ready' : solutionView() ? 'ended' : session.completed ? 'finished' : 'playing');
  $('easy-mode').setAttribute('aria-pressed', String(currentMode()==='easy'));
  $('hard-mode').setAttribute('aria-pressed', String(currentMode()==='hard'));
  $('mode-description').textContent = t(currentMode()==='easy'?'easyShort':'hardShort');
  $('progress').textContent = solutionView() ? t('solutionProgress',{total:entries().length}) : currentMode()==='easy'
    ? t('progressCorrect',{n:solved.size,total:entries().length})
    : t('progressFilled',{n:Object.values(session?.values || {}).filter(Boolean).length,total:inputs.size});
  const selected = new Set(entryCells(active));
  const locked = session?.revealedCells || new Set();
  for (const [key, cell] of containers) {
    const input = inputs.get(key);
    input.value = session?.values[key] || '';
    input.readOnly = Boolean(session?.completed) || locked.has(key);
    cell.classList.toggle('active-word', selected.has(key)); cell.classList.toggle('selected',key===activeKey);
    cell.classList.toggle('correct',greenCells.has(key));
    cell.classList.toggle('solution',solutionView());
    inputs.get(key).tabIndex = key===activeKey ? 0 : -1;
  }
  $('active-clue-number').textContent = t('currentEntry',{number:active.number,direction:t(active.direction)});
  $('active-clue-text').textContent = `${active.clues[language]} (${[...active.answer].length})`;
  const answer = $('active-answer'); answer.replaceChildren(); answer.hidden = !answerVisible(active,solved);
  if (!answer.hidden) answer.append(nameCard(characterMap.get(active.characterId)));
  $('change-direction').disabled = (members.get(activeKey)?.length || 0) < 2 || !session || session.completed;
  $('input-rule').textContent = t(level.answerLanguage==='ja'?'jaRule':'enRule');
  for (const direction of ['across','down']) {
    $(`${direction}-tab`).classList.toggle('selected', activeDirection===direction);
    $(`${direction}-tab`).setAttribute('aria-pressed',String(activeDirection===direction));
    $(`${direction}-count`).textContent = entries().filter((e)=>e.direction===direction).length;
  }
  $('finish-time').textContent = formatTime(session?.elapsed || 0);
  $('finish-mode').textContent = t((session?.finishedMode || currentMode())==='easy'?'easy':'hard');
  $('finish-title').textContent=t(solutionView()?'endedTitle':'finishTitle');
  $('finish-dialog').querySelector('.dialog-copy').textContent=t(solutionView()?'endedCopy':'finishCopy');
  renderAnswerActions(); renderClues(solved); updateTimer();
}

function renderAnswerActions() {
  const easy=currentMode()==='easy', remaining=Math.max(0,3-(session?.hardRevealedEntries.size||0));
  const alreadyViewed=(easy?session?.revealedEntries:session?.hardRevealedEntries)?.has(active.id);
  $('reveal-answer').hidden=Boolean(session?.completed);
  $('reveal-answer').textContent=t(alreadyViewed?'revealAgain':'revealAnswer');
  $('reveal-answer').disabled=!session||session.completed||(!easy&&remaining===0&&!alreadyViewed);
  $('reveal-allowance').hidden=Boolean(session?.completed);
  $('reveal-allowance').textContent=easy?t('revealUnlimited'):t('revealRemaining',{n:remaining});
  $('end-game').hidden=!session||session.completed;
  $('answer-action-note').textContent=session?.completed?'':t(easy?'revealNote':'hardRevealNote');
}

function renderAnswerDialog() {
  const entry=entries().find((e)=>e.id===revealedEntryId); if(!entry)return;
  $('revealed-clue').textContent=`${t('currentEntry',{number:entry.number,direction:t(entry.direction)})} · ${entry.clues[language]}`;
  $('revealed-literal').textContent=entry.answer;
  $('revealed-names').replaceChildren(nameCard(characterMap.get(entry.characterId)));
  const easy=currentMode()==='easy';
  $('answer-dialog-note').textContent=`${easy?t('revealUnlimited'):t('revealRemaining',{n:Math.max(0,3-session.hardRevealedEntries.size)})} · ${t(easy?'revealNote':'hardRevealNote')}`;
}

function renderClues(solved = feedback().solved) {
  const list = $('clue-list'); list.replaceChildren();
  for (const entry of entries().filter((e)=>e.direction===activeDirection)) {
    const button = document.createElement('button'); button.type='button'; button.className='clue-item'; button.dataset.entry=entry.id;
    button.classList.toggle('active',entry.id===active.id); button.classList.toggle('solved',solved.has(entry.id));
    button.setAttribute('aria-pressed',String(entry.id===active.id));
    const number = document.createElement('span'); number.className='clue-index'; number.textContent=String(entry.number).padStart(2,'0');
    const content = document.createElement('span'); content.className='clue-copy';
    const text = document.createElement('span'); text.textContent=entry.clues[language];
    const length = document.createElement('span'); length.className='clue-length'; length.textContent=` (${[...entry.answer].length})`;
    content.append(text,length);
    if (answerVisible(entry,solved)) {
      content.append(nameCard(characterMap.get(entry.characterId)));
      if(solved.has(entry.id)) {
        const check = document.createElement('span'); check.className='solved-mark'; check.textContent='✓'; check.setAttribute('aria-label',t('correct')); button.append(check);
      } else {
        const label=document.createElement('small');label.className='revealed-label';label.textContent=t('revealMarked');content.append(label);
      }
    }
    button.prepend(number,content);
    button.addEventListener('click',()=>{
      const keys = entryCells(entry); activate(entry,keys.find((key)=>!session?.values[key])||keys[0]);
    });
    list.append(button);
  }
}

function activate(entry,key,focus = true) {
  if (!entry) return;
  active=entry; activeKey=key; activeDirection=entry.direction; renderGame();
  const list=$('clue-list'), button=list.querySelector('.clue-item.active');
  if (button) {
    const top=button.offsetTop, bottom=top+button.offsetHeight;
    if (top<list.scrollTop) list.scrollTop=top;
    else if (bottom>list.scrollTop+list.clientHeight) list.scrollTop=bottom-list.clientHeight;
  }
  if (focus&&session&&!session.completed) { inputs.get(key)?.focus({preventScroll:true}); const cell=containers.get(key),scroll=$('board').parentElement; if(cell){const x=cell.offsetLeft-$('board').offsetLeft;if(x<scroll.scrollLeft)scroll.scrollLeft=x;else if(x+cell.offsetWidth>scroll.scrollLeft+scroll.clientWidth)scroll.scrollLeft=x+cell.offsetWidth-scroll.clientWidth;} }
}
function chooseCell(key,toggle = false) {
  const options=members.get(key); if (!options) return;
  let entry=options.find((e)=>e.direction===active.direction)||options[0];
  if (toggle&&options.length===2) entry=options.find((e)=>e.id!==active.id)||entry;
  activate(entry,key,false);
}
function stepInWord(amount) {
  const keys=entryCells(active), next=keys[keys.indexOf(activeKey)+amount]; if (next) activate(active,next);
}
function nextEntry(amount) {
  const all=entries(), next=all[(all.findIndex((e)=>e.id===active.id)+amount+all.length)%all.length];
  const keys=entryCells(next); activate(next,keys.find((key)=>!session.values[key])||keys[0]);
}
function toggleDirection() {
  const options=members.get(activeKey); if (options?.length===2) activate(options.find((e)=>e.id!==active.id),activeKey);
}
function commit(changes) {
  if (!session||session.completed) return;
  const completed=session.update(changes);
  for (const key of Object.keys(changes)) inputs.get(key).value=session.values[key]||'';
  renderGame();
  if (completed) {
    void analytics.end(runHandle, session);
    for (const input of inputs.values()) input.readOnly=true;
    announce(t('finishAnnouncement',{time:formatTime(session.elapsed)})); finish.showModal();
  }
}
function insertText(text) {
  if (!session||session.completed) return;
  const letters=[...normalizeAnswer(text,session.level.answerLanguage)]; if (!letters.length) return;
  const keys=entryCells(active), offset=keys.indexOf(activeKey), count=Math.min(letters.length,keys.length-offset), changes={};
  for (let i=0;i<count;i++) changes[keys[offset+i]]=letters[i];
  commit(changes);
  if (!session.completed) activate(active,keys[Math.min(offset+count,keys.length-1)]);
}
function handleKey(event) {
  if (!session||session.completed||event.isComposing||event.keyCode===229||event.ctrlKey||event.metaKey||event.altKey) return;
  if (session.level.answerLanguage==='en'&&/^[a-zA-Z]$/.test(event.key)) { event.preventDefault(); insertText(event.key); }
  else if (session.level.answerLanguage==='ja'&&/^[\u3041-\u3096\u30A1-\u30FAー]$/.test(event.key)) { event.preventDefault(); insertText(event.key); }
  else if (event.key==='Backspace') { event.preventDefault(); if (!session.values[activeKey]) stepInWord(-1); commit({[activeKey]:''}); }
  else if (event.key==='Delete') { event.preventDefault(); commit({[activeKey]:''}); }
  else if (event.key==='Tab') { event.preventDefault(); nextEntry(event.shiftKey?-1:1); }
  else if (event.key===' '||event.key==='Enter') { event.preventDefault(); toggleDirection(); }
  else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault(); const [r,c]=activeKey.split(',').map(Number);
    const [dr,dc]={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[event.key];
    const key=cellKey(r+dr,c+dc);
    if (inputs.has(key)) activate(members.get(key).find((e)=>e.direction===(dr?'down':'across'))||members.get(key)[0],key);
  }
}

function buildBoard(level,enabled = false) {
  inputs=new Map(); containers=new Map(); members=new Map();
  for (const entry of level.entries) for (const key of entryCells(entry)) {
    if (!members.has(key)) members.set(key,[]); members.get(key).push(entry);
  }
  const starts=new Map(level.entries.map((e)=>[cellKey(e.row,e.column),e.number]));
  const board=$('board'); board.replaceChildren(); board.style.gridTemplateColumns=`repeat(${level.grid.columns},minmax(0,1fr))`;
  board.style.aspectRatio=`${level.grid.columns} / ${level.grid.rows}`;
  board.style.width=String(level.grid.columns*cellSize)+'px';board.style.setProperty('--cell-size',cellSize+'px');
  board.classList.toggle('kana-board',level.answerLanguage==='ja');
  level.grid.layout.forEach((row,r)=>[...row].forEach((char,c)=>{
    const cell=document.createElement('div'); cell.className='cell'; board.append(cell);
    if (char==='#') {cell.setAttribute('aria-hidden','true');return;}
    const key=cellKey(r,c);cell.classList.add('white');cell.dataset.cell=key;
    if (starts.has(key)) {const number=document.createElement('span');number.className='cell-number';number.textContent=starts.get(key);cell.append(number);}
    const input=document.createElement('input');input.type='text';input.autocomplete='off';input.spellcheck=false;
    input.autocapitalize=level.answerLanguage==='en'?'characters':'off';input.inputMode='text';input.lang=level.answerLanguage==='ja'?'ja':'en';
    input.setAttribute('aria-label',t('cellLabel',{row:r+1,column:c+1}));input.setAttribute('enterkeyhint','next');input.disabled=!enabled;input.tabIndex=-1;
    let composing=false, compositionAnchor=null, suppressCompositionEcho=false;
    input.addEventListener('focus',()=>{if(activeKey!==key)chooseCell(key);});
    input.addEventListener('pointerdown',()=>chooseCell(key,activeKey===key));input.addEventListener('keydown',handleKey);
    input.addEventListener('paste',(event)=>{event.preventDefault();insertText(event.clipboardData.getData('text'));});
    input.addEventListener('beforeinput',(event)=>{
      if(composing||event.isComposing||event.inputType.includes('Composition'))return;
      suppressCompositionEcho=false;
      if(event.inputType==='insertText'&&event.data!=null){event.preventDefault();insertText(event.data);}
      else if(event.inputType==='deleteContentBackward'){event.preventDefault();if(!session?.values[key])stepInWord(-1);commit({[activeKey]:''});}
    });
    input.addEventListener('input',(event)=>{
      if(composing||event.isComposing)return;
      if(suppressCompositionEcho){input.value=session?.values[key]||'';return;}
      const value=input.value;input.value=session?.values[key]||'';
      if(value)insertText(value);else commit({[key]:''});
    });
    input.addEventListener('compositionstart',()=>{composing=true;compositionAnchor={entry:active,key};suppressCompositionEcho=false;input.value='';});
    input.addEventListener('compositionend',(event)=>{
      composing=false;const value=event.data||input.value;input.value=session?.values[key]||'';
      suppressCompositionEcho=true;
      if(compositionAnchor)activate(compositionAnchor.entry,compositionAnchor.key,false);
      insertText(value);compositionAnchor=null;
      setTimeout(()=>{suppressCompositionEcho=false;},0);
    });
    cell.append(input);inputs.set(key,input);containers.set(key,cell);
  }));
  active=level.entries[0];activeKey=entryCells(active)[0];activeDirection=active.direction;
}

function launch(level,mode) {
  revealedEntryId=null;
  session=new GameSession(level,mode);previewLevel=level;searchState={status:'initial',results:[],query:''};$('search-input').value='';
  runHandle=analytics.begin(session); refreshStatistics();
  buildBoard(level,true);renderGame();renderSearch();
  for(const id of ['lookup','choose-level','restart','download-puzzle'])$(id).disabled=false;
  activate(active,activeKey);$('clue-list').scrollTop=0;announce(t('startedAnnouncement'));
}
function applyMode(mode) {
  $('answer-dialog').close();
  if(session)session.setMode(mode);draft.mode=mode;renderGame();
  // A result obtained in Assisted mode must not bypass the Challenge allowance.
  searchState={status:'initial',results:[],query:''};renderSearch();
  announce(t('modeChanged',{mode:t(mode==='easy'?'easy':'hard')}));
}
function renderSearch() {
  const hard=currentMode()==='hard', remaining=Math.max(0,3-(session?.hardSearches||0));
  $('search-allowance').textContent=hard?t('searchRemaining',{n:remaining}):t('searchUnlimited');
  $('dictionary-count').textContent=t('dictionaryCount',{n:characters.length});
  $('search-submit').disabled=!session||(hard&&remaining===0);
  $('search-query').hidden=!searchState.query;$('search-query').textContent=t('searchQuery',{query:searchState.query});
  const message=searchState.status==='ok'?(searchState.results.length?t('resultCount',{n:searchState.results.length}):t('noResults')):
    t({initial:'searchInitial',empty:'searchEmpty',limit:'searchLimit'}[searchState.status]);
  $('search-message').textContent=message;
  const results=$('search-results');results.replaceChildren();
  if(searchState.status==='ok')for(const character of searchState.results){
    const card=document.createElement('article');card.className='character-result';card.dataset.character=character.id;card.append(nameCard(character));results.append(card);
  }
}

for(const id of ['ui-language','setup-language'])$(id).addEventListener('change',(event)=>setLanguage(event.target.value));
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{draft.difficulty=button.dataset.category;renderSetup();}));
for(const [name,field] of [['answer-script','answerLanguage'],['board-size','boardSize']])document.querySelectorAll('input[name="'+name+'"]').forEach(r=>r.addEventListener('change',()=>{draft[field]=r.value;renderSetup();}));
document.querySelectorAll('input[name="mode"]').forEach((radio)=>radio.addEventListener('change',()=>{draft.mode=radio.value;}));
$('start-form').addEventListener('submit',event=>{
  event.preventDefault();if(generating)return;draft.mode=new FormData(event.currentTarget).get('mode');
  if(!session||forceRestart||['difficulty','answerLanguage','boardSize'].some(k=>draft[k]!==session.level[k]))void generateGame();
  else{setup.close();applyMode(draft.mode);}
});
setup.addEventListener('cancel',event=>{if(!session||generating)event.preventDefault();});
$('cancel-setup').addEventListener('click',()=>{if(!generating)setup.close();});
$('choose-level').addEventListener('click',()=>openSetup());
$('easy-mode').addEventListener('click',()=>applyMode('easy'));
$('hard-mode').addEventListener('click',()=>applyMode('hard'));
for(const direction of ['across','down'])$(`${direction}-tab`).addEventListener('click',()=>{activeDirection=direction;renderGame();$('clue-list').scrollTop=0;});
$('change-direction').addEventListener('click',toggleDirection);
$('restart').addEventListener('click',()=>$('restart-dialog').showModal());
$('cancel-restart').addEventListener('click',()=>$('restart-dialog').close());
$('confirm-restart').addEventListener('click',()=>{$('restart-dialog').close();draft={difficulty:session.level.difficulty,answerLanguage:session.level.answerLanguage,boardSize:session.level.boardSize,mode:session.mode};forceRestart=true;void generateGame();});
$('review-board').addEventListener('click',()=>finish.close());
$('play-again').addEventListener('click',()=>openSetup(true));
$('lookup').addEventListener('click',()=>{renderSearch();searchDialog.showModal();$('search-input').focus();});
$('close-search').addEventListener('click',()=>searchDialog.close());
$('search-form').addEventListener('submit',(event)=>{
  event.preventDefault();if(!session)return;
  const query=$('search-input').value;searchState={...session.query(characters,query),query};renderSearch();
});
$('reveal-answer').addEventListener('click',()=>{
  if(!session||session.completed)return;
  const result=session.reveal(active.id);
  if(result.status!=='ok'){if(result.status==='limit')announce(t('revealLimit'));return;}
  if(session.completed){
    void analytics.end(runHandle,session);renderGame();announce(t('finishAnnouncement',{time:formatTime(session.elapsed)}));finish.showModal();return;
  }
  revealedEntryId=active.id;renderGame();renderAnswerDialog();$('answer-dialog').showModal();
});
$('close-answer').addEventListener('click',()=>$('answer-dialog').close());
$('end-game').addEventListener('click',()=>{if(session&&!session.completed)$('end-dialog').showModal();});
$('cancel-end').addEventListener('click',()=>$('end-dialog').close());
$('confirm-end').addEventListener('click',()=>{
  $('end-dialog').close();if(!session?.endAndReveal())return;
  void analytics.end(runHandle, session);
  for(const [key,input] of inputs){input.value=session.values[key]||'';input.readOnly=true;}
  renderGame();announce(t('endedAnnouncement',{time:formatTime(session.elapsed)}));finish.showModal();
});
function openExport(){if(!session)return;finish.close();$('solution-export-option').hidden=!session.completed;$('solution-export-option').querySelector('input').disabled=!session.completed;document.querySelector('input[name="export-type"][value="blank"]').checked=true;$('export-status').textContent='';$('export-dialog').showModal();}
$('download-puzzle').addEventListener('click',openExport);$('finish-download').addEventListener('click',openExport);
$('close-export').addEventListener('click',()=>$('export-dialog').close());
$('export-form').addEventListener('submit',async event=>{event.preventDefault();if(!session)return;const button=$('export-save');button.disabled=true;$('export-status').textContent=t('exportBusy');try{await downloadPuzzle({level:session.level,session,language,type:new FormData(event.currentTarget).get('export-type'),includeTime:$('export-time').checked,t});$('export-status').textContent='';}catch(error){console.error(error);$('export-status').textContent=t('exportFailed');}finally{button.disabled=false;}});
for(const [id,delta] of [['zoom-in',4],['zoom-out',-4]])$(id).addEventListener('click',()=>{cellSize=Math.max(28,Math.min(56,cellSize+delta));if(currentLevel()){$('board').style.width=currentLevel().grid.columns*cellSize+'px';$('board').style.setProperty('--cell-size',cellSize+'px');}});
renderStrings();setup.showModal();
try{const catalog=await loadCatalog();bank=catalog.bank;characters=catalog.characters;characterMap=new Map(characters.map(c=>[c.id,c]));$('load-status').textContent='';$('load-status').hidden=true;renderStrings();}
catch(error){loadFailed=true;$('load-status').textContent=t('loadError');console.error(error);}
