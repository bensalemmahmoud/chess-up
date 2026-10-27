/* ---------- étude de position ---------- */
// Pas de coup à trouver d'emblée : on évalue la position, on dit d'où vient l'avantage, on repère ses éléments
// (structure de pions, roi, activité, pièces en prise) calculés par chess_analysis.position_features, puis on cherche
// la menace adverse et on choisit son coup (Stockfish dans le navigateur). Positions calmes de tes parties, de joueurs
// plus forts et de parties longues. Les réponses sont enregistrées avec l'entraînement (srs, donc synchronisées).
const THEMES={ev:'Évaluation',ju:'Origine de l\'avantage',st:'Structure de pions',ro:'Le roi',ac:'Activité des pièces',me:'Pièces en prise',pr:'Menaces adverses',co:'Choix du coup'};
const CAMP={w:'Les Blancs',b:'Les Noirs'},ROI={w:'Le roi blanc',b:'Le roi noir'},DES={w:'des Blancs',b:'des Noirs'};
// élément : [thème, énoncé pour un camp, explication, nom court]
const ELEMENTS={
 isoles:['st',c=>`${CAMP[c]} ont un pion isolé`,'Aucun pion du même camp sur les colonnes voisines : il ne peut être protégé que par des pièces, et la case devant lui est un bon point d\'appui pour l\'adversaire.','pion isolé'],
 doubles:['st',c=>`${CAMP[c]} ont des pions doublés`,'Deux pions sur la même colonne : ils se protègent mal et celui de devant bloque celui de derrière.','pions doublés'],
 arrieres:['st',c=>`${CAMP[c]} ont un pion arriéré sur une colonne semi-ouverte`,'Ses voisins sont plus avancés : plus aucun pion ne peut le protéger, la case devant lui est tenue par un pion adverse, et l\'adversaire peut l\'attaquer par la colonne.','pion arriéré'],
 passes:['st',c=>`${CAMP[c]} ont un pion passé`,'Aucun pion adverse devant lui ni sur les colonnes voisines : seules des pièces peuvent l\'arrêter, et il vaut de plus en plus en avançant.','pion passé'],
 en_prise:['me',c=>`${CAMP[c]} ont une pièce attaquée et mal défendue`,'Attaquée sans défenseur, ou par une pièce de moindre valeur : il faut la défendre ou la déplacer, sinon elle tombe.','pièce attaquée et mal défendue'],
 roi_ouvert:['ro',c=>`${ROI[c]} a perdu son abri de pions`,'Au plus un pion devant le roi alors que la dame adverse est encore là : les pièces adverses peuvent venir l\'attaquer.','roi sans abri de pions'],
 roi_centre:['ro',c=>`${ROI[c]} est resté au centre alors que le centre s'ouvre`,'Le roi n\'a pas roqué et une colonne centrale n\'a plus de pion de son camp : il risque d\'être pris sous le feu des tours et de la dame.','roi resté au centre'],
 roi_actif:['ro',c=>`${ROI[c]} est actif (centralisé)`,'En finale, le roi est une pièce forte : centralisé, il soutient ses pions et attaque ceux de l\'adversaire.','roi actif en finale'],
 colonne:['ac',c=>`${CAMP[c]} ont une tour sur une colonne ouverte`,'Une colonne sans aucun pion : la tour y pèse jusqu\'au camp adverse et peut s\'installer sur la 7e rangée.','tour sur une colonne ouverte'],
 paire_fous:['ac',c=>`${CAMP[c]} ont la paire de fous (et pas l'adversaire)`,'Deux fous contre un seul : un avantage durable, surtout quand la position s\'ouvre.','paire de fous'],
 mauvais_fou:['ac',c=>`${CAMP[c]} ont un mauvais fou`,'Au moins quatre de ses pions sont sur des cases de sa couleur, dont deux bloqués : le fou manque de diagonales.','mauvais fou'],
 avant_poste:['ac',c=>`${CAMP[c]} ont un cavalier en avant-poste`,'Sur une case avancée, soutenu par un pion, et plus aucun pion adverse ne peut le chasser : il faudra une pièce pour l\'échanger.','cavalier en avant-poste'],
 mobilite:['ac',c=>`${CAMP[c]} ont des pièces nettement plus actives`,'Leurs pièces disposent de bien plus de cases : plus d\'options et de menaces, l\'adversaire subit.','pièces plus actives']};
