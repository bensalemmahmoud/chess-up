const D=__DATA__;const T=D.thresholds;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=1)=>x==null||isNaN(x)?'—':x.toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=(a,b)=>b?100*a/b:null;
const CAD_COLORS={rapid:'#3987e5',blitz:'#d95926',daily:'#199e70',bullet:'#c98500',classical:'#8a63d2',correspondence:'#199e70',ultraBullet:'#e66767'};
const FIN={cheat:'triche',resigned:'abandon',checkmated:'mat',timeout:'temps',abandoned:'déconnexion',agreed:'nulle acceptée',repetition:'répétition',stalemate:'pat',insufficient:'matériel insuffisant',timevsinsufficient:'temps / matériel insuff.','50move':'règle des 50 coups'};
const PHASE={ouverture:'Ouverture',milieu:'Milieu de partie',finale:'Finale'};
D.games.forEach((g,i)=>{g.i=i;g.pts=g.resultat==='Victoire'?1:g.resultat==='Nulle'?.5:0});
$('subtitle').textContent='@'+D.username+' · '+D.period+' · '+D.games.length+' parties';$('generated').textContent='Généré le '+D.generated;
Chart.defaults.color='#a9b6c8';Chart.defaults.borderColor='#2b394b';Chart.defaults.font.family='system-ui,sans-serif';
const charts={},pendingCharts={};
function chart(id,cfg){charts[id]?.destroy();delete charts[id];
 if($(id).offsetParent===null){pendingCharts[id]=cfg;return}   // onglet masqué : le graphique sera créé à son affichage
 delete pendingCharts[id];charts[id]=new Chart($(id),cfg)}
const drawPendingCharts=()=>Object.keys(pendingCharts).forEach(id=>$(id).offsetParent!==null&&chart(id,pendingCharts[id]));
const barOpts=(extra={})=>({responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{boxWidth:12}}},...extra});

const cadences=[...new Set(D.games.map(g=>g.cadence))].sort((a,b)=>D.games.filter(g=>g.cadence===b).length-D.games.filter(g=>g.cadence===a).length);
$('fCadence').add(new Option('Toutes',''));cadences.forEach(c=>$('fCadence').add(new Option(c,c)));
const lastDate=D.games.length?new Date(D.games[D.games.length-1].date):new Date();

function baseFilter(ignoreCadence){const c=$('fCadence').value,p=+$('fPeriod').value,r=$('fRated').checked;
 const since=p?new Date(lastDate-p*864e5):null;
 return D.games.filter(g=>(ignoreCadence||!c||g.cadence===c)&&(!r||String(g.rated).toLowerCase()==='true')&&(!since||new Date(g.date)>=since))}
function score(list){const w=list.filter(g=>g.resultat==='Victoire').length,d=list.filter(g=>g.resultat==='Nulle').length,l=list.filter(g=>g.resultat==='Défaite').length;
 return {n:list.length,w,d,l,s:list.length?100*(w+.5*d)/list.length:null}}
const vnd=s=>`${s.w}-${s.d}-${s.l}`;
const gap=g=>(+g.elo_adversaire||0)-(+g.elo_joueur||0);

/* ---------- agrégats Stockfish ---------- */
function sfAgg(list){const a=list.filter(g=>g.sf);const n=a.length;if(!n)return null;
 const ph={ouverture:{coups:0,imp:0,err:0,gaf:0},milieu:{coups:0,imp:0,err:0,gaf:0},finale:{coups:0,imp:0,err:0,gaf:0}};
 let errs=0,zt=0,occ=0,mm=0,prec=0,acpl=0,np=0,winning=0,notConv=0,timeouts=0;
 a.forEach(g=>{for(const p in ph)for(const k in ph[p])ph[p][k]+=g.sf.phases[p][k];
  const e=g.sf.phases;errs+=e.ouverture.err+e.ouverture.gaf+e.milieu.err+e.milieu.gaf+e.finale.err+e.finale.gaf;
  zt+=g.sf.zt_err;occ+=g.sf.occ;mm+=g.sf.mm;if(g.sf.prec!=null){prec+=g.sf.prec;acpl+=g.sf.acpl;np++}
  if(g.sf.max_win>=T.win){winning++;if(g.resultat!=='Victoire')notConv++}
  if(g.resultat==='Défaite'&&g.fin==='timeout')timeouts++});
 const tot=k=>ph.ouverture[k]+ph.milieu[k]+ph.finale[k];
 return {n,a,ph,gaf:tot('gaf'),err:tot('err'),imp:tot('imp'),coups:tot('coups'),errs,zt,occ,mm,prec:np?prec/np:null,acpl:np?acpl/np:null,winning,notConv,timeouts}}

