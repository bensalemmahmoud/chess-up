/* ---------- comportement : enchaînement des parties, sessions, heure de jeu ---------- */
const SESSION_GAP=3600;   // plus d'une heure entre la fin de deux parties : nouvelle session
// Sur toutes les parties (quels que soient les filtres) : résultat de la partie précédente de la session,
// défaites d'affilée juste avant, rang dans la session
D.games.forEach((g,i)=>{const p=D.games[i-1],same=p&&g.ts&&p.ts&&g.ts>=p.ts&&g.ts-p.ts<SESSION_GAP;
 g.avant=same?p.resultat:null;g.pertes=same?(p.resultat==='Défaite'?p.pertes+1:0):0;g.rang=same?p.rang+1:1});

// Barres de score : vertes ou rouges si l'écart avec le score global dépasse la marge du hasard, grises sinon
function scoreBars(id,groups,ref){
 chart(id,{type:'bar',data:{labels:groups.map(x=>x.lab),datasets:[{label:tx('Score'),data:groups.map(x=>x.s),backgroundColor:groups.map(x=>({1:'#199e70','-1':'#e66767'})[scoreGap(x,ref)]||'#5b6b80'),borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>txn(groups[c.dataIndex].n,'Score {s} · {n} partie ({vnd})','Score {s} · {n} parties ({vnd})',{s:fmt(c.raw)+PC,vnd:vnd(groups[c.dataIndex])})}}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+PC}}}})})}
const groupScores=(G,defs)=>defs.map(([lab,f])=>({lab,...score(G.filter(f))})).filter(x=>x.n);

const TILT=[[tx('Première de la session'),g=>!g.avant],[tx('Après une victoire'),g=>g.avant==='Victoire'],[tx('Après une nulle'),g=>g.avant==='Nulle'],
 [tx('Après une défaite'),g=>g.pertes===1],[tx('Après 2 défaites ou plus'),g=>g.pertes>=2]];
const RANKS=[[tx('1re partie'),g=>g.rang===1],[tx('2e'),g=>g.rang===2],[tx('3e'),g=>g.rang===3],[tx('4e – 5e'),g=>g.rang>=4&&g.rang<=5],[tx('6e et suivantes'),g=>g.rang>=6]];
const HOURS=[[tx('Nuit (0 h – 6 h)'),0,6],[tx('Matin (6 h – 12 h)'),6,12],[tx('Après-midi (12 h – 18 h)'),12,18],[tx('Soir (18 h – 24 h)'),18,24]]
 .map(([l,a,b])=>[l,g=>{const h=new Date(g.ts*1000).getHours();return h>=a&&h<b}]);

function renderBehaviour(G){const L=G.filter(g=>g.ts),ref=score(L).s/100;
 const sessions=L.filter(g=>g.rang===1).length;
 $('tiltSub').textContent=L.length?tx("Score selon le résultat de la partie précédente, si elle s'est terminée moins d'une heure avant. Score global : {s}.",{s:fmt(100*ref)+PC}):tx('Heure des parties indisponible.');
 $('sessSub').textContent=sessions?tx("Une session = des parties enchaînées à moins d'une heure d'intervalle : {s} sessions, {m} parties en moyenne.",{s:sessions,m:fmt(L.length/sessions,1)}):'';
 $('hourSub').textContent=tx('Heure de fin de la partie, dans le fuseau horaire de cet appareil.');
 scoreBars('tiltChart',groupScores(L,TILT),ref);scoreBars('sessChart',groupScores(L,RANKS),ref);scoreBars('hourChart',groupScores(L,HOURS),ref)}

// Constats : seulement les écarts qui dépassent la marge du hasard
function behaviourFacts(G){const L=G.filter(g=>g.ts);if(L.length<50)return [];const ref=score(L).s/100,out=[];
 const tilt=score(L.filter(g=>g.pertes>=1));
 if(scoreGap(tilt,ref)<0)out.push(tx('Juste après une défaite, ton score tombe à <b>{s}</b> (contre {m} en moyenne, {n} parties) : fais une pause avant de relancer une partie.',{s:fmt(tilt.s)+PC,m:fmt(100*ref)+PC,n:tilt.n}));
 const late=score(L.filter(g=>g.rang>=4));
 if(scoreGap(late,ref)<0)out.push(tx("À partir de la 4e partie d'une session, ton score tombe à <b>{s}</b> ({n} parties) : des sessions plus courtes te réussissent mieux.",{s:fmt(late.s)+PC,n:late.n}));
 const hours=groupScores(L,HOURS).filter(x=>scoreGap(x,ref)!==0).sort((a,b)=>a.s-b.s);
 if(hours.length)out.push(tx("Selon l'heure de jeu, écarts nets avec ton score moyen ({m}) : {l}.",{m:fmt(100*ref)+PC,l:hours.map(x=>txn(x.n,'{h} <b>{s}</b> ({n} partie)','{h} <b>{s}</b> ({n} parties)',{h:x.lab.split(' (')[0].toLowerCase(),s:fmt(x.s)+PC})).join(', ')}));
 return out}
