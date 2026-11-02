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
function dvLabel(p,i){const r=dvRec(p),done=r.ply>=p.m.split(' ').length;
 return `${i+1}. ${p.elo||'?'} contre ${p.eloa||'?'} · ${p.fam||'ouverture ?'} · ${p.res==='Victoire'?'victoire':p.res==='Défaite'?'défaite':'nulle'} du joueur fort${done?' · ✓ terminée':r.n?` · en cours (${r.n} coups)`:''}`}
function renderDevine(){const sel=$('dGame'),prev=sel.value;
 if(!PARTIES.length){$('dBlock').hidden=true;$('dMissing').hidden=false;
  $('dMissing').textContent='Aucune partie de joueur fort disponible : elles arrivent avec l\'analyse Stockfish (parties longues du haut du classement Lichess).';return}
 $('dBlock').hidden=false;$('dMissing').hidden=true;
 // d'abord les parties dans les familles d'ouvertures que tu joues
 const fams=new Set(D.games.map(g=>g.famille).filter(Boolean)),order=PARTIES.map((p,i)=>i).sort((a,b)=>fams.has(PARTIES[b].fam)-fams.has(PARTIES[a].fam));
 sel.innerHTML=order.map(i=>`<option value="${i}">${esc(dvLabel(PARTIES[i],i))}</option>`).join('');
 const firstOpen=order.find(i=>dvRec(PARTIES[i]).ply<PARTIES[i].m.split(' ').length);
 sel.value=prev&&PARTIES[+prev]?prev:String(firstOpen??order[0]);dvStart(+sel.value)}
function dvStart(i,restart){const p=PARTIES[i],moves=p.m.split(' '),r=restart?{ply:0,n:0,f:0,a:0,am:0}:dvRec(p);
 const G=new Chess();let ply=0;
 const target=Math.max(DV_START,r.ply);
 while(ply<moves.length&&(ply<target||(ply%2===0?'w':'b')!==p.c)){dvUci(G,moves[ply]);ply++}
 dCur={p,i,moves,G,ply,r:{...r},sel:null,last:null,busy:false,expl:null,shown:false};
 const h=G.history({verbose:true}).pop();if(h)dCur.last=[h.from,h.to];
 $('dWhyOut').innerHTML='';$('dViewNav').hidden=true;dvFeedback('',ply>=moves.length?'Partie terminée.':'À toi : quel coup joue le joueur fort ?');dvDraw()}
function dvFeedback(cls,html){$('dFeedback').className='feedback '+cls;$('dFeedback').innerHTML=html}
function dvDraw(){const c=dCur,G=c.G,ask=!c.shown&&!c.busy&&c.ply<c.moves.length;
 $('dBoard').innerHTML=boardHTML(G,c.p.c==='b',{last:c.last,sel:c.sel,targets:ask&&c.sel?G.moves({square:c.sel,verbose:true}):[]});
 const r=c.r;$('dMeta').textContent=`${c.p.elo||'?'} Elo contre ${c.p.eloa||'?'}${c.p.fam?' · '+c.p.fam:''}`;
 $('dTitle').textContent=c.ply<c.moves.length?`Coup ${G.fen().split(' ')[5]} · tu joues les ${c.p.c==='w'?'Blancs':'Noirs'}`:'Fin de la partie';
 $('dStats').textContent=r.n?`${r.f}/${r.n} coups trouvés · ta précision : ${fmt(r.a/r.n,0)} % · celle du joueur fort : ${fmt(r.am/r.n,0)} %`:'';
 $('dWhy').hidden=!c.shown;$('dNext').hidden=!c.shown;$('dSkip').hidden=c.shown||c.ply>=c.moves.length}
function dvSave(){const c=dCur;srs['dv:'+c.p.id]={...c.r,ply:c.ply,t:Date.now()};saveSrs()}

// Chances de gain du camp qui vient de jouer, après le coup
const dvWin=G=>G.in_checkmate()?Promise.resolve(100):G.game_over()?Promise.resolve(50):Engine.move(G.fen(),DV_MS).then(r=>100-winPct(r.score));
function dvGuess(mv){const c=dCur,p=c.p,ply=c.ply,master=c.moves[ply],sign=p.c==='w'?1:-1,u=mv.from+mv.to+(mv.promotion||'');
 c.G.undo();c.fenBefore=c.G.fen();c.guess=mv.san;   // le coup proposé est retiré : on joue ensuite celui du maître
 const lm=Math.max(0,winPct(sign*p.e[ply])-winPct(sign*p.e[ply+1]));   // ce que son coup a coûté (cache)
 const M=new Chess(c.fenBefore),mm=dvUci(M,master),found=u===master;c.masterSan=mm.san;
 const finish=loss=>{c.busy=false;c.r.n++;if(found)c.r.f++;c.r.a+=moveAccuracy(loss);c.r.am+=moveAccuracy(lm);
  const grade=found?['ok','<b>C\'est son coup !</b>']:loss<T.imp?['ok',`<b>Bon coup aussi.</b> Il a joué <b>${esc(mm.san)}</b>.`]
   :loss<T.err?['',`<b>Imprécis</b> (−${Math.round(loss)} points de chances de gain). Il a joué <b>${esc(mm.san)}</b>.`]
   :['ko',`<b>Erreur</b> (−${Math.round(loss)} points de chances de gain). Il a joué <b>${esc(mm.san)}</b>.`];
  const best=p.b[ply]&&p.b[ply]!==master?(()=>{const B=new Chess(c.fenBefore),b=dvUci(B,p.b[ply]);return b?` Stockfish préférait ${esc(b.san)}.`:''})():'';
  dvUci(c.G,master);c.last=[master.slice(0,2),master.slice(2,4)];c.shown=true;
  dvFeedback(grade[0],`${grade[1]}${found?'':` Tu as proposé ${esc(mv.san)}.`}${best}`);dvDraw()};
 if(found)return finish(lm);
 if(u===p.b[ply])return finish(0);
 const Gg=new Chess(c.fenBefore);Gg.move(mv.san);
 c.busy=true;dvFeedback('','Stockfish compare ton coup au sien…');dvDraw();
 dvWin(Gg).then(wg=>dvWin(M).then(wm=>{if(dCur!==c)return;finish(Math.max(0,lm+wm-wg))}))
 .catch(()=>{if(dCur!==c)return;c.busy=false;dvFeedback('ko','Stockfish n\'a pas pu démarrer (connexion internet nécessaire).');dvDraw()})}
