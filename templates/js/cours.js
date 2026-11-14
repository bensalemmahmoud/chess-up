/* ---------- cours par structure de pions ---------- */
// Une structure de pions décide des plans : on la reconnaît (chess_structures.py), on sait ce qu'il faut y faire.
// Pour chaque structure : le plan (texte ci-dessous, par rôle), le plan en action chez les maîtres (D.cours.stats :
// coups-clés de ce plan, chess_structures.PLAN_MOVES, dans leurs parties lentes gagnées), tes chiffres dans cette structure (r.sf.st), tes erreurs à
// rejouer (thème « Structure : … » du mode « Trouver le coup »), des parties de maîtres à rejouer dans « Deviner le
// coup » (D.parties avec st) et des vidéos (D.cours.videos). Repère normalisé : le camp qui possède la structure joue
// les Blancs (structure symétrique : le camp au trait) ; l'échiquier est retourné quand tu joues contre.
// Rôles : a = tu possèdes la structure, c = tu joues contre, s = structure symétrique.
const COURS={
 pions_pendants:{nom:tx('Pions pendants (c4-d4)'),a:tx('Tu as les pions pendants'),c:tx('Tu joues contre les pions pendants'),
  idee:tx('Deux pions côte à côte en c4 et d4, sans pion voisin en b ni en e, sur deux colonnes semi-ouvertes pour l\'adversaire. Forts tant qu\'ils restent côte à côte et que les pièces sont nombreuses, faibles s\'ils sont forcés d\'avancer ou en finale.'),
  plan:{a:[tx('Garde-les côte à côte : ensemble, ils tiennent b5, c5, d5 et e5 et te donnent de l\'espace.'),tx('Tours derrière eux (Tc1, Td1), dame en e2 ou b3, fou de cases blanches vers le roque adverse.'),tx('Prépare la poussée d4-d5 (ou c4-c5) pour le moment où elle ouvre des lignes vers le roi ou libère tes pièces : pas avant, elle laisserait une case à l\'adversaire.'),tx('Évite les échanges de pièces : en finale, les deux pions deviennent des cibles.')],
   c:[tx('Ton but : les forcer à avancer. Un pion poussé laisse derrière lui une case pour tes pièces (c5 ou d5) et devient isolé ou bloqué.'),tx('Pression frontale : tours en c8 et d8, fou en b7 ou f6 sur d4, cavalier qui attaque c4 (depuis a5 ou e5).'),tx('Attaque-les par les côtés avec …b5 ou …e5 quand c\'est possible.'),tx('Échange des pièces : chaque échange rapproche la finale, où les pions pendants sont faibles.')]}},
 pion_isole:{nom:tx('Pion dame isolé'),a:tx('Tu as le pion isolé'),c:tx('Tu joues contre le pion isolé'),
  idee:tx('Un pion en d4 sans pion voisin en c ni en e. Il donne de l\'espace et des cases (e5, c5) pour tes pièces, mais il ne peut plus être protégé par un pion : en finale, c\'est une faiblesse. Le combat est « activité contre structure ».'),
  plan:{a:[tx('Joue pour l\'activité et l\'attaque, tant que les pièces sont là : cavalier en e5 (le plan typique), fou en d3 ou b1 et dame en c2 ou d3 vers h7.'),tx('Tour en e1, parfois levée de tour Te3-g3 ou h3 vers le roi.'),tx('La poussée d4-d5 au bon moment ouvre le jeu et échange ton pion faible contre de l\'activité : prépare-la (Td1, pièces centralisées).'),tx('Évite les échanges, surtout de pièces mineures : chaque échange rapproche la finale où le pion tombe.')],
   c:[tx('D\'abord bloquer : un cavalier en d5, devant le pion, est la pièce idéale (aucun pion ne peut le chasser) et coupe ses poussées.'),tx('Échange les pièces actives de l\'adversaire, surtout son fou de cases blanches qui vise ton roi.'),tx('Puis attaquer le pion : tours sur la colonne d, cavaliers en c6 et f5, fou en f6 ou b6 contre d4.'),tx('Chaque finale est bonne pour toi : n\'aie pas peur de simplifier.')]}},
 carlsbad:{nom:tx('Structure de Carlsbad'),a:tx('Tu as l\'attaque de minorité'),c:tx('Tu as le centre c6-d5'),
  idee:tx('Le camp « propriétaire » a d4 et e3, sans pion c ; l\'autre a c6 et d5, sans pion e (gambit dame refusé, variante d\'échange). Chacun a son aile : l\'attaque de minorité à l\'aile dame d\'un côté, le jeu à l\'aile roi et sur la colonne e de l\'autre.'),
  plan:{a:[tx('L\'attaque de minorité : poussée b4-b5 (soutenue par a4 et Tb1) pour échanger sur c6 et laisser à l\'adversaire un pion c faible, isolé ou arriéré, sur une colonne semi-ouverte.'),tx('Autre plan : f3 puis e3-e4 pour gagner le centre (cavalier en e2 plutôt qu\'en f3).'),tx('Cavalier vers e5 ou c5 une fois l\'aile dame ouverte ; tours sur les colonnes b et c.')],
   c:[tx('Ton jeu est à l\'aile roi et sur la colonne e : cavalier en e4, tour en e8 puis parfois e6-h6, fou en d6 vers h2.'),tx('Contre l\'attaque de minorité : …a5 pour la freiner, ou, quand b5 arrive, une reprise ou une poussée …c5 qui ne te laisse pas de pion c faible.'),tx('Garde ton fou de cases blanches actif (f5, g4) : c\'est le bon fou de cette structure.')]}},
 benoni:{nom:tx('Structure Benoni'),a:tx('Tu as le pion d5 (espace)'),c:tx('Tu as la majorité c5-d6'),
  idee:tx('Un camp a un pion en d5 et la majorité centrale ; l\'autre a c5 et d6, sans pion e, et la majorité à l\'aile dame. Positions déséquilibrées : chacun pousse sa majorité.'),
  plan:{a:[tx('Ta majorité centrale : prépare e4-e5 (avec f4 et Te1) pour ouvrir le jeu et créer un pion passé en d.'),tx('Freine …b5 par a4 : sans cette poussée, l\'adversaire manque de jeu.'),tx('Cavalier en c4 contre d6, le pion faible de l\'adversaire.')],
   c:[tx('Ta majorité à l\'aile dame : …a6, …Tb8 et …b5, puis parfois …c4, pour obtenir des pièces actives.'),tx('Le fou en g7 est ta meilleure pièce : garde la grande diagonale ouverte.'),tx('Surveille e5 : ne laisse jamais passer e4-e5 sans l\'avoir préparé ; un cavalier en e5 te convient.')]}},
 chaine_francaise:{nom:tx('Chaîne de pions française (d4-e5)'),a:tx('Tu as la chaîne avancée (e5)'),c:tx('Tu attaques la chaîne (d5-e6)'),
  idee:tx('Chaînes d4-e5 contre d5-e6 (française, Caro-Kann avance). La chaîne pointe vers l\'aile roi : le camp en e5 y a de l\'espace ; l\'autre attaque la base de la chaîne.'),
  plan:{a:[tx('Soutiens la chaîne : c3, Cf3, parfois f4. Si d4 tombe, e5 tombe ensuite.'),tx('Ton jeu est à l\'aile roi, du côté où pointe la chaîne : Fd3, Dg4, h4-h5, ou f4-f5.'),tx('Le fou de cases blanches adverse est enfermé derrière e6 : n\'échange pas ton bon fou contre lui.')],
   c:[tx('Attaque la base de la chaîne : …c5 contre d4, avec …Cc6, …Db6 et un cavalier en f5 qui visent tous d4.'),tx('Puis …f6 contre e5 : la colonne f s\'ouvre pour tes tours.'),tx('Ton fou de cases blanches est le mauvais fou de la structure : échange-le (…b6 et …Fa6) ou sors-le avant …e6.')]}},
 chaine_est_indienne:{nom:tx('Chaîne Est-indienne (d5-e4)'),a:tx('Tu as la chaîne d5-e4'),c:tx('Tu as la chaîne d6-e5'),
  idee:tx('Chaînes d5-e4 contre d6-e5 (Est-indienne fermée, vieille indienne). Chaque chaîne pointe vers une aile : on joue du côté où elle pointe. Course d\'attaques : un temps compte.'),
  plan:{a:[tx('Ta chaîne pointe vers l\'aile dame : c4-c5 (préparée par b4, Cd2, Tc1) pour ouvrir la colonne c et attaquer d6 et c7.'),tx('Si l\'adversaire joue …f5, f3 garde e4 solide ; ne laisse pas ses pions arriver à ton roi sans contre-jeu.'),tx('Échange son fou de cases noires si possible : c\'est son meilleur défenseur.')],
   c:[tx('Ta chaîne pointe vers l\'aile roi : …f5, puis …f4, …g5-g4 contre le roque adverse.'),tx('Cavaliers vers f6, g6, h4 ; tour en f7 pour la défense de c7 et la colonne f.'),tx('Ne perds pas de temps à l\'aile dame : la course se gagne d\'un temps.')]}},
 maroczy:{nom:tx('Étau de Maroczy'),a:tx('Tu as l\'étau (c4-e4)'),c:tx('Tu joues contre l\'étau (hérisson)'),
  idee:tx('Pions c4 et e4 sans pion d, contre d6 sans pion c (siciliennes, dragon accéléré, hérisson). L\'étau interdit les deux poussées libératrices de l\'adversaire, …b5 et …d5.'),
  plan:{a:[tx('Garde l\'étau : Fe3, Dd2, Tac1, Tfd1, parfois f3 ; tant que …b5 et …d5 sont impossibles, l\'adversaire manque d\'espace.'),tx('Un cavalier en d5 est très fort ; b3 et a4 contre …b5.'),tx('N\'ouvre pas le jeu trop tôt : ton avantage est l\'espace, il grandit avec le temps.')],
   c:[tx('Patience : structure hérisson (…a6, …b6, …e6, …Fb7) ou fou en g7, pièces sur les deux dernières rangées.'),tx('Échange des pièces (…Cxd4) pour libérer l\'espace.'),tx('Les ruptures …b5 et …d5 libèrent ta position : prépare-les et joue-les au moment où elles marchent tactiquement.')]}},
 sicilienne:{nom:tx('Sicilienne ouverte'),a:tx('Tu as e4 (colonne d)'),c:tx('Tu as la majorité centrale (colonne c)'),
  idee:tx('Après d4 et …cxd4 : e4 sans pion d, contre d6 (ou d7) sans pion c. Chacun a une colonne semi-ouverte (d contre c) ; l\'un a plus d\'espace, l\'autre une majorité centrale. Roques opposés fréquents.'),
  plan:{a:[tx('Contrôle d5 : Cc3-d5, Fg5 pour échanger le cavalier f6 qui défend d5, Fc4 ou Fb3.'),tx('Attaque à l\'aile roi selon les pièces : f4-f5, g4-g5 ; avec roques opposés, la vitesse décide.'),tx('Tour en d1 contre d6, souvent le pion faible.')],
   c:[tx('Ta colonne c : Tc8, cavalier vers c4, le sacrifice d\'échange …Txc3 est un thème classique.'),tx('La poussée …d5 libère ta position : quand elle est possible sans perte, tu as en général égalisé.'),tx('…b5-b4 chasse le cavalier c3 qui défend e4 et d5. Prudence avec …e5 : il laisse un trou en d5.')]}},
 stonewall:{nom:tx('Stonewall (d4-e3-f4)'),a:tx('Tu as le Stonewall'),c:tx('Tu joues contre le Stonewall'),
  idee:tx('Pions d4, e3 et f4 (souvent c3) : un mur qui tient e5 mais laisse un trou en e4. Le fou de cases noires est enfermé derrière les pions.'),
  plan:{a:[tx('Cavalier en e5, soutenu par d4 et f4 : c\'est le cœur du plan.'),tx('Attaque à l\'aile roi : Tf3-h3, Dh5 ou De1-h4, parfois g4-g5.'),tx('Ton fou de cases noires est mauvais : échange-le (b3 et Fa3) ou accepte de jouer sans lui ; garde le fou de cases blanches.')],
   c:[tx('La case e4 est un trou : un cavalier y est très fort.'),tx('Échange le cavalier e5 (…Cd7) et le fou de cases blanches adverse, son attaquant.'),tx('Ruptures …c5 contre d4 et …f6 contre le cavalier e5.')]}},
 londres:{nom:tx('Système de Londres (c3-d4-e3)'),a:tx('Tu as le triangle c3-d4-e3'),c:tx('Tu joues contre le triangle'),
  idee:tx('Pions c3, d4 et e3 contre un pion d5 (Londres, Colle, Slave). Structure très solide, mais passive si elle ne bouge pas : il faut une rupture.'),
  plan:{a:[tx('Sors ton fou de cases noires (Ff4 ou Fg5) avant e3 : ensuite il serait enfermé.'),tx('Plan d\'attaque : Ce5 et f4, puis l\'aile roi (Tf3, Dh5).'),tx('Ou rupture e3-e4 (préparée par Cbd2, Dc2, Fd3) pour ouvrir le centre au bon moment.')],
   c:[tx('…c5 et …Db6 contre b2, affaibli par la sortie du fou de cases noires.'),tx('…c4 pour gagner de l\'espace à l\'aile dame, puis …b5-b4.'),tx('Ou la rupture centrale …e5, préparée par …Cbd7 et …Dc7 : elle libère ton jeu.')]}},
 italienne:{nom:tx('Centre italien (e4-d3 contre e5-d6)'),
  idee:tx('Pions e4-d3 contre e5-d6 (partie italienne lente, espagnole fermée). Structure fermée et souple : les manœuvres comptent plus que la tactique, jusqu\'à la rupture.'),
  plan:{s:[tx('La manœuvre de cavalier Cb1-d2-f1-g3 (ou …Cb8-d7-f8-g6) l\'amène à l\'aile roi, vers f5 ou h5.'),tx('La poussée d3-d4, préparée par c3, Te1 et h3, gagne le centre : c\'est la rupture principale.'),tx('a4 gagne de l\'espace et freine …b5 ; h3 évite le clouage …Fg4.'),tx('Rupture d\'attaque : f2-f4 (ou …f5), une fois le cavalier parti de f3 (ou f6).')]}},
 colonne_d:{nom:tx('Colonne d ouverte (e4 contre e5)'),
  idee:tx('Pions e4 contre e5, plus de pions en d (écossaise, espagnole d\'échange, Philidor…). La colonne d est ouverte, les cases d5 et d4 sont des avant-postes.'),
  plan:{s:[tx('La colonne d : la première tour qui s\'y installe, soutenue, prend l\'initiative ; doubler les tours est fréquent.'),tx('Les cases d5 (pour les Blancs) et d4 (pour les Noirs) sont idéales pour un cavalier : c3 ou …c6 les enlève à l\'adversaire.'),tx('La poussée f4 (ou …f5) attaque le pion e de l\'adversaire.'),tx('Les dames s\'échangent souvent : pense déjà à la finale et à tes majorités de pions.')]}},
 colonne_e:{nom:tx('Colonne e ouverte (d4 contre d5)'),
  idee:tx('Pions d4 contre d5, plus de pions en e (française d\'échange, Petrov…). Position symétrique : celui qui crée la première faiblesse chez l\'autre prend l\'avantage.'),
  plan:{s:[tx('La colonne e est la lutte principale : Te1, Te8, souvent doublées ; la case e5 (ou e4) pour un cavalier.'),tx('Un fou contre un cavalier, un pion c avancé, un clouage en g5 : dans une position symétrique, ces petits plus décident.'),tx('Les ruptures c4 (ou …c5) transforment la structure en pion isolé : joue-les en sachant quelle structure tu obtiens.')]}},
 centre_ouvert:{nom:tx('Centre ouvert'),
  idee:tx('Plus aucun pion en d ni en e : les pièces dominent. Développement, paire de fous et colonnes ouvertes comptent plus que tout.'),
  plan:{s:[tx('Les tours sur les colonnes d et e ; la première qui contrôle une colonne ouverte, soutenue, prend l\'initiative.'),tx('Cavaliers au centre (d5, e5, d4, e4) quand aucun pion ne peut les chasser ; la paire de fous est un vrai atout.'),tx('Le roi ne doit pas rester au centre.'),tx('Quand les pièces s\'échangent, une majorité de pions à l\'aile dame, non bloquée, donne un pion passé.')]}}};
