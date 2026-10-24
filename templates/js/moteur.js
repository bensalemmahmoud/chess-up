/* ---------- Stockfish dans le navigateur ---------- */
// Chargé à la première partie seulement (1,5 Mo). Un Worker doit venir de la même origine que la page :
// le script est donc téléchargé puis lancé depuis un Blob.
const Engine=(()=>{const URL_SF='https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
 let worker=null,ready=null,busy=Promise.resolve();
 function start(){
  if(!ready)ready=fetch(URL_SF).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(src=>new Promise((resolve,reject)=>{
   worker=new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})));
   worker.onerror=reject;
   worker.onmessage=e=>{if(String(e.data).startsWith('uciok'))resolve()};
   worker.postMessage('uci')})).catch(err=>{ready=null;throw err});
  return ready}
 // Meilleur coup et évaluation (en centipions, du point de vue du camp au trait), une recherche à la fois
 function move(fen,ms){
  const job=busy.then(start).then(()=>new Promise(resolve=>{let score=0;
   worker.onmessage=e=>{const line=String(e.data),m=line.match(/score (cp|mate) (-?\d+)/);
    if(m)score=m[1]==='cp'?+m[2]:(+m[2]>0?1000:-1000);
    if(line.startsWith('bestmove')){const u=line.split(' ')[1];resolve({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4],score})}};
   worker.postMessage('position fen '+fen);worker.postMessage('go movetime '+ms)}));
  busy=job.catch(()=>{});return job}
 return {start,move}})();
