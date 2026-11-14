/* ---------- finales de référence ---------- */
// Positions théoriques à connaître, jouées contre le Stockfish du navigateur. Ordre : d'abord les types de finale où tu
// perds le plus de points par rapport à tes chances en y entrant (sf.finale de tes parties). Résultats dans srs « fr:<clé> ».
// fin : ce qui compte comme réussi — 'mat', 'dame' (un pion promu et gardé), 'pion' (l'adversaire n'a plus que son roi),
// 'nulle' (tenir max coups sans mat ni dame adverse gardée). Positions vérifiées avec Stockfish.
const REF_ENDGAMES=[
 {k:'mat_dame',t:'dames',nom:tx('Mat avec la dame'),fen:'8/8/8/4k3/8/8/8/3QK3 w - - 0 1',fin:'mat',max:25,
  conseil:tx('Place ta dame à un saut de cavalier du roi adverse et suis-le ainsi : sa zone rétrécit à chaque coup. Une fois le roi sur le bord, amène ton roi, puis mate. Attention au pat : laisse-lui toujours une case tant que le mat n\'est pas prêt.')},
 {k:'mat_tour',t:'tours',nom:tx('Mat avec la tour'),fen:'8/8/8/4k3/8/8/8/R3K3 w - - 0 1',fin:'mat',max:45,
  conseil:tx('La tour enferme le roi adverse derrière une rangée ou une colonne. Ton roi vient face au sien (opposition) et la tour donne échec : il recule d\'une ligne. Si les rois ne sont pas face à face, joue un coup d\'attente de la tour, loin du roi adverse.')},
 {k:'roi_devant',t:'pions',nom:tx('Le roi devant son pion'),fen:'8/8/4k3/8/8/4K3/4P3/8 w - - 0 1',fin:'dame',max:30,
  conseil:tx('Ne pousse pas le pion tout de suite : avance d\'abord ton roi devant lui, le plus loin possible. Roi en 6e rangée devant son pion, c\'est gagné. Garde les coups de pion en réserve pour reprendre l\'opposition au bon moment.')},
 {k:'opposition',t:'pions',nom:tx('Défendre par l\'opposition'),fen:'4k3/8/8/4P3/4K3/8/8/8 b - - 0 1',fin:'nulle',max:20,
  conseil:tx('Reste devant le pion. Quand le roi blanc s\'approche, place ton roi face à lui, une case entre les deux (l\'opposition). Recule toujours tout droit vers la case de promotion, pas sur le côté : tu pourras reprendre l\'opposition, et la poussée finale donnera pat.')},
 {k:'percee',t:'pions',nom:tx('La percée'),fen:'7k/ppp5/8/PPP5/8/8/8/7K w - - 0 1',fin:'dame',max:15,
  conseil:tx('Trois pions contre trois, rois loin : sacrifie le pion du milieu. b6 ! Si axb6, c6 ! ; si cxb6, a6 ! Un pion passe et va à dame avant que le roi noir n\'arrive.')},
 {k:'lucena',t:'tours',nom:tx('Position de Lucena : faire le pont'),fen:'1K6/1P1k4/8/8/8/8/r7/2R5 w - - 0 1',fin:'dame',max:30,
  conseil:tx('Ton roi est enfermé devant son pion. D\'abord un échec pour éloigner encore le roi noir (Td1+), puis la tour en 4e rangée (Td4) : quand ton roi sortira, elle s\'interposera contre les échecs de la tour noire. C\'est le « pont ».')},
 {k:'philidor',t:'tours',nom:tx('Défense de Philidor'),fen:'4k3/8/r7/4PK2/8/8/8/1R6 b - - 0 1',fin:'nulle',max:25,
  conseil:tx('Garde ta tour sur ta 3e rangée (ici la 6e) tant que le pion n\'y est pas : le roi blanc ne peut pas avancer. Dès que le pion arrive sur cette rangée, ta tour descend tout en bas et donne des échecs par derrière : le roi blanc n\'a plus d\'abri.')},
 {k:'dame_pion',t:'dames',nom:tx('Dame contre pion en 7e'),fen:'8/8/8/8/8/8/K2pk3/7Q w - - 0 1',fin:'pion',max:40,
  conseil:tx('Rapproche ta dame par des échecs et des clouages jusqu\'à forcer le roi adverse devant son pion (en d1) : il bloque sa propre promotion, et tu gagnes un temps pour rapprocher ton roi. Recommence jusqu\'à prendre le pion.')},
 {k:'fou_mauvais',t:'mineures',nom:tx('Fou de la mauvaise couleur'),fen:'7k/8/5K2/7P/8/8/4B3/8 b - - 0 1',fin:'nulle',max:20,
  conseil:tx('Pion de tour, et le fou blanc ne contrôle pas la case de promotion (h8 est noire) : il suffit que ton roi tienne le coin. Fais la navette entre h8, g8 et h7 sans t\'éloigner : le pion ne pourra jamais aller à dame.')}];
