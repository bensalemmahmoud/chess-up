/* ---------- pourquoi ce coup ? ---------- */
// Stockfish n'a pas de plan : il calcule une variante. On la montre (à rejouer sur l'échiquier) et on la traduit en mots :
// matériel gagné, promotion, mat, et éléments de la position (mêmes règles que chess_analysis.position_features)
// apparus ou disparus entre le début et la fin de la variante, pour chaque camp. Plus la menace adverse que le coup pare.
const VAL={p:1,n:3,b:3,r:5,q:9,k:0},EXPLAIN_MS=1500;
const sqName=i=>'abcdefgh'[i&7]+((i>>3)+1);
const STEPS={n:[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]],k:[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],
 b:[[1,1],[1,-1],[-1,1],[-1,-1]],r:[[1,0],[-1,0],[0,1],[0,-1]]};STEPS.q=[...STEPS.b,...STEPS.r];
const moveAccuracy=loss=>Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*loss)-3.1669));   // même formule que chess_analysis

// Cases attaquées par la pièce en i (a1 = 0, comme python-chess) ; une pièce qui bloque est comptée
function attacksFrom(B,i){const p=B[i],f=i&7,r=i>>3,out=[];if(!p)return out;
 const add=(df,dr)=>{const x=f+df,y=r+dr;if(x<0||x>7||y<0||y>7)return false;out.push(y*8+x);return !B[y*8+x]};
 if(p.type==='p'){const d=p.color==='w'?1:-1;add(-1,d);add(1,d)}
 else if(p.type==='n'||p.type==='k')STEPS[p.type].forEach(([a,b])=>add(a,b));
 else STEPS[p.type].forEach(([a,b])=>{for(let k=1;add(a*k,b*k);k++);});
 return out}

function phaseOf(G){const n=boardOf(G).reduce((t,p)=>t+(p&&'nbrq'.includes(p.type)?VAL[p.type]:0),0);
 return n<=26?'finale':+G.fen().split(' ')[5]<=12?'ouverture':'milieu'}
function endgameKind(G){const k=new Set(boardOf(G).filter(p=>p&&'nbrq'.includes(p.type)).map(p=>p.type)),only=s=>[...k].every(t=>s.includes(t));
 return !k.size?'pions':only('r')?'tours':only('nb')?'mineures':only('q')?'dames':only('rnb')?'tours_mineures':'dames_pieces'}
const boardOf=G=>Array.from({length:64},(_,i)=>G.get(sqName(i)));

