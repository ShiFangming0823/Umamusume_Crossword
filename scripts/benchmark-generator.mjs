import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { checkData } from './check-data.mjs';
import { CATEGORIES, generatePuzzle } from '../src/generator.js';
const {bank,characters}=await checkData();
const trials=Number(process.argv.find(a=>a.startsWith('--trials='))?.split('=')[1]||40);
if(!Number.isInteger(trials)||trials<1||trials>1000)throw new Error('Expected 1–1000 trials');
const rows=[];
for(const difficulty of CATEGORIES)for(const answerLanguage of ['en','ja'])for(const boardSize of ['small','large']){
 const times=[],attempts=[];let failures=0,maxRows=0,maxColumns=0;
 for(let i=0;i<trials;i++){
  const start=performance.now();let attempt=0;
  try{const p=generatePuzzle({bank,characters,difficulty,answerLanguage,boardSize,seed:(i*2654435761+12345)>>>0,onProgress:p=>{attempt=p.attempt;}});maxRows=Math.max(maxRows,p.grid.rows);maxColumns=Math.max(maxColumns,p.grid.columns);}catch(error){failures++;console.error(error.message);}
  times.push(performance.now()-start);attempts.push(attempt);
 }
 times.sort((a,b)=>a-b);
 const row={difficulty,answerLanguage,boardSize,trials,failures,meanMs:+(times.reduce((a,b)=>a+b,0)/trials).toFixed(2),p95Ms:+times[Math.ceil(trials*.95)-1].toFixed(2),maxMs:+times.at(-1).toFixed(2),maxAttempts:Math.max(...attempts)+1,maxRows,maxColumns};rows.push(row);console.log(JSON.stringify(row));
}
const report={runtime:process.version,platform:process.platform,note:'Node.js measurements on the development computer; not mobile-browser performance. Includes semantic validation; excludes network and Web Worker startup.',rows};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
if(rows.some(r=>r.failures))process.exitCode=1;
