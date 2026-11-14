/* ---------- préparer un adversaire ---------- */
// Ses parties publiques récentes, téléchargées depuis le navigateur (les API Chess.com et Lichess l'autorisent).
const OPP_MAX=150;   // parties analysées au maximum
const OPP_CADENCES={chesscom:['rapid','blitz','bullet','daily'],lichess:['rapid','blitz','bullet','classical','correspondence','ultraBullet']};
const FAMILY_WORDS=['Defense','Opening','Game','Gambit','Attack','System','Countergambit'];
function openingFamily(name){   // même règle que opening_family() côté Python
 const v=name.split(':')[0].split(/\s*\.\.\.|\s+\d/)[0].trim().replace(/\s+(with|and)$/,'').replace('Caro Kann','Caro-Kann'),w=v.split(/\s+/);
 for(let i=0;i<w.length;i++)if(FAMILY_WORDS.includes(w[i])){let j=i+1;if(['Accepted','Declined'].includes(w[j]))j++;return w.slice(0,j).join(' ')}
 return w.slice(0,3).join(' ')||name}
const pgnMoves=pgn=>pgn.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)|\$\d+/g,' ').split(/\s+/).map(t=>t.replace(/^\d+\.+/,'')).filter(t=>t&&!['1-0','0-1','1/2-1/2','*'].includes(t));
const COLOR_LABEL={Blancs:tx('Blancs'),Noirs:tx('Noirs')};   // couleur affichée (la valeur reste 'Blancs'/'Noirs')
const DRAWS=['agreed','stalemate','repetition','insufficient','50move','timevsinsufficient'];