// Éléments de la position pour chaque camp : {w: {élément: [cases]}, b: {...}, mob, mat}
function features(G){const B=boardOf(G),A=B.map((p,i)=>attacksFrom(B,i)),O={w:'b',b:'w'};
 const file=i=>i&7,rank=i=>i>>3,rel=(i,c)=>c==='w'?rank(i):7-rank(i),front=(i,c)=>c==='w'?i+8:i-8;
 const pcs=(t,c)=>B.reduce((o,p,i)=>(p&&p.type===t&&p.color===c&&o.push(i),o),[]);
 const atk=(c,i)=>B.reduce((o,p,j)=>(p&&p.color===c&&A[j].includes(i)&&o.push(j),o),[]);
 const kingOf=c=>B.findIndex(p=>p&&p.type==='k'&&p.color===c);
 // Pièce a du camp c clouée sur son roi : la ligne du clouage (elle peut encore agir le long de cette ligne), sinon null
 function pinLine(c,a){const k=kingOf(c),dx=Math.sign(file(a)-file(k)),dy=Math.sign(rank(a)-rank(k));
  if(k<0||k===a||!(dx===0||dy===0||Math.abs(file(a)-file(k))===Math.abs(rank(a)-rank(k))))return null;
  let seen=false;
  for(let x=file(k)+dx,y=rank(k)+dy;x>=0&&x<8&&y>=0&&y<8;x+=dx,y+=dy){const i=y*8+x,p=B[i];if(!p)continue;
   if(i===a){seen=true;continue}
   if(!seen||p.color===c||!(p.type==='q'||p.type===(dx&&dy?'b':'r')))return null;
   const line=new Set();for(let s=-7;s<=7;s++){const X=file(k)+dx*s,Y=rank(k)+dy*s;if(X>=0&&X<8&&Y>=0&&Y<8)line.add(Y*8+X)}
   return line}
  return null}
 function pawns(c){const mine=pcs('p',c),theirs=pcs('p',O[c]),out={isoles:[],doubles:[],arrieres:[],passes:[]};
  mine.forEach(sq=>{const f=file(sq),r=rel(sq,c),nb=mine.filter(s=>Math.abs(file(s)-f)===1),fr=front(sq,c);
   if(!nb.length&&f>0&&f<7)out.isoles.push(sq);
   if(mine.filter(s=>file(s)===f).length>1)out.doubles.push(sq);
   if(!theirs.some(s=>Math.abs(file(s)-f)<=1&&rel(s,c)>r))out.passes.push(sq);
   else if(nb.length&&nb.every(s=>rel(s,c)>r)&&!theirs.some(s=>file(s)===f)&&fr>=0&&fr<64&&atk(O[c],fr).some(j=>theirs.includes(j)))out.arrieres.push(sq)});
  return out}
 function hanging(c){const out=[];
  ['n','b','r','q'].forEach(t=>pcs(t,c).forEach(sq=>{const free=(side,a)=>{const l=pinLine(side,a);return !l||l.has(sq)};
   const at=atk(O[c],sq).filter(a=>free(O[c],a)),df=atk(c,sq).filter(d=>free(c,d));
   if(at.length&&(!df.length||Math.min(...at.map(a=>VAL[B[a].type]||99))<VAL[t]))out.push(sq)}));
  return out}
 function king(c,end){const k=kingOf(c);if(k<0)return {};const f=file(k),r=rel(k,c);
  if(end)return f>=2&&f<=5&&r>=2&&r<=5?{roi_actif:[k]}:{};
  if(!pcs('q',O[c]).length||r>1)return {};
  const P=pcs('p',c);
  if(r===0&&[3,4,5].includes(f)&&[3,4].some(cf=>!P.some(p=>file(p)===cf)))return {roi_centre:[k]};
  const st=c==='w'?1:-1,fs=[];for(let x=Math.max(0,f-1);x<=Math.min(7,f+1);x++)fs.push(x);
  if(fs.flatMap(x=>[1,2].map(d=>(rank(k)+d*st)*8+x)).filter(s=>P.includes(s)).length<=1)return {roi_ouvert:[k,...fs.map(x=>(rank(k)+st)*8+x)]};
  return {}}
 const mobility=c=>['n','b','r','q'].reduce((t,ty)=>t+pcs(ty,c).reduce((u,s)=>u+A[s].filter(i=>!B[i]||B[i].color!==c).length,0),0);
 function pieces(c){const out={},P=pcs('p',c),T=pcs('p',O[c]),all=[...P,...T];
  const R=pcs('r',c).filter(s=>!all.some(p=>file(p)===file(s)));if(R.length)out.colonne=R;
  const col=i=>(file(i)+rank(i))%2,Bs=pcs('b',c);
  if(new Set(Bs.map(col)).size===2&&new Set(pcs('b',O[c]).map(col)).size<2)out.paire_fous=Bs;
  Bs.forEach(b=>{const same=P.filter(p=>col(p)===col(b)),blocked=same.filter(p=>T.includes(front(p,c)));
   if(same.length>=4&&blocked.length>=2)(out.mauvais_fou??=[]).push(b,...same)});
  pcs('n',c).forEach(n=>{const f=file(n),r=rel(n,c);
   if(r>=3&&r<=5&&atk(c,n).some(j=>P.includes(j))&&!T.some(p=>Math.abs(file(p)-f)===1&&rel(p,c)>r))(out.avant_poste??=[]).push(n)});
  return out}
 const end=phaseOf(G)==='finale',mob={w:mobility('w'),b:mobility('b')};
 const out={mob:[mob.w,mob.b],mat:['w','b'].map(c=>B.reduce((t,p)=>t+(p&&p.color===c?VAL[p.type]:0),0))};
 ['w','b'].forEach(c=>{const f=Object.fromEntries(Object.entries(pawns(c)).filter(([,v])=>v.length)),h=hanging(c);if(h.length)f.en_prise=h;
  Object.assign(f,king(c,end),pieces(c));
  if(mob[c]>=1.3*mob[O[c]]&&mob[c]-mob[O[c]]>=6)f.mobilite=['n','b','r','q'].flatMap(t=>pcs(t,c));
  out[c]=Object.fromEntries(Object.entries(f).map(([k,v])=>[k,[...new Set(v)].map(sqName)]))});
 return out}