const CAUSES={temps:'Gestion de la pendule',conversion:'Conversion des positions gagnantes',ouverture:'Sortie d\'ouverture',milieu:'Tactique en milieu de partie',finale:'Technique de finale',positionnel:'Jeu positionnel (pas de gaffe nette)'};
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
 $('fCount').textContent=G.length+' parties sélectionnées';
 const elos=cadences.map(c=>{const l=GA.filter(g=>g.cadence===c&&g.elo_joueur);return l.length?c+' '+l[l.length-1].elo_joueur:null}).filter(Boolean);
 const accCom=G.filter(g=>g['precision_joueur_%']!=='');
 const k=[['Parties',G.length,''],['Score',fmt(sc.s)+' %','victoire 1 · nulle ½'],['Victoires · nulles · défaites',vnd(sc),''],['Elo actuel',elos.slice(0,2).join(' · ')||'—',elos.slice(2).join(' · ')],
  ['Précision __SITE__',accCom.length?fmt(accCom.reduce((s,g)=>s+ +g['precision_joueur_%'],0)/accCom.length)+' %':'—',accCom.length+' parties seulement'],
  ['Parties analysées',G.filter(g=>g.sf).length,'par Stockfish'],['Comparable (±50 Elo)',fmt(score(G.filter(g=>Math.abs(gap(g))<=50)).s)+' %',score(G.filter(g=>Math.abs(gap(g))<=50)).n+' parties'],['Défaites au temps',G.filter(g=>g.resultat==='Défaite'&&g.fin==='timeout').length,'sur '+sc.l+' défaites']];
 $('kpis').innerHTML=k.map(x=>`<div class="kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('');

 // Résultats par cadence (ignore le filtre cadence)
 const byCad=cadences.map(c=>({c,...score(GA.filter(g=>g.cadence===c))})).filter(x=>x.n);
 chart('cadenceChart',{type:'bar',data:{labels:byCad.map(x=>x.c),datasets:[{label:'Score',data:byCad.map(x=>x.s),backgroundColor:byCad.map(x=>CAD_COLORS[x.c]||'#9085e9'),borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Score ${fmt(c.raw)} % (${vnd(byCad[c.dataIndex])})`}}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+' %'}}}})});
 $('cadenceTable').innerHTML='<tr><th>Cadence</th><th class="num">Parties</th><th>V-N-D</th><th class="num">Score</th></tr>'+byCad.map(x=>`<tr><td>${esc(x.c)}</td><td class="num">${x.n}</td><td>${vnd(x)}</td><td class="num">${fmt(x.s)} %</td></tr>`).join('');

 const byCol=['Blancs','Noirs'].map(c=>({c,...score(G.filter(g=>g.couleur===c))}));
 chart('colorChart',{type:'bar',data:{labels:byCol.map(x=>x.c),datasets:[{label:'Victoires',data:byCol.map(x=>x.w),backgroundColor:'#199e70',borderRadius:4},{label:'Nulles',data:byCol.map(x=>x.d),backgroundColor:'#c98500',borderRadius:4},{label:'Défaites',data:byCol.map(x=>x.l),backgroundColor:'#e66767',borderRadius:4}]},
  options:barOpts({indexAxis:'y',scales:{x:{stacked:true},y:{stacked:true}}})});
 $('colorTable').innerHTML='<tr><th>Couleur</th><th class="num">Parties</th><th>V-N-D</th><th class="num">Score</th></tr>'+byCol.map(x=>`<tr><td>${x.c}</td><td class="num">${x.n}</td><td>${vnd(x)}</td><td class="num">${fmt(x.s)} %</td></tr>`).join('');

 const buckets=[['≤ −150',-1e9,-150],['−149 à −51',-149,-51],['±50',-50,50],['+51 à +149',51,149],['≥ +150',150,1e9]];
 const byGap=buckets.map(([l,a,b])=>({l,...score(G.filter(g=>g.elo_adversaire&&g.elo_joueur&&gap(g)>=a&&gap(g)<=b))}));
 chart('gapChart',{type:'bar',data:{labels:byGap.map(x=>x.l),datasets:[{label:'Score',data:byGap.map(x=>x.s),backgroundColor:'#3987e5',borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Score ${fmt(c.raw)} % · ${byGap[c.dataIndex].n} parties (${vnd(byGap[c.dataIndex])})`}}},scales:{x:{title:{display:true,text:'Adversaire plus faible  ←  écart d\'Elo  →  adversaire plus fort'}},y:{min:0,max:100,ticks:{callback:v=>v+' %'}}}})});

 const week=d=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+6)%7);return t.toISOString().slice(0,10)};
 const weeks=[...new Set(G.map(g=>week(g.date)))].sort();
 const eloSets=cadences.filter(c=>G.some(g=>g.cadence===c)).map(c=>{const last={};G.filter(g=>g.cadence===c&&g.elo_joueur).forEach(g=>last[week(g.date)]=+g.elo_joueur);
  return {label:c,data:weeks.map(w=>last[w]??null),borderColor:CAD_COLORS[c]||'#9085e9',backgroundColor:CAD_COLORS[c]||'#9085e9',spanGaps:true,tension:.25,borderWidth:2,pointRadius:2}}).filter(s=>s.data.filter(v=>v!=null).length>1);
 chart('eloChart',{type:'line',data:{labels:weeks,datasets:eloSets},options:barOpts({scales:{y:{}}})});

 const months=[...new Set(G.map(g=>g.mois))].sort();const bm=months.map(m=>score(G.filter(g=>g.mois===m)));
 chart('monthlyChart',{type:'bar',data:{labels:months,datasets:[{label:'Victoires',data:bm.map(x=>x.w),backgroundColor:'#199e70',borderRadius:4},{label:'Nulles',data:bm.map(x=>x.d),backgroundColor:'#c98500',borderRadius:4},{label:'Défaites',data:bm.map(x=>x.l),backgroundColor:'#e66767',borderRadius:4}]},options:barOpts({scales:{x:{stacked:true},y:{stacked:true,beginAtZero:true}}})});

 renderOpenings(G);renderRepertoire(G);renderSF(G,GA);renderProgress(G);renderTraining(G);renderInsights(G,GA);renderGames(G)}

/* ---------- ouvertures ---------- */
let oSort={k:'n',dir:-1};
function openingRows(G,key,min){const groups={};G.forEach(g=>{const id=g[key]+'|'+g.couleur;(groups[id]??=[]).push(g)});
 return Object.entries(groups).map(([id,l])=>{const a=l.filter(g=>g.sf&&g.sf.eval_ouv!=null);const s=score(l);const sf=l.filter(g=>g.sf);
  return {name:id.split('|')[0],col:id.split('|')[1],...s,ev:a.length?a.reduce((t,g)=>t+g.sf.eval_ouv,0)/a.length/100:null,na:a.length,
   oe:sf.length?sf.reduce((t,g)=>t+g.sf.phases.ouverture.err+g.sf.phases.ouverture.gaf,0)/sf.length:null}}).filter(r=>r.n>=min)}
function renderOpenings(G){const rows=openingRows(G,$('oGroup').value,+$('oMin').value);
 const cols=[['name','Ouverture'],['col','Couleur'],['n','Parties','num'],['vnd','V-N-D'],['s','Score','num'],['ev','Éval. après 12 coups','num'],['oe','Erreurs d\'ouverture / partie','num']];
 $('oHead').innerHTML=cols.map(([k,l,c])=>`<th class="sort ${c||''}" data-k="${k}">${l}${oSort.k===k?(oSort.dir<0?' ↓':' ↑'):''}</th>`).join('');
 rows.sort((a,b)=>{const k=oSort.k==='vnd'?'n':oSort.k;const x=a[k],y=b[k];if(x==null)return 1;if(y==null)return -1;return (x>y?1:x<y?-1:0)*oSort.dir});
 $('openings').innerHTML=rows.map(r=>`<tr><td>${esc(r.name)}${r.n<10?' <span class="muted">· petit échantillon</span>':''}</td><td>${r.col}</td><td class="num">${r.n}</td><td>${vnd(r)}</td>
  <td class="num"><span class="bar" style="width:${Math.round(r.s*.6)}px"></span>${fmt(r.s)} %</td>
  <td class="num ${r.ev==null?'':r.ev<=-1?'loss':r.ev>=1?'win':''}">${r.ev==null?'—':(r.ev>0?'+':'')+fmt(r.ev,2)} <span class="muted">${r.na?'('+r.na+')':''}</span></td><td class="num">${fmt(r.oe,2)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">Aucune ouverture avec assez de parties dans cette sélection.</td></tr>';
 document.querySelectorAll('#oHead th').forEach(th=>th.onclick=()=>{const k=th.dataset.k;oSort=oSort.k===k?{k,dir:-oSort.dir}:{k,dir:['name','col'].includes(k)?1:-1};renderOpenings(baseFilter(false))})}

/* ---------- Stockfish ---------- */
function renderSF(G,GA){const A=sfAgg(G);
 const analysedCads=[...new Set(D.games.filter(g=>g.sf).map(g=>g.cadence))];
 $('prioPanel').hidden=!A;
 if(!A){$('sfBlock').hidden=true;$('sfMissing').hidden=false;
  $('sfMissing').textContent=analysedCads.length?`Aucune partie analysée dans cette sélection. Cadences analysées : ${analysedCads.join(', ')}. Pour en ajouter : python chess_dashboard_generator.py --cadences ${[...new Set([...analysedCads,$('fCadence').value||'blitz'])].join(',')}`:'Aucune partie analysée par Stockfish. Lance : python chess_dashboard_generator.py';return}
 $('sfBlock').hidden=false;$('sfMissing').hidden=true;
 const k=[['Parties analysées',A.n,G.length>A.n?`sur ${G.length} (cadences analysées : ${analysedCads.join(', ')})`:'toutes celles de la sélection'],['Précision estimée',fmt(A.prec)+' %','méthode Lichess'],['Perte moyenne / coup',fmt(A.acpl,0)+' cp','ACPL, en centièmes de pion'],['Gaffes / partie',fmt(A.gaf/A.n,2),fmt(A.err/A.n,2)+' erreurs · '+fmt(A.imp/A.n,1)+' imprécisions'],
  ['Erreurs en zeitnot',fmt(pct(A.zt,A.errs),0)+' %',A.zt+' erreurs et gaffes sur '+A.errs],['Occasions manquées',fmt(A.occ/A.n,2)+' / partie','grosse erreur adverse non punie'],['Mats manqués',A.mm,'mat en 3 coups ou moins non joué'],['Positions gagnantes gâchées',A.winning?fmt(pct(A.notConv,A.winning),0)+' %':'—',A.notConv+' sur '+A.winning+' parties où tu étais gagnant']];
 $('sfKpis').innerHTML=k.map(x=>`<div class="kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="hint">${x[2]}</div></div>`).join('');

 const phs=['ouverture','milieu','finale'];const rate=(p,s)=>A.ph[p].coups?100*A.ph[p][s]/A.ph[p].coups:0;
 chart('phaseChart',{type:'bar',data:{labels:phs.map(p=>PHASE[p]+` (${A.ph[p].coups} coups)`),datasets:[['imp','Imprécisions','#c98500'],['err','Erreurs','#d95926'],['gaf','Gaffes','#e66767']].map(([s,l,c])=>({label:l,data:phs.map(p=>rate(p,s)),backgroundColor:c,borderRadius:4}))},
  options:barOpts({plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label} : ${fmt(c.raw)} pour 100 coups`}}},scales:{y:{beginAtZero:true,title:{display:true,text:'pour 100 coups'}}}})});

 const lost={};A.a.forEach(g=>{const c=cause(g);if(c)(lost[c]??={pts:0,games:[]}).pts+=1-g.pts,lost[c].games.push(g)});
 const ranked=Object.entries(lost).sort((a,b)=>b[1].pts-a[1].pts);const totalLost=ranked.reduce((t,[,v])=>t+v.pts,0);
 chart('causeChart',{type:'bar',data:{labels:ranked.map(([c])=>CAUSES[c]),datasets:[{label:'Points perdus',data:ranked.map(([,v])=>v.pts),backgroundColor:'#e66767',borderRadius:4,maxBarThickness:28}]},
  options:barOpts({indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${fmt(c.raw,1)} points · ${ranked[c.dataIndex][1].games.length} parties · ${fmt(pct(c.raw,totalLost),0)} % des points perdus`}}},scales:{x:{beginAtZero:true}}})});

 topCause=ranked[0]?.[0]||null;renderPriorities(A,ranked,totalLost,G);

 const cmp=analysedCads.map(c=>{const l=GA.filter(g=>g.cadence===c);const a=sfAgg(l);return a&&{c,s:score(a.a),a}}).filter(Boolean);
 const per100=(a,p)=>a.ph[p].coups?fmt(100*a.ph[p].gaf/a.ph[p].coups,1):'—';
 $('cmpTable').innerHTML='<tr><th>Cadence</th><th class="num">Analysées</th><th class="num">Score</th><th class="num">Précision</th><th class="num">ACPL</th><th class="num">Gaffes / partie</th><th class="num">Gaffes /100 coups<br>ouv. · milieu · finale</th><th class="num">Erreurs en zeitnot</th><th class="num">Défaites au temps</th><th class="num">Gagnantes gâchées</th></tr>'+
  cmp.map(({c,s,a})=>`<tr><td>${esc(c)}</td><td class="num">${a.n}</td><td class="num">${fmt(s.s)} %</td><td class="num">${fmt(a.prec)} %</td><td class="num">${fmt(a.acpl,0)}</td><td class="num">${fmt(a.gaf/a.n,2)}</td><td class="num">${per100(a,'ouverture')} · ${per100(a,'milieu')} · ${per100(a,'finale')}</td><td class="num">${fmt(pct(a.zt,a.errs),0)} %</td><td class="num">${a.timeouts}</td><td class="num">${a.winning?fmt(pct(a.notConv,a.winning),0)+' %':'—'}</td></tr>`).join('')+
  (cadences.filter(c=>!analysedCads.includes(c)).length?`<tr><td colspan="10" class="muted">Non analysées : ${cadences.filter(c=>!analysedCads.includes(c)).join(', ')} — python chess_dashboard_generator.py --cadences ${[...analysedCads,...cadences.filter(c=>!analysedCads.includes(c))].join(',')}</td></tr>`:'');

 renderMoments(G);
 const lw=A.a.filter(g=>g.sf.max_win>=T.win&&g.resultat!=='Victoire').reverse();
 $('lostSub').textContent=`Parties où tu as atteint au moins ${T.win} % de chances de gain (environ +4) sans gagner : ${lw.length}.`;
 $('lostWins').innerHTML=lw.map(g=>{const d=g.sf.decisive&&momentOf(g.i,g.sf.decisive.ply);return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(g.adversaire)} (${esc(g.elo_adversaire)})</td><td class="num">${g.sf.max_win} %</td><td class="${g.resultat==='Défaite'?'loss':'draw'}">${esc(g.resultat)}</td><td>${esc(FIN[g.fin]||g.fin)}</td>
  <td>${d?`<a href="${lichess(d.fen,g.couleur)}" target="_blank" rel="noopener">Erreur décisive</a> · `:''}<a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a></td></tr>`}).join('')||'<tr><td colspan="7" class="empty">Aucune.</td></tr>'}

function renderMoments(G){const ids=new Set(G.map(g=>g.i));const t=$('mType').value,p=$('mPhase').value;
 const list=D.moments.filter(m=>ids.has(m.g)&&(!p||m.ph===p)&&(t===''?m.sev!=='mat':t==='gaf'?m.sev==='gaf':t==='occ'?m.occ:t==='mm'?m.mm:m.zt&&m.sev!=='mat')).slice().reverse();
 $('mCount').textContent=list.length+' moments'+(list.length>400?' (400 plus récents affichés)':'');
 const sevl={gaf:'<span class="loss">Gaffe</span>',err:'<span class="draw">Erreur</span>',mat:'<span class="muted">Mat manqué</span>'};
 $('moments').innerHTML=list.slice(0,400).map(m=>{const g=D.games[m.g];return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(m.n)}</td><td>${sevl[m.sev]} <b>${esc(m.san)}</b>${m.occ?' <span class="pill">occasion manquée</span>':''}${m.mm&&m.sev!=='mat'?' <span class="pill">mat manqué</span>':''}</td>
  <td><b>${esc(m.best)}</b></td><td class="num">${m.wb} % → <span class="${m.wa<m.wb-T.gaf?'loss':''}">${m.wa} %</span></td><td>${PHASE[m.ph]}</td><td>${m.clk==null?'—':Math.floor(m.clk/60)+':'+String(m.clk%60).padStart(2,'0')}${m.zt?' <span class="pill">zeitnot</span>':''}</td>
  <td><a href="${lichess(m.fen,g.couleur)}" target="_blank" rel="noopener">Position</a> · <a href="${esc(g.lien)}" target="_blank" rel="noopener">Partie</a></td></tr>`}).join('')||'<tr><td colspan="9" class="empty">Aucun moment pour ces filtres.</td></tr>'}