async function fetchChesscom(user,cadence){
 const r=await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
 if(r.status===404||r.status===410)throw new Error(tx('Joueur introuvable sur Chess.com.'));if(!r.ok)throw new Error(tx('Chess.com ne répond pas ({s}).',{s:r.status}));
 const archives=(await r.json()).archives||[],out=[];
 for(const url of archives.slice(-4).reverse()){if(out.length>=OPP_MAX)break;
  const games=(await (await fetch(url)).json()).games||[];
  games.filter(g=>g.time_class===cadence&&g.rules==='chess').reverse().forEach(g=>{
   const white=g.white.username.toLowerCase()===user.toLowerCase(),me=white?g.white:g.black,eco=(g.pgn.match(/\[ECOUrl "([^"]+)"\]/)||[])[1]||g.eco||'';
   out.push({white,pts:me.result==='win'?1:DRAWS.includes(me.result)?.5:0,fin:me.result==='win'?(white?g.black:g.white).result:me.result,rating:me.rating,
    opp:(white?g.black:g.white).username,opening:openingFamily(eco.split('/').pop().replace(/-+/g,' ')||tx('Inconnue')),moves:pgnMoves(g.pgn).slice(0,4),date:g.end_time*1000})})}
 return out.slice(0,OPP_MAX)}

async function fetchLichess(user,cadence){
 const r=await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${OPP_MAX}&perfType=${cadence}&opening=true`,{headers:{Accept:'application/x-ndjson'}});
 if(r.status===404)throw new Error(tx('Joueur introuvable sur Lichess.'));if(!r.ok)throw new Error(tx('Lichess ne répond pas ({s}).',{s:r.status}));
 return (await r.text()).split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(g=>g.variant==='standard'&&g.moves).map(g=>{
  const white=(g.players.white.user||{}).id===user.toLowerCase(),me=white?g.players.white:g.players.black,them=white?g.players.black:g.players.white;
  const fin={mate:'checkmated',resign:'resigned',outoftime:'timeout',timeout:'abandoned'}[g.status]||g.status;
  return {white,pts:!g.winner?.5:(g.winner==='white')===white?1:0,fin,rating:me.rating,opp:(them.user||{}).name||tx('Anonyme'),
   opening:openingFamily((g.opening||{}).name||tx('Inconnue')),moves:g.moves.split(' ').slice(0,4),date:g.lastMoveAt}})}

function oppTable(rows,label){
 return `<table><tr><th>${label}</th><th class="num">${tx('Parties')}</th><th class="num">${tx('Son score')}</th></tr>${rows.map(([k,l])=>{const s=100*l.reduce((t,g)=>t+g.pts,0)/l.length;
  return `<tr><td>${esc(k)}</td><td class="num">${l.length}</td><td class="num ${s>=60?'loss':s<=40?'win':''}">${fmt(s,0)}${PC}</td></tr>`}).join('')||'<tr><td colspan="3" class="empty">—</td></tr>'}</table>`}
const groupBy=(list,f)=>Object.entries(list.reduce((o,g)=>{const k=f(g);if(k)(o[k]??=[]).push(g);return o},{})).sort((a,b)=>b[1].length-a[1].length);

async function analyseOpponent(){const user=$('oppUser').value.trim(),site=$('oppSite').value,cadence=$('oppCad').value;if(!user)return;
 $('oppGo').disabled=true;$('oppOut').innerHTML=`<p class="muted">${tx('Téléchargement des parties…')}</p>`;
 try{const games=await (site==='lichess'?fetchLichess(user,cadence):fetchChesscom(user,cadence));
  if(!games.length)throw new Error(tx('Aucune partie {c} récente pour {u}.',{c:cadence,u:user}));
  const sc=100*games.reduce((t,g)=>t+g.pts,0)/games.length,lost=games.filter(g=>g.pts===0),asW=games.filter(g=>g.white),asB=games.filter(g=>!g.white);
  const onTime=lost.filter(g=>g.fin==='timeout').length,resigns=lost.filter(g=>g.fin==='resigned').length;
  const h2h=D.site===site?D.games.filter(g=>g.adversaire.toLowerCase()===user.toLowerCase()):[],h=score(h2h);
  const weak=[...groupBy(asW,g=>g.opening).map(([k,l])=>['Blancs',k,l]),...groupBy(asB,g=>g.opening).map(([k,l])=>['Noirs',k,l])]
   .filter(([,,l])=>l.length>=3).map(([c,k,l])=>({c,k,n:l.length,s:100*l.reduce((t,g)=>t+g.pts,0)/l.length})).sort((a,b)=>a.s-b.s);
  const tips=[];
  weak.filter(w=>w.s<=45).slice(0,3).forEach(w=>tips.push(tx('Il est en difficulté dans la <b>{o}</b> avec les {c} : {s} sur {n} parties.',{o:esc(w.k),c:COLOR_LABEL[w.c],s:fmt(w.s,0)+PC,n:w.n})));
  weak.filter(w=>w.s>=65).slice(-2).forEach(w=>tips.push(tx('À éviter : la <b>{o}</b>, où il marque {s} avec les {c} ({n} parties).',{o:esc(w.k),c:COLOR_LABEL[w.c],s:fmt(w.s,0)+PC,n:w.n})));
  if(lost.length>=5&&onTime/lost.length>=.25)tips.push(tx('Il perd souvent au temps ({p} de ses défaites) : garde des positions complexes et ta pendule.',{p:fmt(100*onTime/lost.length,0)+PC}));
  if(lost.length>=5&&resigns/lost.length>=.6)tips.push(tx('Il abandonne volontiers ({p} de ses défaites) : un avantage net suffit souvent.',{p:fmt(100*resigns/lost.length,0)+PC}));
  const firstW=groupBy(asW,g=>g.moves[0]),vsE4=groupBy(asB.filter(g=>g.moves[0]==='e4'),g=>g.moves[1]),vsD4=groupBy(asB.filter(g=>g.moves[0]==='d4'),g=>g.moves[1]);
  const share=(l,n)=>l.slice(0,3).map(([k,x])=>`${esc(k)} ${fmt(100*x.length/n,0)}${PC}`).join(' · ')||'—';
  $('oppOut').innerHTML=`<div class="grid">
   <div class="kpi"><div class="label">${tx('Parties {c} analysées',{c:esc(cadence)})}</div><div class="value">${games.length}</div><div class="hint">${tx('les plus récentes')}</div></div>
   <div class="kpi"><div class="label">${tx('Elo actuel')}</div><div class="value">${games[0].rating||'—'}</div><div class="hint">${site==='lichess'?'Lichess':'Chess.com'}</div></div>
   <div class="kpi"><div class="label">${tx('Son score')}</div><div class="value">${fmt(sc,0)}${PC}</div><div class="hint">${tx('{w} avec les Blancs · {b} avec les Noirs',{w:asW.length,b:asB.length})}</div></div>
   <div class="kpi"><div class="label">${tx('Contre toi')}</div><div class="value">${h2h.length?vnd(h):'—'}</div><div class="hint">${h2h.length?tx('tes victoires-nulles-défaites'):tx('aucune partie dans ce rapport')}</div></div></div>
  <section class="panel"><h2>${tx('Points à exploiter')}</h2><ul class="insights">${tips.map(t=>`<li>${t}</li>`).join('')||`<li class="muted">${tx('Pas de faiblesse nette sur cet échantillon.')}</li>`}</ul>
   <p class="note">${tx('Premier coup avec les Blancs : {l}',{l:share(firstW,asW.length)})}<br>${tx('Contre 1.e4 : {l}',{l:share(vsE4,vsE4.reduce((t,[,l])=>t+l.length,0))})}<br>${tx('Contre 1.d4 : {l}',{l:share(vsD4,vsD4.reduce((t,[,l])=>t+l.length,0))})}</p></section>
  <div class="charts"><section class="panel"><h2>${tx('Ses ouvertures avec les Blancs')}</h2><div class="tablewrap">${oppTable(groupBy(asW,g=>g.opening).slice(0,12),tx('Ouverture'))}</div></section>
   <section class="panel"><h2>${tx('Ses ouvertures avec les Noirs')}</h2><div class="tablewrap">${oppTable(groupBy(asB,g=>g.opening).slice(0,12),tx('Ouverture'))}</div></section></div>
  <p class="note">${tx('Score de ton adversaire : en rouge ses points forts ({a} ou plus), en vert ses points faibles ({b} ou moins). Sous 10 parties, ce sont des pistes plutôt que des certitudes.',{a:'60'+PC,b:'40'+PC})}</p>`}
 catch(err){$('oppOut').innerHTML=`<p class="loss">${esc(err.message||tx('Téléchargement impossible.'))}</p>`}
 finally{$('oppGo').disabled=false}}

function initOpponent(){const setCads=()=>{const sel=$('oppCad'),prev=sel.value||$('fCadence').value||'rapid';sel.innerHTML='';
  OPP_CADENCES[$('oppSite').value].forEach(c=>sel.add(new Option(c,c)));sel.value=OPP_CADENCES[$('oppSite').value].includes(prev)?prev:'rapid'};
 $('oppSite').value=D.site||'chesscom';setCads();$('oppSite').addEventListener('change',setCads);
 $('oppGo').addEventListener('click',analyseOpponent);$('oppUser').addEventListener('keydown',e=>{if(e.key==='Enter')analyseOpponent()})}
