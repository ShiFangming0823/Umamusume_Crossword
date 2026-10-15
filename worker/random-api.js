import { randomPool } from './pool.generated.js';
import { validateRandomBoard } from './random-validation.js';
import { valuesHash } from '../src/random-protocol.js';
import { CATEGORIES, SIZES } from '../src/generator.js';
import { MAX_RUN_MS } from '../src/analytics-protocol.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HttpError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const need=(condition,message,status)=>{if(!condition)throw new HttpError(message,status);};
const scope=data=>{need(CATEGORIES.includes(data.difficulty)&&Object.hasOwn(SIZES,data.boardSize),'Invalid collection or size');};
async function body(request){need(request.headers.get('Content-Type')?.split(';')[0].trim()==='application/json','Expected JSON',415);const text=await request.text();need(new TextEncoder().encode(text).length<=32768,'Request too large',413);let data;try{data=JSON.parse(text);}catch{throw new HttpError('Invalid JSON');}need(data&&typeof data==='object'&&!Array.isArray(data),'Expected object');return data;}
async function route(request,env){
 const url=new URL(request.url);
 if(request.method==='GET'&&url.pathname==='/api/v2/health'){await env.DB.prepare('SELECT 1 FROM category_stats LIMIT 1').first();return{ok:true,version:2};}
 if(request.method==='GET'&&url.pathname==='/api/v2/stats'){
  const data={difficulty:url.searchParams.get('difficulty'),boardSize:url.searchParams.get('boardSize')};scope(data);
  const row=await env.DB.prepare('SELECT starts,solved,elapsed_total_ms FROM category_stats WHERE category=? AND board_size=?').bind(data.difficulty,data.boardSize).first();
  return {...data,starts:row?.starts||0,solved:row?.solved||0,averageMs:row?.solved?Math.round(row.elapsed_total_ms/row.solved):null};
 }
 need(request.method==='POST'&&['/api/v2/runs/start','/api/v2/runs/finish'].includes(url.pathname),'Not found',404);
 const data=await body(request);need(UUID.test(data.runId),'Invalid run ID');scope(data);
 if(url.pathname.endsWith('/start')){
  let values;try{values=validateRandomBoard(data,randomPool);}catch{throw new HttpError('Invalid or unsupported crossword',422);}
  const hash=await valuesHash(values);
  await env.DB.prepare('INSERT INTO random_game_runs(run_id,category,board_size,solution_hash,started_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id) DO NOTHING').bind(data.runId,data.difficulty,data.boardSize,hash,Date.now()).run();
  const row=await env.DB.prepare('SELECT category,board_size,solution_hash FROM random_game_runs WHERE run_id=?').bind(data.runId).first();
  need(row?.category===data.difficulty&&row?.board_size===data.boardSize&&row?.solution_hash===hash,'Run ID conflict',409);return{ok:true};
 }
 need(['solved','revealed'].includes(data.outcome)&&Number.isSafeInteger(data.elapsedMs)&&data.elapsedMs>=0&&data.elapsedMs<=MAX_RUN_MS,'Invalid result');
 const row=await env.DB.prepare('SELECT category,board_size,solution_hash,status FROM random_game_runs WHERE run_id=?').bind(data.runId).first();
 need(row?.category===data.difficulty&&row?.board_size===data.boardSize,'Start this run first',409);
 if(data.outcome==='solved'){
  need(data.values&&typeof data.values==='object'&&!Array.isArray(data.values)&&Object.keys(data.values).length<=3600&&Object.entries(data.values).every(([k,v])=>/^\d+,\d+$/.test(k)&&typeof v==='string'&&Array.from(v).length===1),'Invalid letters');
  need(await valuesHash(data.values)===row.solution_hash,'Board is not solved',422);
 }
 if(row.status!=='active'){need(row.status===data.outcome,'Run has already ended',409);return{ok:true,duplicate:true};}
 await env.DB.prepare("UPDATE random_game_runs SET status=?,elapsed_ms=?,finished_at=? WHERE run_id=? AND status='active'").bind(data.outcome,data.elapsedMs,Date.now(),data.runId).run();return{ok:true};
}
export default{async fetch(request,env){
 const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'https://umamusume-crossword.pages.dev').split(',').map(s=>s.trim());
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin'};
 if(allowed.includes(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
 if((origin&&!allowed.includes(origin))||(!origin&&!['GET','HEAD'].includes(request.method)))return reply({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'}});
 try{return reply(await route(request,env));}catch(error){return reply({error:error instanceof HttpError?error.message:'Statistics temporarily unavailable'},error instanceof HttpError?error.status:503);}
}};
