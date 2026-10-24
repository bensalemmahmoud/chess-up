['fCadence','fPeriod','fRated'].forEach(id=>$(id).addEventListener('change',render));
['oGroup','oMin'].forEach(id=>$(id).addEventListener('change',()=>renderOpenings(baseFilter(false))));
['mType','mPhase'].forEach(id=>$(id).addEventListener('change',()=>renderMoments(baseFilter(false))));
$('search').addEventListener('input',()=>renderGames(baseFilter(false)));$('resultFilter').addEventListener('change',()=>renderGames(baseFilter(false)));
$('csvBtn').onclick=()=>{const keys=['date','cadence','couleur','resultat','fin','elo_joueur','adversaire','elo_adversaire','precision_joueur_%','ouverture','famille','variante','ECO','lien'];
 const rows=baseFilter(false);const csv=[[...keys,'precision_stockfish_%','acpl','gaffes'].join(';'),...rows.map(r=>[...keys.map(k=>r[k]),r.sf?.prec??'',r.sf?.acpl??'',r.sf?r.sf.phases.ouverture.gaf+r.sf.phases.milieu.gaf+r.sf.phases.finale.gaf:''].map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';'))].join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'}));a.download='chess_games.csv';a.click();URL.revokeObjectURL(a.href)};
// Cadence affichée par défaut : celle qui a le plus de parties analysées
const mainCadence=Object.entries(D.games.reduce((o,g)=>{if(g.sf)o[g.cadence]=(o[g.cadence]||0)+1;return o},{})).sort((a,b)=>b[1]-a[1])[0];
if(mainCadence)$('fCadence').value=mainCadence[0];
initOpponent();renderObjective();
render();

/* ---------- onglets ---------- */
const TABS=[...document.querySelectorAll('#tabs a')].map(a=>a.dataset.tab);
function showTab(t){if(!TABS.includes(t))t=TABS[0];
 document.querySelectorAll('.tab').forEach(s=>s.hidden=s.dataset.tab!==t);
 document.querySelectorAll('#tabs a').forEach(a=>a.classList.toggle('active',a.dataset.tab===t));
 if(location.hash!=='#'+t)history.replaceState(null,'','#'+t);
 try{localStorage.setItem('chess-up:onglet',t)}catch(e){}
 drawPendingCharts();window.scrollTo(0,0)}
function route(){if(location.hash.startsWith('#sync=')){handleSyncHash();showTab('entrainement')}else showTab(location.hash.slice(1))}
addEventListener('hashchange',route);
if(location.hash)route();else showTab((()=>{try{return localStorage.getItem('chess-up:onglet')}catch(e){return null}})());
