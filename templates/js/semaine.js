/* ---------- ma semaine : objectifs hebdomadaires ---------- */
// Chaque lundi, des objectifs calculés depuis les données du joueur : 2 d'entraînement (le thème de sa priorité n°1, le
// cours de la structure où il se trompe le plus), 1 de jeu (mesuré sur ses parties de la semaine, à chaque génération du
// rapport), un 3e d'entraînement s'il choisit 4 h par semaine, et un objectif libre qu'il écrit et coche lui-même.
// Le volume suit le temps choisi (SEM_BASE est prévu pour 2 h) et s'adapte d'une semaine à l'autre : objectif atteint →
// +20 %, rempli à moins de la moitié → −20 % (bornes SEM_LVL).
// Stockage dans srs (donc dans le lien de synchronisation) :
// - journal 'j:<jour>:<appareil>' = {t, c:{coup, ok, d:{thème: n}, devine, st:{structure: coups devinés}, cours,
//   vu:{structure: ouvertures du cours}, etude, serie, fin, calc}} : une clé par appareil et par jour, la fusion « le plus
//   récent gagne » additionne ainsi les appareils ;
// - plan 'sem:<lundi>' = {t, goals, perso:{txt, ok}}, figé à la première ouverture de la semaine ;
// - temps choisi 'sem:budget' = {t, h}.
const SEM_HOURS=[1,2,4],SEM_BASE={theme:24,cours:8,etude:5,serie:1,lentes:4},SEM_LVL=[.5,2],SEM_MIN_GAMES=3,SEM_WEEKS=8;
let semReady=false;
const DEVICE=(()=>{try{let d=localStorage.getItem('chess-up:appareil');if(!d){d=Math.random().toString(36).slice(2,8);localStorage.setItem('chess-up:appareil',d)}return d}catch(e){return 'x'}})();
const dayKey=t=>{const x=new Date(t);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
const parseDay=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
function mondayOf(t){const x=new Date(t);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x}
const weekKey=t=>dayKey(mondayOf(t));
const weekDays=mk=>new Set([...Array(7)].map((_,i)=>dayKey(addDays(parseDay(mk),i))));
const semBudget=()=>srs['sem:budget']?.h||2;
// Cadence des objectifs de jeu : celle qui a le plus de parties analysées (sinon le plus de parties)
const semCad=()=>{const n={};D.games.forEach(g=>n[g.cadence]=(n[g.cadence]||0)+(g.sf?1000:1));return Object.entries(n).sort((a,b)=>b[1]-a[1])[0]?.[0]};

// Une activité d'entraînement de plus aujourd'hui, sur cet appareil
function logAct(kind,extra={}){const id='j:'+dayKey(Date.now())+':'+DEVICE,r=srs[id]||{c:{}},c=r.c;
 c[kind]=(c[kind]||0)+1;
 if(kind==='coup'&&extra.ok)c.ok=(c.ok||0)+1;
 if(extra.deck)(c.d??={})[extra.deck]=(c.d[extra.deck]||0)+1;
 const map=kind==='cours'?'vu':'st';   // cours ouverts, ou coups devinés dans une structure
 if(extra.st)(c[map]??={})[extra.st]=(c[map][extra.st]||0)+1;
 r.t=Date.now();srs[id]=r;saveSrs();if(semReady)renderSemaine();seanceTick()}
// Activité d'une semaine, tous appareils : {coup, d:{…}, st:{…}, …}
function weekAct(mk){const out={d:{},st:{}},days=weekDays(mk);
 for(const [k,v] of Object.entries(srs)){if(!k.startsWith('j:')||!days.has(k.split(':')[1]))continue;
  for(const [a,n] of Object.entries(v.c||{}))if(typeof n==='number')out[a]=(out[a]||0)+n;else for(const [x,m] of Object.entries(n))(out[a]??={})[x]=(out[a][x]||0)+m}
 return out}
const weekGames=(mk,cad)=>{const days=weekDays(mk);return D.games.filter(g=>days.has(g.date)&&g.cadence===cad)};
const gafOf=g=>g.sf.phases.ouverture.gaf+g.sf.phases.milieu.gaf+g.sf.phases.finale.gaf;

// Objectif de jeu. Si la cadence analysée par Stockfish ne fait pas SEM_SLOW_SHARE des parties des 4 dernières semaines :
// en jouer davantage (parties lentes : on y apprend, et elles alimentent les exercices). Sinon, sur la cadence la plus
// jouée : défaites au temps si c'est la priorité n°1, ne pas enchaîner après deux défaites si le score chute nettement
// après une défaite, moins de gaffes que sa moyenne récente (cadence analysée).
const SEM_SLOW_SHARE=.3;
function gameGoal(){const cad=semCad(),since=dayKey(Date.now()-28*864e5),recent=D.games.filter(g=>g.date>=since);
 const played=Object.entries(recent.reduce((o,g)=>(o[g.cadence]=(o[g.cadence]||0)+1,o),{})).sort((a,b)=>b[1]-a[1])[0]?.[0]||cad;
 const analysed=D.games.some(g=>g.cadence===cad&&g.sf);
 if(analysed&&recent.length>=10&&recent.filter(g=>g.cadence===cad).length<SEM_SLOW_SHARE*recent.length)return {k:'lentes',cad,lvl:1};
 const P=D.games.filter(g=>g.cadence===played);
 if(topCause==='temps'&&P.slice(-30).some(g=>g.resultat==='Défaite'&&g.fin==='timeout'))return {k:'temps',cad:played};
 const L=P.filter(g=>g.ts);
 if(L.length>=50&&scoreGap(score(L.filter(g=>g.pertes>=1)),score(L).s/100)<0)return {k:'tilt',cad:played};
 const A=D.games.filter(g=>g.cadence===cad&&g.sf).slice(-30),m=A.length>=10?A.reduce((t,g)=>t+gafOf(g),0)/A.length:null;
 if(m!=null&&m>=.3)return {k:'gaffes',cad,target:Math.max(.2,Math.floor(m*.8*10)/10),ref:Math.round(m*100)/100};
 return {k:'temps',cad:played}}

function buildPlan(mk){const pk=dayKey(addDays(parseDay(mk),-7)),prev=srs['sem:'+pk];
 const lvl=k=>{const g=prev?.goals?.find(x=>x.k===k);if(!g)return 1;const r=goalStatus(g,pk);
  return Math.min(SEM_LVL[1],Math.max(SEM_LVL[0],(g.lvl||1)*(r.done?1.2:r.frac<.5?.8:1)))};
 const goals=[];
 let deck=CAUSE_DECK[topCause]||'tout';if(deckCards(deck).length<5)deck='tout';
 goals.push({k:'theme',deck,lvl:lvl('theme')});
 // cours : la structure où tu te trompes le plus, sauf celle déjà réussie la semaine dernière
 const rows=D.cours?coursAgg(D.games.filter(g=>g.cadence===semCad())).rows.sort((a,b)=>b.excess-a.excess||b.games.length-a.games.length):[];
 const pick=rows.find(r=>!prev?.goals?.some(x=>x.k==='cours'&&x.st===r.k&&goalStatus(x,pk).done))||rows[0];
 if(pick){const errs=D.moments.filter(m=>m.st&&m.st.split(':')[0]===pick.k&&m.best).length,dv=PARTIES.some(p=>p.st===pick.k);
  goals.push({k:'cours',st:pick.k,role:pick.r,via:errs>=3||!dv?'err':'devine',lvl:lvl('cours')})}
 else goals.push({k:'etude',lvl:lvl('etude')});
 const gg=gameGoal();if(gg.k==='lentes')gg.lvl=lvl('lentes');goals.push(gg);
 goals.push(goals.some(g=>g.k==='etude')?{k:'serie',lvl:1,extra:1}:{k:'etude',lvl:lvl('etude'),extra:1});   // seulement avec 4 h
 return {t:Date.now(),goals,perso:{txt:'',ok:false}}}

const semTarget=(g,h)=>g.k==='serie'?1:Math.max({theme:5,cours:3,etude:2,lentes:2}[g.k],Math.round(SEM_BASE[g.k]*h/2*(g.lvl||1)));
// Avancement d'un objectif pendant la semaine mk : {val, target, frac (0 à 1), done, judged (objectif de jeu jugeable)}
function goalStatus(g,mk,h=semBudget()){const act=weekAct(mk);
 if(g.k==='theme'||g.k==='etude'||g.k==='serie'){const val=g.k==='theme'?act.d[g.deck]||0:act[g.k]||0,target=semTarget(g,h);
  return {val,target,frac:Math.min(1,val/target),done:val>=target}}
 if(g.k==='cours'){const target=semTarget(g,h),opened=act.vu?.[g.st]?1:0,n=Math.min(target,g.via==='err'?act.d['st_'+g.st]||0:act.st[g.st]||0);
  return {val:n,opened,target,frac:(opened+n)/(target+1),done:opened&&n>=target}}
 const W=weekGames(mk,g.cad);
 if(g.k==='lentes'){const target=semTarget(g,h);return {val:W.length,target,frac:Math.min(1,W.length/target),done:W.length>=target}}
 const A=W.filter(x=>x.sf),base=g.k==='gaffes'?A:W,judged=base.length>=SEM_MIN_GAMES;
 const val=g.k==='gaffes'?(A.length?A.reduce((t,x)=>t+gafOf(x),0)/A.length:null)
  :g.k==='temps'?W.filter(x=>x.resultat==='Défaite'&&x.fin==='timeout').length:W.filter(x=>x.pertes>=2).length;
 const ok=g.k==='gaffes'?val!=null&&val<=g.target:val===0;
 return {val,n:base.length,judged,done:judged&&ok,frac:judged?(ok?1:g.k==='gaffes'?Math.min(.95,g.target/Math.max(val,.01)):.3):Math.min(.95,base.length/SEM_MIN_GAMES)*.5,bad:judged&&!ok}}

function goalLabel(g,h){const n=semTarget(g,h);
 if(g.k==='theme')return txn(n,'Rejouer {n} position du thème « {t} »','Rejouer {n} positions du thème « {t} »',{t:esc(DECKS[g.deck]?.[0]?.replace(/^· /,'')||g.deck)});
 if(g.k==='cours')return g.via==='err'?txn(n,'Cours « {c} » : le lire, puis rejouer {n} de tes erreurs dans cette structure','Cours « {c} » : le lire, puis rejouer {n} de tes erreurs dans cette structure',{c:esc(coName(g.st))})
  :txn(n,'Cours « {c} » : le lire, puis deviner {n} coup d\'une partie de maître dans cette structure','Cours « {c} » : le lire, puis deviner {n} coups d\'une partie de maître dans cette structure',{c:esc(coName(g.st))});
 if(g.k==='etude')return txn(n,'Faire {n} étude de position','Faire {n} études de position');
 if(g.k==='serie')return tx('Réussir une série chronométrée en entier');
 if(g.k==='gaffes')return tx('Au plus {g} gaffe par partie en moyenne en {cad}',{g:fmt(g.target,1),cad:esc(g.cad)});
 if(g.k==='temps')return tx('Aucune défaite au temps en {cad}',{cad:esc(g.cad)});
 if(g.k==='lentes')return txn(n,'Jouer au moins {n} partie en {cad} : les parties lentes font progresser, et Stockfish les analyse pour tes exercices','Jouer au moins {n} parties en {cad} : les parties lentes font progresser, et Stockfish les analyse pour tes exercices',{cad:esc(g.cad)});
 return tx('Après deux défaites d\'affilée, arrêter la session (une heure de pause)')}
function goalDetail(g,s){
 if(g.k==='theme'||g.k==='etude'||g.k==='serie'||g.k==='lentes')return `${s.val} / ${s.target}`;
 if(g.k==='cours')return (s.opened?tx('cours lu'):tx('cours pas encore ouvert'))+` · ${s.val} / ${s.target}`;
 const games=txn(s.n,'{n} partie cette semaine','{n} parties cette semaine');
 if(g.k==='gaffes')return s.n?tx('{g} gaffe par partie en moyenne ({games} ; ta moyenne récente : {r})',{g:fmt(s.val,2),games:txn(s.n,'{n} partie analysée cette semaine','{n} parties analysées cette semaine'),r:fmt(g.ref,2)})
  :tx('En attente de tes parties analysées de la semaine.');
 if(g.k==='temps')return s.n?txn(s.val,'{n} défaite au temps ({games})','{n} défaites au temps ({games})',{games}):tx('En attente de tes parties de la semaine.');
 return s.n?txn(s.val,'{n} partie lancée après deux défaites d\'affilée ({games})','{n} parties lancées après deux défaites d\'affilée ({games})',{games}):tx('En attente de tes parties de la semaine.')}
const semGoals=(plan,h)=>plan.goals.filter(g=>!g.extra||h>=4);
// Bilan d'une semaine passée : objectifs atteints sur le total (l'objectif libre compte s'il a été écrit)
function weekResult(mk){const plan=srs['sem:'+mk],h=plan.h||semBudget(),gs=semGoals(plan,h);
 const done=gs.filter(g=>goalStatus(g,mk,h).done).length+(plan.perso?.txt&&plan.perso.ok?1:0);
 return {done,total:gs.length+(plan.perso?.txt?1:0)}}

function renderSemaine(){const mk=weekKey(Date.now());let plan=srs['sem:'+mk];
 if(!plan){plan=buildPlan(mk);plan.h=semBudget();srs['sem:'+mk]=plan;saveSrs()}
 const h=semBudget(),left=7-((new Date().getDay()+6)%7);
 $('semBudget').value=String(h);
 $('semSub').textContent=tx('Semaine du {d} · {n} j restants. Objectifs choisis lundi d\'après tes parties ; celles de la semaine sont comptées à chaque mise à jour du rapport (dernière : {g}).',
  {d:parseDay(mk).toLocaleDateString(LOCALE,{day:'numeric',month:'long'}),n:left,g:D.generated});
 $('semGoals').innerHTML=semGoals(plan,h).map((g,i)=>{const s=goalStatus(g,mk,h),go=['theme','cours','etude','serie'].includes(g.k);
  return `<div class="goal${s.done?' done':s.bad?' bad':''}"><div class="goalhead"><span>${s.done?'✓ ':''}${goalLabel(g,h)}</span>${go?`<button class="linkbtn" data-go="${plan.goals.indexOf(g)}">${tx('Y aller →')}</button>`:''}</div>`
   +`<div class="gbar"><div style="width:${Math.round(100*s.frac)}%"></div></div><div class="muted gdetail">${goalDetail(g,s)}</div></div>`}).join('');
 $('semPerso').value=plan.perso?.txt||'';$('semPersoOk').checked=!!plan.perso?.ok;$('semPersoOk').disabled=!plan.perso?.txt;
 // historique : les semaines passées qui ont un plan, de la plus récente à la plus ancienne
 const past=Object.keys(srs).filter(k=>/^sem:\d{4}-/.test(k)&&k.slice(4)<mk).map(k=>k.slice(4)).sort().reverse().slice(0,SEM_WEEKS);
 let streak=0;for(const w of past){const r=weekResult(w);if(r.total&&r.done>=r.total-1)streak++;else break}
 $('semHist').innerHTML=past.length?tx('Semaines précédentes : {l}.',{l:past.map(w=>{const r=weekResult(w);return `${parseDay(w).toLocaleDateString(LOCALE,{day:'numeric',month:'short'})} <b>${r.done}/${r.total}</b>`}).join(' · ')})
  +(streak>=2?' '+tx('{n} semaines réussies d\'affilée (tous les objectifs sauf un au moins).',{n:streak}):'')
  :tx('Ton historique apparaîtra ici dès la semaine prochaine. Les objectifs suivent tes priorités : ils changent quand tu progresses, et deviennent plus exigeants quand tu les atteins.');
 semReady=true}

function semGo(g){showTab('entrainement');
 if(g.k==='theme'){deckChosen=true;setMode('coup');renderTraining(baseFilter(false));if([...$('tDeck').options].some(o=>o.value===g.deck))$('tDeck').value=g.deck;buildQueue(false)}
 else if(g.k==='cours'){setMode('cours');showCours(g.st+':'+g.role)}
 else setMode(g.k)}
$('semGoals').addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b)semGo(srs['sem:'+weekKey(Date.now())].goals[+b.dataset.go])});
$('semBudget').addEventListener('change',e=>{srs['sem:budget']={t:Date.now(),h:+e.target.value};const p=srs['sem:'+weekKey(Date.now())];if(p){p.h=+e.target.value;p.t=Date.now()}saveSrs();renderSemaine()});
const semPerso=()=>{const p=srs['sem:'+weekKey(Date.now())];p.perso={txt:$('semPerso').value.trim().slice(0,120),ok:$('semPersoOk').checked&&!!$('semPerso').value.trim()};p.t=Date.now();saveSrs();renderSemaine()};
$('semPerso').addEventListener('change',semPerso);$('semPersoOk').addEventListener('change',semPerso);