const ADVICE={
 milieu:'Avant chaque coup, une vérification systématique : quels sont les échecs, captures et menaces, pour moi et pour l\'adversaire ? 15 à 20 minutes de problèmes tactiques par jour (thèmes : fourchettes, clouages, pièces non protégées), puis rejouer les positions ci-dessous sans regarder la solution.',
 finale:'Revoir les finales de base (roi et pions, opposition, finales de tours : Lucena et Philidor), puis rejouer contre Stockfish les finales ratées listées ci-dessous jusqu\'à trouver le bon plan.',
 ouverture:'Reprendre les lignes qui te laissent une position inférieure après 12 coups (tableau des ouvertures, colonne « Éval. ») : noter tes coups, les comparer à la théorie, et retenir les plans plutôt que des suites par cœur.',
 temps:'Se fixer un budget de temps (ex. en 10 min : ne pas dépasser un tiers du temps au 15e coup), jouer vite les coups forcés, et réserver la réflexion aux moments critiques. Les parties 15+10 aident à construire ce réflexe.',
 conversion:'Quand tu es gagnant : simplifier (échanger les pièces, pas les pions), supprimer le contre-jeu adverse avant d\'attaquer, et vérifier les menaces adverses à chaque coup. S\'entraîner en rejouant ces positions gagnantes contre Stockfish.',
 positionnel:'Tu perds ces parties sans gaffe nette : l\'adversaire prend l\'avantage petit à petit. Travailler les structures de pions de ton répertoire, l\'activité des pièces et les plans typiques, par exemple avec des parties de maîtres commentées.'};
