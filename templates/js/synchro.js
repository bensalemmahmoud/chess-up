/* ---------- synchroniser l'entraînement entre appareils ---------- */
// Sans serveur : la progression (srs) est compressée dans l'adresse du rapport (#sync=…).
// La partie après # n'est jamais envoyée au site : elle ne quitte l'appareil que par le lien que tu partages.
const b64url={enc:buf=>{let s='';new Uint8Array(buf).forEach(b=>s+=String.fromCharCode(b));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')},
 dec:s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))};
const gz=(data,mode)=>new Response(new Blob([data]).stream().pipeThrough(mode==='in'?new CompressionStream('gzip'):new DecompressionStream('gzip'))).arrayBuffer();

async function syncLink(){const packed=await gz(new TextEncoder().encode(JSON.stringify(srs)),'in');
 return location.href.split('#')[0]+'#sync='+b64url.enc(packed)}
// Fusion : pour chaque position, on garde la version la plus récente (t), sinon la plus travaillée (n)
async function importSync(code){const other=JSON.parse(new TextDecoder().decode(await gz(b64url.dec(code),'out')));let n=0;
 for(const [id,v] of Object.entries(other)){const mine=srs[id];
  if(!mine||(v.t||0)>(mine.t||0)||(!v.t&&!mine.t&&(v.n||0)>(mine.n||0))){srs[id]=v;n++}}
 saveSrs();return n}

$('syncBtn').addEventListener('click',async()=>{$('syncMsg').textContent='';
 try{const url=await syncLink();$('syncOut').value=url;$('syncOut').hidden=false;$('syncOut').select();
  if(navigator.share){try{await navigator.share({title:'Chess Analytics : ma progression',url});return}catch(e){}}
  try{await navigator.clipboard.writeText(url);$('syncMsg').textContent='Lien copié. Ouvre-le sur ton autre appareil.'}
  catch(e){$('syncMsg').textContent='Copie ce lien et ouvre-le sur ton autre appareil.'}}
 catch(e){$('syncMsg').textContent='Ce navigateur ne permet pas la synchronisation.'}});

async function handleSyncHash(){const code=location.hash.slice(6);history.replaceState(null,'','#entrainement');
 try{const n=await importSync(code);renderTraining(baseFilter(false));
  setFeedback('ok',`<b>Progression synchronisée :</b> ${n} position${n>1?'s':''} mise${n>1?'s':''} à jour depuis ton autre appareil.`)}
 catch(e){setFeedback('ko','Lien de synchronisation illisible : recrée-le sur l\'autre appareil.')}}
