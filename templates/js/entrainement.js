/* ---------- entraînement ---------- */
const DECKS={
 conversion:['Conversion des positions gagnantes',(m,g)=>m.wb>=T.win&&g.resultat!=='Victoire'],
 milieu:['Tactique en milieu de partie',m=>m.ph==='milieu'],
 finale:['Technique de finale',m=>m.ph==='finale'],
 ...Object.fromEntries(Object.entries(FINALES).map(([k,l])=>['fin_'+k,['· '+l,m=>m.ft===k]])),   // une finale par type
 ouverture:['Sortie d\'ouverture',m=>m.ph==='ouverture'],
 repertoire:['Mon répertoire d\'ouvertures',null],   // positions récurrentes de tes ouvertures (repertoire.js)
 otb:['Mes parties sur l\'échiquier',null],           // parties collées dans le dashboard (partie.js)
 occ:['Occasions manquées',m=>m.occ],
 mm:['Mats manqués',m=>m.mm],
 temps:['Erreurs en zeitnot',m=>m.zt],
 reflexe:['Erreurs jouées en réflexe',m=>m.tb===0],
 roi_moi:['Erreurs avec ton roi exposé',m=>(m.ctx||[]).some(k=>k==='moi_roi_ouvert'||k==='moi_roi_centre')],
 roi_adv:['Erreurs face à un roi adverse exposé',m=>(m.ctx||[]).some(k=>k==='adv_roi_ouvert'||k==='adv_roi_centre')],
 defense:['Défense des positions inférieures',m=>m.wb<40&&m.sev!=='mat'],   // erreurs commises alors que tu étais déjà moins bien
 materiel:['Matériel en prise',m=>(m.mot||[]).some(k=>k.startsWith('materiel'))],
 fourchette:['Fourchettes',m=>(m.mot||[]).some(k=>k.startsWith('fourchette'))],
 clouage:['Clouages',m=>(m.mot||[]).some(k=>k.startsWith('clouage'))],
 matsubi:['Mats permis',m=>(m.mot||[]).includes('mat_subi')],
 tout:['Toutes mes erreurs',()=>true]};
const CAUSE_DECK={temps:'temps',conversion:'conversion',ouverture:'ouverture',milieu:'milieu',finale:'finale',positionnel:'tout'};
const SRS_KEY='chess-up:entrainement:'+D.username,INTERVALS=[0,1,3,7,16,35];   // jours avant de revoir une position, selon sa boîte
const srs=(()=>{try{return JSON.parse(localStorage.getItem(SRS_KEY))||{}}catch(e){return {}}})();
// stockage persistant demandé à la première réponse : sinon le navigateur peut l'effacer (Safari après 7 jours sans visite)
let persistAsked=false;
const saveSrs=()=>{try{localStorage.setItem(SRS_KEY,JSON.stringify(srs))}catch(e){}
 if(!persistAsked){persistAsked=true;try{navigator.storage?.persist?.().catch(()=>{})}catch(e){}}};