const FINALE_ONLY=new Set(['roi_actif']),MIDDLE_ONLY=new Set(['roi_ouvert','roi_centre']);
const EVAL_LABELS=['Noirs nettement mieux','Noirs un peu mieux','Équilibré','Blancs un peu mieux','Blancs nettement mieux'];
const evalBucket=cp=>{const w=winPct(cp);return w<25?0:w<45?1:w<=55?2:w<=75?3:4};   // chances de gain des Blancs
const evalWords=i=>i===2?'équilibré':EVAL_LABELS[i];   // dans une phrase : « les Blancs » garde sa majuscule
const evalText=cp=>(cp>0?'+':cp<0?'−':'')+fmt(Math.abs(cp)/100,1);
const THEME_COLORS=['#3987e5','#8a63d2','#d95926','#e66767','#199e70','#c98500','#4fb3bf','#a9b6c8'];
const STATEMENTS=5,HISTORY=20,RECENT=40;   // énoncés par position, réponses gardées par position, réponses du score récent d'un thème
const THREAT_MIN=15,ENGINE_MS=900;         // menace sérieuse : +15 points de chances de gain si l'adversaire jouait deux fois ; temps de Stockfish
const CTX_MIN=100;                         // situations comptées sur au moins ce nombre de tes coups
const OTHER={w:'b',b:'w'},CAPTURED={p:'le pion',n:'le cavalier',b:'le fou',r:'la tour',q:'la dame'};
let eCur=null,eQueue=[],eIds=new Set(),eSession={ok:0,n:0},eWeakPhase=null,errorProne={};
const studyId=s=>'et:'+(s.g!=null?D.games[s.g].lien+'#'+s.ply:s.fen.split(' ').slice(0,4).join(' '));
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;

/* Scores par thème : réponses [date, {thème: score sur 100}] gardées dans srs['et:…'].h */
function studyAnswers(){return Object.entries(srs).filter(([k])=>k.startsWith('et:')).flatMap(([,v])=>v.h||[]).sort((a,b)=>a[0]-b[0])}
function themeScores(){const ans=studyAnswers(),out={};
 for(const k in THEMES){const xs=ans.filter(a=>a[1][k]!=null).map(a=>a[1][k]),prev=xs.slice(-2*RECENT,-RECENT);
  out[k]={n:xs.length,avg:avg(xs.slice(-RECENT)),prev:prev.length>=10?avg(prev):null}}
 return out}
// Faiblesse d'un thème (0 à 1) : sans assez de réponses, on ne sait pas encore (0,5)
const weakness=sc=>Object.fromEntries(Object.keys(THEMES).map(k=>[k,sc[k].n>=5?1-sc[k].avg/100:.5]));
// Réponse d'une étape qui suit la validation (origine de l'avantage avant, menace et coup après) : dans la dernière réponse
function addScore(theme,v){if(!eCur.result)return eCur.pending=Object.assign(eCur.pending||{},{[theme]:v});   // avant la validation : en attente
 const r=srs[studyId(eCur.s)];if(!r?.h?.length)return;
 r.h[r.h.length-1][1][theme]=v;r.t=Date.now();saveSrs();renderStudyScores()}

/* Dans quelles positions tu te trompes : taux d'erreurs (erreurs et gaffes, hors ouverture) selon les éléments
   présents sur l'échiquier quand tu joues (sf.ctx), comparé à ton taux moyen ; au-delà de 2 écarts-types, c'est net */
function renderErrorContext(G){const n={},e={};let N=0,NE=0;
 G.forEach(g=>{const sf=g.sf;if(!sf?.ctx)return;
  ['milieu','finale'].forEach(p=>{N+=sf.phases[p].coups;NE+=sf.phases[p].err+sf.phases[p].gaf});
  for(const k in sf.ctx.coups)n[k]=(n[k]||0)+sf.ctx.coups[k];for(const k in sf.ctx.err)e[k]=(e[k]||0)+sf.ctx.err[k]});
 const p0=N?NE/N:0;errorProne={};
 const rows=Object.keys(n).filter(k=>n[k]>=CTX_MIN&&ELEMENTS[k.slice(4)]).map(k=>{const rate=(e[k]||0)/n[k],se=Math.sqrt(p0*(1-p0)/n[k]);
  const sig=rate-p0>2*se?1:p0-rate>2*se?-1:0;if(sig>0)errorProne[k]=rate/p0;return {k,n:n[k],rate,ratio:p0?rate/p0:null,sig}}).sort((a,b)=>b.ratio-a.ratio);
 $('ctxSub').textContent=N?`Ton taux d'erreurs (erreurs et gaffes) hors ouverture : ${fmt(100*p0)} % de tes coups. Il change selon ce qu'il y a sur l'échiquier au moment de jouer :`:'Pas encore de parties analysées.';
 $('ctxTable').innerHTML=rows.length?'<thead><tr><th>Situation</th><th class="num">Tes coups</th><th class="num">Erreurs</th><th class="num">Par rapport à ta moyenne</th></tr></thead><tbody>'
  +rows.slice(0,12).map(r=>`<tr><td>${ctxLabel(r.k)}</td><td class="num">${r.n}</td><td class="num">${fmt(100*r.rate)} %</td><td class="num ${r.sig>0?'loss':r.sig<0?'win':''}">×${fmt(r.ratio)}${r.sig?'':' <span class="muted">(hasard possible)</span>'}</td></tr>`).join('')+'</tbody>'
  :'<tbody><tr><td class="empty">Pas assez de coups analysés pour comparer les situations.</td></tr></tbody>'}
