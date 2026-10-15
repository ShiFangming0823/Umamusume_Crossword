import { QrCode } from './vendor/qrcodegen.js';
import { cellKey, entryCells, formatTime } from './game.js';
export const GAME_URL = 'https://umamusume-crossword.pages.dev/';
export function qrMatrix(text = GAME_URL) {
  const qr = QrCode.encodeText(text, QrCode.Ecc.MEDIUM);
  return Array.from({length:qr.size}, (_, y) => Array.from({length:qr.size}, (_, x) => qr.getModule(x,y)));
}
function wrap(ctx, text, width) {
  const lines=[];
  for (const paragraph of text.split('\n')) {
    let line='';
    for (const ch of paragraph) { if (line && ctx.measureText(line+ch).width > width) { lines.push(line); line=ch; } else line+=ch; }
    lines.push(line);
  }
  return lines;
}
export function drawPuzzle({level, session, language, type='blank', includeTime=false, t}) {
  if (!['blank','current','solution'].includes(type) || (type==='solution' && !session?.completed)) throw new Error('Solution export is available after the game ends');
  const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
  const width=1800, margin=80, usable=width-margin*2;
  const cell=Math.min(64,Math.floor(usable/level.grid.columns)), boardHeight=level.grid.rows*cell;
  ctx.font='26px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';
  const columns=['across','down'].map(direction=>level.entries.filter(e=>e.direction===direction).map(e=>({entry:e,lines:wrap(ctx,`${e.number}. ${e.clues[language]} (${Array.from(e.answer).length})${type==='solution'?`  ${e.answer}`:''}`,760)})));
  const columnHeights=columns.map(items=>items.reduce((n,item)=>n+item.lines.length*38+24,70));
  canvas.width=width; canvas.height=270+boardHeight+80+Math.max(...columnHeights)+300;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.textBaseline='top';
  ctx.fillStyle='#173e2f';ctx.font='bold 42px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';ctx.fillText(t('appTitle'),margin,45);
  ctx.font='28px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';
  ctx.fillText(`${t(level.difficulty)} · ${t(level.boardSize==='small'?'smallBoard':'largeBoard')} · ${t(level.answerLanguage==='en'?'answerEn':'answerJa')}`,margin,111);
  ctx.fillText(t(type==='solution'?'exportSolution':type==='current'?'exportCurrent':'exportBlank'),margin,155);
  if(includeTime)ctx.fillText(`${t('time')}: ${formatTime(session?.elapsed||0)} · ${t(session?.completed?(session.finishReason==='solved'?'finished':'ended'):'playing')}`,margin,199);
  const top=270, left=Math.round((width-level.grid.columns*cell)/2);
  const starts=new Map(level.entries.map(e=>[cellKey(e.row,e.column),e.number]));
  const values=type==='solution'?Object.fromEntries(level.entries.flatMap(e=>entryCells(e).map((k,i)=>[k,[...e.answer][i]]))):type==='current'?session?.values||{}:{};
  level.grid.layout.forEach((row,r)=>Array.from(row).forEach((ch,c)=>{
    const x=left+c*cell,y=top+r*cell,k=cellKey(r,c);ctx.fillStyle=ch==='#'?'#303830':'#fff';ctx.fillRect(x,y,cell,cell);
    ctx.strokeStyle='#777';ctx.lineWidth=1;ctx.strokeRect(x,y,cell,cell);
    if(ch==='#')return;
    if(starts.has(k)){ctx.textAlign='left';ctx.fillStyle='#333';ctx.font=`${Math.max(10,Math.round(cell*.23))}px Arial`;ctx.fillText(starts.get(k),x+3,y+2);}
    if(values[k]){ctx.fillStyle='#111';ctx.textAlign='center';ctx.font=`600 ${Math.round(cell*.5)}px "Segoe UI", "Yu Gothic", "Microsoft YaHei", sans-serif`;ctx.fillText(values[k],x+cell/2,y+cell*.35);}
  }));
  ctx.textAlign='left';const cluesTop=top+boardHeight+65;
  columns.forEach((items,index)=>{const x=margin+index*840;let y=cluesTop;ctx.fillStyle='#173e2f';ctx.font='bold 32px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';ctx.fillText(t(index?'down':'across'),x,y);y+=65;
    ctx.font='26px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';ctx.fillStyle='#111';for(const item of items){for(const line of item.lines){ctx.fillText(line,x,y);y+=38;}y+=24;}});
  const footerTop=canvas.height-250;ctx.strokeStyle='#999';ctx.beginPath();ctx.moveTo(margin,footerTop-20);ctx.lineTo(width-margin,footerTop-20);ctx.stroke();
  ctx.font='25px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';ctx.fillStyle='#173e2f';ctx.fillText(GAME_URL,margin,footerTop+30);ctx.fillText(t('exportFooter'),margin,footerTop+80);
  ctx.font='21px "Segoe UI", "Microsoft YaHei", "Yu Gothic", sans-serif';ctx.fillText(`${t('randomSeed')}: ${level.seed}`,margin,footerTop+130);
  const matrix=qrMatrix(), scale=5, quiet=4, qrSize=(matrix.length+quiet*2)*scale, qx=width-margin-qrSize,qy=footerTop;
  ctx.fillStyle='#fff';ctx.fillRect(qx,qy,qrSize,qrSize);ctx.fillStyle='#000';matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)ctx.fillRect(qx+(x+quiet)*scale,qy+(y+quiet)*scale,scale,scale);}));
  return canvas;
}
export async function downloadPuzzle(options) {
  const canvas=drawPuzzle(options),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw new Error('PNG encoding failed');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`tracen-${options.level.difficulty}-${options.level.boardSize}-${options.level.seed}-${options.type}.png`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
