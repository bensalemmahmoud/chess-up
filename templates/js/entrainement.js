/* ---------- entraînement ---------- */
const DECKS={
 conversion:[tx('Conversion des positions gagnantes'),(m,g)=>m.wb>=T.win&&g.resultat!=='Victoire'],
 milieu:[tx('Tactique en milieu de partie'),m=>m.ph==='milieu'],
 finale:[tx('Technique de finale'),m=>m.ph==='finale'],
 ...Object.fromEntries(Object.entries(FINALES).map(([k,l])=>['fin_'+k,['· '+tx(l),m=>m.ft===k]])),   // une finale par type
 ouverture:[tx('Sortie d\'ouverture'),m=>m.ph==='ouverture'],
 repertoire:[tx('Mon répertoire d\'ouvertures'),null],   // positions récurrentes de tes ouvertures (repertoire.js)
 otb:[tx('Mes parties sur l\'échiquier'),null],           // parties collées dans le dashboard (partie.js)
 occ:[tx('Occasions manquées'),m=>m.occ],
 mm:[tx('Mats manqués'),m=>m.mm],
 temps:[tx('Erreurs en zeitnot'),m=>m.zt],
 reflexe:[tx('Erreurs jouées en réflexe'),m=>m.tb===0],
 roi_moi:[tx('Erreurs avec ton roi exposé'),m=>(m.ctx||[]).some(k=>k==='moi_roi_ouvert'||k==='moi_roi_centre')],
 roi_adv:[tx('Erreurs face à un roi adverse exposé'),m=>(m.ctx||[]).some(k=>k==='adv_roi_ouvert'||k==='adv_roi_centre')],
 defense:[tx('Défense des positions inférieures'),m=>m.wb<40&&m.sev!=='mat'],   // erreurs commises alors que tu étais déjà moins bien
 materiel:[tx('Matériel en prise'),m=>(m.mot||[]).some(k=>k.startsWith('materiel'))],
 fourchette:[tx('Fourchettes'),m=>(m.mot||[]).some(k=>k.startsWith('fourchette'))],
 clouage:[tx('Clouages'),m=>(m.mot||[]).some(k=>k.startsWith('clouage'))],
 matsubi:[tx('Mats permis'),m=>(m.mot||[]).includes('mat_subi')],
 tout:[tx('Toutes mes erreurs'),()=>true]};
const CAUSE_DECK={temps:'temps',conversion:'conversion',ouverture:'ouverture',milieu:'milieu',finale:'finale',positionnel:'tout'};
const SRS_KEY='chess-up:entrainement:'+D.username,INTERVALS=[0,1,3,7,16,35];   // jours avant de revoir une position, selon sa boîte
const srs=(()=>{try{return JSON.parse(localStorage.getItem(SRS_KEY))||{}}catch(e){return {}}})();
// stockage persistant demandé à la première réponse : sinon le navigateur peut l'effacer (Safari après 7 jours sans visite)
let persistAsked=false;
const saveSrs=()=>{try{localStorage.setItem(SRS_KEY,JSON.stringify(srs))}catch(e){}
 if(!persistAsked){persistAsked=true;try{navigator.storage?.persist?.().catch(()=>{})}catch(e){}}};
