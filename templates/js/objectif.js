/* ---------- objectif +200 Elo et progression ---------- */
// Indicateurs comparables entre deux ensembles de parties (agrégats de sfAgg) ; low : plus bas = mieux.
const INDICATORS=[
 {k:'prec',l:'Précision',f:A=>A.prec,u:' %',d:1},
 {k:'gaf',l:'Gaffes par partie',f:A=>A.gaf/A.n,low:1,d:2},
 {k:'err',l:'Erreurs par partie',f:A=>A.err/A.n,low:1,d:2},
 {k:'mil',l:'Gaffes pour 100 coups en milieu de partie',f:A=>A.ph.milieu.coups?100*A.ph.milieu.gaf/A.ph.milieu.coups:null,low:1,d:1},
 {k:'fin',l:'Gaffes pour 100 coups en finale',f:A=>A.ph.finale.coups?100*A.ph.finale.gaf/A.ph.finale.coups:null,low:1,d:1},
 {k:'occ',l:'Occasions manquées par partie',f:A=>A.occ/A.n,low:1,d:2},
 {k:'conv',l:'Positions gagnantes gâchées',f:A=>A.winning?100*A.notConv/A.winning:null,u:' %',low:1,d:0},
 {k:'def',l:'Parties perdantes sauvées',f:A=>A.losing?100*A.saved/A.losing:null,u:' %',d:0},
 {k:'vite',l:'Erreurs pour 100 coups joués en réflexe',f:A=>tbRate(A,0),low:1,d:1},
 {k:'zt',l:'Erreurs commises en zeitnot',f:A=>A.errs?100*A.zt/A.errs:null,u:' %',low:1,d:0},
 {k:'to',l:'Parties perdues au temps',f:A=>100*A.timeouts/A.n,u:' %',low:1,d:0}];
const OBJ=D.objectif;
const objAgg=OBJ&&sfAgg(OBJ.games.map(g=>({...g,pts:g.resultat==='Victoire'?1:g.resultat==='Nulle'?.5:0})));
// Toi : tes 150 dernières parties analysées dans la cadence de l'objectif (ton niveau actuel, quels que soient les filtres)
const meObj=OBJ&&sfAgg(D.games.filter(g=>g.sf&&g.cadence===OBJ.cadence).slice(-150));

function renderObjective(){const box=$('objPanel');box.hidden=!(OBJ&&objAgg&&meObj);if(box.hidden)return;
 $('objTitle').textContent=`Objectif ${OBJ.target} en ${OBJ.cadence}`;
 $('objSub').textContent=`Ce qui te sépare des joueurs de ce niveau : ${objAgg.n} parties récentes de ${OBJ.players} joueurs autour de ${OBJ.elo} Elo, choisis parmi tes adversaires et les leurs (échantillon du ${OBJ.date}). Toi : tes ${meObj.n} dernières parties analysées en ${OBJ.cadence}.`;
 const rows=INDICATORS.map(i=>{const me=i.f(meObj),them=i.f(objAgg);if(me==null||them==null)return null;
  // écart relatif symétrique, entre -1 et 1 : reste lisible quand l'une des deux valeurs est nulle
  const worse=i.low?me-them:them-me,scale=Math.max(Math.abs(me),Math.abs(them)),rel=scale?worse/scale:0;return {...i,me,them,worse,rel}}).filter(Boolean).sort((a,b)=>b.rel-a.rel);
 const v=(x,i)=>fmt(x,i.d)+(i.u||'');
 $('objTable').innerHTML='<tr><th>Indicateur</th><th class="num">Toi</th><th class="num">Niveau '+OBJ.target+'</th><th>Écart</th></tr>'+rows.map(r=>{
  const ok=r.worse<=0,w=Math.min(100,Math.round(Math.abs(r.rel)*100));
  return `<tr><td>${r.l}</td><td class="num"><b>${v(r.me,r)}</b></td><td class="num">${v(r.them,r)}</td>
   <td><span class="bar" style="width:${Math.max(4,w*.8)}px;background:${ok?'var(--win)':'var(--loss)'}"></span><span class="${ok?'win':'loss'}">${ok?'déjà au niveau':(r.rel>=.5?'gros écart':r.rel>=.2?'écart net':'léger écart')}</span></td></tr>`}).join('');
 const gaps=rows.filter(r=>r.rel>=.2).slice(0,2);
 $('objSummary').innerHTML=gaps.length?`Tes plus gros chantiers pour atteindre ${OBJ.target} : <b>${gaps.map(r=>r.l.toLowerCase()).join('</b> et <b>')}</b>.`
  :`Tes indicateurs sont déjà proches de ceux des joueurs à ${OBJ.target} : l'écart se joue sur la régularité et le volume de parties.`}

// Progression mois par mois d'un indicateur, avec le niveau de l'objectif en pointillés
function renderProgress(G){const ind=INDICATORS.find(i=>i.k===$('progInd').value)||INDICATORS[1];
 const months=[...new Set(G.filter(g=>g.sf).map(g=>g.mois))].sort();
 const pts=months.map(m=>{const A=sfAgg(G.filter(g=>g.mois===m));return A&&A.n>=5?ind.f(A):null});
 const sameCad=OBJ&&objAgg&&(!$('fCadence').value||$('fCadence').value===OBJ.cadence);
 const sets=[{label:ind.l,data:pts,borderColor:'#3987e5',backgroundColor:'#3987e5',tension:.25,spanGaps:true,pointRadius:3}];
 if(sameCad)sets.push({label:`Niveau ${OBJ.target}`,data:months.map(()=>ind.f(objAgg)),borderColor:'#199e70',borderDash:[6,4],pointRadius:0,borderWidth:2});
 chart('progChart',{type:'line',data:{labels:months,datasets:sets},options:barOpts({plugins:{tooltip:{callbacks:{label:c=>`${c.dataset.label} : ${fmt(c.raw,ind.d)}${ind.u||''}`}}},scales:{y:{beginAtZero:true}}})});
 $('progNote').textContent=`Mois avec au moins 5 parties analysées dans la sélection.${OBJ&&!sameCad?` La ligne de l'objectif n'apparaît qu'en ${OBJ.cadence}.`:''}`}
INDICATORS.forEach(i=>$('progInd').add(new Option(i.l,i.k)));$('progInd').value='gaf';
$('progInd').addEventListener('change',()=>renderProgress(baseFilter(false)));