const ctxLabel=k=>(k.startsWith('moi_')?'Chez toi : ':'Chez l\'adversaire : ')+ELEMENTS[k.slice(4)][3];
// Éléments d'une position d'étude vus du camp au trait (toi, dans tes parties)
function studyContext(s){const me=s.fen.split(' ')[1];
 return [...Object.keys(s.f[me]).map(k=>'moi_'+k),...Object.keys(s.f[OTHER[me]]).map(k=>'adv_'+k)]}

/* Choix des positions : d'abord celles à revoir, puis les nouvelles qui touchent tes thèmes faibles, les situations
   où tu te trompes souvent, les ouvertures que tu joues et la phase où tu es le moins précis */
function studyThemes(s){const t=new Set(['ev','co']);['w','b'].forEach(c=>Object.keys(s.f[c]).forEach(k=>ELEMENTS[k]&&t.add(ELEMENTS[k][0])));return t}
function myFamilies(){const n={};D.games.forEach(g=>{if(eIds.has(g.i)&&g.famille)n[g.famille]=(n[g.famille]||0)+1});
 return new Set(Object.entries(n).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([f])=>f))}
function whyChosen(s,sc,fams){const w=weakness(sc),out=[];   // au plus tes deux thèmes les plus faibles présents ici
 [...studyThemes(s)].filter(t=>sc[t].n>=5&&w[t]>=.35).sort((a,b)=>w[b]-w[a]).slice(0,2).forEach(t=>out.push(THEMES[t].toLowerCase()+' (ton point faible)'));
 const prone=studyContext(s).filter(k=>errorProne[k]).sort((a,b)=>errorProne[b]-errorProne[a])[0];
 if(prone)out.push(`une situation où tu te trompes souvent (${ctxLabel(prone).toLowerCase()})`);
 if(s.g==null&&s.fam&&fams.has(s.fam))out.push('une ouverture que tu joues ('+s.fam+')');
 if(s.ph===eWeakPhase)out.push((s.ph==='finale'?'la finale':'le milieu de partie')+', ta phase la moins précise');
 return out}
function relevance(s,w,fams){let r=Math.random()*.2;studyThemes(s).forEach(t=>r+=w[t]);
 if(studyContext(s).some(k=>errorProne[k]))r+=.4;
 if(s.g==null&&s.fam&&fams.has(s.fam))r+=.5;if(s.ph===eWeakPhase)r+=.3;return r}

const studySource=s=>s.g!=null?'moi':s.src==='cl'?'cl':'obj';   // tes parties, joueurs plus forts, parties longues
function studyCards(){const src=$('eSrc').value,ph=$('ePhase').value;
 return D.etudes.filter(s=>(s.g==null||eIds.has(s.g))&&(!src||studySource(s)===src)&&(!ph||s.ph===ph))}
function renderStudy(G){const ok=typeof Chess!=='undefined'&&D.etudes.length>0;
 renderErrorContext(G);$('eBlock').hidden=!ok;$('eMissing').hidden=ok;renderStudyScores();
 if(!ok){$('eMissing').textContent=typeof Chess==='undefined'?'L\'échiquier n\'a pas pu être chargé : il faut une connexion internet.':'Aucune position à étudier : lance d\'abord l\'analyse Stockfish.';return}
 eIds=new Set(G.map(g=>g.i));
 const acc={};   // précision moyenne par phase sur les parties filtrées
 G.forEach(g=>{if(g.sf)['milieu','finale'].forEach(p=>{const o=acc[p]??={a:0,n:0};o.a+=g.sf.phases[p].acc;o.n+=g.sf.phases[p].coups})});
 const ranked=Object.entries(acc).filter(([,v])=>v.n>=30).sort((a,b)=>a[1].a/a[1].n-b[1].a/b[1].n);eWeakPhase=ranked.length>1?ranked[0][0]:null;
 const n={moi:0,obj:0,cl:0};D.etudes.forEach(s=>{if(s.g==null||eIds.has(s.g))n[studySource(s)]++});
 const o=$('eSrc').options;o[0].text=`Toutes (${n.moi+n.obj+n.cl})`;o[1].text=`Mes parties (${n.moi})`;
 o[2].text=`Joueurs plus forts (${n.obj})`;o[3].text=`Parties longues de joueurs forts (${n.cl})`;
 buildStudyQueue(false)}
function buildStudyQueue(all){const now=Date.now(),sc=themeScores(),w=weakness(sc),fams=myFamilies();
 const cards=studyCards().map(s=>({s,r:srs[studyId(s)]})).filter(c=>all||!c.r||c.r.due<=now);
 cards.forEach(c=>c.rel=c.r?0:relevance(c.s,w,fams));
 cards.sort((a,b)=>(!a.r)-(!b.r)||(a.r?a.r.due-b.r.due:b.rel-a.rel));
 eQueue=cards.map(c=>c.s);nextStudy()}