/* ---------- accueil : trois repères, chacun mène à sa section du diagnostic ---------- */
function renderHome(){const cad=semCad(),G=D.games.filter(g=>g.cadence===cad&&g.elo_joueur),last=G[G.length-1],tiles=[];
 if(last){const ago=dayKey(Date.now()-30*864e5),old=[...G].reverse().find(g=>g.date<ago),d=old?last.elo_joueur-old.elo_joueur:null;
  tiles.push(['secResultats',tx('Elo {cad}',{cad:esc(cad)}),last.elo_joueur,d==null?'':tx('{d} en 30 jours',{d:(d>0?'+':'')+d})])}
 const o=D.objectif;
 if(o&&last)tiles.push(['secObjectif',tx('Objectif'),o.target,o.target>last.elo_joueur?tx('encore {n} points · ce qui t\'en sépare',{n:o.target-last.elo_joueur}):tx('atteint · voir le détail')]);
 if(topCause)tiles.push(['secPrio',tx('Priorité n°1'),`<span class="tiletxt">${CAUSES[topCause]}</span>`,tx('là où tu perds le plus de points')]);
 $('homeStats').innerHTML=tiles.map(([sec,l,v,h])=>`<button class="kpi tile" data-sec="${sec}"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h} →</div></button>`).join('')}
