/* ---------- entraînement ---------- */
const DECKS={
 conversion:['Conversion des positions gagnantes',(m,g)=>m.wb>=T.win&&g.resultat!=='Victoire'],
 milieu:['Tactique en milieu de partie',m=>m.ph==='milieu'],
 finale:['Technique de finale',m=>m.ph==='finale'],
 ...Object.fromEntries(Object.entries(FINALES).map(([k,l])=>['fin_'+k,['· '+l,m=>m.ft===k]])),   // une finale par type
 ouverture:['Sortie d\'ouverture',m=>m.ph==='ouverture'],
 repertoire:['Mon répertoire d\'ouvertures',null],   // positions récurrentes de tes ouvertures (repertoire.js)
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
const saveSrs=()=>{try{localStorage.setItem(SRS_KEY,JSON.stringify(srs))}catch(e){}};
const cardId=m=>m.id||D.games[m.g].lien+'#'+m.ply;
const GLYPH={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'},PIECE={p:'de pion',n:'de cavalier',b:'de fou',r:'de tour',q:'de la dame',k:'du roi'};
const bare=s=>String(s).replace(/[+#?!]/g,'');
const winPct=cp=>{cp=Math.max(-1000,Math.min(1000,cp));return 50+50*(2/(1+Math.exp(-0.00368208*cp))-1)};   // même formule que chess_analysis.win_pct
const PLAYOUT_MOVES=20;   // partie contre Stockfish : position « convertie » si toujours gagnante après ce nombre de coups
let topCause=null,deckChosen=false,queue=[],cur=null,session={ok:0,n:0},trIds=new Set();

// Échiquier en HTML : marks = {last:[cases], sel, hint, targets:[{to, capture}], zone:[cases surlignées]}
function boardHTML(G,flip,marks={}){let h='';
 for(let r=0;r<8;r++)for(let c=0;c<8;c++){const f=flip?7-c:c,rk=flip?r+1:8-r,sq='abcdefgh'[f]+rk,p=G.get(sq),t=(marks.targets||[]).some(x=>x.to===sq);
  const cls=['sq',(f+rk)%2?'dark':'light'];   // a1 (f=0, rangée 1) est une case foncée
  if(marks.last&&marks.last.includes(sq))cls.push('last');if(marks.sel===sq)cls.push('sel');if(marks.hint===sq)cls.push('hint');if(marks.zone&&marks.zone.includes(sq))cls.push('zone');if(t)cls.push('target',p?'capt':'');
  h+=`<div class="${cls.join(' ')}" data-sq="${sq}">${c===0?`<span class="coord r">${rk}</span>`:''}${r===7?`<span class="coord f">${'abcdefgh'[f]}</span>`:''}${p?`<span class="pc ${p.color}">${GLYPH[p.type]}</span>`:''}</div>`}
 return h}

function renderTraining(G){const ok=typeof Chess!=='undefined'&&D.moments.some(m=>m.best);
 $('trBlock').hidden=!ok;$('trMissing').hidden=ok;
 if(!ok){$('trMissing').textContent=typeof Chess==='undefined'?'L\'échiquier n\'a pas pu être chargé : il faut une connexion internet.':'Aucune position à travailler : lance d\'abord l\'analyse Stockfish.';return}
 trIds=new Set(G.map(g=>g.i));
 const sel=$('tDeck'),prev=sel.value,def=CAUSE_DECK[topCause]||'tout';sel.innerHTML='';
 Object.entries(DECKS).forEach(([k,[l]])=>{const n=deckCards(k).length;if(n||k===def)sel.add(new Option(`${l} (${n})${k===def?' · priorité 1':''}`,k))});
 sel.value=deckChosen&&[...sel.options].some(o=>o.value===prev)?prev:def;
 buildQueue(false)}
function deckCards(k){if(k==='repertoire')return repertoireCards().filter(m=>trIds.has(m.g));
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
  if(best)cur={m,g:D.games[m.g],game:new Chess(m.fen),best,color:m.fen.split(' ')[1],sel:null,last:null,hint:false,failed:false,done:false,locked:false,pv:null,redo:[],wins:{}}}
 if(!cur){$('board').innerHTML='';$('tMeta').textContent='';$('tTitle').textContent='Rien à revoir aujourd\'hui dans ce thème';$('tLinks').innerHTML='';setFeedback('','');
  $('tPrompt').innerHTML='Change de thème, ou <a href="#" id="tAll">reprends toutes les positions de ce thème</a>.';$('tAll').onclick=e=>{e.preventDefault();buildQueue(true)};
  $('tHint').disabled=$('tSolve').disabled=$('tBack').disabled=$('tFwd').disabled=true;$('tPlay').hidden=true;updateStats();return}
 const g=cur.g,m=cur.m;
 $('tMeta').textContent=m.rep?`Ton répertoire · position rencontrée dans ${m.count} parties · ${PHASE[m.ph]}`:`${g.date} · ${g.cadence} · contre ${g.adversaire} (${g.elo_adversaire}) · ${PHASE[m.ph]}`;
 $('tTitle').textContent=`Coup ${m.n.replace(/\.+$/,'')} · les ${cur.color==='w'?'Blancs':'Noirs'} jouent`;
 $('tPrompt').textContent=m.rep?`Position de ton répertoire. Le coup que tu y joues d'habitude est imprécis selon Stockfish : trouve mieux.`
  :m.mm?'Il y a un mat en 3 coups ou moins. Trouve-le.':m.occ?`Ton adversaire vient de se tromper : tu as ${m.wb} % de chances de gain. Punis l'erreur.`
  :m.wb>=T.win?`Tu es gagnant (${m.wb} % de chances de gain). Trouve le coup qui garde l'avantage.`:`Tes chances de gain : ${m.wb} %. Trouve le meilleur coup.`;
 setFeedback('','');
 $('tLinks').innerHTML=`<a href="${lichess(m.fen,cur.color==='w'?'Blancs':'Noirs')}" target="_blank" rel="noopener">Analyse</a>`+(m.rep?'':` · <a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a>`);
 draw();updateStats()}

function draw(){const c=cur,mine=!c.pv||c.game.turn()===c.color;
 const targets=c.sel&&mine?c.game.moves({square:c.sel,verbose:true}):[];
 $('board').innerHTML=boardHTML(c.game,c.color==='b',{last:c.last,sel:c.sel,hint:c.hint&&!c.done?c.best.from:null,targets});
 $('tHint').disabled=$('tSolve').disabled=c.done;
 $('tBack').disabled=!c.done||c.locked||!c.game.history().length;$('tFwd').disabled=c.locked||!c.redo.length;
 $('tPlay').hidden=!c.done;$('tPlay').textContent=c.pv?'Arrêter la partie':'Jouer la suite contre Stockfish'}

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
 if(pv.win==null)return ['','À toi de jouer.'];
 if(pv.start>=T.win&&pv.moves>=PLAYOUT_MOVES&&pv.win>=T.win){pv.over=true;return ['ok',`<b>Position convertie :</b> toujours gagnant après ${PLAYOUT_MOVES} coups (${Math.round(pv.win)} % de chances de gain).`]}
 const drop=pv.win<pv.start-20?' <span class="loss">Tu as perdu une bonne partie de ton avantage.</span>':'';
 return ['',`${pv.moves?`Coup ${pv.moves}`:'À toi de jouer'} · tes chances de gain : <b>${Math.round(pv.win)} %</b>.${drop}`]}
function playoutStep(){const c=cur,[cls,msg]=playoutStatus();setFeedback(cls,msg);draw();
 if(c.pv.over||c.game.turn()===c.color)return;
 c.locked=true;setFeedback('','Stockfish réfléchit…');
 Engine.move(c.game.fen(),700).then(r=>{if(cur!==c||!c.pv)return;
  c.game.move({from:r.from,to:r.to,promotion:r.promotion||'q'});c.last=[r.from,r.to];c.pv.win=winPct(-r.score);c.wins[c.game.history().length]=c.pv.win;c.locked=false;playoutStep()})
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
$('tHint').onclick=()=>{if(!cur||cur.done)return;cur.hint=true;setFeedback('',`Indice : c'est un coup ${PIECE[cur.best.piece]} (case surlignée).`);draw()};
$('tSolve').onclick=()=>{if(!cur||cur.done||cur.locked)return;cur.failed=true;grade(false);cur.game.move(cur.best.san);cur.last=[cur.best.from,cur.best.to];cur.sel=null;
 setFeedback('ko',`Solution : <b>${esc(cur.m.best)}</b>. ${gameNote()} La position reviendra dans la séance.`);draw()};
$('tNext').onclick=()=>nextCard();
$('tDeck').addEventListener('change',()=>{deckChosen=true;buildQueue(false)});
