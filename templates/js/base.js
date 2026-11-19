const D=__DATA__;const T=D.thresholds;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=1)=>x==null||isNaN(x)?'—':x.toLocaleString(LOCALE,{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=(a,b)=>b?100*a/b:null;
const CAD_COLORS={rapid:'#3987e5',blitz:'#d95926',daily:'#199e70',bullet:'#c98500',classical:'#8a63d2',correspondence:'#199e70',ultraBullet:'#e66767'};
const FIN={cheat:tx('triche'),resigned:tx('abandon'),checkmated:tx('mat'),timeout:tx('temps'),abandoned:tx('déconnexion'),agreed:tx('nulle acceptée'),repetition:tx('répétition'),stalemate:tx('pat'),insufficient:tx('matériel insuffisant'),timevsinsufficient:tx('temps / matériel insuff.'),'50move':tx('règle des 50 coups')};
const PHASE={ouverture:tx('Ouverture'),milieu:tx('Milieu de partie'),finale:tx('Finale')};
const FINALES={pions:tx('Finales de pions'),tours:tx('Finales de tours'),mineures:tx('Finales de pièces mineures'),tours_mineures:tx('Tours et pièces mineures'),dames:tx('Finales de dames'),dames_pieces:tx('Dames et autres pièces')};
// Valeurs de données affichées (couleur, résultat) : traduites à l'affichage seulement
const VAL_TXT={Blancs:tx('Blancs'),Noirs:tx('Noirs'),Victoire:tx('Victoire'),Nulle:tx('Nulle'),'Défaite':tx('Défaite')};
const vtx=v=>VAL_TXT[v]??v;
// « subi » : ce que la meilleure réponse adverse gagnait après ton coup ; « manqué » : ce que le meilleur coup gagnait
const MOTIFS={materiel_subi:tx('Matériel laissé en prise'),fourchette_subie:tx('Fourchette subie'),clouage_subi:tx('Clouage subi'),mat_subi:tx('Mat permis'),
 materiel_manque:tx('Gain de matériel manqué'),fourchette_manquee:tx('Fourchette manquée'),clouage_manque:tx('Clouage manqué'),mat_manque:tx('Mat manqué')};
Object.entries(MOTIFS).forEach(([k,l])=>$('mMotif').add(new Option(l,k)));
// Temps de réflexion d'un coup, en part du temps total d'une partie (chess_analysis.TIME_BUCKETS)
const TIME_LABELS=(()=>{const b=T.tps.map(x=>Math.round(x*100)),names=[tx('Réflexe'),tx('Rapide'),tx('Normal'),tx('Longue réflexion')];
 return names.map((n,i)=>n+' ('+(i===0?'< '+b[0]:i===b.length?'≥ '+b[b.length-1]:b[i-1]+'–'+b[i])+PC+')')})();
D.games.forEach((g,i)=>{g.i=i;g.pts=g.resultat==='Victoire'?1:g.resultat==='Nulle'?.5:0});
// Période : D.since = "YYYY-MM" → « juin 2026 » dans la langue affichée (date locale, pas UTC, pour ne pas changer de mois)
const SINCE_TXT=D.since?(([y,m])=>new Date(y,m-1,1).toLocaleString(LOCALE,{month:'long',year:'numeric'}))(D.since.split('-').map(Number)):'';
$('subtitle').textContent='@'+D.username+(SINCE_TXT?' · '+tx('Depuis {mois}',{mois:SINCE_TXT}):'')+' · '+txn(D.games.length,'{n} partie','{n} parties');$('generated').textContent=tx('Généré le {date}',{date:D.generated});
Chart.defaults.color='#a9b6c8';Chart.defaults.borderColor='#2b394b';Chart.defaults.font.family='system-ui,sans-serif';
const charts={},pendingCharts={};
function chart(id,cfg){charts[id]?.destroy();delete charts[id];
 if($(id).offsetParent===null){pendingCharts[id]=cfg;return}   // onglet masqué : le graphique sera créé à son affichage
 delete pendingCharts[id];charts[id]=new Chart($(id),cfg)}
const drawPendingCharts=()=>Object.keys(pendingCharts).forEach(id=>$(id).offsetParent!==null&&chart(id,pendingCharts[id]));
const barOpts=(extra={})=>({responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{boxWidth:12}}},...extra});

const cadences=[...new Set(D.games.map(g=>g.cadence))].sort((a,b)=>D.games.filter(g=>g.cadence===b).length-D.games.filter(g=>g.cadence===a).length);
$('fCadence').add(new Option(tx('Toutes'),''));cadences.forEach(c=>$('fCadence').add(new Option(c,c)));
const lastDate=D.games.length?new Date(D.games[D.games.length-1].date):new Date();

function baseFilter(ignoreCadence){const c=$('fCadence').value,p=+$('fPeriod').value,r=$('fRated').checked;
 const since=p?new Date(lastDate-p*864e5):null;
 return D.games.filter(g=>(ignoreCadence||!c||g.cadence===c)&&(!r||String(g.rated).toLowerCase()==='true')&&(!since||new Date(g.date)>=since))}
function score(list){const w=list.filter(g=>g.resultat==='Victoire').length,d=list.filter(g=>g.resultat==='Nulle').length,l=list.filter(g=>g.resultat==='Défaite').length;
 return {n:list.length,w,d,l,s:list.length?100*(w+.5*d)/list.length:null}}
const vnd=s=>`${s.w}-${s.d}-${s.l}`;
// Marge du hasard : un score (sur n parties) s'écarte nettement d'une référence p (0 à 1) s'il en sort de plus de 2 écarts-types.
// Renvoie 1 (nettement au-dessus), -1 (nettement en dessous) ou 0.
function scoreGap(s,p){if(!s.n||p==null)return 0;const se=100*Math.sqrt(Math.max(p*(1-p),.01)/s.n),d=s.s-100*p;return Math.abs(d)>2*se?Math.sign(d):0}
const scoresDiffer=(a,b)=>{const pa=a.s/100,pb=b.s/100;return Math.abs(a.s-b.s)>200*Math.sqrt(Math.max(pa*(1-pa),.01)/a.n+Math.max(pb*(1-pb),.01)/b.n)};
const HASARD=' <span class="muted">('+tx('écart dans la marge du hasard')+')</span>';
const gap=g=>(+g.elo_adversaire||0)-(+g.elo_joueur||0);
const SMALL=' <span class="muted">· '+tx('petit échantillon')+'</span>';