const cardId=m=>m.id||D.games[m.g].lien+'#'+m.ply;
const GLYPH={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'},PIECE={p:tx('de pion'),n:tx('de cavalier'),b:tx('de fou'),r:tx('de tour'),q:tx('de la dame'),k:tx('du roi')};   // « un coup {p} »
const bare=s=>String(s).replace(/[+#?!]/g,'');
const winPct=cp=>{cp=Math.max(-1000,Math.min(1000,cp));return 50+50*(2/(1+Math.exp(-0.00368208*cp))-1)};   // même formule que chess_analysis.win_pct
const PLAYOUT_MOVES=20;   // partie contre Stockfish : position « convertie » si toujours gagnante après ce nombre de coups
// Niveau de Stockfish pour « Jouer la suite » : convertir contre un joueur du niveau visé, pas contre un moteur à pleine force.
// [clé, Elo (null : pleine force), libellé] ; les Elo Chess.com/Lichess et ceux du moteur ne sont qu'à peu près comparables
const LEVELS=(()=>{const o=D.objectif,last=[...D.games].reverse().find(g=>g.elo_joueur&&(!o||g.cadence===o.cadence)),me=last?+last.elo_joueur:null;
 return [o?.target&&['obj',o.target,tx('Niveau de l\'objectif (≈ {e} Elo)',{e:o.target})],me&&['moi',me,tx('Ton niveau (≈ {e} Elo)',{e:me})],['max',null,tx('Pleine force')]].filter(Boolean)})();
$('tLevel').innerHTML=LEVELS.map(([k,,l])=>`<option value="${k}">${esc(l)}</option>`).join('');
try{const v=localStorage.getItem('chess-up:niveau');if(LEVELS.some(l=>l[0]===v))$('tLevel').value=v}catch(e){}
$('tLevel').addEventListener('change',e=>{try{localStorage.setItem('chess-up:niveau',e.target.value)}catch(err){}});
const playoutElo=()=>LEVELS.find(l=>l[0]===$('tLevel').value)?.[1]||null;
const levelElo=()=>{const e=playoutElo();return e&&(Engine.version>=17?Math.max(1320,e):e)};
// Barre d'évaluation : tes chances de gain, ta couleur remplit la barre
function evalBar(el,win,color){const w=Math.round(win);el.classList.toggle('noirs',color==='b');
 el.firstElementChild.style.width=w+'%';el.lastElementChild.textContent=tx('tes chances : {w}',{w:w+PC})}
let topCause=null,deckChosen=false,queue=[],cur=null,session={ok:0,n:0},trIds=new Set();

// Échiquier en HTML : marks = {last:[cases], sel, hint (case ou [cases]), targets:[{to, capture}], zone:[cases surlignées],
// arrow:[de, vers] (flèche du coup conseillé)}
function boardHTML(G,flip,marks={}){let h='';const hint=[].concat(marks.hint||[]);
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){const f=flip?7-c:c,rk=flip?r+1:8-r,sq='abcdefgh'[f]+rk,p=G.get(sq),t=(marks.targets||[]).some(x=>x.to===sq);
  const cls=['sq',(f+rk)%2?'dark':'light'];   // a1 (f=0, rangée 1) est une case foncée
  if(marks.last&&marks.last.includes(sq))cls.push('last');if(marks.sel===sq)cls.push('sel');if(hint.includes(sq))cls.push('hint');if(marks.zone&&marks.zone.includes(sq))cls.push('zone');if(t)cls.push('target',p?'capt':'');
  h+=`<div class="${cls.join(' ')}" data-sq="${sq}">${c===0?`<span class="coord r">${rk}</span>`:''}${r===7?`<span class="coord f">${'abcdefgh'[f]}</span>`:''}${p?`<span class="pc ${p.color}">${GLYPH[p.type]}</span>`:''}</div>`}
 return h+(marks.arrow?arrowSVG(marks.arrow[0],marks.arrow[1],flip):'')}
// Flèche par-dessus l'échiquier (une case = 1 unité) : ne bloque pas les clics
function arrowSVG(from,to,flip){
 const xy=sq=>{const f='abcdefgh'.indexOf(sq[0]),r=+sq[1];return flip?[7-f+.5,r-.5]:[f+.5,8-r+.5]},[x1,y1]=xy(from),[x2,y2]=xy(to);
 const d=Math.hypot(x2-x1,y2-y1),ux=(x2-x1)/d,uy=(y2-y1)/d,hx=x2-ux*.42,hy=y2-uy*.42,px=-uy*.27,py=ux*.27;   // pointe : 0,42 case
 return `<svg class="arrow" viewBox="0 0 8 8" aria-hidden="true"><line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke-width=".2" stroke-linecap="round"/>`
  +`<polygon points="${x2-ux*.12},${y2-uy*.12} ${hx+px},${hy+py} ${hx-px},${hy-py}"/></svg>`}

function renderTraining(G){const ok=typeof Chess!=='undefined'&&D.moments.some(m=>m.best);
 $('trBlock').hidden=!ok;$('trMissing').hidden=ok;
 if(!ok){$('trMissing').textContent=typeof Chess==='undefined'?tx('L\'échiquier n\'a pas pu être chargé : il faut une connexion internet.'):tx('Aucune position à travailler : lance d\'abord l\'analyse Stockfish.');return}
 trIds=new Set(G.map(g=>g.i));
 const sel=$('tDeck'),prev=sel.value,def=CAUSE_DECK[topCause]||'tout';sel.innerHTML='';
 Object.entries(DECKS).forEach(([k,[l]])=>{const n=deckCards(k).length;if(n||k===def)sel.add(new Option(k===def?tx('{l} ({n}) · priorité 1',{l,n}):`${l} (${n})`,k))});
 sel.value=deckChosen&&[...sel.options].some(o=>o.value===prev)?prev:def;
 buildQueue(false)}
function deckCards(k){if(k==='repertoire')return repertoireCards().filter(m=>trIds.has(m.g));
 if(k==='otb')return otbMoments();
 const f=DECKS[k][1];return D.moments.filter(m=>m.best&&trIds.has(m.g)&&f(m,D.games[m.g]))}
function buildQueue(all){const now=Date.now();
 const due=deckCards($('tDeck').value).map(m=>({m,s:srs[cardId(m)]})).filter(c=>all||!c.s||c.s.due<=now);
 // d'abord les positions déjà vues à revoir, puis les nouvelles, des plus récentes aux plus anciennes
 due.sort((a,b)=>(!a.s)-(!b.s)||(a.s?a.s.due-b.s.due:(b.m.g-a.m.g)||(a.m.ply-b.m.ply)));
 queue=due.map(c=>c.m);cur=null;nextCard()}
function updateStats(){const cards=deckCards($('tDeck').value),mastered=cards.filter(m=>(srs[cardId(m)]?.b||0)>=3).length;
 const todo=queue.length+(cur&&!cur.done?1:0);$('cta').textContent=todo?tx('S\'entraîner · {n} positions →',{n:todo}):tx('S\'entraîner →');
 $('tStats').textContent=tx('{todo} à faire · {m}/{c} maîtrisées · séance : {ok}/{n} réussies du premier coup',{todo,m:mastered,c:cards.length,ok:session.ok,n:session.n})}
function setFeedback(cls,html){$('tFeedback').className='feedback '+cls;$('tFeedback').innerHTML=html}
const gameNote=()=>{const v={san:`<b>${esc(cur.m.san)}</b>`,c:cur.m.count,wb:cur.m.wb+PC,wa:cur.m.wa+PC};
 return cur.m.rep?tx('Tu joues habituellement {san} ici ({c} parties) : tes chances de gain passent de {wb} à {wa}.',v)
 :tx('En partie, tu as joué {san} : tes chances de gain sont passées de {wb} à {wa}.',v)};

function grade(ok){const id=cardId(cur.m),s=srs[id]||{b:0,n:0};
 if(!ok)s.b=0;else if(!cur.hint)s.b=Math.min(s.b+1,INTERVALS.length-1);   // avec indice : réussie, mais la boîte ne monte pas
 s.n++;s.t=Date.now();s.due=s.t+(ok?Math.max(1,INTERVALS[s.b]):0)*864e5;srs[id]=s;saveSrs();logAct('coup',{deck:$('tDeck').value,ok});   // t : date de mise à jour, pour la synchronisation
 cur.done=true;session.n++;if(ok&&!cur.hint)session.ok++;
 if(!ok)queue.splice(Math.min(3,queue.length),0,cur.m);   // une position ratée revient quelques positions plus loin
 updateStats()}

function nextCard(){if(cur&&!cur.done&&cur.failed)grade(false);cur=null;
 while(queue.length&&!cur){const m=queue.shift(),best=new Chess(m.fen).move(m.best,{sloppy:true});
  if(best)cur={m,g:D.games[m.g],game:new Chess(m.fen),best,color:m.fen.split(' ')[1],sel:null,last:null,hint:0,failed:false,done:false,locked:false,pv:null,redo:[],wins:{}}}
 if(!cur){$('board').innerHTML='';$('tMeta').textContent='';$('tTitle').textContent=tx('Rien à revoir aujourd\'hui dans ce thème');$('tLinks').innerHTML='';setFeedback('','');
  $('tPrompt').innerHTML=tx('Change de thème, ou <a href="#" id="tAll">reprends toutes les positions de ce thème</a>.');$('tAll').onclick=e=>{e.preventDefault();buildQueue(true)};
  $('tHint').disabled=$('tSolve').disabled=$('tBack').disabled=$('tFwd').disabled=true;$('tPlay').hidden=$('tWhy').hidden=$('tEval').hidden=$('tLevelBox').hidden=true;$('tWhyOut').innerHTML='';updateStats();return}
 const g=cur.g,m=cur.m;$('tWhyOut').innerHTML='';
 const ph=tx(PHASE[m.ph]),d=m.date||tx('sans date');
 $('tMeta').textContent=m.rep?tx('Ton répertoire · position rencontrée dans {c} parties · {ph}',{c:m.count,ph})
  :m.otb?(m.adv?tx('Sur l\'échiquier · {d} · contre {a} · {ph}',{d,a:m.adv,ph}):tx('Sur l\'échiquier · {d} · {ph}',{d,ph}))
  :tx('{d} · {cad} · contre {a} ({e}) · {ph}',{d:g.date,cad:g.cadence,a:g.adversaire,e:g.elo_adversaire,ph});
 const num=m.n.replace(/\.+$/,'');$('tTitle').textContent=cur.color==='w'?tx('Coup {n} · les Blancs jouent',{n:num}):tx('Coup {n} · les Noirs jouent',{n:num});
 const w=m.wb+PC;
 $('tPrompt').textContent=m.rep?tx('Position de ton répertoire. Le coup que tu y joues d\'habitude est imprécis selon Stockfish : trouve mieux.')
  :m.mm?tx('Il y a un mat en 3 coups ou moins. Trouve-le.'):m.occ?tx('Ton adversaire vient de se tromper : tu as {w} de chances de gain. Punis l\'erreur.',{w})
  :m.wb>=T.win?tx('Tu es gagnant ({w} de chances de gain). Trouve le coup qui garde l\'avantage.',{w}):tx('Tes chances de gain : {w}. Trouve le meilleur coup.',{w});
 setFeedback('','');
 $('tLinks').innerHTML=`<a href="${lichess(m.fen,cur.color==='w'?'Blancs':'Noirs')}" target="_blank" rel="noopener">${tx('Analyse')}</a>`+(m.rep||m.otb?'':` · <a href="${esc(g.lien)}" target="_blank" rel="noopener">${tx('Partie')}</a>`);
 draw();updateStats()}

function draw(){const c=cur,mine=!c.pv||c.game.turn()===c.color;
 const targets=c.sel&&mine?c.game.moves({square:c.sel,verbose:true}):[];
 const eh=c.done&&c.eh&&c.eh.to&&c.eh.fen===c.game.fen()?[c.eh.from,c.eh.to]:null;   // indice de Stockfish sur la position affichée
 $('board').innerHTML=boardHTML(c.game,c.color==='b',{last:c.last,sel:c.sel,hint:!c.done&&c.hint?c.best.from:null,
  arrow:eh||(!c.done&&c.hint>1?[c.best.from,c.best.to]:null),targets});
 $('tSolve').disabled=c.done;$('tHint').disabled=c.done?!engineHintOk(c):c.hint>1;
 $('tHint').textContent=!c.done&&c.hint===1?tx('Montrer le coup'):tx('Indice');
 $('tLevelBox').hidden=!c.done||!!c.pv;
 $('tEval').hidden=!c.pv;if(c.pv)evalBar($('tEval'),c.pv.win??c.pv.start,c.color);
 $('tBack').disabled=!c.done||c.locked||!c.game.history().length;$('tFwd').disabled=c.locked||!c.redo.length;
 $('tPlay').hidden=!c.done;$('tPlay').textContent=c.pv?tx('Arrêter la partie'):tx('Jouer la suite contre Stockfish');$('tWhy').hidden=!c.done||!!c.pv}

function play(from,to){const c=cur,m=c.m,isBest=from===c.best.from&&to===c.best.to;
 const mv=c.game.move({from,to,promotion:isBest&&c.best.promotion||'q'});c.sel=null;c.last=[from,to];
 const alt=!isBest&&(m.alts||[]).some(a=>bare(a)===bare(mv.san));   // autre coup que Stockfish juge presque aussi bon
 if(isBest||alt){const first=!c.failed;grade(first);
  const what=isBest?tx('{b} est le coup de Stockfish.',{b:esc(m.best)}):tx('{m} est aussi un bon coup ; Stockfish préfère légèrement {b}.',{m:esc(mv.san),b:esc(m.best)});
  setFeedback('ok',`<b>${first?(c.hint?tx('Trouvé avec l\'indice.'):tx('Bien joué !')):tx('Trouvé.')}</b> ${what} ${gameNote()}${first?'':' '+tx('La position reviendra dans la séance.')}`);draw();return}
 c.failed=true;c.locked=true;
 const v={m:`<b>${esc(mv.san)}</b>`,wb:m.wb+PC,wa:m.wa+PC};
 setFeedback('ko',bare(mv.san)===bare(m.san)?(m.rep?tx('{m}, c\'est ton coup habituel : il fait passer tes chances de gain de {wb} à {wa}. Cherche mieux.',v)
   :tx('{m}, c\'est le coup joué en partie : il fait passer tes chances de gain de {wb} à {wa}. Cherche mieux.',v))
  :tx('{m} ne fait pas partie des meilleurs coups de Stockfish. Réessaie, demande un indice ou regarde la solution.',v));
 draw();setTimeout(()=>{if(cur!==c)return;c.game.undo();c.last=null;c.locked=false;draw()},900)}

/* Partie contre Stockfish depuis la position, une fois l'exercice terminé */
function playoutStatus(){const c=cur,pv=c.pv,G=c.game;
 if(G.in_checkmate()){pv.over=true;return G.turn()===c.color?['ko',tx('Échec et mat : Stockfish a gagné.')]:['ok',`<b>${tx('Échec et mat, tu as gagné !')}</b>`]}
 if(G.in_draw()||G.in_stalemate()){pv.over=true;return ['ko',tx('Partie nulle.')+(pv.start>=T.win?' '+tx('La position était gagnante : cherche où l\'avantage a filé.'):'')]}
 if(pv.win==null){const e=levelElo();return ['',e?tx('À toi de jouer. Stockfish joue au niveau ≈ {e} Elo.',{e}):tx('À toi de jouer. Stockfish joue à pleine force.')]}
 if(pv.start>=T.win&&pv.moves>=PLAYOUT_MOVES&&pv.win>=T.win){pv.over=true;return ['ok',tx('<b>Position convertie :</b> toujours gagnant après {n} coups ({w} de chances de gain).',{n:PLAYOUT_MOVES,w:Math.round(pv.win)+PC})]}
 const drop=pv.win<pv.start-20?` <span class="loss">${tx('Tu as perdu une bonne partie de ton avantage.')}</span>`:'',w=Math.round(pv.win)+PC;
 return ['',(pv.moves?tx('Coup {m} · tes chances de gain : <b>{w}</b>.',{m:pv.moves,w}):tx('À toi de jouer · tes chances de gain : <b>{w}</b>.',{w}))+drop]}
function playoutStep(){const c=cur,[cls,msg]=playoutStatus();setFeedback(cls,msg);draw();
 if(c.pv.over||c.game.turn()===c.color)return;
 c.locked=true;setFeedback('',tx('Stockfish réfléchit…'));
 const elo=playoutElo();
 Engine.move(c.game.fen(),700,{elo}).then(r=>{if(cur!==c||!c.pv)return;
  c.game.move({from:r.from,to:r.to,promotion:r.promotion||'q'});c.last=[r.from,r.to];
  const done=w=>{if(cur!==c||!c.pv)return;c.pv.win=w;c.wins[c.game.history().length]=w;c.locked=false;playoutStep()};
  // à force limitée, le score de la recherche n'est pas celui du coup choisi : la position est réévaluée à pleine force
  if(!elo||c.game.game_over())return done(winPct(-r.score));
  return Engine.move(c.game.fen(),400).then(e=>done(winPct(e.score)))})
 .catch(()=>{if(cur!==c)return;c.locked=false;c.pv=null;setFeedback('ko',tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).'));draw()})}
$('tPlay').onclick=()=>{const c=cur;if(!c||!c.done)return;
 if(c.pv){c.pv=null;c.locked=false;setFeedback('',tx('Partie arrêtée.'));draw();return}
 c.pv={moves:0,win:null,start:c.m.wb,over:false,base:c.game.history().length};c.redo=[];c.sel=null;playoutStep()};

/* Coup précédent / suivant : une fois l'exercice terminé, et pendant la partie contre Stockfish (pour reprendre une gaffe) */
function afterNav(){const c=cur,h=c.game.history({verbose:true}),l=h[h.length-1];c.last=l?[l.from,l.to]:null;c.sel=null;
 if(c.pv){c.pv.over=false;c.pv.win=c.wins[h.length]??null;c.pv.moves=h.slice(c.pv.base).filter(m=>m.color===c.color).length;
  if(c.game.turn()!==c.color&&!c.redo.length)return playoutStep();   // plus rien à rejouer : Stockfish répond
  const [cls,msg]=playoutStatus();setFeedback(cls,msg)}
 draw()}
$('tBack').onclick=()=>{const c=cur;if(!c||!c.done||c.locked||!c.game.history().length)return;
 c.redo.push(c.game.undo());
 if(c.pv&&c.game.turn()!==c.color&&c.game.history().length)c.redo.push(c.game.undo());   // contre Stockfish : retour à ton tour
 afterNav()};
$('tFwd').onclick=()=>{const c=cur;if(!c||c.locked||!c.redo.length)return;c.game.move(c.redo.pop());afterNav()};

$('board').addEventListener('click',e=>{const el=e.target.closest('.sq'),c=cur;if(!el||!c||c.locked)return;
 if(c.done&&(!c.pv||c.pv.over||c.game.turn()!==c.color))return;
 const sq=el.dataset.sq,p=c.game.get(sq);
 if(c.sel&&c.game.moves({square:c.sel,verbose:true}).some(x=>x.to===sq)){
  if(!c.pv)return play(c.sel,sq);
  c.game.move({from:c.sel,to:sq,promotion:'q'});c.last=[c.sel,sq];c.sel=null;c.redo=[];c.pv.moves++;return playoutStep()}
 c.sel=p&&p.color===c.game.turn()&&c.sel!==sq?sq:null;draw()});
/* Indice : pendant l'exercice, d'abord la pièce à jouer, puis le coup (flèche) ; ensuite (variante rejouée avec ◀/▶
   ou partie contre Stockfish), le meilleur coup de Stockfish sur la position affichée */
const engineHintOk=c=>c.done&&!c.locked&&!c.game.game_over()&&(!c.pv||!c.pv.over&&c.game.turn()===c.color)&&c.eh?.fen!==c.game.fen();
$('tHint').onclick=()=>{const c=cur;if(!c)return;
 if(!c.done){if(c.hint>1)return;c.hint++;
  setFeedback('',c.hint===1?tx('Indice : c\'est un coup {p} (case surlignée).',{p:PIECE[c.best.piece]}):tx('Indice : le coup est indiqué par la flèche. Joue-le.'));draw();return}
 if(!engineHintOk(c))return;
 const fen=c.game.fen();c.eh={fen};setFeedback('',tx('Stockfish cherche le meilleur coup…'));draw();
 engineHint(fen).then(h=>{if(cur!==c||c.game.fen()!==fen)return;c.eh=h&&{fen,...h};setFeedback('',h?tx('Indice : {h}',{h:h.text}):tx('Aucun coup possible.'));draw()})
 .catch(()=>{if(cur!==c)return;c.eh=null;setFeedback('ko',tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).'));draw()})};
$('tSolve').onclick=()=>{if(!cur||cur.done||cur.locked)return;cur.failed=true;grade(false);cur.game.move(cur.best.san);cur.last=[cur.best.from,cur.best.to];cur.sel=null;
 setFeedback('ko',tx('Solution : {b}. {note} La position reviendra dans la séance.',{b:`<b>${esc(cur.m.best)}</b>`,note:gameNote()}));draw()};
$('tNext').onclick=()=>nextCard();

/* Pourquoi ? Une fois l'exercice terminé : la suite de Stockfish après le meilleur coup, ce qu'elle change, la menace
   adverse, et la réfutation du coup joué en partie. « Rejouer » charge la variante dans ◀/▶ */
$('tWhy').onclick=()=>{const c=cur;if(!c||!c.done||c.pv||c.expl)return;c.expl='calc';
 $('tWhyOut').innerHTML=`<p class="muted">${tx('Stockfish cherche les variantes (quelques secondes)…')}</p>`;
 explainAll(c.m.fen,c.m.best,c.m.san).then(x=>{if(cur!==c)return;c.expl=x;
  const r=esc(x.refut?.san);
  $('tWhyOut').innerHTML=explainHTML(x,{refut:c.m.rep?tx('Et {m}, ton coup habituel ? La réponse de Stockfish',{m:r}):tx('Et {m}, le coup joué en partie ? La réponse de Stockfish',{m:r})})})
 .catch(()=>{if(cur!==c)return;c.expl=null;$('tWhyOut').innerHTML=`<p class="loss">${tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).')}</p>`})};
$('tWhyOut').addEventListener('click',e=>{const b=e.target.closest('[data-line]'),c=cur;if(!b||!c?.expl?.best||c.pv||c.locked)return;
 const l=c.expl[b.dataset.line];c.game=new Chess(l.fen);c.redo=[...l.moves].reverse();c.last=null;c.sel=null;
 setFeedback('',tx('Variante chargée : avance avec ▶. {t}',{t:esc(l.text)}));draw()});
$('tDeck').addEventListener('change',()=>{deckChosen=true;buildQueue(false)});