const STRUCT_MIN_COUPS=4;   // une partie compte dans une structure si tu y as joué au moins ce nombre de coups
let coKey=null,coRole=null;
const coName=k=>COURS[k]?.nom||k;
const coRoleName=(k,r)=>r==='s'?'':COURS[k]?.[r]||'';
let coEx=[],coExI=0;   // exemples du plan chez les maîtres pour le cours affiché, et celui montré sur l'échiquier
const coRes=v=>({Victoire:tx('Victoire'),Défaite:tx('Défaite'),Nulle:tx('Nulle')})[v]||v;   // résultat affiché (la donnée reste en français)

// Thèmes « Structure : … » du mode « Trouver le coup » : tes erreurs commises dans chaque structure
Object.keys(COURS).forEach(k=>{DECKS['st_'+k]=[tx('· Structure : {nom}',{nom:COURS[k].nom}),m=>!!m.st&&m.st.split(':')[0]===k]});

// Tes chiffres par structure et rôle, sur les parties filtrées : coups, erreurs, précision, parties, score
function coursAgg(G){const out={};let N=0,NE=0;
 G.forEach(g=>{const sf=g.sf;if(!sf?.st)return;N+=sf.phases.milieu.coups;NE+=sf.phases.milieu.err+sf.phases.milieu.gaf;
  Object.entries(sf.st).forEach(([kr,[n,err,acc]])=>{const o=out[kr]||(out[kr]={k:kr.split(':')[0],r:kr.split(':')[1],coups:0,err:0,acc:0,games:[]});
   o.coups+=n;o.err+=err;o.acc+=acc;
   if(n>=STRUCT_MIN_COUPS)o.games.push(g)})});
 const p0=N?NE/N:0;
 return {p0,rows:Object.values(out).filter(o=>COURS[o.k]&&o.games.length).map(o=>{const rate=o.coups?o.err/o.coups:0,se=Math.sqrt(Math.max(p0*(1-p0),1e-4)/Math.max(1,o.coups));
  return {...o,rate,sig:rate-p0>2*se?1:p0-rate>2*se?-1:0,sc:score(o.games),excess:(rate-p0)*o.coups}})}}