/* ---------- agrégats Stockfish ---------- */
function sfAgg(list){const a=list.filter(g=>g.sf);const n=a.length;if(!n)return null;
 const ph={ouverture:{coups:0,imp:0,err:0,gaf:0,acc:0},milieu:{coups:0,imp:0,err:0,gaf:0,acc:0},finale:{coups:0,imp:0,err:0,gaf:0,acc:0}};
 let errs=0,zt=0,occ=0,mm=0,prec=0,acpl=0,np=0,winning=0,notConv=0,timeouts=0,losing=0,saved=0,t15=0,nt15=0;
 const tb={coups:T.tps.map(()=>0).concat(0),err:T.tps.map(()=>0).concat(0)};
 a.forEach(g=>{for(const p in ph)for(const k in ph[p])ph[p][k]+=g.sf.phases[p][k];
  const e=g.sf.phases;errs+=e.ouverture.err+e.ouverture.gaf+e.milieu.err+e.milieu.gaf+e.finale.err+e.finale.gaf;
  zt+=g.sf.zt_err;occ+=g.sf.occ;mm+=g.sf.mm;if(g.sf.prec!=null){prec+=g.sf.prec;acpl+=g.sf.acpl;np++}
  if(g.sf.max_win>=T.win){winning++;if(g.resultat!=='Victoire')notConv++}
  if(g.sf.min_win!=null&&g.sf.min_win<=100-T.win){losing++;if(g.resultat!=='Défaite')saved++}   // position perdante sauvée
  if(g.sf.tps)tb.coups.forEach((_,i)=>{tb.coups[i]+=g.sf.tps.coups[i];tb.err[i]+=g.sf.tps.err[i]});
  if(g.sf.t15!=null){t15+=g.sf.t15;nt15++}
  if(g.resultat==='Défaite'&&g.fin==='timeout')timeouts++});
 const tot=k=>ph.ouverture[k]+ph.milieu[k]+ph.finale[k];
 return {n,a,ph,gaf:tot('gaf'),err:tot('err'),imp:tot('imp'),coups:tot('coups'),errs,zt,occ,mm,prec:np?prec/np:null,acpl:np?acpl/np:null,winning,notConv,timeouts,losing,saved,tb,t15:nt15?t15/nt15:null}}
// Erreurs pour 100 coups joués dans une tranche de temps de réflexion, et dans toutes les autres
const phAcc=(A,p)=>A.ph[p].coups?A.ph[p].acc/A.ph[p].coups:null;   // précision moyenne des coups d'une phase
const tbRate=(A,i)=>A.tb.coups[i]?100*A.tb.err[i]/A.tb.coups[i]:null;
const tbRest=(A,i)=>{const c=A.tb.coups.reduce((t,x,j)=>t+(j===i?0:x),0),e=A.tb.err.reduce((t,x,j)=>t+(j===i?0:x),0);return c?100*e/c:null};
// Nombre de moments (erreurs, gaffes, mats manqués) par motif, dans les parties G
function motifCounts(G){const ids=new Set(G.map(g=>g.i)),list=D.moments.filter(m=>ids.has(m.g)),c={};
 list.forEach(m=>(m.mot||[]).forEach(k=>c[k]=(c[k]||0)+1));
 return {n:list.length,none:list.filter(m=>!(m.mot||[]).length).length,ranked:Object.entries(c).sort((a,b)=>b[1]-a[1])}}

const CAUSES={temps:tx('Gestion de la pendule'),conversion:tx('Conversion des positions gagnantes'),ouverture:tx('Sortie d\'ouverture'),milieu:tx('Tactique en milieu de partie'),finale:tx('Technique de finale'),positionnel:tx('Jeu positionnel (pas de gaffe nette)')};
// Points perdus par cause (parties non gagnées), de la plus coûteuse à la moins coûteuse
function lostByCause(A){const lost={};A.a.forEach(g=>{const c=cause(g);if(c)(lost[c]??={pts:0,games:[]}).pts+=1-g.pts,lost[c].games.push(g)});
 const ranked=Object.entries(lost).sort((a,b)=>b[1].pts-a[1].pts);return {ranked,totalLost:ranked.reduce((t,[,v])=>t+v.pts,0)}}
function cause(g){if(g.resultat==='Victoire'||!g.sf)return null;const s=g.sf,d=s.decisive;
 if((g.fin==='timeout'&&(!d||d.loss<T.gaf))||(d&&d.zt))return 'temps';
 if(s.max_win>=T.win)return 'conversion';
 if(d)return d.ph;
 if(s.eval_ouv!=null&&s.eval_ouv<=-200)return 'ouverture';
 return 'positionnel'}
const momentOf=(g,ply)=>D.moments.find(m=>m.g===g&&m.ply===ply);
const lichess=(fen,color)=>'https://lichess.org/analysis/standard/'+fen.replace(/ /g,'_')+'?color='+(color==='Blancs'?'white':'black');