/* Variante : depuis fen, le coup san puis la suite de Stockfish. Au moins 8 demi-coups, prolongée tant que les prises
   s'enchaînent (fin d'un échange), jusqu'à 12 */
function lineText(fen,moves){const p=fen.split(' ');let n=+p[5],w=p[1]==='w';
 return moves.map((m,i)=>{const s=(w?n+'.':i===0?n+'...':'')+m.san;if(!w)n++;w=!w;return s}).join(' ')}
function playLine(fen,ucis){const G=new Chess(fen),moves=[];
 for(const u of ucis){if(moves.length>=12)break;
  if(moves.length>=8&&!G.moves({verbose:true}).some(m=>m.from===u.slice(0,2)&&m.to===u.slice(2,4)&&m.captured))break;
  const mv=G.move({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]||'q'});if(!mv)break;moves.push(mv)}
 return {G,moves}}
const les=c=>c==='w'?'les Blancs':'les Noirs',GOOD=new Set(['passes','colonne','paire_fous','avant_poste','mobilite','roi_actif']);
const names=(f,c,ks)=>ks.map(k=>`${ELEMENTS[k][3]} (${f[c][k].slice(0,3).join(', ')})`).join(', ');
// Ce que la variante change, du point de vue du camp me qui joue le premier coup
function lineFacts(fen,moves,G,me){const op=OTHER[me],f0=features(new Chess(fen)),f1=features(G),out=[],i=me==='w'?0:1;
 if(G.in_checkmate())return [G.turn()===op?`La variante se termine par le mat : ${les(me)} gagnent.`:`La variante se termine par le mat ${DES[me]}.`];
 const dm=(f1.mat[i]-f1.mat[1-i])-(f0.mat[i]-f0.mat[1-i]);
 if(moves.some(m=>m.promotion&&m.color===me))out.push(`Un pion ${DES[me]} va à dame.`);
 if(dm>0)out.push(`${CAMP[me]} gagnent ${dm} point${dm>1?'s':''} de matériel.`);
 else if(dm<0)out.push(`${CAMP[me]} perdent ${-dm} point${dm<-1?'s':''} de matériel.`);
 const diff=(c,good,gained)=>Object.keys(ELEMENTS).filter(k=>k!=='en_prise'&&GOOD.has(k)===good&&(gained?f1[c][k]&&!f0[c][k]:f0[c][k]&&!f1[c][k]));
 const say=(ks,txt,f,c)=>{if(ks.length)out.push(txt+names(f,c,ks)+'.')};
 say(diff(me,true,true),`${CAMP[me]} obtiennent : `,f1,me);
 say(diff(op,false,true),`${CAMP[op]} se retrouvent avec : `,f1,op);
 say(diff(me,false,false),`${CAMP[me]} se débarrassent de : `,f0,me);
 say(diff(op,true,false),`${CAMP[op]} perdent : `,f0,op);
 const plus=out.length>0&&dm>=0;   // « en contrepartie » seulement après un gain
 say(diff(me,false,true),plus?`En contrepartie, ${les(me)} acceptent : `:`${CAMP[me]} acceptent : `,f1,me);
 say(diff(op,true,true),plus?`En contrepartie, ${les(op)} obtiennent : `:`${CAMP[op]} obtiennent : `,f1,op);
 return out}

