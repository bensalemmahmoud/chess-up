/* ---------- langue de l'interface ----------
   Le texte source est le français. templates/i18n/<langue>/*.json traduit chaque phrase française, réunis par le générateur
   dans I18N = {langue: {phrase française: traduction}}. Langue affichée : le choix du visiteur (localStorage), sinon celle
   imposée au rapport (--langue), sinon celle du navigateur (anglais si elle n'est pas disponible). Dans le code : tx('Phrase française') ou tx('{n} parties',{n}) — la clé est le littéral français,
   tests/test_i18n.py vérifie que chaque tx('…') littéral est traduit. Le texte fixe de dashboard.html est traduit ici au
   démarrage, nœud par nœud (texte, placeholder, title, aria-label). Changer de langue recharge la page. */
const I18N=__I18N__;
const LANGUES=['fr',...Object.keys(I18N)];
const LANG=(()=>{let l=null;try{l=localStorage.getItem('chess-up:langue')}catch(e){}if(LANGUES.includes(l))return l;
 if(LANGUES.includes(__LANGUE__))return __LANGUE__;
 for(const n of navigator.languages||[navigator.language]){const c=String(n||'').slice(0,2).toLowerCase();if(LANGUES.includes(c))return c}
 return 'en'})();
const LOCALE={fr:'fr-FR',en:'en-US'}[LANG]||LANG;
const DICT=I18N[LANG]||{};
function tx(s,v){const r=DICT[s]??s;return v?r.replace(/\{(\w+)\}/g,(m,k)=>k in v?v[k]:m):r}
// Pluriel : txn(n,'{n} partie','{n} parties') — singulier pour 0 et 1 en français, pour 1 seulement en anglais
const txn=(n,one,many,v={})=>tx((LANG==='fr'?n<2:n===1)?one:many,{n,...v});
// Pourcentage : « 52 % » en français, « 52% » en anglais — écrire fmt(x)+PC au lieu de fmt(x)+' %'
const PC=LANG==='fr'?' %':'%';
function setLang(l){try{localStorage.setItem('chess-up:langue',l)}catch(e){}location.reload()}
(function translateDom(){document.documentElement.lang=LANG;
 const sel=document.getElementById('langue');
 if(sel){LANGUES.forEach(l=>sel.add(new Option(l.toUpperCase(),l)));sel.value=LANG;sel.addEventListener('change',()=>setLang(sel.value))}
 if(LANG==='fr')return;
 // une <option> sans value prend son texte pour valeur : la figer avant de traduire le texte (le JS compare des valeurs françaises)
 document.querySelectorAll('option:not([value])').forEach(o=>o.value=o.textContent);
 const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let n;(n=w.nextNode());){const p=n.parentNode.nodeName;if(p==='SCRIPT'||p==='STYLE')continue;
  const k=n.nodeValue.replace(/\s+/g,' ').trim();if(k&&DICT[k]!=null)n.nodeValue=n.nodeValue.replace(/\S[\s\S]*\S|\S/,()=>DICT[k])}
 document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el=>['placeholder','title','aria-label'].forEach(a=>{
  const v=el.getAttribute(a);if(v==null)return;const k=v.replace(/\s+/g,' ').trim();if(DICT[k]!=null)el.setAttribute(a,DICT[k])}))})();