const FR_MS=1000;
// état d'une finale en fin de libellé de la liste
const FR_OK=()=>' · '+tx('✓ réussie'),FR_RETRY=()=>' · '+tx('à retenter');
let fCur=null;

// Écart par partie entre ton score et tes chances en entrant dans chaque type de finale (négatif : tu perds des points)
function endgameGaps(){const by={};
 D.games.forEach(g=>{const f=g.sf?.finale;if(!f)return;const o=by[f.type]??={n:0,s:0,e:0};o.n++;o.s+=g.resultat==='Victoire'?1:g.resultat==='Nulle'?.5:0;o.e+=f.w/100});
 return Object.fromEntries(Object.entries(by).filter(([,o])=>o.n>=3).map(([t,o])=>[t,(o.s-o.e)/o.n]))}
function renderFinales(){const gap=endgameGaps(),order=[...REF_ENDGAMES].sort((a,b)=>(gap[a.t]??0)-(gap[b.t]??0));
 const worst=Object.entries(gap).sort((a,b)=>a[1]-b[1])[0],sel=$('fSel'),prev=sel.value;
 sel.innerHTML=order.map(r=>{const rec=srs['fr:'+r.k];
  return `<option value="${r.k}">${esc(r.nom)} · ${FINALES[r.t]}${worst&&worst[1]<0&&worst[0]===r.t?' · '+tx('ton point faible'):''}${rec?.ok?FR_OK():rec?.n?FR_RETRY():''}</option>`}).join('');
 $('fSub').textContent=worst&&worst[1]<0?tx('Dans tes parties, c\'est dans les « {type} » que tu perds le plus de points par rapport à tes chances en y entrant : ces positions sont en tête.',{type:FINALES[worst[0]].toLowerCase()}):'';
 sel.value=prev&&REF_ENDGAMES.some(r=>r.k===prev)?prev:order[0].k;frStart(sel.value)}
function frStart(k){const r=REF_ENDGAMES.find(x=>x.k===k),G=new Chess(r.fen);
 fCur={r,G,me:G.turn(),moves:0,over:false,sel:null,last:null,busy:false,hint:false,help:false,eh:null};
 $('fTitle').textContent=r.nom;
 $('fGoal').innerHTML=(fCur.me==='w'?tx('Tu joues les Blancs.'):tx('Tu joues les Noirs.'))+' '+(r.fin==='nulle'?tx('<b>Tiens la nulle</b> pendant {n} coups contre Stockfish.',{n:r.max}):r.fin==='mat'?tx('<b>Mate</b> en moins de {n} coups.',{n:r.max})
  :r.fin==='pion'?tx('<b>Gagne le pion</b> en moins de {n} coups.',{n:r.max}):tx('<b>Va à dame</b> (et garde-la) en moins de {n} coups.',{n:r.max}));
 $('fLinks').innerHTML=`<a href="${lichess(r.fen,fCur.me==='w'?'Blancs':'Noirs')}" target="_blank" rel="noopener">${tx('Analyse')}</a>`;
 frFeedback('',tx('À toi de jouer.'));frDraw()}
function frFeedback(cls,html){$('fFeedback').className='feedback '+cls;$('fFeedback').innerHTML=html}
function frDraw(){const c=fCur,G=c.G,mine=!c.over&&!c.busy&&G.turn()===c.me;
 const eh=c.eh?.to&&c.eh.fen===G.fen()?[c.eh.from,c.eh.to]:null;
 $('fBoard').innerHTML=boardHTML(G,c.me==='b',{last:c.last,sel:c.sel,arrow:eh,targets:mine&&c.sel?G.moves({square:c.sel,verbose:true}):[]});
 // le conseil d'abord ; ensuite, le même bouton demande le meilleur coup à Stockfish
 $('fHint').textContent=c.hint?tx('Meilleur coup'):tx('Conseil');$('fHint').disabled=c.hint&&(!mine||c.eh?.fen===G.fen());$('fConseil').hidden=!c.hint;$('fConseil').textContent=c.r.conseil}