/* ---------- rendu ---------- */
function render(){const G=baseFilter(false),GA=baseFilter(true);const sc=score(G);
 $('fCount').textContent=txn(G.length,'{n} partie sélectionnée','{n} parties sélectionnées');
 const elos=cadences.map(c=>{const l=GA.filter(g=>g.cadence===c&&g.elo_joueur);return l.length?c+' '+l[l.length-1].elo_joueur:null}).filter(Boolean);
 const accCom=G.filter(g=>g['precision_joueur_%']!=='');
 const comp=score(G.filter(g=>Math.abs(gap(g))<=50));
 const k=[[tx('Parties'),G.length,''],[tx('Score'),fmt(sc.s)+PC,tx('victoire 1 · nulle ½')],[tx('Victoires · nulles · défaites'),vnd(sc),''],[tx('Elo actuel'),elos.slice(0,2).join(' · ')||'—',elos.slice(2).join(' · ')],
  [tx('Précision {site}',{site:'__SITE__'}),accCom.length?fmt(accCom.reduce((s,g)=>s+ +g['precision_joueur_%'],0)/accCom.length)+PC:'—',txn(accCom.length,'{n} partie seulement','{n} parties seulement')],
  [tx('Parties analysées'),G.filter(g=>g.sf).length,tx('par Stockfish')],[tx('Comparable (±50 Elo)'),fmt(comp.s)+PC,txn(comp.n,'{n} partie','{n} parties')],[tx('Défaites au temps'),G.filter(g=>g.resultat==='Défaite'&&g.fin==='timeout').length,txn(sc.l,'sur {n} défaite','sur {n} défaites')]];
 $('kpis').innerHTML=k.map(x=>`<div class="kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('');

 // Résultats par cadence (ignore le filtre cadence)
 const byCad=cadences.map(c=>({c,...score(GA.filter(g=>g.cadence===c))})).filter(x=>x.n);
 chart('cadenceChart',{type:'bar',data:{labels:byCad.map(x=>x.c),datasets:[{label:tx('Score'),data:byCad.map(x=>x.s),backgroundColor:byCad.map(x=>CAD_COLORS[x.c]||'#9085e9'),borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>tx('Score {s} ({vnd})',{s:fmt(c.raw)+PC,vnd:vnd(byCad[c.dataIndex])})}}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+PC}}}})});
 $('cadenceTable').innerHTML=`<tr><th>${tx('Cadence')}</th><th class="num">${tx('Parties')}</th><th>${tx('V-N-D')}</th><th class="num">${tx('Score')}</th></tr>`+byCad.map(x=>`<tr><td>${esc(x.c)}</td><td class="num">${x.n}</td><td>${vnd(x)}</td><td class="num">${fmt(x.s)}${PC}</td></tr>`).join('');

 const byCol=['Blancs','Noirs'].map(c=>({c,...score(G.filter(g=>g.couleur===c))}));
 chart('colorChart',{type:'bar',data:{labels:byCol.map(x=>vtx(x.c)),datasets:[{label:tx('Victoires'),data:byCol.map(x=>x.w),backgroundColor:'#199e70',borderRadius:4},{label:tx('Nulles'),data:byCol.map(x=>x.d),backgroundColor:'#c98500',borderRadius:4},{label:tx('Défaites'),data:byCol.map(x=>x.l),backgroundColor:'#e66767',borderRadius:4}]},
  options:barOpts({indexAxis:'y',scales:{x:{stacked:true},y:{stacked:true}}})});
 $('colorTable').innerHTML=`<tr><th>${tx('Couleur')}</th><th class="num">${tx('Parties')}</th><th>${tx('V-N-D')}</th><th class="num">${tx('Score')}</th></tr>`+byCol.map(x=>`<tr><td>${vtx(x.c)}</td><td class="num">${x.n}</td><td>${vnd(x)}</td><td class="num">${fmt(x.s)}${PC}</td></tr>`).join('');

 const buckets=[['≤ −150',-1e9,-150],[tx('{a} à {b}',{a:'−149',b:'−51'}),-149,-51],['±50',-50,50],[tx('{a} à {b}',{a:'+51',b:'+149'}),51,149],['≥ +150',150,1e9]];
 const byGap=buckets.map(([l,a,b])=>({l,...score(G.filter(g=>g.elo_adversaire&&g.elo_joueur&&gap(g)>=a&&gap(g)<=b))}));
 chart('gapChart',{type:'bar',data:{labels:byGap.map(x=>x.l),datasets:[{label:tx('Score'),data:byGap.map(x=>x.s),backgroundColor:'#3987e5',borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>txn(byGap[c.dataIndex].n,'Score {s} · {n} partie ({vnd})','Score {s} · {n} parties ({vnd})',{s:fmt(c.raw)+PC,vnd:vnd(byGap[c.dataIndex])})}}},scales:{x:{title:{display:true,text:tx('Adversaire plus faible  ←  écart d\'Elo  →  adversaire plus fort')}},y:{min:0,max:100,ticks:{callback:v=>v+PC}}}})});

 const week=d=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+6)%7);return t.toISOString().slice(0,10)};
 const weeks=[...new Set(G.map(g=>week(g.date)))].sort();
 const eloSets=cadences.filter(c=>G.some(g=>g.cadence===c)).map(c=>{const last={};G.filter(g=>g.cadence===c&&g.elo_joueur).forEach(g=>last[week(g.date)]=+g.elo_joueur);
  return {label:c,data:weeks.map(w=>last[w]??null),borderColor:CAD_COLORS[c]||'#9085e9',backgroundColor:CAD_COLORS[c]||'#9085e9',spanGaps:true,tension:.25,borderWidth:2,pointRadius:2}}).filter(s=>s.data.filter(v=>v!=null).length>1);
 chart('eloChart',{type:'line',data:{labels:weeks,datasets:eloSets},options:barOpts({scales:{y:{}}})});

 const months=[...new Set(G.map(g=>g.mois))].sort();const bm=months.map(m=>score(G.filter(g=>g.mois===m)));
 chart('monthlyChart',{type:'bar',data:{labels:months,datasets:[{label:tx('Victoires'),data:bm.map(x=>x.w),backgroundColor:'#199e70',borderRadius:4},{label:tx('Nulles'),data:bm.map(x=>x.d),backgroundColor:'#c98500',borderRadius:4},{label:tx('Défaites'),data:bm.map(x=>x.l),backgroundColor:'#e66767',borderRadius:4}]},options:barOpts({scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}})});

 renderOpenings(G);renderRepertoire(G);renderSF(G,GA);renderProgress(G);renderTraining(G);renderStudy(G);renderInsights(G,GA);renderBehaviour(G);renderGames(G)}

/* ---------- ouvertures ---------- */
let oSort={k:'n',dir:-1};
function openingRows(G,key,min){const groups={};G.forEach(g=>{const id=g[key]+'|'+g.couleur;(groups[id]??=[]).push(g)});
 return Object.entries(groups).map(([id,l])=>{const a=l.filter(g=>g.sf&&g.sf.eval_ouv!=null);const s=score(l);const sf=l.filter(g=>g.sf);
  return {name:id.split('|')[0],col:id.split('|')[1],...s,ev:a.length?a.reduce((t,g)=>t+g.sf.eval_ouv,0)/a.length/100:null,na:a.length,
   oe:sf.length?sf.reduce((t,g)=>t+g.sf.phases.ouverture.err+g.sf.phases.ouverture.gaf,0)/sf.length:null}}).filter(r=>r.n>=min)}
function renderOpenings(G){const rows=openingRows(G,$('oGroup').value,+$('oMin').value);
 const cols=[['name',tx('Ouverture')],['col',tx('Couleur')],['n',tx('Parties'),'num'],['vnd',tx('V-N-D')],['s',tx('Score'),'num'],['ev',tx('Éval. après 12 coups'),'num'],['oe',tx('Erreurs d\'ouverture / partie'),'num']];
 $('oHead').innerHTML=cols.map(([k,l,c])=>`<th class="sort ${c||''}" data-k="${k}">${l}${oSort.k===k?(oSort.dir<0?' ↓':' ↑'):''}</th>`).join('');
 rows.sort((a,b)=>{const k=oSort.k==='vnd'?'n':oSort.k;const x=a[k],y=b[k];if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*oSort.dir});
 $('openings').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}${r.n<10?SMALL:''}</td><td>${vtx(r.col)}</td><td class="num">${r.n}</td><td>${vnd(r)}</td>
  <td class="num"><span class="bar" style="width:${Math.round(r.s*.6)}px"></span>${fmt(r.s)}${PC}</td>
  <td class="num ${r.ev==null?'':r.ev<=-1?'loss':r.ev>=1?'win':''}">${r.ev==null?'—':(r.ev>0?'+':'')+fmt(r.ev,2)} <span class="muted">${r.na?'('+r.na+')':''}</span></td><td class="num">${fmt(r.oe,2)}</td></tr>`).join('')||`<tr><td colspan="7" class="empty">${tx('Aucune ouverture avec assez de parties dans cette sélection.')}</td></tr>`;
 document.querySelectorAll('#oHead th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;oSort=oSort.k===k?{k,dir:-oSort.dir}:{k,dir:['name','col'].includes(k)?1:-1};renderOpenings(baseFilter(false))})}

/* ---------- Stockfish ---------- */
function renderSF(G,GA){const A=sfAgg(G);
 const analysedCads=[...new Set(D.games.filter(g=>g.sf).map(g=>g.cadence))];
 $('prioPanel').hidden=!A;$('endPanel').hidden=!A;$('partiesSf').hidden=!A;   // sections qui viennent de l'analyse Stockfish
 if(!A){$('sfBlock').hidden=true;$('sfMissing').hidden=false;
  $('sfMissing').textContent=analysedCads.length?tx('Aucune partie analysée dans cette sélection. Cadences analysées : {cads}. Pour en ajouter : {cmd}',{cads:analysedCads.join(', '),cmd:'python chess_dashboard_generator.py --cadences '+[...new Set([...analysedCads,$('fCadence').value||'blitz'])].join(',')}):tx('Aucune partie analysée par Stockfish. Lance : {cmd}',{cmd:'python chess_dashboard_generator.py'});return}
 $('sfBlock').hidden=false;$('sfMissing').hidden=true;
 const k=[[tx('Parties analysées'),A.n,G.length>A.n?tx('sur {n} (cadences analysées : {cads})',{n:G.length,cads:analysedCads.join(', ')}):tx('toutes celles de la sélection')],[tx('Précision estimée'),fmt(A.prec)+PC,tx('ouverture {o} · milieu {m} · finale {f}',{o:fmt(phAcc(A,'ouverture'),0),m:fmt(phAcc(A,'milieu'),0),f:fmt(phAcc(A,'finale'),0)})],[tx('Perte moyenne / coup'),fmt(A.acpl,0)+' cp',tx('ACPL, en centièmes de pion')],[tx('Gaffes / partie'),fmt(A.gaf/A.n,2),tx('{e} erreurs · {i} imprécisions',{e:fmt(A.err/A.n,2),i:fmt(A.imp/A.n,1)})],
  [tx('Erreurs en zeitnot'),fmt(pct(A.zt,A.errs),0)+PC,tx('{z} erreurs et gaffes sur {n}',{z:A.zt,n:A.errs})],[tx('Occasions manquées'),tx('{n} / partie',{n:fmt(A.occ/A.n,2)}),tx('grosse erreur adverse non punie')],[tx('Parties perdantes sauvées'),A.losing?fmt(pct(A.saved,A.losing),0)+PC:'—',tx('{s} sur {n} parties où tu étais perdant (nulle ou victoire)',{s:A.saved,n:A.losing})],[tx('Positions gagnantes gâchées'),A.winning?fmt(pct(A.notConv,A.winning),0)+PC:'—',tx('{s} sur {n} parties où tu étais gagnant',{s:A.notConv,n:A.winning})]];
 $('sfKpis').innerHTML=k.map(x=>`<div class="kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('');

 const phs=['ouverture','milieu','finale'];const rate=(p,s)=>A.ph[p].coups?100*A.ph[p][s]/A.ph[p].coups:0;
 chart('phaseChart',{type:'bar',data:{labels:phs.map(p=>txn(A.ph[p].coups,'{phase} ({n} coup)','{phase} ({n} coups)',{phase:PHASE[p]})),datasets:[...[['imp',tx('Imprécisions'),'#c98500'],['err',tx('Erreurs'),'#d95926'],['gaf',tx('Gaffes'),'#e66767']].map(([s,l,c])=>({label:l,data:phs.map(p=>rate(p,s)),backgroundColor:c,borderRadius:4})),
   {type:'line',label:tx('Précision'),data:phs.map(p=>phAcc(A,p)),yAxisID:'y1',borderColor:'#3987e5',backgroundColor:'#3987e5',pointRadius:4,borderWidth:2}]},
  options:barOpts({plugins:{tooltip:{callbacks:{label:c=>c.dataset.yAxisID==='y1'?tx('Précision : {v}',{v:fmt(c.raw)+PC}):tx('{l} : {v} pour 100 coups',{l:c.dataset.label,v:fmt(c.raw)})}}},
   scales:{y:{beginAtZero:true,title:{display:true,text:tx('pour 100 coups')}},y1:{position:'right',suggestedMin:60,max:100,grid:{drawOnChartArea:false},ticks:{callback:v=>v+PC}}}})});

 const {ranked,totalLost}=lostByCause(A);
 chart('causeChart',{type:'bar',data:{labels:ranked.map(([c])=>CAUSES[c]),datasets:[{label:tx('Points perdus'),data:ranked.map(([,v])=>v.pts),backgroundColor:'#e66767',borderRadius:4,maxBarThickness:28}]},
  options:barOpts({indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>txn(ranked[c.dataIndex][1].games.length,'{p} points · {n} partie · {s} des points perdus','{p} points · {n} parties · {s} des points perdus',{p:fmt(c.raw,1),s:fmt(pct(c.raw,totalLost),0)+PC})}}},scales:{x:{beginAtZero:true}}})});

 renderMotifs(G);renderTime(A);renderEndgames(A);
 topCause=ranked[0]?.[0]||null;renderPriorities(A,ranked,totalLost,G);

 const cmp=analysedCads.map(c=>{const l=GA.filter(g=>g.cadence===c);const a=sfAgg(l);return a&&{c,s:score(a.a),a}}).filter(Boolean);
 const per100=(a,p)=>a.ph[p].coups?fmt(100*a.ph[p].gaf/a.ph[p].coups,1):'—';
 const notAnalysed=cadences.filter(c=>!analysedCads.includes(c));
 $('cmpTable').innerHTML=`<tr><th>${tx('Cadence')}</th><th class="num">${tx('Analysées')}</th><th class="num">${tx('Score')}</th><th class="num">${tx('Précision')}</th><th class="num">${tx('Précision<br>ouv. · milieu · finale')}</th><th class="num">ACPL</th><th class="num">${tx('Gaffes / partie')}</th><th class="num">${tx('Gaffes /100 coups<br>ouv. · milieu · finale')}</th><th class="num">${tx('Erreurs en zeitnot')}</th><th class="num">${tx('Défaites au temps')}</th><th class="num">${tx('Gagnantes gâchées')}</th></tr>`+
  cmp.map(({c,s,a})=>`<tr><td>${esc(c)}</td><td class="num">${a.n}</td><td class="num">${fmt(s.s)}${PC}</td><td class="num">${fmt(a.prec)}${PC}</td><td class="num">${['ouverture','milieu','finale'].map(p=>fmt(phAcc(a,p),0)).join(' · ')}</td><td class="num">${fmt(a.acpl,0)}</td><td class="num">${fmt(a.gaf/a.n,2)}</td><td class="num">${per100(a,'ouverture')} · ${per100(a,'milieu')} · ${per100(a,'finale')}</td><td class="num">${fmt(pct(a.zt,a.errs),0)}${PC}</td><td class="num">${a.timeouts}</td><td class="num">${a.winning?fmt(pct(a.notConv,a.winning),0)+PC:'—'}</td></tr>`).join('')+
  (notAnalysed.length?`<tr><td colspan="11" class="muted">${tx('Non analysées : {cads} — {cmd}',{cads:notAnalysed.join(', '),cmd:'python chess_dashboard_generator.py --cadences '+[...analysedCads,...notAnalysed].join(',')})}</td></tr>`:'');

 renderMoments(G);
 const lw=A.a.filter(g=>g.sf.max_win>=T.win&&g.resultat!=='Victoire').reverse();
 $('lostSub').textContent=tx('Parties où tu as atteint au moins {w} de chances de gain (environ +4) sans gagner : {n}.',{w:T.win+PC,n:lw.length});
 $('lostWins').innerHTML=lw.map(g=>{const d=g.sf.decisive&&momentOf(g.i,g.sf.decisive.ply);return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(g.adversaire)} (${esc(g.elo_adversaire)})</td><td class="num">${g.sf.max_win}${PC}</td><td class="${g.resultat==='Défaite'?'loss':'draw'}">${esc(vtx(g.resultat))}</td><td>${esc(FIN[g.fin]||g.fin)}</td>
  <td>${d?`<a href="${lichess(d.fen,g.couleur)}" target="_blank" rel="noopener">${tx('Erreur décisive')}</a> · `:''}<a href="${esc(g.lien)}" target="_blank" rel="noopener">${tx('Partie')}</a></td></tr>`}).join('')||`<tr><td colspan="7" class="empty">${tx('Aucune.')}</td></tr>`}

function renderMotifs(G){const M=motifCounts(G);
 $('motifSub').textContent=tx('Sur tes {n} erreurs, gaffes et mats manqués. « Subi » : ce que la meilleure réponse adverse gagnait après ton coup ; « manqué » : ce que le meilleur coup gagnait. {none} sans motif détecté (erreur positionnelle ou combinaison plus longue).',{n:M.n,none:M.none});
 chart('motifChart',{type:'bar',data:{labels:M.ranked.map(([k])=>MOTIFS[k]),datasets:[{label:tx('Moments'),data:M.ranked.map(([,v])=>pct(v,M.n)),backgroundColor:M.ranked.map(([k])=>/_subie?$/.test(k)?'#e66767':'#c98500'),borderRadius:4,maxBarThickness:28}]},
  options:barOpts({indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>txn(M.ranked[c.dataIndex][1],'{n} moment · {s} de tes erreurs','{n} moments · {s} de tes erreurs',{s:fmt(c.raw,0)+PC})}}},scales:{x:{beginAtZero:true,ticks:{callback:v=>v+PC}}}})})}