function renderPriorities(A,ranked,totalLost,G){
 const cad=$('fCadence').value;$('prioSub').textContent=`Classées selon les points perdus dans les ${A.n} parties analysées${cad?' en '+cad:' (toutes cadences analysées confondues : filtre « Cadence » pour les séparer)'}. Seules les parties non gagnées comptent.`;
 const evidence=(c,v)=>{const ph=A.ph[c];const base=`${fmt(v.pts,1)} points perdus dans ${v.games.length} parties (${fmt(pct(v.pts,totalLost),0)} % du total).`;
  if(ph)return base+` Dans cette phase, tu fais ${fmt(100*ph.gaf/ph.coups,1)} gaffes pour 100 coups.`+(c==='milieu'&&A.occ?` Tu as aussi laissé passer ${A.occ} grosses erreurs adverses sans les punir.`:'');
  if(c==='temps')return base+` ${fmt(pct(A.zt,A.errs),0)} % de tes erreurs et gaffes sont commises en zeitnot, et ${A.timeouts} défaites sont des pertes au temps.`;
  if(c==='conversion')return base+` Tu as été gagnant dans ${A.winning} parties et n'en as pas gagné ${A.notConv}.`;
  return base};
 const worstOpenings=c=>c!=='ouverture'?'':(()=>{const r=openingRows(G,'variante',5).filter(r=>r.ev!=null&&r.na>=3).sort((a,b)=>a.ev-b.ev).slice(0,3);return r.length?`<p>Lignes les plus difficiles : ${r.map(x=>`${esc(x.name)} (${x.col}, ${(x.ev>0?'+':'')+fmt(x.ev,2)})`).join(' ; ')}.</p>`:''})();
 $('prio').innerHTML=ranked.slice(0,3).map(([c,v],i)=>{const ex=v.games.slice(-3).reverse().map(g=>{const d=g.sf.decisive&&momentOf(g.i,g.sf.decisive.ply);
   return `<li>${esc(g.date)} contre ${esc(g.adversaire)} : ${d?`<a href="${lichess(d.fen,g.couleur)}" target="_blank" rel="noopener">${esc(d.n+' '+d.san)}</a> (meilleur : ${esc(d.best)}) · `:''}<a href="${esc(g.lien)}" target="_blank" rel="noopener">partie</a></li>`}).join('');
  return `<div class="panel"><div class="rank">Priorité ${i+1}</div><h3>${CAUSES[c]}</h3><div class="impact">${evidence(c,v)}</div>${worstOpenings(c)}<p><b>À travailler :</b> ${ADVICE[c]}</p><div class="muted" style="font-size:12px">Exemples récents :</div><ul>${ex}</ul></div>`}).join('')||'<div class="empty">Pas assez de parties non gagnées analysées.</div>'}

