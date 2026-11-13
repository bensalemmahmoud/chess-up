// Scénarios du dashboard dans Edge ou Chrome sans fenêtre, pilotés par le protocole DevTools (Node 22+ : WebSocket intégré).
// Usage : node tests/navigateur.mjs <page.html> <navigateur>   (lancé par tests/test_dashboard.py)
// Chaque scénario est exécuté dans la page ; il échoue s'il lève une erreur. Toute exception JS de la page fait aussi
// échouer l'ensemble. SANS_MOTEUR=1 saute les scénarios qui chargent Stockfish depuis le CDN ; CAPTURES=<dossier>
// y enregistre une capture d'écran après chaque scénario.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [html, exe] = process.argv.slice(2);
const MOTEUR = !process.env.SANS_MOTEUR;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(f, ms, what) {
  const t0 = Date.now();
  for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('attente dépassée : ' + what); await sleep(100); }
}

// Connexion DevTools : requêtes numérotées, événements par méthode
function cdp(url) {
  const ws = new WebSocket(url), pending = new Map(), handlers = [];
  let id = 0;
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const {res, rej} = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else handlers.forEach(h => h(m));
  };
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return {open, on: h => handlers.push(h), close: () => ws.close(),
    send: (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, {res, rej}); ws.send(JSON.stringify({id: n, method, params})); })};
}

// Aides injectées dans la page
const HELPERS = `window.__t={
 wait:(f,ms=5000,what='condition')=>new Promise((res,rej)=>{const t0=Date.now();(function loop(){let v;try{v=f()}catch(e){}
  if(v)return res(v);if(Date.now()-t0>ms)return rej(new Error('attente dépassée : '+what));setTimeout(loop,100)})()}),
 sq:(board,s)=>{const el=document.querySelector('#'+board+' [data-sq="'+s+'"]');if(!el)throw new Error('case introuvable : '+s);el.click()},
 move:(board,from,to)=>{__t.sq(board,from);__t.sq(board,to)},
 ok:(c,msg)=>{if(!c)throw new Error(msg)},
 text:id=>document.getElementById(id).textContent};`;

const SCENARIOS = [
  ['tous les onglets s\'affichent', false, `
    const tabs=[...document.querySelectorAll('.tab')].map(t=>t.dataset.tab);__t.ok(tabs.length>3,'onglets introuvables');
    for(const t of tabs){showTab(t);await new Promise(r=>setTimeout(r,80))}
    return tabs.length+' onglets'`],
  ['entraînement : indice en deux temps, puis le coup', false, `
    showTab('entrainement');setMode('coup');await __t.wait(()=>cur,3000,'position');
    const c=cur,b=c.best;__t.ok($('tHint').textContent==='Indice'&&!$('tHint').disabled,'bouton Indice');
    $('tHint').click();__t.ok(document.querySelector('#board .sq.hint')?.dataset.sq===b.from,'case de la pièce surlignée');
    __t.ok(!document.querySelector('#board svg.arrow'),'pas encore de flèche');__t.ok($('tHint').textContent==='Montrer le coup','second indice');
    $('tHint').click();__t.ok(document.querySelector('#board svg.arrow'),'flèche du coup');__t.ok($('tHint').disabled,'plus d\\'indice');
    __t.move('board',b.from,b.to);__t.ok(c.done&&/avec l'indice/.test(__t.text('tFeedback')),'coup validé avec l\\'indice : '+__t.text('tFeedback'));
    __t.ok((srs[cardId(c.m)]||{}).b===0,'la boîte ne monte pas');
    __t.ok(!$('tLevelBox').hidden&&$('tLevel').value==='obj','choix du niveau, objectif par défaut');
    return b.san`],
  ['entraînement : meilleur coup de Stockfish une fois l\'exercice fini', true, `
    const c=cur;__t.ok(c.done&&!$('tHint').disabled,'indice disponible');$('tHint').click();
    await __t.wait(()=>/Stockfish joue/.test(__t.text('tFeedback')),120000,'indice de Stockfish');
    __t.ok(document.querySelector('#board svg.arrow'),'flèche');__t.ok($('tHint').disabled,'un seul indice par position');
    __t.ok(Engine.version===17,'Stockfish 17 chargé (version : '+Engine.version+')');
    return __t.text('tFeedback')`],
  ['partie contre Stockfish au niveau de l\'objectif, avec barre d\'évaluation et indice', true, `
    const c=cur;$('tPlay').click();__t.ok(c.pv&&!$('tEval').hidden,'barre d\\'évaluation affichée');
    await __t.wait(()=>c.game.turn()===c.color&&!c.locked,60000,'réponse de Stockfish');
    __t.ok(c.pv.win!=null&&/\\d+ %/.test($('tEval').textContent),'chances de gain : '+$('tEval').textContent);
    __t.ok($('tEval').firstElementChild.style.width===Math.round(c.pv.win)+'%','barre remplie à '+Math.round(c.pv.win)+' %');
    $('tHint').click();await __t.wait(()=>c.eh?.to,60000,'indice pendant la partie');
    const n=c.game.history().length;__t.move('board',c.eh.from,c.eh.to);__t.ok(c.game.history().length===n+1,'coup de l\\'indice joué');
    await __t.wait(()=>c.game.turn()===c.color&&!c.locked||c.pv.over,60000,'deuxième réponse');
    return $('tEval').textContent+' · '+__t.text('tFeedback').slice(0,60)`],
  ['étude : indice puis coup montré, note plafonnée', false, `
    setMode('etude');await __t.wait(()=>eCur,3000,'position d\\'étude');
    document.querySelector('#eBody [data-ev]').click();if(eCur.step==='why')document.querySelector('#eBody [data-why]').click();
    $('eValidate').click();__t.ok(eCur.result,'énoncés validés');startMove();   // la menace (Stockfish) est sautée
    __t.ok($('eHint')?.textContent==='Indice','bouton Indice');$('eHint').click();
    __t.ok(document.querySelector('#eBoard .sq.hint')?.dataset.sq===eCur.bestMv.from,'pièce surlignée');
    $('eHint').click();__t.ok(document.querySelector('#eBoard svg.arrow')&&!$('eHint'),'flèche, plus d\\'indice');
    const b=eCur.bestMv;__t.move('eBoard',b.from,b.to);
    __t.ok(eCur.move?.grade===0,'note plafonnée à 0 avec le coup montré');return b.san`],
  ['deviner le coup : indice de la pièce', false, `
    setMode('devine');await __t.wait(()=>dCur,3000,'partie à deviner');const c=dCur,from=c.moves[c.ply].slice(0,2);
    __t.ok(!$('dHint').hidden&&!$('dHint').disabled,'bouton Indice');$('dHint').click();
    __t.ok(document.querySelector('#dBoard .sq.hint')?.dataset.sq===from&&$('dHint').disabled,'pièce du joueur fort surlignée');
    const u=c.moves[c.ply];__t.move('dBoard',u.slice(0,2),u.slice(2,4));
    __t.ok(c.shown&&c.r.f===0&&c.r.n===1,'trouvé avec l\\'indice : pas compté comme trouvé');return u`],
  ['finales : conseil, puis meilleur coup de Stockfish', true, `
    setMode('finales');await __t.wait(()=>fCur,3000,'finale');__t.ok($('fHint').textContent==='Conseil','bouton Conseil');
    $('fHint').click();__t.ok(!$('fConseil').hidden&&$('fHint').textContent==='Meilleur coup','conseil affiché');
    $('fHint').click();await __t.wait(()=>document.querySelector('#fBoard svg.arrow'),60000,'flèche de Stockfish');
    __t.ok(fCur.help,'aide notée');return __t.text('fFeedback')`],
];