// Finales par type : chances de gain en y entrant, score obtenu, erreurs commises dans ce type de finale
function endgameRows(A){const by={};A.a.forEach(g=>{const f=g.sf.finale;if(f)(by[f.type]??=[]).push(g)});
 return Object.entries(by).map(([t,l])=>{const s=score(l),exp=l.reduce((x,g)=>x+g.sf.finale.w,0)/l.length,ids=new Set(l.map(g=>g.i));
  const errs=D.moments.filter(m=>ids.has(m.g)&&m.ft===t&&m.sev!=='mat').length;
  return {t,...s,exp,gap:s.s-exp,sig:scoreGap(s,exp/100),errs:errs/l.length}}).sort((a,b)=>b.n-a.n)}
function renderEndgames(A){const rows=endgameRows(A),n=rows.reduce((t,r)=>t+r.n,0);
 $('endSub').textContent=tx('Type de la première finale atteinte dans {n} parties analysées (pièces restantes, rois et pions exclus). « Attendu » : ton score si tu convertissais exactement les chances de gain que Stockfish te donnait en entrant en finale.',{n});
 $('endTable').innerHTML=`<tr><th>${tx('Finale')}</th><th class="num">${tx('Parties')}</th><th>${tx('V-N-D')}</th><th class="num">${tx('Attendu')}</th><th class="num">${tx('Score')}</th><th>${tx('Écart')}</th><th class="num">${tx('Erreurs / partie')}</th></tr>`+rows.map(r=>`<tr><td>${FINALES[r.t]}${r.n<10?SMALL:''}</td><td class="num">${r.n}</td><td>${vnd(r)}</td><td class="num">${fmt(r.exp,0)}${PC}</td><td class="num">${fmt(r.s,0)}${PC}</td>
  <td class="${r.sig>0?'win':r.sig<0?'loss':'muted'}">${tx('{g} pts',{g:(r.gap>0?'+':'')+fmt(r.gap,0)})}${r.sig?'':' '+tx('(hasard)')}</td><td class="num">${fmt(r.errs,2)}</td></tr>`).join('')||`<tr><td colspan="7" class="empty">${tx('Aucune finale atteinte dans les parties analysées.')}</td></tr>`}

