/* ---------- deviner le coup ---------- */
// Parties longues de joueurs du haut du classement Lichess (D.parties : coups UCI, évaluations et meilleurs coups du
// cache), rejouées du côté du joueur fort : à chaque coup, le joueur propose le sien. Le coup du maître est trouvé, ou
// celui du joueur est comparé au sien par le Stockfish du navigateur (même moteur, même temps pour les deux).
// Progression dans srs sous « dv:<id> » : ply = où reprendre, n coups devinés, f trouvés, a et am = sommes des précisions.
const DV_START=16,DV_MS=900;   // on devine à partir du 9e coup (l'ouverture se joue toute seule)
const PARTIES=D.parties||[];
let dCur=null;

const dvUci=(G,u)=>G.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'});
const dvRec=p=>srs['dv:'+p.id]||{ply:0,n:0,f:0,a:0,am:0};
function dvLabel(p,i){const r=dvRec(p),done=r.ply>=p.m.split(' ').length,etat=done?' · '+tx('✓ terminée'):r.n?' · '+tx('en cours ({n} coups)',{n:r.n}):'';
 if(p.nom)return `${i+1}. ${p.nom} · ${typeof COURS!=='undefined'&&COURS[p.st]?COURS[p.st].nom:tx('structure')} · ${p.c==='w'?tx('du côté des Blancs'):tx('du côté des Noirs')}${etat}`;
 return `${i+1}. ${tx('{a} contre {b}',{a:p.elo||'?',b:p.eloa||'?'})} · ${p.fam||tx('ouverture ?')} · ${p.res==='Victoire'?tx('victoire du joueur fort'):p.res==='Défaite'?tx('défaite du joueur fort'):tx('nulle du joueur fort')}${etat}`}
function renderDevine(){const sel=$('dGame'),prev=sel.value;
 if(!PARTIES.length){$('dBlock').hidden=true;$('dMissing').hidden=false;
  $('dMissing').textContent=tx('Aucune partie de joueur fort disponible : elles arrivent avec l\'analyse Stockfish (parties longues du haut du classement Lichess).');return}
 $('dBlock').hidden=false;$('dMissing').hidden=true;
 // d'abord les parties dans les familles d'ouvertures que tu joues
 // (les parties des cours par structure viennent après les parties longues du haut du classement)
 const fams=new Set(D.games.map(g=>g.famille).filter(Boolean)),order=PARTIES.map((p,i)=>i).sort((a,b)=>!!PARTIES[a].st-!!PARTIES[b].st||fams.has(PARTIES[b].fam)-fams.has(PARTIES[a].fam));
 sel.innerHTML=order.map(i=>`<option value="${i}">${esc(dvLabel(PARTIES[i],i))}</option>`).join('');
 const firstOpen=order.find(i=>dvRec(PARTIES[i]).ply<PARTIES[i].m.split(' ').length);
 sel.value=prev&&PARTIES[+prev]?prev:String(firstOpen??order[0]);dvStart(+sel.value)}
function dvStart(i,restart){const p=PARTIES[i],moves=p.m.split(' '),r=restart?{ply:0,n:0,f:0,a:0,am:0}:dvRec(p);
 const G=new Chess();let ply=0;
 const target=Math.max(p.start||DV_START,r.ply);   // partie d'un cours : depuis l'entrée dans la structure
 while(ply<moves.length&&(ply<target||(ply%2===0?'w':'b')!==p.c)){dvUci(G,moves[ply]);ply++}
 dCur={p,i,moves,G,ply,r:{...r},sel:null,last:null,busy:false,expl:null,shown:false,hint:false};
 const h=G.history({verbose:true}).pop();if(h)dCur.last=[h.from,h.to];
 $('dWhyOut').innerHTML='';$('dViewNav').hidden=true;dvFeedback('',ply>=moves.length?tx('Partie terminée.'):tx('À toi : quel coup joue le joueur fort ?'));dvDraw()}