function updateStudyStats(){const todo=eQueue.length+(eCur&&!eCur.result?1:0);
 $('eStats').textContent=`${todo} à faire · séance : ${eSession.ok}/${eSession.n} réussies`}

function nextStudy(){const s=eQueue.shift();eCur=null;
 if(!s){$('eBoard').innerHTML='';$('eMeta').textContent=$('eWhy').textContent=$('eLinks').textContent='';$('eTitle').textContent='Rien à revoir aujourd\'hui ici';
  $('eBody').innerHTML='<p>Change de filtre, ou <a href="#" id="eAll">reprends toutes les positions</a>.</p>';
  $('eAll').onclick=e=>{e.preventDefault();buildStudyQueue(true)};updateStudyStats();return}
 const color=s.fen.split(' ')[1],g=s.g!=null?D.games[s.g]:null,sc=themeScores();
 eCur={s,color,game:new Chess(s.fen),step:'eval',ev:null,stmts:pickStatements(s),zone:[],sel:null,pick:null,last:null};
 $('eMeta').textContent=(g?`${g.date} · ${g.cadence} · contre ${g.adversaire} (${g.elo_adversaire})`:`${s.src==='cl'?'Partie longue':'Partie'} de joueurs à ~${s.elo||'?'} Elo${s.cad?' · '+s.cad:''}${s.fam?' · '+s.fam:''}`)+' · '+PHASE[s.ph];
 $('eTitle').textContent=`Coup ${s.n.replace(/\.+$/,'')} · les ${color==='w'?'Blancs':'Noirs'} jouent`+(g?` (tu as les ${g.couleur})`:'');
 const why=srs[studyId(s)]?[]:whyChosen(s,sc,myFamilies());$('eWhy').textContent=why.length?'Choisie pour toi : '+why.join(', ')+'.':'';
 $('eLinks').innerHTML=`<a href="${lichess(s.fen,color==='w'?'Blancs':'Noirs')}" target="_blank" rel="noopener">Analyse</a>`+(g?` · <a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a>`:'');
 drawStudy();updateStudyStats()}

// Énoncés à cocher : jusqu'à 3 vrais, les éléments rares d'abord (un pion isolé se trouve presque partout),
// complétés par des faux, en priorité ceux qui sont vrais pour l'autre camp (le piège classique)
const ELEMENT_FREQ={};D.etudes.forEach(s=>['w','b'].forEach(c=>Object.keys(s.f[c]).forEach(k=>ELEMENT_FREQ[k]=(ELEMENT_FREQ[k]||0)+1)));
function pickStatements(s){const end=s.ph==='finale';
 const all=Object.keys(ELEMENTS).filter(k=>end?!MIDDLE_ONLY.has(k):!FINALE_ONLY.has(k)).flatMap(k=>['w','b'].map(c=>({c,k,truth:!!s.f[c][k],checked:false})));
 const truths=all.filter(x=>x.truth).map(x=>[x,Math.random()*ELEMENT_FREQ[x.k]]).sort((a,b)=>a[1]-b[1]).slice(0,3).map(([x])=>x),mirror=shuffle(all.filter(x=>!x.truth&&s.f[OTHER[x.c]][x.k]));
 const rest=shuffle(all.filter(x=>!x.truth&&!mirror.includes(x)));
 return shuffle([...truths,...[...mirror,...rest].slice(0,STATEMENTS-truths.length)])}

/* D'où vient l'avantage : chaque facteur compte les éléments en faveur du camp qui est mieux selon Stockfish */
const FACTORS={mat:['Le matériel','du matériel'],st:['La structure de pions','de la structure de pions'],ro:['La sécurité des rois','de la sécurité des rois'],ac:['L\'activité des pièces','de l\'activité des pièces']};   // [bouton, « vient de … »]
const FACTOR_ELEMS={st:{B:['passes'],O:['isoles','doubles','arrieres']},ro:{B:['roi_actif'],O:['roi_ouvert','roi_centre']},
 ac:{B:['mobilite','colonne','paire_fous','avant_poste'],O:['mauvais_fou']}};