const cardId=m=>m.id||D.games[m.g].lien+'#'+m.ply;
const GLYPH={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'},PIECE={p:'de pion',n:'de cavalier',b:'de fou',r:'de tour',q:'de la dame',k:'du roi'};
const bare=s=>String(s).replace(/[+#?!]/g,'');
const winPct=cp=>{cp=Math.max(-1000,Math.min(1000,cp));return 50+50*(2/(1+Math.exp(-0.00368208*cp))-1)};   // même formule que chess_analysis.win_pct
const PLAYOUT_MOVES=20;   // partie contre Stockfish : position « convertie » si toujours gagnante après ce nombre de coups
// Niveau de Stockfish pour « Jouer la suite » : convertir contre un joueur du niveau visé, pas contre un moteur à pleine force.
// [clé, Elo (null : pleine force), libellé] ; les Elo Chess.com/Lichess et ceux du moteur ne sont qu'à peu près comparables
const LEVELS=(()=>{const o=D.objectif,last=[...D.games].reverse().find(g=>g.elo_joueur&&(!o||g.cadence===o.cadence)),me=last?+last.elo_joueur:null;
 return [o?.target&&['obj',o.target,`Niveau de l'objectif (≈ ${o.target} Elo)`],me&&['moi',me,`Ton niveau (≈ ${me} Elo)`],['max',null,'Pleine force']].filter(Boolean)})();
$('tLevel').innerHTML=LEVELS.map(([k,,l])=>`<option value="${k}">${esc(l)}</option>`).join('');
try{const v=localStorage.getItem('chess-up:niveau');if(LEVELS.some(l=>l[0]===v))$('tLevel').value=v}catch(e){}
$('tLevel').addEventListener('change',e=>{try{localStorage.setItem('chess-up:niveau',e.target.value)}catch(err){}});
const playoutElo=()=>LEVELS.find(l=>l[0]===$('tLevel').value)?.[1]||null;
const levelText=()=>{const e=playoutElo();return e?`au niveau ≈ ${Engine.version>=17?Math.max(1320,e):e} Elo`:'à pleine force'};
// Barre d'évaluation : tes chances de gain, ta couleur remplit la barre
function evalBar(el,win,color){const w=Math.round(win);el.classList.toggle('noirs',color==='b');
 el.firstElementChild.style.width=w+'%';el.lastElementChild.textContent=`tes chances : ${w} %`}
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
 if(!ok){$('trMissing').textContent=typeof Chess==='undefined'?'L\'échiquier n\'a pas pu être chargé : il faut une connexion internet.':'Aucune position à travailler : lance d\'abord l\'analyse Stockfish.';return}
 trIds=new Set(G.map(g=>g.i));
 const sel=$('tDeck'),prev=sel.value,def=CAUSE_DECK[topCause]||'tout';sel.innerHTML='';
 Object.entries(DECKS).forEach(([k,[l]])=>{const n=deckCards(k).length;if(n||k===def)sel.add(new Option(`${l} (${n})${k===def?' · priorité 1':''}`,k))});
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
 const todo=queue.length+(cur&&!cur.done?1:0);$('cta').textContent=todo?`S'entraîner · ${todo} positions →`:'S\'entraîner →';
 $('tStats').textContent=`${todo} à faire · ${mastered}/${cards.length} maîtrisées · séance : ${session.ok}/${session.n} réussies du premier coup`}
function setFeedback(cls,html){$('tFeedback').className='feedback '+cls;$('tFeedback').innerHTML=html}
const gameNote=()=>cur.m.rep?`Tu joues habituellement <b>${esc(cur.m.san)}</b> ici (${cur.m.count} parties) : tes chances de gain passent de ${cur.m.wb} % à ${cur.m.wa} %.`
 :`En partie, tu as joué <b>${esc(cur.m.san)}</b> : tes chances de gain sont passées de ${cur.m.wb} % à ${cur.m.wa} %.`;

function grade(ok){const id=cardId(cur.m),s=srs[id]||{b:0,n:0};
 if(!ok)s.b=0;else if(!cur.hint)s.b=Math.min(s.b+1,INTERVALS.length-1);   // avec indice : réussie, mais la boîte ne monte pas
 s.n++;s.t=Date.now();s.due=s.t+(ok?Math.max(1,INTERVALS[s.b]):0)*864e5;srs[id]=s;saveSrs();   // t : date de mise à jour, pour la synchronisation
 cur.done=true;session.n++;if(ok&&!cur.hint)session.ok++;
 if(!ok)queue.splice(Math.min(3,queue.length),0,cur.m);   // une position ratée revient quelques positions plus loin
 updateStats()}

function nextCard(){if(cur&&!cur.done&&cur.failed)grade(false);cur=null;
 while(queue.length&&!cur){const m=queue.shift(),best=new Chess(m.fen).move(m.best,{sloppy:true});
  if(best)cur={m,g:D.games[m.g],game:new Chess(m.fen),best,color:m.fen.split(' ')[1],sel:null,last:null,hint:0,failed:false,done:false,locked:false,pv:null,redo:[],wins:{}}}
 if(!cur){$('board').innerHTML='';$('tMeta').textContent='';$('tTitle').textContent='Rien à revoir aujourd\'hui dans ce thème';$('tLinks').innerHTML='';setFeedback('','');
  $('tPrompt').innerHTML='Change de thème, ou <a href="#" id="tAll">reprends toutes les positions de ce thème</a>.';$('tAll').onclick=e=>{e.preventDefault();buildQueue(true)};
  $('tHint').disabled=$('tSolve').disabled=$('tBack').disabled=$('tFwd').disabled=true;$('tPlay').hidden=$('tWhy').hidden=$('tEval').hidden=$('tLevelBox').hidden=true;$('tWhyOut').innerHTML='';updateStats();return}
 const g=cur.g,m=cur.m;$('tWhyOut').innerHTML='';
 $('tMeta').textContent=m.rep?`Ton répertoire · position rencontrée dans ${m.count} parties · ${PHASE[m.ph]}`
  :m.otb?`Sur l'échiquier · ${m.date||'sans date'}${m.adv?' · contre '+m.adv:''} · ${PHASE[m.ph]}`:`${g.date} · ${g.cadence} · contre ${g.adversaire} (${g.elo_adversaire}) · ${PHASE[m.ph]}`;
 $('tTitle').textContent=`Coup ${m.n.replace(/\.+$/,'')} · les ${cur.color==='w'?'Blancs':'Noirs'} jouent`;
 $('tPrompt').textContent=m.rep?`Position de ton répertoire. Le coup que tu y joues d'habitude est imprécis selon Stockfish : trouve mieux.`
  :m.mm?'Il y a un mat en 3 coups ou moins. Trouve-le.':m.occ?`Ton adversaire vient de se tromper : tu as ${m.wb} % de chances de gain. Punis l'erreur.`
  :m.wb>=T.win?`Tu es gagnant (${m.wb} % de chances de gain). Trouve le coup qui garde l'avantage.`:`Tes chances de gain : ${m.wb} %. Trouve le meilleur coup.`;
 setFeedback('','');
 $('tLinks').innerHTML=`<a href="${lichess(m.fen,cur.color==='w'?'Blancs':'Noirs')}" target="_blank" rel="noopener">Analyse</a>`+(m.rep||m.otb?'':` · <a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a>`);
 draw();updateStats()}

function draw(){const c=cur,mine=!c.pv||c.game.turn()===c.color;
 const targets=c.sel&&mine?c.game.moves({square:c.sel,verbose:true}):[];
 const eh=c.done&&c.eh&&c.eh.to&&c.eh.fen===c.game.fen()?[c.eh.from,c.eh.to]:null;   // indice de Stockfish sur la position affichée
 $('board').innerHTML=boardHTML(c.game,c.color==='b',{last:c.last,sel:c.sel,hint:!c.done&&c.hint?c.best.from:null,
  arrow:eh||(!c.done&&c.hint>1?[c.best.from,c.best.to]:null),targets});
 $('tSolve').disabled=c.done;$('tHint').disabled=c.done?!engineHintOk(c):c.hint>1;
 $('tHint').textContent=!c.done&&c.hint===1?'Montrer le coup':'Indice';
 $('tLevelBox').hidden=!c.done||!!c.pv;
 $('tEval').hidden=!c.pv;if(c.pv)evalBar($('tEval'),c.pv.win??c.pv.start,c.color);
 $('tBack').disabled=!c.done||c.locked||!c.game.history().length;$('tFwd').disabled=c.locked||!c.redo.length;
 $('tPlay').hidden=!c.done;$('tPlay').textContent=c.pv?'Arrêter la partie':'Jouer la suite contre Stockfish';$('tWhy').hidden=!c.done||!!c.pv}

function play(from,to){const c=cur,m=c.m,isBest=from===c.best.from&&to===c.best.to;
 const mv=c.game.move({from,to,promotion:isBest&&c.best.promotion||'q'});c.sel=null;c.last=[from,to];
 const alt=!isBest&&(m.alts||[]).some(a=>bare(a)===bare(mv.san));   // autre coup que Stockfish juge presque aussi bon
 if(isBest||alt){const first=!c.failed;grade(first);
  const what=isBest?`${esc(m.best)} est le coup de Stockfish.`:`${esc(mv.san)} est aussi un bon coup ; Stockfish préfère légèrement ${esc(m.best)}.`;
  setFeedback('ok',`<b>${first?(c.hint?'Trouvé avec l\'indice.':'Bien joué !'):'Trouvé.'}</b> ${what} ${gameNote()}${first?'':' La position reviendra dans la séance.'}`);draw();return}
 c.failed=true;c.locked=true;
 setFeedback('ko',bare(mv.san)===bare(m.san)?`<b>${esc(mv.san)}</b>, c'est ${m.rep?'ton coup habituel':'le coup joué en partie'} : il fait passer tes chances de gain de ${m.wb} % à ${m.wa} %. Cherche mieux.`
  :`<b>${esc(mv.san)}</b> ne fait pas partie des meilleurs coups de Stockfish. Réessaie, demande un indice ou regarde la solution.`);
 draw();setTimeout(()=>{if(cur!==c)return;c.game.undo();c.last=null;c.locked=false;draw()},900)}

/* Partie contre Stockfish depuis la position, une fois l'exercice terminé */
function playoutStatus(){const c=cur,pv=c.pv,G=c.game;
 if(G.in_checkmate()){pv.over=true;return G.turn()===c.color?['ko','Échec et mat : Stockfish a gagné.']:['ok','<b>Échec et mat, tu as gagné !</b>']}
 if(G.in_draw()||G.in_stalemate()){pv.over=true;return ['ko','Partie nulle.'+(pv.start>=T.win?' La position était gagnante : cherche où l\'avantage a filé.':'')]}
 if(pv.win==null)return ['',`À toi de jouer. Stockfish joue ${levelText()}.`];
 if(pv.start>=T.win&&pv.moves>=PLAYOUT_MOVES&&pv.win>=T.win){pv.over=true;return ['ok',`<b>Position convertie :</b> toujours gagnant après ${PLAYOUT_MOVES} coups (${Math.round(pv.win)} % de chances de gain).`]}
 const drop=pv.win<pv.start-20?' <span class="loss">Tu as perdu une bonne partie de ton avantage.</span>':'';
 return ['',`${pv.moves?`Coup ${pv.moves}`:'À toi de jouer'} · tes chances de gain : <b>${Math.round(pv.win)} %</b>.${drop}`]}
function playoutStep(){const c=cur,[cls,msg]=playoutStatus();setFeedback(cls,msg);draw();
 if(c.pv.over||c.game.turn()===c.color)return;
 c.locked=true;setFeedback('','Stockfish réfléchit…');
 const elo=playoutElo();
 Engine.move(c.game.fen(),700,{elo}).then(r=>{if(cur!==c||!c.pv)return;
  c.game.move({from:r.from,to:r.to,promotion:r.promotion||'q'});c.last=[r.from,r.to];
  const done=w=>{if(cur!==c||!c.pv)return;c.pv.win=w;c.wins[c.game.history().length]=w;c.locked=false;playoutStep()};
  // à force limitée, le score de la recherche n'est pas celui du coup choisi : la position est réévaluée à pleine force
  if(!elo||c.game.game_over())return done(winPct(-r.score));
  return Engine.move(c.game.fen(),400).then(e=>done(winPct(e.score)))})
 .catch(()=>{if(cur!==c)return;c.locked=false;c.pv=null;setFeedback('ko','Stockfish n\'a pas pu démarrer (connexion internet nécessaire).');draw()})}
$('tPlay').onclick=()=>{const c=cur;if(!c||!c.done)return;
 if(c.pv){c.pv=null;c.locked=false;setFeedback('','Partie arrêtée.');draw();return}
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
  setFeedback('',c.hint===1?`Indice : c'est un coup ${PIECE[c.best.piece]} (case surlignée).`:'Indice : le coup est indiqué par la flèche. Joue-le.');draw();return}
 if(!engineHintOk(c))return;
 const fen=c.game.fen();c.eh={fen};setFeedback('','Stockfish cherche le meilleur coup…');draw();
 engineHint(fen).then(h=>{if(cur!==c||c.game.fen()!==fen)return;c.eh=h&&{fen,...h};setFeedback('',h?'Indice : '+h.text:'Aucun coup possible.');draw()})
 .catch(()=>{if(cur!==c)return;c.eh=null;setFeedback('ko','Stockfish n\'a pas pu démarrer (connexion internet nécessaire).');draw()})};
$('tSolve').onclick=()=>{if(!cur||cur.done||cur.locked)return;cur.failed=true;grade(false);cur.game.move(cur.best.san);cur.last=[cur.best.from,cur.best.to];cur.sel=null;
 setFeedback('ko',`Solution : <b>${esc(cur.m.best)}</b>. ${gameNote()} La position reviendra dans la séance.`);draw()};
$('tNext').onclick=()=>nextCard();

/* Pourquoi ? Une fois l'exercice terminé : la suite de Stockfish après le meilleur coup, ce qu'elle change, la menace
   adverse, et la réfutation du coup joué en partie. « Rejouer » charge la variante dans ◀/▶ */
$('tWhy').onclick=()=>{const c=cur;if(!c||!c.done||c.pv||c.expl)return;c.expl='calc';
 $('tWhyOut').innerHTML='<p class="muted">Stockfish cherche les variantes (quelques secondes)…</p>';
 explainAll(c.m.fen,c.m.best,c.m.san).then(x=>{if(cur!==c)return;c.expl=x;
  $('tWhyOut').innerHTML=explainHTML(x,{refut:`Et ${esc(x.refut?.san)}, ${c.m.rep?'ton coup habituel':'le coup joué en partie'} ? La réponse de Stockfish`})})
 .catch(()=>{if(cur!==c)return;c.expl=null;$('tWhyOut').innerHTML='<p class="loss">Stockfish n\'a pas pu démarrer (connexion internet nécessaire).</p>'})};
$('tWhyOut').addEventListener('click',e=>{const b=e.target.closest('[data-line]'),c=cur;if(!b||!c?.expl?.best||c.pv||c.locked)return;
 const l=c.expl[b.dataset.line];c.game=new Chess(l.fen);c.redo=[...l.moves].reverse();c.last=null;c.sel=null;
 setFeedback('',`Variante chargée : avance avec ▶. ${esc(l.text)}`);draw()});
$('tDeck').addEventListener('change',()=>{deckChosen=true;buildQueue(false)});
