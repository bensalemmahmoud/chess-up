/* ---------- parties jouées sur l'échiquier (club, tournoi) ---------- */
// La partie est collée dans la page (PGN, ou seulement les coups, en notation française ou anglaise) et analysée par le
// Stockfish du navigateur. Rien n'est envoyé : elle est rangée dans srs sous « otb:<id> » (donc dans le lien de
// synchronisation), avec ses moments critiques, qui forment le thème « Mes parties sur l'échiquier ».
const OTB_MS=1000;   // temps de Stockfish par position : environ 1 min 30 pour une partie de 45 coups
let otbBusy=false;

const otbGames=()=>Object.entries(srs).filter(([k,v])=>k.startsWith('otb:')&&!k.includes('#')&&!v.del).map(([k,v])=>({id:k.slice(4),...v}))
 .sort((a,b)=>(b.date||'').localeCompare(a.date||'')||b.t-a.t);
const otbMoments=()=>otbGames().flatMap(g=>g.moments||[]);

// Coups lus dans le texte : en-têtes, commentaires, variantes, numéros et annotations retirés ; notation française
// (R, D, T, F, C) traduite si le texte en contient
function parsePgn(text){const tags={};text.replace(/\[(\w+)\s+"([^"]*)"\]/g,(_,k,v)=>tags[k]=v);
 let body=text.replace(/\[[^\]]*\]/g,' ').replace(/\{[^}]*\}/g,' ').replace(/;[^\n]*/g,' ').replace(/\$\d+/g,' ');
 while(/\([^()]*\)/.test(body))body=body.replace(/\([^()]*\)/g,' ');
 const toks=body.replace(/\d+\.(\.\.)?/g,' ').split(/\s+/).map(t=>t.replace(/[!?]+$/,'').replace(/e\.p\.$/,'')).filter(t=>t&&!/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(t));
 const french=toks.some(t=>/^[DTFC]/.test(t)||/=[DTFC]/.test(t));
 const FR={R:'K',D:'Q',T:'R',F:'B',C:'N'};
 const G=new Chess(),sans=[];
 for(const [i,raw] of toks.entries()){let t=raw.replace(/0-0-0/g,'O-O-O').replace(/0-0/g,'O-O');
  if(french)t=t.replace(/^[RDTFC]/,c=>FR[c]).replace(/=([RDTFC])/,(_,c)=>'='+FR[c]);
  const mv=G.move(t,{sloppy:true});
  if(!mv)throw new Error(`coup ${Math.floor(i/2)+1}${i%2?' des Noirs':''} illisible : « ${raw} »`);
  sans.push(mv.san)}
 if(sans.length<10)throw new Error('il faut au moins 5 coups');
 return {tags,sans}}

// Analyse : évaluation et meilleur coup de chaque position (point de vue des Blancs), puis les erreurs du joueur
function analyseOtb(text,color,progress){const {tags,sans}=parsePgn(text),G=new Chess(),fens=[G.fen()];
 sans.forEach(s=>{G.move(s);fens.push(G.fen())});
 const evals=[],best=[];
 const step=i=>{if(i>=fens.length)return Promise.resolve();const P=new Chess(fens[i]);progress(i,fens.length);
  if(P.game_over()){evals.push(P.in_checkmate()?(P.turn()==='w'?-1000:1000):0);best.push(null);return step(i+1)}
  return Engine.move(fens[i],OTB_MS).then(r=>{evals.push(P.turn()==='w'?r.score:-r.score);
   best.push(P.move({from:r.from,to:r.to,promotion:r.promotion||'q'})?.san||null);return step(i+1)})};
 return step(0).then(()=>{const id=Date.now().toString(36),sign=color==='w'?1:-1,moments=[];
  const opp=color==='w'?tags.Black:tags.White,date=(tags.Date||'').replace(/\?/g,'').replace(/\.+$/,'').replace(/\./g,'-')||null;
  for(let i=color==='w'?0:1;i<sans.length;i+=2){const wb=winPct(sign*evals[i]),wa=winPct(sign*evals[i+1]);
   if(wb-wa<T.err||!best[i]||bare(best[i])===bare(sans[i]))continue;
   const P=new Chess(fens[i]),ph=phaseOf(P);
   moments.push({id:`otb:${id}#${i}`,otb:id,fen:fens[i],best:best[i],san:sans[i],wb:Math.round(wb),wa:Math.round(wa),ply:i,ph,
    ft:ph==='finale'?endgameKind(P):undefined,n:`${fens[i].split(' ')[5]}${i%2?'...':'.'}`,sev:wb-wa>=T.gaf?'gaf':'err',alts:[],date,adv:opp&&opp!=='?'?opp:null})}
  const res=tags.Result==='1/2-1/2'?'Nulle':tags.Result===(color==='w'?'1-0':'0-1')?'Victoire':tags.Result===(color==='w'?'0-1':'1-0')?'Défaite':null;
  srs['otb:'+id]={t:Date.now(),n:1,date,adv:moments[0]?.adv??(opp&&opp!=='?'?opp:null),couleur:color,res,coups:Math.ceil(sans.length/2),moments};saveSrs();
  return srs['otb:'+id]})}