$('homeStats').addEventListener('click',e=>{const b=e.target.closest('[data-sec]');if(b)goSection(b.dataset.sec)});

/* ---------- séance guidée : enchaîner les exercices du jour tirés de « Ma semaine » ----------
   Une séance ≈ 20 minutes (3 par heure du temps choisi) : pour chaque objectif d'entraînement pas encore atteint, une
   étape à sa mesure (positions du thème, lire le cours puis y rejouer ses erreurs, études, série). Chaque étape compte
   les activités du journal depuis son début ; une fois son compte atteint, le bandeau propose l'étape suivante. */
let seance=null;   // {steps:[{k, g, n, base, done}], i, fin}
function seanceSteps(){const mk=weekKey(Date.now()),plan=srs['sem:'+mk],h=semBudget(),per=Math.max(1,h*3),steps=[];
 for(const g of semGoals(plan,h)){const s=goalStatus(g,mk,h);if(s.done)continue;
  const part=left=>Math.min(left,Math.max(g.k==='theme'?5:3,Math.ceil(s.target/per)));
  if(g.k==='theme')steps.push({k:'theme',g,n:part(s.target-s.val)});
  else if(g.k==='cours'){if(!s.opened)steps.push({k:'lire',g,n:0});if(s.target>s.val)steps.push({k:'cours',g,n:part(s.target-s.val)})}
  else if(g.k==='etude')steps.push({k:'etude',g,n:Math.min(2,s.target-s.val)});
  else if(g.k==='serie')steps.push({k:'serie',g,n:1})}
 if(!steps.length)steps.push({k:'libre',g:{k:'theme',deck:'tout'},n:10});   // tout est atteint : séance libre sur tes erreurs
 return steps}