function renderCours(){const ok=typeof Chess!=='undefined'&&D.cours;
 $('coBlock').hidden=!ok;$('coMissing').hidden=!!ok;
 if(!ok){$('coMissing').textContent=typeof Chess==='undefined'?tx('L\'échiquier n\'a pas pu être chargé : il faut une connexion internet.'):tx('Les cours arrivent avec l\'analyse Stockfish (parties de grands maîtres des tournois retransmis sur Lichess).');return}
 const {p0,rows}=coursAgg(baseFilter(false));
 rows.sort((a,b)=>b.excess-a.excess||b.games.length-a.games.length);
 const st=D.cours.stats||{};
 $('coSub').textContent=rows.length?tx('Ton taux d\'erreurs en milieu de partie : {p} de tes coups. Dans chaque structure :',{p:fmt(100*p0)+PC})
  :tx('Aucune de tes parties analysées ne passe encore par une structure connue : choisis une structure dans la liste pour lire son cours.');
 $('coTable').innerHTML=rows.length?`<thead><tr><th>${tx('Structure')}</th><th class="num">${tx('Parties')}</th><th class="num">${tx('Score')}</th><th class="num">${tx('Erreurs')}</th><th class="num">${tx('Précision')}</th></tr></thead><tbody>`
  +rows.map((r,i)=>`<tr class="clickable" data-k="${r.k}" data-r="${r.r}"><td>${esc(coName(r.k))}${r.r!=='s'?`<br><span class="muted">${esc(coRoleName(r.k,r.r))}</span>`:''}${i===0&&r.sig>0?` <span class="pill">${tx('priorité')}</span>`:''}</td>`
   +`<td class="num">${r.games.length}</td><td class="num">${fmt(r.sc.s,0)}${PC}</td><td class="num ${r.sig>0?'loss':r.sig<0?'win':''}">${fmt(100*r.rate)}${PC}${r.sig?'':` <span class="muted">${tx('(hasard possible)')}</span>`}</td><td class="num">${fmt(r.acc/Math.max(1,r.coups),0)}${PC}</td></tr>`).join('')+'</tbody>'
  :`<tbody><tr><td class="empty">${tx('Pas encore de structure dans tes parties analysées.')}</td></tr></tbody>`;
 // liste de toutes les structures : d'abord les tiennes (dans l'ordre de priorité), puis les autres
 const sel=$('coSel'),keys=[...new Set([...rows.map(r=>r.k+':'+r.r),...Object.keys(COURS).flatMap(k=>COURS[k].plan.s?[k+':s']:[k+':a',k+':c'])])];
 sel.innerHTML=keys.map(kr=>{const [k,r]=kr.split(':');return `<option value="${kr}">${esc(coName(k))}${r!=='s'?' · '+esc(coRoleName(k,r).replace(/^Tu /,'tu ')):''}${st[k]?'':' '+tx('(pas de partie de maître)')}</option>`}).join('');
 const want=coKey?coKey+':'+coRole:keys[0];sel.value=keys.includes(want)?want:keys[0];showCours(sel.value,rows)}