// Explication d'un coup joué depuis fen : la suite de Stockfish et ce qu'elle change. La variante principale du moteur
// est parfois coupée tôt : on la prolonge par de courtes recherches jusqu'à LINE_MIN demi-coups
const LINE_MIN=6,EXTEND_MS=400;
async function explainMove(fen,san){const G=new Chess(fen),first=G.move(san,{sloppy:true});if(!first)throw new Error('coup illégal');
 const me=first.color,after=G.fen(),r=G.game_over()?null:await Engine.move(after,EXPLAIN_MS);
 const pv=r?[...r.pv]:[];
 for(let k=0;k<3&&pv.length<LINE_MIN-1;k++){const l=playLine(after,pv);if(l.moves.length<pv.length||l.G.game_over())break;
  const more=await Engine.move(l.G.fen(),EXTEND_MS);pv.push(...more.pv)}
 const l=playLine(after,pv),moves=[first,...l.moves];
 const win=G.in_checkmate()?100:r?100-winPct(r.score):50;   // chances de gain du camp qui joue le coup, au bout de la recherche
 return {fen,san:first.san,moves:moves.map(m=>m.san),text:lineText(fen,moves),facts:lineFacts(fen,moves,l.G,me),win,me}}
// Menace : si l'adversaire pouvait jouer maintenant, que gagnerait-il ? (null si rien de sérieux) ; win = chances de gain
// du camp au trait après son meilleur coup, l'évaluation de la position
function threatOf(fen,win){const flip=flipFen(fen);if(!flip)return Promise.resolve(null);
 return Engine.move(flip,EXPLAIN_MS).then(r=>{const mv=new Chess(flip).move({from:r.from,to:r.to,promotion:r.promotion||'q'});
  const before=100-win,after=winPct(r.score);   // chances de gain de l'adversaire
  return mv&&after-before>=THREAT_MIN?{mv,now:before,after}:null})}

/* Bloc « pourquoi » : le coup expliqué (meilleur ou joué par un joueur fort), éventuellement la réfutation d'un autre
   coup, et la menace que le coup pare. Les boutons data-line rejouent la variante sur l'échiquier du mode. */
function explainAll(fen,best,other){const x={};
 return explainMove(fen,best).then(b=>{x.best=b;return other&&bare(other)!==bare(best)?explainMove(fen,other):null})
  .then(r=>{x.refut=r;return threatOf(fen,x.best.win)}).then(t=>{x.threat=t;return x})}
function explainHTML(x,labels={}){const blk=(l,title,key)=>`<div class="why"><b>${title}</b><p class="muted">${esc(l.text)}</p>
 ${l.facts.length?'<ul>'+l.facts.map(f=>`<li>${esc(f)}</li>`).join('')+'</ul>':'<p>Rien de concret ne change dans ces coups : l\'avantage tient aux coups que l\'adversaire ne peut plus jouer. Rejoue la variante pas à pas pour le voir.</p>'}
 <p>Au bout : ${Math.round(l.win)} % de chances de gain pour ${les(l.me)}.</p><button data-line="${key}">▶ Rejouer cette variante</button></div>`;
 let h=blk(x.best,labels.best||`Pourquoi ${esc(x.best.san)} : la suite de Stockfish`,'best');
 if(x.threat)h+=`<div class="why"><b>La menace</b><p>Si c'était ${x.threat.mv.color==='w'?'aux Blancs':'aux Noirs'} de jouer : ${threatText(x.threat)}. Le coup doit en tenir compte.</p></div>`;
 if(x.refut)h+=blk(x.refut,labels.refut||`Et ${esc(x.refut.san)} ? La réponse de Stockfish`,'refut');
 return h}