function renderOtb(){const L=otbGames();
 $('otbList').innerHTML=L.length?'<thead><tr><th>Date</th><th>Couleur</th><th>Adversaire</th><th>Résultat</th><th class="num">Coups</th><th class="num">Erreurs</th><th></th></tr></thead><tbody>'
  +L.map(g=>`<tr><td>${esc(g.date||'—')}</td><td>${g.couleur==='w'?'Blancs':'Noirs'}</td><td>${esc(g.adv||'—')}</td><td class="${g.res==='Victoire'?'win':g.res==='Défaite'?'loss':g.res?'draw':''}">${g.res||'—'}</td>
  <td class="num">${g.coups}</td><td class="num">${g.moments.length}</td><td><button class="linkbtn" data-del="${esc(g.id)}">Supprimer</button></td></tr>`).join('')+'</tbody>'
  :'<tbody><tr><td class="empty">Aucune partie ajoutée pour l\'instant.</td></tr></tbody>'}

$('otbGo').onclick=()=>{if(otbBusy)return;const text=$('otbPgn').value.trim();if(!text){$('otbMsg').textContent='Colle d\'abord ta partie.';return}
 try{parsePgn(text)}catch(e){$('otbMsg').innerHTML=`<span class="loss">Partie illisible : ${esc(e.message)}.</span>`;return}
 otbBusy=true;$('otbGo').disabled=true;
 analyseOtb(text,$('otbColor').value,(i,n)=>$('otbMsg').textContent=`Analyse par Stockfish : position ${i+1} sur ${n}… (reste sur la page)`)
 .then(g=>{$('otbPgn').value='';$('otbMsg').innerHTML=`<span class="win">Partie analysée : ${g.moments.length} erreur${g.moments.length>1?'s':''} à retravailler</span> dans le thème « Mes parties sur l'échiquier ».`;
  renderOtb();deckChosen=true;renderTraining(baseFilter(false));if(g.moments.length){$('tDeck').value='otb';buildQueue(false)}})
 .catch(e=>{$('otbMsg').innerHTML=`<span class="loss">Analyse impossible : ${esc(e.message||'Stockfish n\'a pas pu démarrer (connexion internet nécessaire)')}.</span>`})
 .finally(()=>{otbBusy=false;$('otbGo').disabled=false})};
// Suppression : une marque datée plutôt qu'un effacement, pour que la synchronisation ne fasse pas revenir la partie
$('otbList').addEventListener('click',e=>{const b=e.target.closest('[data-del]');if(!b)return;
 if(b.dataset.confirm!=='1'){b.dataset.confirm='1';b.textContent='Confirmer ?';return}
 srs['otb:'+b.dataset.del]={t:Date.now(),del:1};saveSrs();renderOtb();renderTraining(baseFilter(false))});
renderOtb();