function seanceCount(st){const act=weekAct(weekKey(Date.now())),g=st.g;
 return st.k==='theme'||st.k==='libre'?act.d[g.deck]||0:st.k==='cours'?(g.via==='err'?act.d['st_'+g.st]||0:act.st[g.st]||0)
  :st.k==='etude'?act.etude||0:st.k==='serie'?act.serie||0:0}
function seanceLabel(st){const n=st.n,g=st.g;
 if(st.k==='theme')return txn(n,'Rejouer {n} position du thème « {t} »','Rejouer {n} positions du thème « {t} »',{t:esc(DECKS[g.deck]?.[0]?.replace(/^· /,'')||g.deck)});
 if(st.k==='lire')return tx('Lire le cours « {c} » : son plan et ses exemples chez les maîtres',{c:esc(coName(g.st))});
 if(st.k==='cours')return g.via==='err'?txn(n,'Rejouer {n} de tes erreurs dans la structure « {c} »','Rejouer {n} de tes erreurs dans la structure « {c} »',{c:esc(coName(g.st))})
  :txn(n,'Deviner {n} coup d\'une partie de maître dans la structure « {c} »','Deviner {n} coups d\'une partie de maître dans la structure « {c} »',{c:esc(coName(g.st))});
 if(st.k==='etude')return txn(n,'Faire {n} étude de position','Faire {n} études de position');
 if(st.k==='serie')return tx('Réussir une série chronométrée en entier');
 return txn(n,'Tous tes objectifs de la semaine sont atteints : séance libre, {n} position de tes erreurs','Tous tes objectifs de la semaine sont atteints : séance libre, {n} positions de tes erreurs')}