/* ---------- constats ---------- */
function renderInsights(G,GA){const out=[];
 const byCad=cadences.map(c=>({c,...score(GA.filter(g=>g.cadence===c))})).filter(x=>x.n>=30).sort((a,b)=>b.s-a.s);
 if(byCad.length>1){const b=byCad[0],w=byCad[byCad.length-1],share=pct(GA.filter(g=>g.cadence==='blitz').length,GA.length);
  out.push(`Tu scores <b>${fmt(b.s)} %</b> en ${b.c} contre <b>${fmt(w.s)} %</b> en ${w.c} : ${fmt(b.s-w.s)} points d'écart.`+(share>40?` Le blitz représente ${fmt(share,0)} % de tes parties.`:''))}
 const col=['Blancs','Noirs'].map(c=>({c,...score(G.filter(g=>g.couleur===c))}));
 if(col[0].n>=10&&col[1].n>=10){const [hi,lo]=col[0].s>=col[1].s?col:[col[1],col[0]];out.push(`Avec les ${hi.c}, ton score est de <b>${fmt(hi.s)} %</b> contre ${fmt(lo.s)} % avec les ${lo.c} (${fmt(hi.s-lo.s)} points d'écart).`)}
 const comp=score(G.filter(g=>Math.abs(gap(g))<=50));if(comp.n>=10)out.push(`Contre des adversaires de niveau comparable (±50 Elo), ton score est de <b>${fmt(comp.s)} %</b> sur ${comp.n} parties.`);
 const op=openingRows(G,'famille',10).sort((a,b)=>b.s-a.s);if(op.length>1){const b=op[0],w=op[op.length-1];out.push(`Ouverture la plus rentable (≥ 10 parties) : <b>${esc(b.name)}</b> avec les ${b.col} (${fmt(b.s)} %). La moins rentable : <b>${esc(w.name)}</b> avec les ${w.col} (${fmt(w.s)} %, ${vnd(w)}).`)}
 const A=sfAgg(G);if(A){const phs=['ouverture','milieu','finale'].filter(p=>A.ph[p].coups>=50).map(p=>({p,r:100*A.ph[p].gaf/A.ph[p].coups})).sort((a,b)=>b.r-a.r);
  if(phs.length)out.push(`Stockfish : ${fmt(A.gaf/A.n,2)} gaffe par partie en moyenne ; c'est en <b>${PHASE[phs[0].p].toLowerCase()}</b> que tu gaffes le plus (${fmt(phs[0].r,1)} pour 100 coups).`);
  if(A.winning)out.push(`Tu as obtenu une position gagnante dans ${A.winning} parties analysées et n'en as pas gagné <b>${A.notConv}</b> (${fmt(pct(A.notConv,A.winning),0)} %).`)}
 $('insights').innerHTML=out.map(x=>`<li>${x}</li>`).join('')||'<li class="muted">Pas assez de parties dans la sélection.</li>'}

