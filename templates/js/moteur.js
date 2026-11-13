/* ---------- Stockfish dans le navigateur ---------- */
// Chargé à la première utilisation seulement. Stockfish 17.1 « lite » en WebAssembly monothread (7 Mo, pas besoin de
// SharedArrayBuffer, que GitHub Pages ne permet pas) ; s'il ne démarre pas (navigateur ancien, CDN injoignable), repli
// sur Stockfish 10 en asm.js (1,5 Mo, nettement plus faible). Un Worker doit venir de la même origine que la page :
// le script est donc téléchargé puis lancé depuis un Blob ; Stockfish 17 lit l'adresse de son .wasm dans le fragment.
const Engine=(()=>{
 const SF17='https://unpkg.com/stockfish@17.1.0/src/stockfish-17.1-lite-single-03e3232',
  SOURCES=[{v:17,js:SF17+'.js',wasm:SF17+'.wasm',wait:45000},{v:10,js:'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',wait:20000}];
 let worker=null,ready=null,busy=Promise.resolve(),version=null,level=null;
 function launch(s){
  if(s.wasm&&typeof WebAssembly!=='object')return Promise.reject(new Error('WebAssembly absent'));
  return fetch(s.js).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(src=>new Promise((resolve,reject)=>{
   const w=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'}))+(s.wasm?'#'+encodeURIComponent(s.wasm):''));
   const fail=err=>{clearTimeout(timer);try{w.terminate()}catch(e){}reject(err)},timer=setTimeout(()=>fail(new Error('délai dépassé')),s.wait);
   w.onerror=e=>{e.preventDefault?.();fail(new Error(e.message||'erreur du moteur'))};
   w.onmessage=e=>{if(String(e.data).startsWith('uciok')){clearTimeout(timer);w.onerror=null;resolve(w)}};
   w.postMessage('uci')}));
 }
 function start(){
  if(!ready)ready=SOURCES.reduce((p,s)=>p.catch(()=>launch(s).then(w=>{worker=w;version=s.v;level=null})),Promise.reject())
   .catch(err=>{ready=null;throw err});
  return ready}
 // Force limitée (elo) ou pleine force (null). Stockfish 17 : UCI_Elo, de 1320 à 3190 ; Stockfish 10 : Skill Level 0–20.
 function setLevel(elo){if(elo===level)return;level=elo;
  if(version>=17){worker.postMessage('setoption name UCI_LimitStrength value '+(elo?'true':'false'));
   if(elo)worker.postMessage('setoption name UCI_Elo value '+Math.max(1320,Math.min(3190,Math.round(elo))))}
  else worker.postMessage('setoption name Skill Level value '+(elo?Math.max(0,Math.min(20,Math.round((elo-1000)/90))):20))}
 // Meilleur coup, évaluation (en centipions, du point de vue du camp au trait) et variante principale (coups UCI),
 // une recherche à la fois. opts.elo : joue au niveau indiqué (le score reste celui de la recherche, pas du coup choisi).
 function move(fen,ms,opts={}){
  const job=busy.then(start).then(()=>new Promise(resolve=>{let score=0,mate=null,pv=[];setLevel(opts.elo||null);
   worker.onmessage=e=>{const line=String(e.data),m=line.match(/score (cp|mate) (-?\d+)/),p=line.match(/ pv (.+)$/);
    if(m){score=m[1]==='cp'?+m[2]:(+m[2]>0?1000:-1000);mate=m[1]==='mate'?+m[2]:null}
    if(p&&m&&!/(lower|upper)bound/.test(line))pv=p[1].trim().split(/\s+/);   // une borne n'est qu'une recherche partielle
    if(line.startsWith('bestmove')){const u=line.split(' ')[1];resolve({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4],score,mate,pv:pv[0]===u?pv:[u]})}};
   worker.postMessage('position fen '+fen);worker.postMessage('go movetime '+ms)}));
  busy=job.catch(()=>{});return job}
 return {start,move,get version(){return version}}})();

/* Indice : le meilleur coup de Stockfish sur une position, en clair. Promesse de {from, to, san, text} (null si aucun coup) */
function engineHint(fen,ms=1500){
 return Engine.move(fen,ms).then(r=>{const G=new Chess(fen),side=G.turn()==='w'?'Blancs':'Noirs',mv=G.move({from:r.from,to:r.to,promotion:r.promotion||'q'});
  if(!mv)return null;
  const ev=r.mate!=null?(r.mate>0?`mat en ${r.mate} pour les ${side}`:`les ${side} se font mater en ${-r.mate}`)
   :`${Math.round(winPct(r.score))} % de chances de gain pour les ${side}`;
  return {from:mv.from,to:mv.to,san:mv.san,text:`Stockfish joue <b>${esc(mv.san)}</b> (flèche) · ${ev}.`}})}