function dvFeedback(cls,html){$('dFeedback').className='feedback '+cls;$('dFeedback').innerHTML=html}
function dvDraw(){const c=dCur,G=c.G,ask=!c.shown&&!c.busy&&c.ply<c.moves.length;
 $('dBoard').innerHTML=boardHTML(G,c.p.c==='b',{last:c.last,sel:c.sel,hint:ask&&c.hint?c.moves[c.ply].slice(0,2):null,targets:ask&&c.sel?G.moves({square:c.sel,verbose:true}):[]});
 const r=c.r;$('dMeta').textContent=tx('{a} Elo contre {b}',{a:c.p.elo||'?',b:c.p.eloa||'?'})+(c.p.fam?' · '+c.p.fam:'');
 $('dTitle').textContent=c.ply<c.moves.length?(c.p.c==='w'?tx('Coup {n} · tu joues les Blancs',{n:G.fen().split(' ')[5]}):tx('Coup {n} · tu joues les Noirs',{n:G.fen().split(' ')[5]})):tx('Fin de la partie');
 $('dStats').textContent=r.n?tx('{f}/{n} coups trouvés · ta précision : {a} · celle du joueur fort : {m}',{f:r.f,n:r.n,a:fmt(r.a/r.n,0)+PC,m:fmt(r.am/r.n,0)+PC}):'';
 $('dWhy').hidden=!c.shown;$('dNext').hidden=!c.shown;$('dSkip').hidden=$('dHint').hidden=c.shown||c.ply>=c.moves.length;$('dHint').disabled=c.hint}
function dvSave(){const c=dCur;srs['dv:'+c.p.id]={...c.r,ply:c.ply,t:Date.now()};saveSrs()}

