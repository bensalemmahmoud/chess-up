/* ---------- série chronométrée ---------- */
// Méthode « Woodpecker » : les mêmes positions, refaites de plus en plus vite, jusqu'à ce que les motifs deviennent des
// réflexes. Une série = SERIE_N positions d'un thème, un seul essai chacune. Elle revient à l'identique tant qu'elle n'est
// pas réussie en entier. srs « serie:<thème> » : ids de la série en cours, h = essais [date, réussies, secondes].
const SERIE_N=10,SERIE_PAUSE=1400;
let sCur=null,sTimer=null;

const fmtTime=s=>`${Math.floor(s/60)} min ${String(Math.round(s%60)).padStart(2,'0')} s`;
function serieDecks(){return Object.entries(DECKS).map(([k,[l]])=>({k,l,n:deckCards(k).length})).filter(d=>d.n>=5)}
function renderSerie(){const sel=$('sDeck'),prev=sel.value,decks=serieDecks();
 $('sBlock').hidden=!decks.length;$('sMissing').hidden=!!decks.length;
 if(!decks.length){$('sMissing').textContent='Pas encore assez de positions analysées pour une série (au moins 5 dans un thème).';return}
 sel.innerHTML=decks.map(d=>`<option value="${d.k}">${esc(d.l)} (${d.n})</option>`).join('');
 sel.value=decks.some(d=>d.k===prev)?prev:decks.some(d=>d.k==='tout')?'tout':decks[0].k;serieIdle()}
function serieRec(k){return srs['serie:'+k]||{h:[]}}
// La série en cours du thème, sinon une nouvelle : d'abord les positions que tu rates (boîte basse), puis au hasard
function serieCards(k,fresh){const all=deckCards(k),byId=new Map(all.map(m=>[cardId(m),m])),rec=serieRec(k);
 if(!fresh&&rec.ids){const kept=rec.ids.map(id=>byId.get(id)).filter(Boolean);if(kept.length>=Math.min(5,all.length))return kept}
 const pick=shuffle([...all]).sort((a,b)=>(srs[cardId(a)]?.b??1)-(srs[cardId(b)]?.b??1)).slice(0,SERIE_N);
 srs['serie:'+k]={...rec,ids:pick.map(cardId),h:[],t:Date.now()};saveSrs();return pick}
function serieIdle(){clearInterval(sTimer);sCur=null;const k=$('sDeck').value,rec=serieRec(k);
 $('sBoard').innerHTML='';$('sTitle').textContent=rec.ids?'Série en cours : les mêmes positions, plus vite':'Nouvelle série';
 $('sTimer').textContent='';$('sGo').hidden=false;
 sFeedback('','Clique sur « Démarrer » : le chronomètre part à la première position.');serieHistory(rec)}
function serieHistory(rec){$('sHist').innerHTML=rec.h?.length?'<ol class="insights">'+rec.h.map(([t,ok,s],i)=>`<li>Essai ${i+1} (${new Date(t).toLocaleDateString('fr-FR')}) : <b>${ok}/${rec.ids.length}</b> en ${fmtTime(s)}</li>`).join('')+'</ol>':''}
function sFeedback(cls,html){$('sFeedback').className='feedback '+cls;$('sFeedback').innerHTML=html}
function serieStart(fresh){const k=$('sDeck').value,cards=serieCards(k,fresh);
 sCur={k,cards,i:0,ok:0,t0:Date.now(),G:null,sel:null,last:null,locked:false};$('sGo').hidden=true;
 clearInterval(sTimer);sTimer=setInterval(()=>{if(sCur)$('sTimer').textContent=`${sCur.i+1}/${sCur.cards.length} · ${fmtTime((Date.now()-sCur.t0)/1000)} · ${sCur.ok} réussie${sCur.ok>1?'s':''}`},500);
 serieShow()}
function serieShow(){const c=sCur,m=c.cards[c.i];c.G=new Chess(m.fen);c.orient=c.G.turn();c.sel=null;c.last=null;c.locked=false;
 c.best=new Chess(m.fen).move(m.best,{sloppy:true});
 $('sTitle').textContent=`Les ${c.G.turn()==='w'?'Blancs':'Noirs'} jouent`;sFeedback('','Trouve le meilleur coup.');serieDraw()}
function serieDraw(){const c=sCur,targets=c.sel&&!c.locked?c.G.moves({square:c.sel,verbose:true}):[];
 $('sBoard').innerHTML=boardHTML(c.G,c.orient==='b',{last:c.last,sel:c.sel,targets})}
function serieAnswer(mv){const c=sCur,m=c.cards[c.i],ok=c.best&&mv.from===c.best.from&&mv.to===c.best.to||(m.alts||[]).some(a=>bare(a)===bare(mv.san));
 c.locked=true;c.last=[mv.from,mv.to];
 if(ok){c.ok++;sFeedback('ok','<b>Oui !</b>')}
 else{c.G.undo();if(c.best){c.G.move(c.best.san);c.last=[c.best.from,c.best.to]}sFeedback('ko',`Non : c'était <b>${esc(m.best)}</b>.`)}
 serieDraw();
 setTimeout(()=>{if(sCur!==c)return;c.i++;if(c.i<c.cards.length)return serieShow();serieEnd()},ok?450:SERIE_PAUSE)}
function serieEnd(){const c=sCur,secs=(Date.now()-c.t0)/1000,rec=serieRec(c.k),prev=rec.h?.slice(-1)[0];clearInterval(sTimer);
 rec.h=[...(rec.h||[]),[Date.now(),c.ok,Math.round(secs)]];rec.t=Date.now();
 const all=c.ok===c.cards.length;if(all)delete rec.ids;   // série réussie en entier : la prochaine sera nouvelle
 srs['serie:'+c.k]=all?{h:[],t:rec.t}:rec;saveSrs();
 $('sTimer').textContent='';$('sGo').hidden=false;
 sFeedback(all?'ok':'',`<b>${c.ok}/${c.cards.length}</b> en ${fmtTime(secs)}${prev?` (essai précédent : ${prev[1]}/${c.cards.length} en ${fmtTime(prev[2])})`:''}. `
  +(all?'Série réussie : la prochaine sera faite de nouvelles positions.':'Refais la même série : le but est de tout trouver, de plus en plus vite.'));
 serieHistory(all?{h:[]}:rec);sCur=null}
$('sBoard').addEventListener('click',e=>{const el=e.target.closest('.sq'),c=sCur;if(!el||!c||c.locked)return;
 const sq=el.dataset.sq,G=c.G;
 if(c.sel&&G.moves({square:c.sel,verbose:true}).some(x=>x.to===sq)){const mv=G.move({from:c.sel,to:sq,promotion:c.best&&c.best.from===c.sel&&c.best.to===sq&&c.best.promotion||'q'});c.sel=null;return serieAnswer(mv)}
 const p=G.get(sq);c.sel=p&&p.color===G.turn()&&c.sel!==sq?sq:null;serieDraw()});
$('sGo').onclick=()=>serieStart(false);
$('sNew').onclick=()=>{const k=$('sDeck').value;srs['serie:'+k]={h:[],t:Date.now()};saveSrs();serieIdle()};
$('sDeck').addEventListener('change',serieIdle);
MODE_OPEN.serie=()=>{if(!sCur)renderSerie()};   // une série en cours continue quand on revient