function renderTime(A){const total=A.tb.coups.reduce((t,x)=>t+x,0);
 $('timeSub').textContent=total?tx('Temps passé sur le coup, en part du temps total d\'une partie (temps initial + 40 incréments ; en 10 min : réflexe = moins de {a} s, longue réflexion = {b} s et plus).',{a:Math.round(600*T.tps[0]),b:Math.round(600*T.tps[T.tps.length-1])})+' '+(A.t15!=null?tx('Au {k}e coup, tu as utilisé en moyenne {p} de ton temps initial.',{k:T.t15,p:fmt(A.t15,0)+PC}):'')
  :tx('Pas de temps de pendule dans les parties analysées de cette sélection.');
 chart('timeChart',{type:'bar',data:{labels:TIME_LABELS,datasets:[{label:tx('Erreurs et gaffes pour 100 coups'),data:A.tb.coups.map((_,i)=>tbRate(A,i)),backgroundColor:'#d95926',borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>tx('{r} erreurs et gaffes pour 100 coups · {n} coups joués ({p})',{r:fmt(c.raw),n:A.tb.coups[c.dataIndex],p:fmt(pct(A.tb.coups[c.dataIndex],total),0)+PC})}}},scales:{y:{beginAtZero:true,title:{display:true,text:tx('pour 100 coups')}}}})})}

