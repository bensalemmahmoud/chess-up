/* ---------- répertoire d'ouvertures ---------- */
// Arbre des premiers coups de tes parties (g.coups), et évaluation Stockfish des positions où tu as le trait
// (D.repertoire : {coups qui y mènent: {b: meilleur coup, w: chances de gain, m: {coup joué: chances après}}}).
let repPath=[],repColor='Blancs',repCardsCache=null;
const myTurn=(ply,color)=>ply%2===(color==='Blancs'?0:1);
const moveLabel=(ply,san)=>`${Math.floor(ply/2)+1}${ply%2?'...':'.'}${san}`;

function renderRepertoire(G){
 const games=G.filter(g=>g.couleur===repColor&&g.coups),key=repPath.join(' '),ply=repPath.length;
 const here=games.filter(g=>{const m=g.coups.split(' ');return repPath.every((s,i)=>m[i]===s)});
 const next={};here.forEach(g=>{const s=g.coups.split(' ')[ply];if(s)(next[s]??=[]).push(g)});
 const sf=D.repertoire?.[key],mine=myTurn(ply,repColor);
 const board=new Chess();repPath.forEach(s=>board.move(s,{sloppy:true}));
 $('repBoard').innerHTML=boardHTML(board,repColor==='Noirs',{last:(()=>{const h=board.history({verbose:true}).pop();return h?[h.from,h.to]:[]})()});
 $('repPath').innerHTML=[`<a href="#" data-i="0">Début</a>`,...repPath.map((s,i)=>`<a href="#" data-i="${i+1}">${esc(moveLabel(i,s))}</a>`)].join(' › ');
 const sc=score(here);
 $('repInfo').innerHTML=here.length?`${here.length} parties dans cette position · ton score : <b>${fmt(sc.s)} %</b> (${vnd(sc)})`
  +(mine?(sf?` · Stockfish conseille <b>${esc(sf.b)}</b>`:''):' · c\'est à ton adversaire de jouer'):'Aucune partie dans cette position avec les filtres actuels.';
 const rows=Object.entries(next).sort((a,b)=>b[1].length-a[1].length).map(([san,l])=>{const s=score(l);
  let note='';
  if(mine&&sf){const after=sf.m[san];
   if(bare(san)===bare(sf.b))note='<span class="win">✓ meilleur coup</span>';
   else if(after!=null&&sf.w-after>=T.imp)note=`<span class="loss">⚠ ${sf.w-after>=T.err?'erreur':'imprécision'}</span> · Stockfish préfère <b>${esc(sf.b)}</b>`;
   else if(after!=null)note='<span class="muted">bon coup</span>';}
  return `<tr data-san="${esc(san)}" class="clickable"><td><b>${esc(moveLabel(ply,san))}</b></td><td class="num">${l.length}</td><td class="num">${fmt(pct(l.length,here.length),0)} %</td>
   <td class="num"><span class="bar" style="width:${Math.round(s.s*.5)}px"></span>${fmt(s.s)} %</td><td>${note}</td></tr>`}).join('');
 $('repMoves').innerHTML=rows||`<tr><td colspan="5" class="empty">${here.length?'Fin des coups enregistrés pour cette ligne.':'—'}</td></tr>`;
 $('repHead').innerHTML=`<th>${mine?'Ton coup':'Coup adverse'}</th><th class="num">Parties</th><th class="num">Fréquence</th><th class="num">Ton score</th><th>Stockfish</th>`}

$('repMoves').addEventListener('click',e=>{const tr=e.target.closest('tr[data-san]');if(!tr)return;repPath.push(tr.dataset.san);renderRepertoire(baseFilter(false))});
$('repPath').addEventListener('click',e=>{const a=e.target.closest('a[data-i]');if(!a)return;e.preventDefault();repPath=repPath.slice(0,+a.dataset.i);renderRepertoire(baseFilter(false))});
$('repColor').addEventListener('change',e=>{repColor=e.target.value;repPath=[];renderRepertoire(baseFilter(false))});

// Positions de ton répertoire où ton coup habituel est imprécis : un thème d'entraînement à part
function repertoireCards(){if(repCardsCache)return repCardsCache;
 const counts={},last={};   // coups joués par position où tu as le trait, et partie la plus récente qui y passe
 D.games.forEach(g=>{if(!g.coups)return;const m=g.coups.split(' ');
  for(let ply=0;ply<m.length;ply++)if(myTurn(ply,g.couleur)){const k=m.slice(0,ply).join(' '),o=counts[k]??={};o[m[ply]]=(o[m[ply]]||0)+1;last[k]=g.i}});
 repCardsCache=Object.entries(D.repertoire||{}).flatMap(([k,sf])=>{const c=counts[k];if(!c||!sf.b)return [];
  const [usual,n]=Object.entries(c).sort((a,b)=>b[1]-a[1])[0],after=sf.m[usual];
  if(n<2||after==null||sf.w-after<T.imp||bare(usual)===bare(sf.b))return [];
  const board=new Chess(),moves=k?k.split(' '):[];if(!moves.every(s=>board.move(s,{sloppy:true})))return [];
  const ply=moves.length,alts=Object.entries(sf.m).filter(([s,w])=>bare(s)!==bare(sf.b)&&sf.w-w<T.imp).map(([s])=>s);
  return [{id:'rep:'+k,rep:true,fen:board.fen(),best:sf.b,san:usual,count:n,wb:sf.w,wa:after,alts,ph:'ouverture',ply,n:`${Math.floor(ply/2)+1}${ply%2?'...':'.'}`,g:last[k]}]});
 return repCardsCache}