function showCours(kr,rows){const [k,r]=kr.split(':');coKey=k;coRole=r;const c=COURS[k],st=(D.cours.stats||{})[k],role=st?.roles?.[r];
 rows=rows||coursAgg(baseFilter(false)).rows;const me=rows.find(x=>x.k===k&&x.r===r);
 $('coSel').value=kr;
 $('coTitle').textContent=c.nom;$('coRole').textContent=coRoleName(k,r);
 const plan=c.plan[r]||[];
 let h=`<p>${esc(c.idee)}</p><h3>${tx('Le plan')}</h3><ul class="insights">${plan.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
 // le plan en action : coups-clés de ce plan dans des parties de maîtres gagnées par le camp qui les joue
 coEx=role?.ex||[];coExI=0;
 if(coEx.length)h+=`<h3>${tx('Le plan en action chez les maîtres')}</h3><p class="muted">${tx('Des coups-clés de ce plan dans des parties lentes entre joueurs à 2400 Elo et plus, gagnées par le camp qui les joue. Clique pour voir la position, avec le coup en flèche.')}</p>`
  +`<div class="stmts" id="coExList">${coEx.map((x,i)=>`<button class="linkbtn" data-ex="${i}">▶ ${esc(x.nom)} · ${x.c==='w'?tx('les Blancs jouent {coup}',{coup:esc(x.san)}):tx('les Noirs jouent {coup}',{coup:esc(x.san)})}</button>`).join('')}</div>`;
 if(me)h+=`<h3>${tx('Toi dans cette structure')}</h3><p>${txn(me.games.length,'{n} partie, score {s}, {e} d\'erreurs (ta moyenne en milieu de partie : {m}).','{n} parties, score {s}, {e} d\'erreurs (ta moyenne en milieu de partie : {m}).',
   {s:fmt(me.sc.s,0)+PC,e:fmt(100*me.rate)+PC,m:fmt(100*coursAgg(baseFilter(false)).p0)+PC})}</p>`
  +`<ul class="insights">${me.games.slice(-5).reverse().map(g=>`<li><a href="${esc(g.lien)}" target="_blank" rel="noopener">${esc(g.date)} · ${esc(g.adversaire)} · ${esc(coRes(g.resultat))}</a></li>`).join('')}</ul>`;
 $('coBody').innerHTML=h;drawCoursBoard();
 // exercices : tes erreurs dans la structure, parties de maîtres à rejouer
 const nErr=deckCards('st_'+k).length,games=PARTIES.map((p,i)=>({p,i})).filter(x=>x.p.st===k);
 $('coTrain').hidden=!nErr;$('coTrain').textContent=tx('Rejouer mes erreurs dans cette structure ({n})',{n:nErr});
 $('coGames').innerHTML=games.length?games.map(x=>`<button class="linkbtn" data-dv="${x.i}">▶ ${esc(x.p.nom||tx('Partie de maître'))} · ${x.p.c==='w'?tx('du côté des Blancs'):tx('du côté des Noirs')}</button>`).join(' '):`<span class="muted">${tx('Pas encore de partie de maître analysée pour cette structure.')}</span>`;
 const vids=(D.cours.videos||{})[k]||[];
 $('coVideos').innerHTML=vids.length?'<ul class="insights">'+vids.map(v=>`<li><a href="https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}${v.t?'&t='+Math.floor(v.t)+'s':''}" target="_blank" rel="noopener">${esc(v.titre)}</a> <span class="muted">· ${esc(v.chaine)} · ${fmtVues(v.vues)}${v.t?' · '+tx('à partir de {t}',{t:fmtTemps(v.t)}):''}${v.langue?' · '+esc(v.langue):''}</span></li>`).join('')+'</ul>'
  :`<span class="muted">${tx('Pas encore de vidéo sélectionnée.')}</span> <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(tx('{nom} échecs plan',{nom:c.nom}))}" target="_blank" rel="noopener">${tx('Chercher sur YouTube')}</a>`}
