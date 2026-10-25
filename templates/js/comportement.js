/* ---------- comportement : enchaînement des parties, sessions, heure de jeu ---------- */
const SESSION_GAP=3600;   // plus d'une heure entre la fin de deux parties : nouvelle session
// Sur toutes les parties (quels que soient les filtres) : résultat de la partie précédente de la session,
// défaites d'affilée juste avant, rang dans la session
D.games.forEach((g,i)=>{const p=D.games[i-1],same=p&&g.ts&&p.ts&&g.ts>=p.ts&&g.ts-p.ts<SESSION_GAP;
 g.avant=same?p.resultat:null;g.pertes=same?(p.resultat==='Défaite'?p.pertes+1:0):0;g.rang=same?p.rang+1:1});

// Barres de score : vertes ou rouges si l'écart avec le score global dépasse la marge du hasard, grises sinon
function scoreBars(id,groups,ref){
 chart(id,{type:'bar',data:{labels:groups.map(x=>x.l),datasets:[{label:'Score',data:groups.map(x=>x.s),backgroundColor:groups.map(x=>({1:'#199e70','-1':'#e66767'})[scoreGap(x,ref)]||'#5b6b80'),borderRadius:4,maxBarThickness:56}]},
  options:barOpts({plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`Score ${fmt(c.raw)} % · ${groups[c.dataIndex].n} parties (${vnd(groups[c.dataIndex])})`}}},scales:{y:{min:0,max:100,ticks:{callback:v=>v+' %'}}}})})}
const groupScores=(G,defs)=>defs.map(([l,f])=>({l,...score(G.filter(f))})).filter(x=>x.n);

const TILT=[['Première de la session',g=>!g.avant],['Après une victoire',g=>g.avant==='Victoire'],['Après une nulle',g=>g.avant==='Nulle'],
 ['Après une défaite',g=>g.pertes===1],['Après 2 défaites ou plus',g=>g.pertes>=2]];
const RANKS=[['1re partie',g=>g.rang===1],['2e',g=>g.rang===2],['3e',g=>g.rang===3],['4e – 5e',g=>g.rang>=4&&g.rang<=5],['6e et suivantes',g=>g.rang>=6]];
const HOURS=[['Nuit (0 h – 6 h)',0,6],['Matin (6 h – 12 h)',6,12],['Après-midi (12 h – 18 h)',12,18],['Soir (18 h – 24 h)',18,24]]
 .map(([l,a,b])=>[l,g=>{const h=new Date(g.ts*1000).getHours();return h>=a&&h<b}]);

function renderBehaviour(G){const L=G.filter(g=>g.ts),ref=score(L).s/100;
 const sessions=L.filter(g=>g.rang===1).length;
 $('tiltSub').textContent=L.length?`Score selon le résultat de la partie précédente, si elle s'est terminée moins d'une heure avant. Score global : ${fmt(100*ref)} %.`:'Heure des parties indisponible.';
 $('sessSub').textContent=sessions?`Une session = des parties enchaînées à moins d'une heure d'intervalle : ${sessions} sessions, ${fmt(L.length/sessions,1)} parties en moyenne.`:'';
 $('hourSub').textContent='Heure de fin de la partie, dans le fuseau horaire de cet appareil.';
 scoreBars('tiltChart',groupScores(L,TILT),ref);scoreBars('sessChart',groupScores(L,RANKS),ref);scoreBars('hourChart',groupScores(L,HOURS),ref)}

// Constats : seulement les écarts qui dépassent la marge du hasard
function behaviourFacts(G){const L=G.filter(g=>g.ts);if(L.length<50)return [];const ref=score(L).s/100,out=[];
 const tilt=score(L.filter(g=>g.pertes>=1));
 if(scoreGap(tilt,ref)<0)out.push(`Juste après une défaite, ton score tombe à <b>${fmt(tilt.s)} %</b> (contre ${fmt(100*ref)} % en moyenne, ${tilt.n} parties) : fais une pause avant de relancer une partie.`);
 const late=score(L.filter(g=>g.rang>=4));
 if(scoreGap(late,ref)<0)out.push(`À partir de la 4e partie d'une session, ton score tombe à <b>${fmt(late.s)} %</b> (${late.n} parties) : des sessions plus courtes te réussissent mieux.`);
 const hours=groupScores(L,HOURS).filter(x=>scoreGap(x,ref)!==0).sort((a,b)=>a.s-b.s);
 if(hours.length)out.push(`Selon l'heure de jeu, écarts nets avec ton score moyen (${fmt(100*ref)} %) : `+hours.map(x=>`${x.l.split(' (')[0].toLowerCase()} <b>${fmt(x.s)} %</b> (${x.n} parties)`).join(', ')+'.');
 return out}