function advantage(s){const B=s.e>0?'w':'b',O=OTHER[B],f=s.f,n=(c,k)=>(f[c][k]||[]).length,has=(c,k)=>f[c][k]?1:0;
 const md=B==='w'?f.mat[0]-f.mat[1]:f.mat[1]-f.mat[0];
 const sc={mat:md>=1?md:0,
  st:.5*(n(O,'isoles')+n(O,'doubles')+n(O,'arrieres')-n(B,'isoles')-n(B,'doubles')-n(B,'arrieres'))+n(B,'passes')-n(O,'passes'),
  ro:1.5*(has(O,'roi_ouvert')+has(O,'roi_centre')-has(B,'roi_ouvert')-has(B,'roi_centre'))+has(B,'roi_actif')-has(O,'roi_actif'),
  ac:1.5*(has(B,'mobilite')-has(O,'mobilite'))+.5*(n(B,'colonne')-n(O,'colonne'))+.75*(has(B,'paire_fous')-has(O,'paire_fous'))
   +n(B,'avant_poste')-n(O,'avant_poste')+.75*(has(O,'mauvais_fou')-has(B,'mauvais_fou'))};
 const max=Math.max(...Object.values(sc));
 // question posée seulement si Stockfish voit un avantage et qu'un facteur l'explique nettement
 return {B,O,sc,md,ok:evalBucket(s.e)!==2&&max>=1,best:Object.keys(sc).filter(k=>sc[k]>0&&sc[k]>=.75*max)}}
function factorDetail(a,k,s){if(k==='mat')return `${a.B==='w'?'les Blancs':'les Noirs'} ont ${a.md} point${a.md>1?'s':''} de matériel de plus`;
 const items=[...FACTOR_ELEMS[k].B.filter(e=>s.f[a.B][e]).map(e=>[a.B,e]),...FACTOR_ELEMS[k].O.filter(e=>s.f[a.O][e]).map(e=>[a.O,e])];
 return items.map(([c,e])=>`${ELEMENTS[e][3]} ${DES[c]}${s.f[c][e].length&&e!=='mobilite'?' ('+s.f[c][e].join(', ')+')':''}`).join(', ')}
function factorSquares(a,k,s){if(k==='mat')return [];
 return [...FACTOR_ELEMS[k].B.flatMap(e=>e==='mobilite'?[]:s.f[a.B][e]||[]),...FACTOR_ELEMS[k].O.flatMap(e=>s.f[a.O][e]||[])]}

/* Menace adverse : si c'était à l'adversaire de jouer, que ferait-il ? (Stockfish sur la position, trait inversé) */
function flipFen(fen){const p=fen.split(' ');p[1]=OTHER[p[1]];p[3]='-';const f=p.join(' ');return new Chess().validate_fen(f).valid?f:null}
function startThreat(){const c=eCur,flip=flipFen(c.s.fen);c.step='menace';c.pick=c.last=null;c.zone=[];
 if(!flip){c.threat={state:'none'};return drawStudy()}
 c.threat={state:'calc'};drawStudy();
 Engine.move(flip,ENGINE_MS).then(r=>{if(eCur!==c)return;const G=new Chess(flip),mv=G.move({from:r.from,to:r.to,promotion:r.promotion||'q'});
  const now=winPct(c.color==='w'?-c.s.e:c.s.e),after=winPct(r.score);   // chances de gain de l'adversaire
  c.threat=mv&&after-now>=THREAT_MIN?{state:'ask',mv,now,after,flip}:{state:'none',mv,now,after};
  if(c.threat.state==='ask')c.game=new Chess(flip);drawStudy()})
 .catch(()=>{if(eCur!==c)return;c.threat={state:'error'};drawStudy()})}
function threatText(t){const m=t.mv,goal=[];
 if(m.captured)goal.push(`prendre ${CAPTURED[m.captured]} en ${m.to}`);
 if(m.san.includes('#'))goal.push('mater');else if(m.san.includes('+'))goal.push('donner échec');
 return `<b>${esc(m.san)}</b>${goal.length?' pour '+goal.join(' et '):''} : ses chances de gain passeraient de ${Math.round(t.now)} % à ${Math.round(t.after)} %`}
function answerThreat(mv){const c=eCur,t=c.threat;t.guess=mv;t.right=mv.to===t.mv.to;   // même case visée : la menace est comprise
 addScore('pr',t.right?100:0);c.game=new Chess(t.flip);c.game.move(t.mv.san);c.last=[t.mv.from,t.mv.to];drawStudy()}

/* Ton coup : comparé à celui de Stockfish par Stockfish lui-même (même moteur, même temps) */
function startMove(){const c=eCur;c.step='coup';c.game=new Chess(c.s.fen);c.pick=c.last=null;c.zone=[];drawStudy()}
const winAfter=G=>G.in_checkmate()?Promise.resolve(100):G.game_over()?Promise.resolve(50):Engine.move(G.fen(),ENGINE_MS).then(r=>100-winPct(r.score));
function answerMove(mv){const c=eCur,s=c.s,best=new Chess(s.fen);const bm=best.move(s.best,{sloppy:true});c.move={mv,bm};
 if(bare(mv.san)===bare(s.best)){c.move.loss=0;return finishMove()}
 c.busy=true;drawStudy();
 winAfter(c.game).then(wu=>winAfter(best).then(wb=>{if(eCur!==c)return;c.move.loss=Math.max(0,wb-wu);c.busy=false;finishMove()}))
 .catch(()=>{if(eCur!==c)return;c.busy=false;c.move.error=true;c.step='done';drawStudy()})}