// Chances de gain du camp qui vient de jouer, après le coup
const dvWin=G=>G.in_checkmate()?Promise.resolve(100):G.game_over()?Promise.resolve(50):Engine.move(G.fen(),DV_MS).then(r=>100-winPct(r.score));
function dvGuess(mv){const c=dCur,p=c.p,ply=c.ply,master=c.moves[ply],sign=p.c==='w'?1:-1,u=mv.from+mv.to+(mv.promotion||'');
 c.G.undo();c.fenBefore=c.G.fen();c.guess=mv.san;   // le coup proposé est retiré : on joue ensuite celui du maître
 const lm=Math.max(0,winPct(sign*p.e[ply])-winPct(sign*p.e[ply+1]));   // ce que son coup a coûté (cache)
 const M=new Chess(c.fenBefore),mm=dvUci(M,master),found=u===master;c.masterSan=mm.san;
 const finish=loss=>{c.busy=false;c.r.n++;if(found&&!c.hint)c.r.f++;   // trouvé avec l'indice : pas compté comme trouvé
  c.r.a+=moveAccuracy(loss);c.r.am+=moveAccuracy(lm);
  const san=esc(mm.san),pts=Math.round(loss);
  const grade=found?['ok',c.hint?tx('<b>C\'est son coup</b> (avec l\'indice).'):tx('<b>C\'est son coup !</b>')]:loss<T.imp?['ok',tx('<b>Bon coup aussi.</b> Il a joué <b>{san}</b>.',{san})]
   :loss<T.err?['',tx('<b>Imprécis</b> (−{n} points de chances de gain). Il a joué <b>{san}</b>.',{n:pts,san})]
   :['ko',tx('<b>Erreur</b> (−{n} points de chances de gain). Il a joué <b>{san}</b>.',{n:pts,san})];
  const best=p.b[ply]&&p.b[ply]!==master?(()=>{const B=new Chess(c.fenBefore),b=dvUci(B,p.b[ply]);return b?' '+tx('Stockfish préférait {san}.',{san:esc(b.san)}):''})():'';
  dvUci(c.G,master);c.last=[master.slice(0,2),master.slice(2,4)];c.shown=true;
  dvFeedback(grade[0],`${grade[1]}${found?'':' '+tx('Tu as proposé {san}.',{san:esc(mv.san)})}${best}`);dvDraw()};
 if(found)return finish(lm);
 if(u===p.b[ply])return finish(0);
 const Gg=new Chess(c.fenBefore);Gg.move(mv.san);
 c.busy=true;dvFeedback('',tx('Stockfish compare ton coup au sien…'));dvDraw();
 dvWin(Gg).then(wg=>dvWin(M).then(wm=>{if(dCur!==c)return;finish(Math.max(0,lm+wm-wg))}))
 .catch(()=>{if(dCur!==c)return;c.busy=false;dvFeedback('ko',tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).'));dvDraw()})}
// Suite : la réponse de l'adversaire, puis à nouveau au joueur
function dvNext(){const c=dCur;c.ply++;c.shown=false;c.hint=false;c.expl=null;c.view=null;$('dViewNav').hidden=true;$('dWhyOut').innerHTML='';
 if(c.ply<c.moves.length){const r=dvUci(c.G,c.moves[c.ply]);c.last=[r.from,r.to];c.ply++}
 dvSave();
 if(c.ply>=c.moves.length){const r=c.r;dvFeedback('ok',tx('<b>Partie terminée.</b> {f}/{n} coups trouvés, ta précision {a} contre {m} pour le joueur fort.',{f:r.f,n:r.n,a:fmt(r.a/Math.max(1,r.n),0)+PC,m:fmt(r.am/Math.max(1,r.n),0)+PC}));
  $('dGame').options[$('dGame').selectedIndex].text=dvLabel(c.p,c.i)}
 else dvFeedback('',tx('Ton adversaire a joué {san}. À toi.',{san:esc(c.G.history().slice(-1)[0])}));
 dvDraw()}

$('dBoard').addEventListener('click',e=>{const el=e.target.closest('.sq'),c=dCur;if(!el||!c||c.busy||c.shown||c.ply>=c.moves.length)return;
 const sq=el.dataset.sq,G=c.G;
 if(c.sel&&G.moves({square:c.sel,verbose:true}).some(x=>x.to===sq)){const mv=G.move({from:c.sel,to:sq,promotion:'q'});c.sel=null;return dvGuess(mv)}
 const pc=G.get(sq);c.sel=pc&&pc.color===G.turn()&&c.sel!==sq?sq:null;dvDraw()});
$('dNext').onclick=()=>{if(dCur?.shown)dvNext()};
$('dSkip').onclick=()=>{const c=dCur;if(!c||c.busy||c.shown||c.ply>=c.moves.length)return;c.fenBefore=c.G.fen();
 const mv=dvUci(c.G,c.moves[c.ply]);c.masterSan=mv.san;c.guess=null;c.last=[mv.from,mv.to];c.shown=true;dvFeedback('',tx('Il a joué <b>{san}</b> (coup non compté).',{san:esc(mv.san)}));dvDraw()};
// Indice : la pièce que joue le joueur fort
$('dHint').onclick=()=>{const c=dCur;if(!c||c.busy||c.shown||c.hint||c.ply>=c.moves.length)return;c.hint=true;
 const pc=c.G.get(c.moves[c.ply].slice(0,2));
 dvFeedback('',{p:tx('Indice : il joue un coup de pion (case surlignée).'),n:tx('Indice : il joue un coup de cavalier (case surlignée).'),b:tx('Indice : il joue un coup de fou (case surlignée).'),
  r:tx('Indice : il joue un coup de tour (case surlignée).'),q:tx('Indice : il joue un coup de la dame (case surlignée).'),k:tx('Indice : il joue un coup du roi (case surlignée).')}[pc.type]);dvDraw()};
$('dRestart').onclick=()=>{if(dCur)dvStart(dCur.i,true)};
$('dGame').addEventListener('change',e=>dvStart(+e.target.value));
$('dWhy').onclick=()=>{const c=dCur;if(!c?.shown||c.expl)return;c.expl='calc';$('dWhyOut').innerHTML=`<p class="muted">${tx('Stockfish cherche les variantes (quelques secondes)…')}</p>`;
 explainAll(c.fenBefore,c.masterSan,c.guess).then(x=>{if(dCur!==c)return;c.expl=x;
  $('dWhyOut').innerHTML=explainHTML(x,{best:tx('Pourquoi {san} : la suite de Stockfish',{san:esc(x.best.san)}),refut:tx('Et ton coup, {san} ? La réponse de Stockfish',{san:esc(x.refut?.san)})})})
 .catch(()=>{if(dCur!==c)return;c.expl=null;$('dWhyOut').innerHTML=`<p class="loss">${tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).')}</p>`})};
// Rejouer une variante : sur un échiquier à part, coup par coup (◀/▶), sans toucher à la partie
$('dWhyOut').addEventListener('click',e=>{const b=e.target.closest('[data-line]'),c=dCur;if(!b||!c?.expl?.best)return;
 const l=c.expl[b.dataset.line];c.view={G:new Chess(l.fen),moves:l.moves,i:0};dvView()});
function dvView(){const v=dCur.view,G=new Chess(v.G.fen());let last=null;
 for(let k=0;k<v.i;k++){const m=G.move(v.moves[k]);last=[m.from,m.to]}
 $('dBoard').innerHTML=boardHTML(G,dCur.p.c==='b',{last});
 $('dViewNav').hidden=false;$('dViewInfo').textContent=v.i?`${v.i}/${v.moves.length} · ${v.moves[v.i-1]}`:tx('Début de la variante')}
$('dViewBack').onclick=()=>{const v=dCur?.view;if(v&&v.i>0){v.i--;dvView()}};
$('dViewFwd').onclick=()=>{const v=dCur?.view;if(v&&v.i<v.moves.length){v.i++;dvView()}};
$('dViewEnd').onclick=()=>{if(!dCur)return;dCur.view=null;$('dViewNav').hidden=true;dvDraw()};
MODE_OPEN.devine=()=>{if(!dCur)renderDevine()};