// Échiquier du cours : l'exemple choisi (vraie partie, avant le coup-clé, le camp qui le joue en bas, coup en flèche),
// sinon une position de la structure (repère normalisé, retourné si tu joues contre)
function drawCoursBoard(){const x=coEx[coExI],G=new Chess();
 document.querySelectorAll('#coExList [data-ex]').forEach(b=>b.classList.toggle('active',+b.dataset.ex===coExI));
 if(x&&G.load(x.fen)){
  $('coBoard').innerHTML=boardHTML(G,x.c==='b',{arrow:[x.uci.slice(0,2),x.uci.slice(2,4)]});
  $('coBoardNote').innerHTML=tx('{nom} : position avant {coup}, joué par le camp en bas, qui a gagné la partie.',{nom:esc(x.nom),coup:`<b>${esc(x.san)}</b>`})
   +(x.u?` <a href="${esc(x.u)}" target="_blank" rel="noopener">${tx('Voir la partie')}</a>`:'');return}
 const st=(D.cours.stats||{})[coKey];if(!(st?.ex&&G.load(st.ex)))G.clear();
 $('coBoard').innerHTML=boardHTML(G,coRole==='c');
 $('coBoardNote').textContent=st?.ex?tx('Position d\'une partie de maître dans cette structure, {camp}.',
  {camp:coRole==='c'?tx('ton camp en bas (Noirs)'):coRole==='s'?tx('camp au trait en bas'):tx('ton camp en bas (Blancs)')}):''}