function finishMove(){const c=eCur,l=c.move.loss;c.move.grade=l<T.imp?2:l<T.err?1:0;addScore('co',[0,50,100][c.move.grade]);
 c.step='done';c.zone=c.move.bm?[c.move.bm.from,c.move.bm.to]:[];drawStudy()}

function drawStudyBoard(){const c=eCur,asking=(c.step==='menace'&&c.threat?.state==='ask'&&!c.threat.guess)||(c.step==='coup'&&!c.move);
 $('eBoard').classList.toggle('mini',!asking);
 $('eBoard').innerHTML=boardHTML(c.game,c.color==='b',{zone:c.zone,last:c.last,sel:c.pick,targets:asking&&c.pick?c.game.moves({square:c.pick,verbose:true}):[]})}
function evalFeedback(){const c=eCur,s=c.s,truth=evalBucket(s.e),d=Math.abs(c.ev-truth),g=s.g!=null?D.games[s.g]:null;
 const mine=g?` · tes chances de gain : ${Math.round(c.color==='w'?winPct(s.e):100-winPct(s.e))} %`:'';
 return `<div class="feedback ${d===0?'ok':d===1?'':'ko'}"><b>${d===0?'Juste.':d===1?'Presque.':'Non.'}</b> Stockfish : <b>${evalText(s.e)}</b>, ${evalWords(truth)}${mine}. Ta réponse : ${evalWords(c.ev)}.</div>`}
function whyFeedback(){const c=eCur,a=c.adv,right=a.best.includes(c.why);
 return `<div class="feedback ${right?'ok':'ko'}"><b>${right?'Juste.':'Non.'}</b> D'après les éléments détectés, l'avantage ${DES[a.B]} vient surtout ${a.best.map(k=>FACTORS[k][1]).join(' et ')} : ${a.best.map(k=>factorDetail(a,k,c.s)).join(' ; ')}.${right?'':` Ta réponse : ${FACTORS[c.why][0].toLowerCase()}.`}</div>`}
function resultsHTML(){const c=eCur,s=c.s,asked=new Set(c.stmts.map(x=>x.c+x.k));
 const line=(x,i)=>{const right=!!x.checked===x.truth,sq=s.f[x.c][x.k],mark=x.extra?'•':right?'✓':'✗';
  const detail=x.truth?`${sq.length&&x.k!=='mobilite'?'Cases : '+sq.join(', ')+'. ':''}${ELEMENTS[x.k][2]}`
   :'Ce n\'est pas le cas ici.'+(s.f[OTHER[x.c]][x.k]?' C\'est vrai pour l\'autre camp.':'');
  return `<div class="stmt ${x.extra?'':right?'ok':'ko'}${c.sel===i?' sel':''}" data-z="${i}"><span>${mark}</span><span>${x.truth?'':'<s>'}${ELEMENTS[x.k][1](x.c)}${x.truth?'':'</s>'}${x.checked&&!x.extra?' · <i>coché</i>':''}<small>${detail}</small></span></div>`};
 const extra=c.extra=['w','b'].flatMap(cl=>Object.keys(s.f[cl]).filter(k=>ELEMENTS[k]&&!asked.has(cl+k)).map(k=>({c:cl,k,truth:true,extra:true})));
 const d=s.f.mat[0]-s.f.mat[1],mat=d===0?'égal':`${d>0?'les Blancs':'les Noirs'} ont ${Math.abs(d)} point${Math.abs(d)>1?'s':''} de plus`;
 return `<details${c.step==='review'?' open':''}><summary><b>Éléments : ${c.result.good}/${c.stmts.length} énoncés justes</b>${c.step==='review'?' · clique sur un énoncé pour voir les cases':''}</summary>`
  +`<div class="stmts">${c.stmts.map(line).join('')}</div>`
  +(extra.length?`<p class="muted">Autres éléments de la position :</p><div class="stmts">${extra.map((x,i)=>line(x,c.stmts.length+i)).join('')}</div>`:'')
  +`<p class="note">Matériel : ${mat}. Cases accessibles aux pièces : Blancs ${s.f.mob[0]}, Noirs ${s.f.mob[1]}.</p></details>`}
function threatHTML(){const t=eCur.threat;if(!t)return '';
 if(t.state==='calc')return '<div class="feedback">Stockfish cherche ce que menace l\'adversaire…</div>';
 if(t.state==='error')return '<div class="feedback ko">Stockfish n\'a pas pu démarrer (connexion internet nécessaire) : étape passée.</div>';
 if(t.state==='none')return `<div class="feedback"><b>Pas de menace sérieuse.</b> Même s'il jouait deux fois de suite, l'adversaire ne gagnerait presque rien${t.mv?` (son meilleur coup serait ${esc(t.mv.san)})`:''} : tu as le temps de jouer ton plan.</div>`;
 if(!t.guess)return `<p><b>Que menace l'adversaire ?</b> Si c'était à lui de jouer, quel coup ferait-il ? Joue-le sur l'échiquier pour ${eCur.color==='w'?'les Noirs':'les Blancs'}.</p>`;
 return `<div class="feedback ${t.right?'ok':'ko'}"><b>${t.right?'Bien vu.':'Non.'}</b> La menace : ${threatText(t)}.${t.right?'':` Tu as proposé ${esc(t.guess.san)}.`} Avant de jouer ton plan, pare-la.</div>`}