// 'ok' réussi, 'ko' raté, null : on continue
function frStatus(){const c=fCur,G=c.G,r=c.r,op=OTHER[c.me],pieces=col=>boardOf(G).filter(p=>p&&p.color===col&&p.type!=='k');
 if(G.in_checkmate())return G.turn()===op?'ok':'ko';
 if(G.in_draw()||G.in_stalemate()||G.in_threefold_repetition())return r.fin==='nulle'?'ok':'ko';
 if(r.fin==='nulle'){if(G.turn()===op&&pieces(op).some(p=>p.type==='q'))return 'ko';return c.moves>=r.max?'ok':null}
 if(!pieces(c.me).length)return 'ko';
 if(r.fin==='dame'&&G.turn()===c.me&&pieces(c.me).some(p=>p.type==='q'))return 'ok';   // promue, et gardée après la réponse
 if(r.fin==='pion'&&!pieces(op).length)return 'ok';
 return c.moves>=r.max&&G.turn()===c.me?'ko':null}
function frEnd(st){const c=fCur,rec=srs['fr:'+c.r.k]||{n:0,ok:0};c.over=true;
 rec.n++;if(st==='ok'&&!c.help)rec.ok++;   // réussie avec les coups de Stockfish : pas validée
 rec.t=Date.now();srs['fr:'+c.r.k]=rec;saveSrs();if(st==='ok'&&!c.help)logAct('fin');
 const why=c.G.in_checkmate()?tx('Échec et mat.'):c.G.in_stalemate()?tx('Pat.'):c.G.in_draw()||c.G.in_threefold_repetition()?tx('Partie nulle.'):'';
 frFeedback(st==='ok'?'ok':'ko',st==='ok'?(c.help?tx('<b>Réussi avec l\'aide de Stockfish.</b> {why} Recommence sans son aide pour la valider.',{why}):tx('<b>Réussi !</b> {why} {bravo}',{why,bravo:c.hint?'':tx('Sans le conseil, bravo.')}))
  :tx('<b>Raté.</b> {why} Lis le conseil et recommence : cette finale doit devenir un automatisme.',{why}));
 // état en fin de libellé, remplacé (comparé au texte traduit, pas au français)
 const o=[...$('fSel').options].find(o=>o.value===c.r.k);
 if(o){let s=o.text;[FR_OK(),FR_RETRY()].forEach(x=>{if(s.endsWith(x))s=s.slice(0,-x.length)});o.text=s+(rec.ok?FR_OK():FR_RETRY())}frDraw()}
function frReply(){const c=fCur;let st=frStatus();if(st)return frEnd(st);
 c.busy=true;frFeedback('',tx('Stockfish réfléchit…'));frDraw();
 Engine.move(c.G.fen(),FR_MS).then(r=>{if(fCur!==c)return;c.busy=false;const mv=c.G.move({from:r.from,to:r.to,promotion:r.promotion||'q'});c.last=[mv.from,mv.to];
  st=frStatus();if(st)return frEnd(st);
  frFeedback('',c.r.max?tx('Coup {n} sur {m}. À toi.',{n:c.moves,m:c.r.max}):tx('Coup {n}. À toi.',{n:c.moves}));frDraw()})
 .catch(()=>{if(fCur!==c)return;c.busy=false;c.over=true;frFeedback('ko',tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).'));frDraw()})}
$('fBoard').addEventListener('click',e=>{const el=e.target.closest('.sq'),c=fCur;if(!el||!c||c.over||c.busy||c.G.turn()!==c.me)return;
 const sq=el.dataset.sq,G=c.G;
 if(c.sel&&G.moves({square:c.sel,verbose:true}).some(x=>x.to===sq)){const mv=G.move({from:c.sel,to:sq,promotion:'q'});c.sel=null;c.last=[mv.from,mv.to];c.moves++;return frReply()}
 const p=G.get(sq);c.sel=p&&p.color===G.turn()&&c.sel!==sq?sq:null;frDraw()});
$('fSel').addEventListener('change',e=>frStart(e.target.value));
$('fRestart').onclick=()=>{if(fCur)frStart(fCur.r.k)};
$('fHint').onclick=()=>{const c=fCur;if(!c)return;
 if(!c.hint){c.hint=true;return frDraw()}
 if(c.over||c.busy||c.G.turn()!==c.me||c.eh?.fen===c.G.fen())return;
 const fen=c.G.fen();c.eh={fen};c.help=true;frFeedback('',tx('Stockfish cherche le meilleur coup…'));frDraw();
 engineHint(fen).then(h=>{if(fCur!==c||c.G.fen()!==fen)return;c.eh=h&&{fen,...h};frFeedback('',h?h.text:tx('Aucun coup possible.'));frDraw()})
 .catch(()=>{if(fCur!==c)return;c.eh=null;frFeedback('ko',tx('Stockfish n\'a pas pu démarrer (connexion internet nécessaire).'));frDraw()})};
MODE_OPEN.finales=()=>{if(!fCur)renderFinales()};