const fmtVues=n=>n>=1e6?tx('{n} M de vues',{n:fmt(n/1e6,1)}):n>=1e3?tx('{n} k vues',{n:fmt(n/1e3,0)}):tx('{n} vues',{n:n||0});
const fmtTemps=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;

$('coSel').addEventListener('change',e=>showCours(e.target.value));
$('coBody').addEventListener('click',e=>{const b=e.target.closest('[data-ex]');if(!b)return;coExI=+b.dataset.ex;drawCoursBoard();
 if(innerWidth<900)$('coBoard').scrollIntoView({behavior:'smooth',block:'center'})});   // sur téléphone, l'échiquier est au-dessus
$('coTable').addEventListener('click',e=>{const tr=e.target.closest('tr[data-k]');if(tr)showCours(tr.dataset.k+':'+tr.dataset.r)});
$('coTrain').onclick=()=>{deckChosen=true;setMode('coup');renderTraining(baseFilter(false));$('tDeck').value='st_'+coKey;buildQueue(false)};
$('coGames').addEventListener('click',e=>{const b=e.target.closest('[data-dv]');if(!b)return;const i=+b.dataset.dv;
 setMode('devine');if(!dCur||dCur.i!==i){$('dGame').value=String(i);dvStart(i)}});
['fCadence','fPeriod','fRated'].forEach(id=>$(id).addEventListener('change',()=>{if(coKey)renderCours()}));
MODE_OPEN.cours=()=>{if(!coKey)renderCours()};