/* ---------- historique ---------- */
function renderGames(G){const q=$('search').value.toLowerCase(),r=$('resultFilter').value;
 const list=G.filter(g=>(!q||(g.adversaire+' '+g.ouverture).toLowerCase().includes(q))&&(!r||g.resultat===r)).slice().reverse();
 $('games').innerHTML=list.map(g=>{const pc=g['precision_joueur_%']!==''?fmt(+g['precision_joueur_%'])+' %':g.sf?.prec!=null?fmt(g.sf.prec)+' %*':'—';
  const gf=g.sf?g.sf.phases.ouverture.gaf+g.sf.phases.milieu.gaf+g.sf.phases.finale.gaf:'—';
  return `<tr><td>${esc(g.date)}</td><td><span class="pill">${esc(g.cadence)}</span></td><td>${esc(g.couleur)}</td><td class="${g.resultat==='Victoire'?'win':g.resultat==='Défaite'?'loss':'draw'}">${esc(g.resultat)}</td><td class="muted">${esc(FIN[g.fin]||g.fin)}</td><td class="num">${esc(g.elo_joueur)}</td><td>${esc(g.adversaire)}</td><td class="num">${esc(g.elo_adversaire)}</td><td class="num">${pc}</td><td class="num">${gf}</td><td>${esc(g.ouverture)}</td><td><a href="${esc(g.lien)}" target="_blank" rel="noopener">Voir</a></td></tr>`}).join('')}
