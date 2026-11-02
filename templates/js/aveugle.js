/* ---------- calcul à l'aveugle ---------- */
// L'échiquier montre une position de partie longue de joueur fort (D.parties) et ne bouge plus : on lit les coups
// qui suivent, on les joue dans sa tête, puis on désigne le meilleur coup de la position d'arrivée (case de départ, case
// d'arrivée) sur l'échiquier de départ. Validé : le meilleur coup du cache, le coup joué s'il ne perdait presque rien,
// ou un coup que le Stockfish du navigateur juge presque aussi bon. srs « calc » : h = [date, longueur, réussi].
const CALC_MAX_EVAL=350,CALC_HISTORY=300;
let aCur=null;

function calcPick(len){for(let tries=0;tries<200;tries++){const p=PARTIES[Math.floor(Math.random()*PARTIES.length)],moves=p.m.split(' ');
  const q=DV_START+Math.floor(Math.random()*Math.max(1,moves.length-len-DV_START-2)),end=q+len;
  if(end>=moves.length||!p.b[end]||Math.abs(p.e[end])>CALC_MAX_EVAL)continue;
  const G=new Chess();for(let i=0;i<q;i++)dvUci(G,moves[i]);
  const start=G.fen(),line=[];for(let i=q;i<end;i++)line.push(dvUci(G,moves[i]));
  if(G.game_over()||G.in_check())continue;   // pas d'échec à parer : le coup se cherche vraiment
  return {p,q,end,start,line,final:G.fen(),best:new Chess(G.fen()).move({from:p.b[end].slice(0,2),to:p.b[end].slice(2,4),promotion:p.b[end][4]||'q'})}}
 return null}
function renderAveugle(){$('aBlock').hidden=!PARTIES.length;$('aMissing').hidden=!!PARTIES.length;
 if(!PARTIES.length){$('aMissing').textContent='Aucune partie de joueur fort disponible : elles arrivent avec l\'analyse Stockfish.';return}
 calcNext()}
function calcStats(){const h=srs.calc?.h||[],by={};h.forEach(([,l,ok])=>{const o=by[l]??={n:0,ok:0};o.n++;o.ok+=ok});
 $('aStats').textContent=Object.keys(by).sort().map(l=>`${l} demi-coups : ${by[l].ok}/${by[l].n}`).join(' · ')}
function calcNext(){const len=+$('aLen').value,x=calcPick(len);if(!x)return;
 aCur={...x,len,sel:null,done:false,busy:false,view:0};
 const p=x.start.split(' ');let n=+p[5],w=p[1]==='w';
 $('aLine').innerHTML=x.line.map((m,i)=>{const s=(w?n+'.':i===0?n+'...':'')+esc(m.san);if(!w)n++;w=!w;return s}).join(' ');
 const side=new Chess(x.final).turn()==='w'?'Blancs':'Noirs';
 $('aTitle').textContent=`Après ces coups, les ${side} jouent : quel est le meilleur coup ?`;
 $('aMeta').textContent=`Partie longue · ${x.p.elo||'?'} contre ${x.p.eloa||'?'}${x.p.fam?' · '+x.p.fam:''}`;
 aFeedback('','Joue la suite dans ta tête, puis clique sur la case de départ et la case d\'arrivée de ton coup.');calcDraw();calcStats()}
function aFeedback(cls,html){$('aFeedback').className='feedback '+cls;$('aFeedback').innerHTML=html}
// Avant la réponse : la position de départ, figée. Après : on peut parcourir la suite (◀/▶), jusqu'au meilleur coup
function calcDraw(){const c=aCur,orient=new Chess(c.final).turn()==='b';
 if(!c.done){$('aBoard').innerHTML=boardHTML(new Chess(c.start),orient,{sel:c.sel});$('aBack').disabled=$('aFwd').disabled=true;return}
 const G=new Chess(c.start),moves=[...c.line,...(c.best?[c.best]:[])];let last=null;
 for(let i=0;i<c.view;i++){const m=G.move(moves[i].san);last=[m.from,m.to]}
 $('aBoard').innerHTML=boardHTML(G,orient,{last,hint:c.view===moves.length&&c.best?c.best.to:null});
 $('aBack').disabled=c.view===0;$('aFwd').disabled=c.view>=moves.length}
function calcRecord(ok){const rec=srs.calc||{h:[]};rec.h=[...rec.h,[Date.now(),aCur.len,ok?1:0]].slice(-CALC_HISTORY);rec.t=Date.now();srs.calc=rec;saveSrs()}
function calcFinish(ok,html){const c=aCur;c.done=true;c.busy=false;c.view=c.line.length+(c.best?1:0);calcRecord(ok);
 aFeedback(ok?'ok':'ko',html+' Parcours la suite avec ◀/▶.');calcDraw();calcStats()}
function calcAnswer(from,to){const c=aCur,F=new Chess(c.final),mv=F.move({from,to,promotion:'q'});
 if(!mv){aFeedback('ko',`Ce coup n'est pas possible dans la position d'arrivée : revérifie où sont les pièces après la suite, puis réessaie.`);return}
 const u=mv.from+mv.to+(mv.promotion||''),p=c.p,sign=F.turn()==='w'?-1:1;   // F a joué : le camp qui joue est l'autre
 const bestSan=c.best?.san;
 if(u===p.b[c.end])return calcFinish(true,`<b>Exact :</b> ${esc(mv.san)} est le coup de Stockfish.`);
 const lm=Math.max(0,winPct(sign*p.e[c.end])-winPct(sign*p.e[c.end+1]));
 if(u===c.p.m.split(' ')[c.end]&&lm<T.imp)return calcFinish(true,`<b>Bien vu :</b> ${esc(mv.san)}, le coup joué dans la partie. Stockfish préférait ${esc(bestSan)}.`);
 c.busy=true;aFeedback('','Stockfish vérifie ton coup…');
 const B=new Chess(c.final);B.move(bestSan);
 dvWin(F).then(wu=>dvWin(B).then(wb=>{if(aCur!==c)return;const loss=Math.max(0,wb-wu);
  calcFinish(loss<T.imp,loss<T.imp?`<b>Bon coup :</b> ${esc(mv.san)} vaut presque ${esc(bestSan)}, le choix de Stockfish.`
   :`<b>Pas le meilleur :</b> ${esc(mv.san)} perd ${Math.round(loss)} points de chances de gain. Stockfish joue ${esc(bestSan)}.`)}))
 .catch(()=>{if(aCur!==c)return;c.busy=false;aFeedback('ko','Stockfish n\'a pas pu démarrer (connexion internet nécessaire).')})}
$('aBoard').addEventListener('click',e=>{const el=e.target.closest('.sq'),c=aCur;if(!el||!c||c.done||c.busy)return;
 const sq=el.dataset.sq;if(!c.sel||c.sel===sq){c.sel=c.sel===sq?null:sq;return calcDraw()}
 const from=c.sel;c.sel=null;calcDraw();calcAnswer(from,sq)});
$('aBack').onclick=()=>{if(aCur?.done&&aCur.view>0){aCur.view--;calcDraw()}};
$('aFwd').onclick=()=>{const c=aCur;if(c?.done&&c.view<c.line.length+(c.best?1:0)){c.view++;calcDraw()}};
$('aSolve').onclick=()=>{const c=aCur;if(!c||c.done||c.busy)return;calcFinish(false,`Le meilleur coup était <b>${esc(c.best?.san)}</b>.`)};
$('aNext').onclick=calcNext;
$('aLen').addEventListener('change',calcNext);
MODE_OPEN.aveugle=()=>{if(!aCur)renderAveugle()};