function renderMoments(G){const ids=new Set(G.map(g=>g.i));const t=$('mType').value,p=$('mPhase').value,mo=$('mMotif').value;
 const list=D.moments.filter(m=>ids.has(m.g)&&(!p||m.ph===p)&&(!mo||(m.mot||[]).includes(mo))&&(t===''?m.sev!=='mat':t==='gaf'?m.sev==='gaf':t==='occ'?m.occ:t==='mm'?m.mm:m.zt&&m.sev!=='mat')).slice().reverse();
 $('mCount').textContent=txn(list.length,'{n} moment','{n} moments')+(list.length>400?' '+tx('(400 plus récents affichés)'):'');
 const sevl={gaf:`<span class="loss">${tx('Gaffe')}</span>`,err:`<span class="draw">${tx('Erreur')}</span>`,mat:`<span class="muted">${tx('Mat manqué')}</span>`};
 $('moments').innerHTML=list.slice(0,400).map(m=>{const g=D.games[m.g];return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(m.n)}</td><td>${sevl[m.sev]} <b>${esc(m.san)}</b>${m.occ?` <span class="pill">${tx('occasion manquée')}</span>`:''}${m.mm&&m.sev!=='mat'?` <span class="pill">${tx('mat manqué')}</span>`:''}${(m.mot||[]).filter(k=>k!=='mat_manque').map(k=>` <span class="pill">${MOTIFS[k].toLowerCase()}</span>`).join('')}</td>
  <td><b>${esc(m.best)}</b></td><td class="num">${m.wb}${PC} → <span class="${m.wa<m.wb-T.gaf?'loss':''}">${m.wa}${PC}</span></td><td>${PHASE[m.ph]}</td><td>${m.clk==null?'—':Math.floor(m.clk/60)+':'+String(m.clk%60).padStart(2,'0')}${m.t!=null?` <span class="muted">(${m.t} s)</span>`:''}${m.zt?` <span class="pill">${tx('zeitnot')}</span>`:''}</td>
  <td><a href="${lichess(m.fen,g.couleur)}" target="_blank" rel="noopener">${tx('Position')}</a> · <a href="${esc(g.lien)}" target="_blank" rel="noopener">${tx('Partie')}</a></td></tr>`}).join('')||`<tr><td colspan="9" class="empty">${tx('Aucun moment pour ces filtres.')}</td></tr>`}

const ADVICE={
 milieu:tx('Avant chaque coup, une vérification systématique : quels sont les échecs, captures et menaces, pour moi et pour l\'adversaire ? 15 à 20 minutes de problèmes tactiques par jour (thèmes : fourchettes, clouages, pièces non protégées), puis rejouer les positions ci-dessous sans regarder la solution.'),
 finale:tx('Revoir les finales de base (roi et pions, opposition, finales de tours : Lucena et Philidor), puis rejouer contre Stockfish les finales ratées listées ci-dessous jusqu\'à trouver le bon plan.'),
 ouverture:tx('Reprendre les lignes qui te laissent une position inférieure après 12 coups (tableau des ouvertures, colonne « Éval. ») : noter tes coups, les comparer à la théorie, et retenir les plans plutôt que des suites par cœur.'),
 temps:tx('Se fixer un budget de temps (ex. en 10 min : ne pas dépasser un tiers du temps au 15e coup), jouer vite les coups forcés, et réserver la réflexion aux moments critiques. Les parties 15+10 aident à construire ce réflexe.'),
 conversion:tx('Quand tu es gagnant : simplifier (échanger les pièces, pas les pions), supprimer le contre-jeu adverse avant d\'attaquer, et vérifier les menaces adverses à chaque coup. S\'entraîner en rejouant ces positions gagnantes contre Stockfish.'),
 positionnel:tx('Tu perds ces parties sans gaffe nette : l\'adversaire prend l\'avantage petit à petit. Travailler les structures de pions de ton répertoire, l\'activité des pièces et les plans typiques, par exemple avec des parties de maîtres commentées.')};
function renderPriorities(A,ranked,totalLost,G){
 const cad=$('fCadence').value;$('prioSub').textContent=cad?tx('Classées selon les points perdus dans les {n} parties analysées en {cad}. Seules les parties non gagnées comptent.',{n:A.n,cad}):tx('Classées selon les points perdus dans les {n} parties analysées (toutes cadences analysées confondues : filtre « Cadence » pour les séparer). Seules les parties non gagnées comptent.',{n:A.n});
 const evidence=(c,v)=>{const ph=A.ph[c];const base=txn(v.games.length,'{p} points perdus dans {n} partie ({s} du total).','{p} points perdus dans {n} parties ({s} du total).',{p:fmt(v.pts,1),s:fmt(pct(v.pts,totalLost),0)+PC});
  if(c==='finale'){const w=endgameRows(A).filter(r=>r.n>=5).sort((a,b)=>a.gap-b.gap)[0];
   return base+' '+tx('Dans cette phase, tu fais {g} gaffes pour 100 coups, avec une précision de {a}.',{g:fmt(100*ph.gaf/ph.coups,1),a:fmt(phAcc(A,'finale'),0)+PC})
    +(w&&w.gap<0?' '+tx('Type le plus coûteux : {t} ({s} de score pour {e} attendus, {n} parties).',{t:FINALES[w.t].toLowerCase(),s:fmt(w.s,0)+PC,e:fmt(w.exp,0)+PC,n:w.n}):'')}
  if(ph)return base+' '+tx('Dans cette phase, tu fais {g} gaffes pour 100 coups.',{g:fmt(100*ph.gaf/ph.coups,1)})+(c==='milieu'&&A.occ?' '+tx('Tu as aussi laissé passer {n} grosses erreurs adverses sans les punir.',{n:A.occ}):'')
   +(c==='milieu'?(()=>{const M=motifCounts(G);return M.ranked.length?' '+tx('Motif le plus fréquent : {m} ({s} de tes erreurs).',{m:MOTIFS[M.ranked[0][0]].toLowerCase(),s:fmt(pct(M.ranked[0][1],M.n),0)+PC}):''})():'');
  if(c==='temps')return base+' '+tx('{z} de tes erreurs et gaffes sont commises en zeitnot, et {t} défaites sont des pertes au temps.',{z:fmt(pct(A.zt,A.errs),0)+PC,t:A.timeouts})
   +(tbRate(A,0)!=null&&tbRest(A,0)?' '+tx('Coups joués en réflexe : {a} erreurs pour 100 coups, contre {b} pour les autres.',{a:fmt(tbRate(A,0),1),b:fmt(tbRest(A,0),1)}):'')
   +(A.t15!=null?' '+tx('Au {k}e coup, tu as déjà utilisé {p} de ton temps initial en moyenne.',{k:T.t15,p:fmt(A.t15,0)+PC}):'');
  if(c==='conversion')return base+' '+tx('Tu as été gagnant dans {w} parties et n\'en as pas gagné {n}.',{w:A.winning,n:A.notConv});
  return base};
 const worstOpenings=c=>c!=='ouverture'?'':(()=>{const r=openingRows(G,'variante',5).filter(r=>r.ev!=null&&r.na>=3).sort((a,b)=>a.ev-b.ev).slice(0,3);return r.length?`<p>${tx('Lignes les plus difficiles : {l}.',{l:r.map(x=>`${esc(x.name)} (${vtx(x.col)}, ${(x.ev>0?'+':'')+fmt(x.ev,2)})`).join(LANG==='fr'?' ; ':'; ')})}</p>`:''})();
 $('prio').innerHTML=ranked.slice(0,3).map(([c,v],i)=>{const ex=v.games.slice(-3).reverse().map(g=>{const d=g.sf.decisive&&momentOf(g.i,g.sf.decisive.ply);
   return `<li>${tx('{date} contre {adv} :',{date:esc(g.date),adv:esc(g.adversaire)})} ${d?`<a href="${lichess(d.fen,g.couleur)}" target="_blank" rel="noopener">${esc(d.n+' '+d.san)}</a> (${tx('meilleur : {m}',{m:esc(d.best)})}) · `:''}<a href="${esc(g.lien)}" target="_blank" rel="noopener">${tx('partie')}</a></li>`}).join('');
  return `<div class="panel"><div class="rank">${tx('Priorité {n}',{n:i+1})}</div><h3>${CAUSES[c]}</h3><div class="impact">${evidence(c,v)}</div>${worstOpenings(c)}<p><b>${tx('À travailler :')}</b> ${ADVICE[c]}</p><div class="muted" style="font-size:12px">${tx('Exemples récents :')}</div><ul>${ex}</ul></div>`}).join('')||`<div class="empty">${tx('Pas assez de parties non gagnées analysées.')}</div>`}

/* ---------- constats ---------- */
function renderInsights(G,GA){const out=[];
 const byCad=cadences.map(c=>({c,...score(GA.filter(g=>g.cadence===c))})).filter(x=>x.n>=30).sort((a,b)=>b.s-a.s);
 if(byCad.length>1){const b=byCad[0],w=byCad[byCad.length-1],share=pct(GA.filter(g=>g.cadence==='blitz').length,GA.length);
  out.push(tx('Tu scores <b>{a}</b> en {ca} contre <b>{b}</b> en {cb} : {d} points d\'écart',{a:fmt(b.s)+PC,ca:b.c,b:fmt(w.s)+PC,cb:w.c,d:fmt(b.s-w.s)})+(scoresDiffer(b,w)?'':HASARD)+'.'+(share>40?' '+tx('Le blitz représente {s} de tes parties.',{s:fmt(share,0)+PC}):''))}
 const col=['Blancs','Noirs'].map(c=>({c,...score(G.filter(g=>g.couleur===c))}));
 if(col[0].n>=10&&col[1].n>=10){const [hi,lo]=col[0].s>=col[1].s?col:[col[1],col[0]];out.push(tx('Avec les {hi}, ton score est de <b>{a}</b> contre {b} avec les {lo} ({d} points d\'écart',{hi:vtx(hi.c),a:fmt(hi.s)+PC,b:fmt(lo.s)+PC,lo:vtx(lo.c),d:fmt(hi.s-lo.s)})+(scoresDiffer(hi,lo)?'':HASARD)+').')}
 const comp=score(G.filter(g=>Math.abs(gap(g))<=50));if(comp.n>=10)out.push(tx('Contre des adversaires de niveau comparable (±50 Elo), ton score est de <b>{s}</b> sur {n} parties.',{s:fmt(comp.s)+PC,n:comp.n}));
 const op=openingRows(G,'famille',10).sort((a,b)=>b.s-a.s);if(op.length>1){const b=op[0],w=op[op.length-1];out.push(tx('Ouverture la plus rentable (≥ 10 parties) : <b>{b}</b> avec les {bc} ({bs}). La moins rentable : <b>{w}</b> avec les {wc} ({ws}, {wv}).',{b:esc(b.name),bc:vtx(b.col),bs:fmt(b.s)+PC,w:esc(w.name),wc:vtx(w.col),ws:fmt(w.s)+PC,wv:vnd(w)}))}
 const A=sfAgg(G);if(A){const phs=['ouverture','milieu','finale'].filter(p=>A.ph[p].coups>=50).map(p=>({p,r:100*A.ph[p].gaf/A.ph[p].coups})).sort((a,b)=>b.r-a.r);
  if(phs.length)out.push(tx('Stockfish : {g} gaffe par partie en moyenne ; c\'est en <b>{p}</b> que tu gaffes le plus ({r} pour 100 coups).',{g:fmt(A.gaf/A.n,2),p:PHASE[phs[0].p].toLowerCase(),r:fmt(phs[0].r,1)}));
  const accs=['ouverture','milieu','finale'].filter(p=>A.ph[p].coups>=50).map(p=>({p,v:phAcc(A,p)})).sort((a,b)=>a.v-b.v);
  if(accs.length>1)out.push(tx('Ta précision est la plus basse en <b>{a}</b> ({av}) et la plus haute en {b} ({bv}).',{a:PHASE[accs[0].p].toLowerCase(),av:fmt(accs[0].v,1)+PC,b:PHASE[accs[accs.length-1].p].toLowerCase(),bv:fmt(accs[accs.length-1].v,1)+PC}));
  if(A.winning)out.push(tx('Tu as obtenu une position gagnante dans {w} parties analysées et n\'en as pas gagné <b>{n}</b> ({p}).',{w:A.winning,n:A.notConv,p:fmt(pct(A.notConv,A.winning),0)+PC}));
  if(A.losing>=5)out.push(tx('Tu as été perdant (moins de {l} de chances de gain) dans {n} parties analysées et en as sauvé <b>{s}</b> ({p}) par une nulle ou une victoire.',{l:(100-T.win)+PC,n:A.losing,s:A.saved,p:fmt(pct(A.saved,A.losing),0)+PC}));
  const fast=tbRate(A,0),rest=tbRest(A,0);
  if(A.tb.coups[0]>=50&&fast!=null&&rest&&fast>=1.5*rest)out.push(tx('Tes coups joués en réflexe sont <b>{x} fois</b> plus souvent des erreurs que les autres ({a} contre {b} pour 100 coups) : prends quelques secondes pour vérifier les menaces avant de jouer.',{x:fmt(fast/rest,1),a:fmt(fast,1),b:fmt(rest,1)}));
  const M=motifCounts(G);if(M.ranked.length&&M.n>=20)out.push(tx('Motif tactique le plus fréquent dans tes erreurs : <b>{m}</b> ({p} des {n} erreurs).',{m:MOTIFS[M.ranked[0][0]].toLowerCase(),p:fmt(pct(M.ranked[0][1],M.n),0)+PC,n:M.n}))}
 out.push(...behaviourFacts(G));
 $('insights').innerHTML=out.map(x=>`<li>${x}</li>`).join('')||`<li class="muted">${tx('Pas assez de parties dans la sélection.')}</li>`}

/* ---------- historique ---------- */
function renderGames(G){const q=$('search').value.toLowerCase(),r=$('resultFilter').value;
 const list=G.filter(g=>(!q||(g.adversaire+' '+g.ouverture).toLowerCase().includes(q))&&(!r||g.resultat===r)).slice().reverse();
 $('games').innerHTML=list.map(g=>{const pc=g['precision_joueur_%']!==''?fmt(+g['precision_joueur_%'])+PC:g.sf?.prec!=null?fmt(g.sf.prec)+PC+'*':'—';
  const gf=g.sf?g.sf.phases.ouverture.gaf+g.sf.phases.milieu.gaf+g.sf.phases.finale.gaf:'—';
  return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(vtx(g.couleur))}</td><td class="${g.resultat==='Victoire'?'win':g.resultat==='Défaite'?'loss':'draw'}">${esc(vtx(g.resultat))}</td><td class="muted">${esc(FIN[g.fin]||g.fin)}</td><td class="num">${esc(g.elo_joueur)}</td><td>${esc(g.adversaire)}</td><td class="num">${esc(g.elo_adversaire)}</td><td class="num">${pc}</td><td class="num">${gf}</td><td>${esc(g.ouverture)}</td><td><a href="${esc(g.lien)}" target="_blank" rel="noopener">${tx('Voir')}</a></td></tr>`}).join('')}