function moveHTML(){const c=eCur,s=c.s,m=c.move,who=s.g!=null?'Tu as joué':'Le joueur a joué';
 if(!m)return `<p><b>À toi de jouer :</b> quel coup choisis-tu ? Joue-le sur l'échiquier.</p>`;
 if(c.busy)return `<div class="feedback">Stockfish évalue ${esc(m.mv.san)}…</div>`;
 if(m.error)return '<div class="feedback ko">Stockfish n\'a pas pu évaluer ton coup (connexion internet nécessaire).</div>';
 const verdict=['Ce coup perd l\'avantage ou aggrave la position','Coup imprécis','Bon coup'][m.grade];
 return `<div class="feedback ${m.grade===2?'ok':m.grade===0?'ko':''}"><b>${verdict}.</b> Ton coup : ${esc(m.mv.san)}${m.loss?` (${Math.round(m.loss)} points de chances de gain de moins que le meilleur)`:''}. Coup de Stockfish : <b>${esc(s.best)}</b> (cases surlignées). ${who} ${esc(s.jo||'?')} dans la partie.</div>`}
function drawStudy(){const c=eCur;drawStudyBoard();let h='';
 if(c.ev!=null)h+=evalFeedback();
 if(c.why!=null)h+=whyFeedback();
 if(c.step==='eval')h+=`<p>Qui est mieux, et de combien ?</p><div class="filters choices">${[4,3,2,1,0].map(i=>`<button data-ev="${i}">${EVAL_LABELS[i]}</button>`).join('')}</div>`;
 else if(c.step==='why')h+=`<p>D'où vient surtout l'avantage ${DES[c.adv.B]} ?</p><div class="filters choices">${Object.entries(FACTORS).map(([k,l])=>`<button data-why="${k}">${l[0]}</button>`).join('')}</div>`;
 else if(c.step==='elements')h+=`<p>Coche ce qui est vrai dans cette position :</p><div class="stmts">${c.stmts.map((x,i)=>
  `<label class="stmt"><input type="checkbox" data-st="${i}"${x.checked?' checked':''}><span>${ELEMENTS[x.k][1](x.c)}</span></label>`).join('')}</div><div class="filters"><button id="eValidate">Valider</button></div>`;
 if(c.result){h+=resultsHTML();
  if(c.step==='review')h+='<div class="filters"><button id="eGoThreat">Étape suivante : la menace adverse →</button></div>';
  if(['menace','coup','done'].includes(c.step))h+=threatHTML();
  if(c.step==='menace'&&c.threat&&(c.threat.state!=='ask'||c.threat.guess)&&c.threat.state!=='calc')h+='<div class="filters"><button id="eGoMove">Étape suivante : ton coup →</button></div>';
  if(c.step==='coup'||c.step==='done')h+=moveHTML()}
 $('eBody').innerHTML=h}

function validateStudy(){const c=eCur,truth=evalBucket(c.s.e),ev=[100,50,0][Math.min(2,Math.abs(c.ev-truth))],per={};
 c.stmts.forEach(x=>(per[ELEMENTS[x.k][0]]??=[]).push(!!x.checked===x.truth?100:0));
 const scores={ev,...c.pending};for(const t in per)scores[t]=Math.round(avg(per[t]));
 const good=c.stmts.filter(x=>!!x.checked===x.truth).length,ok=ev===100&&good>=c.stmts.length-1;
 const id=studyId(c.s),r=srs[id]||{b:0,n:0};
 r.b=ok?Math.min(r.b+1,INTERVALS.length-1):0;r.n++;r.t=Date.now();r.due=r.t+(ok?Math.max(1,INTERVALS[r.b]):1)*864e5;   // ratée : le lendemain
 r.h=[...(r.h||[]),[r.t,scores]].slice(-HISTORY);srs[id]=r;saveSrs();
 eSession.n++;if(ok)eSession.ok++;c.result={good,ok};c.step='review';drawStudy();renderStudyScores();updateStudyStats()}

