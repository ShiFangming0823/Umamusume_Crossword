export function boardSubmission(level) {
  return {answerLanguage:level.answerLanguage,grid:level.grid,entries:level.entries.map(({characterId,number,row,column,direction})=>({characterId,number,row,column,direction}))};
}
export async function valuesHash(values) {
  const content=JSON.stringify(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0));
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