// Suite : la réponse de l'adversaire, puis à nouveau au joueur
function dvNext(){const c=dCur;c.ply++;c.shown=false;c.expl=null;c.view=null;$('dViewNav').hidden=true;$('dWhyOut').innerHTML='';
 if(c.ply<c.moves.length){const r=dvUci(c.G,c.moves[c.ply]);c.last=[r.from,r.to];c.ply++}
 dvSave();
 if(c.ply>=c.moves.length){const r=c.r;dvFeedback('ok',`<b>Partie terminée.</b> ${r.f}/${r.n} coups trouvés, ta précision ${fmt(r.a/Math.max(1,r.n),0)} % contre ${fmt(r.am/Math.max(1,r.n),0)} % pour le joueur fort.`);
  $('dGame').options[$('dGame').selectedIndex].text=dvLabel(c.p,c.i)}
 else dvFeedback('',`Ton adversaire a joué ${esc(c.G.history().slice(-1)[0])}. À toi.`);
 dvDraw()}

$('dBoard').addEventListener('click',e=>{const el=e.target.closest('.sq'),c=dCur;if(!el||!c||c.busy||c.shown||c.ply>=c.moves.length)return;
 const sq=el.dataset.sq,G=c.G;
 if(c.sel&&G.moves({square:c.sel,verbose:true}).some(x=>x.to===sq)){const mv=G.move({from:c.sel,to:sq,promotion:'q'});c.sel=null;return dvGuess(mv)}
 const pc=G.get(sq);c.sel=pc&&pc.color===G.turn()&&c.sel!==sq?sq:null;dvDraw()});
$('dNext').onclick=()=>{if(dCur?.shown)dvNext()};
$('dSkip').onclick=()=>{const c=dCur;if(!c||c.busy||c.shown||c.ply>=c.moves.length)return;c.fenBefore=c.G.fen();
 const mv=dvUci(c.G,c.moves[c.ply]);c.masterSan=mv.san;c.guess=null;c.last=[mv.from,mv.to];c.shown=true;dvFeedback('',`Il a joué <b>${esc(mv.san)}</b> (coup non compté).`);dvDraw()};
$('dRestart').onclick=()=>{if(dCur)dvStart(dCur.i,true)};
$('dGame').addEventListener('change',e=>dvStart(+e.target.value));
$('dWhy').onclick=()=>{const c=dCur;if(!c?.shown||c.expl)return;c.expl='calc';$('dWhyOut').innerHTML='<p class="muted">Stockfish cherche les variantes (quelques secondes)…</p>';
 explainAll(c.fenBefore,c.masterSan,c.guess).then(x=>{if(dCur!==c)return;c.expl=x;
  $('dWhyOut').innerHTML=explainHTML(x,{best:`Pourquoi ${esc(x.best.san)} : la suite de Stockfish`,refut:`Et ton coup, ${esc(x.refut?.san)} ? La réponse de Stockfish`})})
 .catch(()=>{if(dCur!==c)return;c.expl=null;$('dWhyOut').innerHTML='<p class="loss">Stockfish n\'a pas pu démarrer (connexion internet nécessaire).</p>'})};
// Rejouer une variante : sur un échiquier à part, coup par coup (◀/▶), sans toucher à la partie
$('dWhyOut').addEventListener('click',e=>{const b=e.target.closest('[data-line]'),c=dCur;if(!b||!c?.expl?.best)return;
 const l=c.expl[b.dataset.line];c.view={G:new Chess(l.fen),moves:l.moves,i:0};dvView()});
function dvView(){const v=dCur.view,G=new Chess(v.G.fen());let last=null;
 for(let k=0;k<v.i;k++){const m=G.move(v.moves[k]);last=[m.from,m.to]}
 $('dBoard').innerHTML=boardHTML(G,dCur.p.c==='b',{last});
 $('dViewNav').hidden=false;$('dViewInfo').textContent=v.i?`${v.i}/${v.moves.length} · ${v.moves[v.i-1]}`:'Début de la variante'}
$('dViewBack').onclick=()=>{const v=dCur?.view;if(v&&v.i>0){v.i--;dvView()}};
$('dViewFwd').onclick=()=>{const v=dCur?.view;if(v&&v.i<v.moves.length){v.i++;dvView()}};
$('dViewEnd').onclick=()=>{if(!dCur)return;dCur.view=null;$('dViewNav').hidden=true;dvDraw()};
MODE_OPEN.devine=()=>{if(!dCur)renderDevine()};