function renderStudyScores(){const sc=themeScores(),ans=studyAnswers();
 $('eScoresSub').textContent=ans.length?`Sur tes ${RECENT} dernières réponses de chaque thème (${ans.length} positions étudiées). Tendance : par rapport aux ${RECENT} réponses précédentes.`
  :'Étudie quelques positions : ton score par thème apparaîtra ici, et les positions suivantes seront choisies sur tes thèmes les plus faibles.';
 const known=Object.entries(sc).filter(([,v])=>v.n>=5).sort((a,b)=>a[1].avg-b[1].avg),weakest=known.length>1?known[0][0]:null;
 $('eScores').innerHTML=ans.length?'<thead><tr><th>Thème</th><th class="num">Score</th><th class="num">Réponses</th><th>Tendance</th></tr></thead><tbody>'+Object.entries(THEMES).map(([k,l])=>{const v=sc[k];
  const trend=v.prev==null?'—':v.avg-v.prev>=5?'<span class="win">en progrès</span>':v.prev-v.avg>=5?'<span class="loss">en baisse</span>':'stable';
  return `<tr><td>${l}${k===weakest?' <span class="pill">à travailler</span>':''}</td><td class="num">${v.avg==null?'—':`<span class="bar" style="width:${Math.round(v.avg*.6)}px"></span>${Math.round(v.avg)} %`}</td><td class="num">${v.n}</td><td>${trend}</td></tr>`}).join('')+'</tbody>':'';
 const months={};ans.forEach(([t,s])=>{const o=months[new Date(t).toISOString().slice(0,7)]??={};for(const k in s)(o[k]??=[]).push(s[k])});
 const labels=Object.keys(months).sort();$('eChartBox').hidden=labels.length<2;   // une courbe à partir de deux mois
 if(labels.length>=2)chart('eChart',{type:'line',data:{labels,datasets:Object.entries(THEMES).map(([k,l],i)=>({label:l,
  data:labels.map(m=>(months[m][k]||[]).length>=3?Math.round(avg(months[m][k])):null),borderColor:THEME_COLORS[i],backgroundColor:THEME_COLORS[i],spanGaps:true,tension:.25}))},
  options:barOpts({scales:{y:{min:0,max:100,ticks:{callback:v=>v+' %'}}}})})}

$('eBody').addEventListener('click',e=>{const c=eCur;if(!c)return;const b=e.target.closest('[data-ev]'),w=e.target.closest('[data-why]'),z=e.target.closest('[data-z]');
 if(b&&c.step==='eval'){c.ev=+b.dataset.ev;c.adv=advantage(c.s);c.step=c.adv.ok?'why':'elements';drawStudy()}
 else if(w&&c.step==='why'){c.why=w.dataset.why;addScore('ju',c.adv.best.includes(c.why)?100:0);
  c.zone=c.adv.best.flatMap(k=>factorSquares(c.adv,k,c.s));c.step='elements';drawStudy()}
 else if(e.target.id==='eValidate'&&c.step==='elements'){c.zone=[];validateStudy()}
 else if(e.target.id==='eGoThreat')startThreat();
 else if(e.target.id==='eGoMove')startMove();
 else if(z&&c.result){const i=+z.dataset.z,x=i<c.stmts.length?c.stmts[i]:c.extra[i-c.stmts.length];
  c.sel=c.sel===i?null:i;c.zone=c.sel==null||!x.truth?[]:c.s.f[x.c][x.k];
  document.querySelectorAll('#eBody [data-z]').forEach(el=>el.classList.toggle('sel',+el.dataset.z===c.sel));drawStudyBoard()}});
$('eBody').addEventListener('change',e=>{const i=e.target.dataset.st;if(eCur&&i!=null)eCur.stmts[+i].checked=e.target.checked});
// Échiquier : jouer la menace adverse, puis ton coup
$('eBoard').addEventListener('click',e=>{const c=eCur,el=e.target.closest('.sq');if(!c||!el||c.busy||$('eBoard').classList.contains('mini'))return;
 const sq=el.dataset.sq,G=c.game;
 if(c.pick&&G.moves({square:c.pick,verbose:true}).some(x=>x.to===sq)){const mv=G.move({from:c.pick,to:sq,promotion:'q'});c.pick=null;c.last=[mv.from,mv.to];
  return c.step==='menace'?answerThreat(mv):answerMove(mv)}
 const p=G.get(sq);c.pick=p&&p.color===G.turn()&&c.pick!==sq?sq:null;drawStudyBoard()});
$('eNext').onclick=()=>nextStudy();
['eSrc','ePhase'].forEach(id=>$(id).addEventListener('change',()=>buildStudyQueue(false)));

/* Deux modes dans l'onglet : trouver le coup (entrainement.js) ou étudier la position */
function setMode(m){if(m!=='etude')m='coup';$('modeCoup').hidden=m!=='coup';$('modeEtude').hidden=m!=='etude';
 document.querySelectorAll('#modes button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
 try{localStorage.setItem('chess-up:mode',m)}catch(e){}
 drawPendingCharts()}
document.querySelectorAll('#modes button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('cta').addEventListener('click',()=>setMode('coup'));   // « S'entraîner » depuis les priorités : les positions critiques
setMode((()=>{try{return localStorage.getItem('chess-up:mode')}catch(e){return null}})());