const profile = mkdtempSync(join(tmpdir(), 'chess-up-'));
const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--window-size=1280,1000',
  ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], {stdio: 'ignore'});   // runners Ubuntu 24.04 : le bac à sable de Chrome n'y démarre pas
let failed = 0, browser = null;
try {
  const port = await until(() => { const f = join(profile, 'DevToolsActivePort'); return existsSync(f) && readFileSync(f, 'utf8').split('\n')[0]; }, 30000, 'démarrage du navigateur');
  const base = `http://127.0.0.1:${port}`;
  browser = cdp((await (await fetch(base + '/json/version')).json()).webSocketDebuggerUrl);
  await browser.open;
  const target = await until(async () => (await (await fetch(base + '/json/list')).json()).find(t => t.type === 'page'), 10000, 'onglet');
  const page = cdp(target.webSocketDebuggerUrl);
  await page.open;
  const errors = [];
  let loaded = false;
  page.on(m => {
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.loadEventFired') loaded = true;
  });
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  const [w, h] = (process.env.TAILLE || '1280x1000').split('x').map(Number);   // TAILLE=390x844 : téléphone
  await page.send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: w < 600});
  await page.send('Page.navigate', {url: pathToFileURL(html).href});
  await until(() => loaded, 60000, 'chargement de la page');
  const run = async body => {
    const r = await page.send('Runtime.evaluate', {expression: `(async()=>{${body}})()`, awaitPromise: true, returnByValue: true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await run(HELPERS + `await __t.wait(()=>typeof Chess!=='undefined',30000,'chess.js (CDN)')`);
  for (const [name, engine, body] of SCENARIOS) {
    if (engine && !MOTEUR) { console.log(`- ${name} : sauté (SANS_MOTEUR)`); continue; }
    const t0 = Date.now();
    try { const v = await run(body); console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${v != null ? ' · ' + v : ''}`); }
    catch (e) { failed++; console.log(`✗ ${name} : ${e.message.split('\n')[0]}`); }
    const wide = await run(`const d=document.documentElement;return d.scrollWidth>d.clientWidth+1?d.scrollWidth+' px pour '+d.clientWidth:null`);
    if (wide) { failed++; console.log(`✗ ${name} : la page défile horizontalement (${wide})`); }
    if (process.env.CAPTURES) {   // capture d'écran après chaque scénario, pour vérifier le rendu à l'œil
      await page.send('Page.bringToFront');   // sans fenêtre, un onglet jamais « montré » ne produit pas d'image
      await run(`[...document.querySelectorAll('.board')].find(b=>b.offsetParent)?.scrollIntoView({block:'center'})`);
      const shot = await Promise.race([page.send('Page.captureScreenshot', {format: 'png'}), sleep(10000).then(() => null)]);
      if (!shot) { console.log('  (capture d\'écran impossible)'); continue; }
      const {data} = shot;
      writeFileSync(join(process.env.CAPTURES, `${SCENARIOS.findIndex(s => s[0] === name) + 1}.png`), Buffer.from(data, 'base64'));
    }
  }
  if (errors.length) { failed++; console.log('✗ exceptions dans la page :\n  ' + errors.join('\n  ')); }
} catch (e) {
  failed++; console.log('✗ ' + e.message);
} finally {
  try { if (browser) await Promise.race([browser.send('Browser.close'), sleep(3000)]); } catch (e) { /* déjà fermé */ }
  await Promise.race([new Promise(r => proc.once('exit', r)), sleep(5000)]);
  if (proc.exitCode === null) proc.kill();
  try { rmSync(profile, {recursive: true, force: true}); } catch (e) { /* fichiers encore verrouillés sous Windows */ }
}
console.log(failed ? `${failed} échec(s)` : 'tous les scénarios passent');
process.exit(failed ? 1 : 0);