function seanceGo(st){const g=st.g;
 if(st.k==='theme'||st.k==='libre')semGo({k:'theme',deck:g.deck});
 else if(st.k==='lire')semGo(g);
 else if(st.k==='cours'){if(g.via==='err')semGo({k:'theme',deck:'st_'+g.st});
  else{showTab('entrainement');setMode('devine');const i=PARTIES.findIndex(p=>p.st===g.st);if(i>=0&&(!dCur||dCur.i!==i)){$('dGame').value=String(i);dvStart(i)}}}
 else semGo(g)}
function seanceStart(){seance={steps:seanceSteps(),i:0,fin:false};seanceStep()}
function seanceStep(){const st=seance.steps[seance.i];st.base=seanceCount(st);seanceGo(st);renderSeance()}
function seanceNext(){const st=seance.steps[seance.i];st.done=Math.min(st.n,seanceCount(st)-st.base);
 if(++seance.i<seance.steps.length)seanceStep();else{seance.fin=true;renderSeance();window.scrollTo(0,0)}}
function seanceTick(){if(seance&&!seance.fin)renderSeance()}   // à chaque activité du journal
function renderSeance(){const el=$('seance');el.hidden=!seance;if(!seance)return;
 if(seance.fin){const mk=weekKey(Date.now()),plan=srs['sem:'+mk],h=semBudget(),gs=semGoals(plan,h),done=gs.filter(g=>goalStatus(g,mk,h).done).length;
  el.className='panel seance done';
  el.innerHTML=`<h3>${tx('Séance terminée ✓')}</h3><ul class="insights">${seance.steps.map(st=>`<li>${seanceLabel(st)}${st.n?` : <b>${st.done||0}/${st.n}</b>`:''}</li>`).join('')}</ul>`
   +`<p>${txn(gs.length,'Ma semaine : {d} objectif atteint sur {n}.','Ma semaine : {d} objectifs atteints sur {n}.',{d:done})}</p>`
   +`<div class="filters"><button data-se="semaine">${tx('Voir ma semaine')}</button><button data-se="stop">${tx('Fermer')}</button></div>`;return}
 const st=seance.steps[seance.i],cnt=st.n?Math.min(st.n,seanceCount(st)-st.base):0,ok=st.n&&cnt>=st.n,lastStep=seance.i===seance.steps.length-1;
 el.className='panel seance'+(ok?' done':'');
 el.innerHTML=`<div class="rank">${tx('Séance du jour · étape {i} sur {n}',{i:seance.i+1,n:seance.steps.length})}</div><h3>${ok?'✓ ':''}${seanceLabel(st)}</h3>`
  +(st.n?`<div class="gbar"><div style="width:${Math.round(100*cnt/st.n)}%"></div></div><div class="muted gdetail">${cnt} / ${st.n}</div>`:'')
  +`<div class="filters"><button data-se="next" class="${ok||!st.n?'cta':''}">${st.k==='lire'?tx('J\'ai lu le cours →'):lastStep?(ok?tx('Terminer la séance ✓'):tx('Terminer la séance')):ok?tx('Étape suivante →'):tx('Passer cette étape')}</button>`
  +`<button data-se="go">${tx('Revenir à l\'exercice')}</button><button data-se="stop">${tx('Arrêter')}</button></div>`}
$('seance').addEventListener('click',e=>{const b=e.target.closest('[data-se]');if(!b||!seance)return;const a=b.dataset.se;
 if(a==='next')seanceNext();else if(a==='go')seanceGo(seance.steps[seance.i]);else if(a==='semaine'){seance=null;renderSeance();showTab('accueil')}else{seance=null;renderSeance()}});
$('semStart').addEventListener('click',seanceStart);
