/* Ascension: progress stored in a private GitHub repository.
   The profile (the same S object the app has always saved) is kept on the device first, so every click stays instant
   and the app works offline; it is then written, gzipped, to <owner>/<repo>/progress.json.gz through the GitHub
   contents API. Each upload is a commit, so GitHub keeps every earlier version. On another browser, "Load from GitHub"
   on the setup screen brings the profile down; the unlock password is then asked before anything opens.
   The token is a fine-grained personal access token limited to the one data repository, kept only on this device. */
(function(){
  const CK='ascension.gh', FILE='progress.json.gz', API='https://api.github.com';
  const DEF={owner:'AakashDevSpace',repo:'ascension-data',token:''};
  let C=(()=>{try{return Object.assign({},DEF,JSON.parse(localStorage.getItem(CK)||'{}'))}catch(e){return Object.assign({},DEF)}})();
  const saveC=()=>{try{localStorage.setItem(CK,JSON.stringify(C))}catch(e){}};
  const on=()=>!!C.token;
  let sha=null,busy=false,again=false,timer=null,status={t:'',when:0,err:''};

  // ---------- GitHub contents API, gzipped JSON ----------
  async function gz(str){const s=new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));return new Uint8Array(await new Response(s).arrayBuffer())}
  async function gunzip(bytes){const s=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return await new Response(s).text()}
  function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s)}
  function unb64(t){const s=atob(t.replace(/\s/g,'')),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
  const url=()=>`${API}/repos/${encodeURIComponent(C.owner)}/${encodeURIComponent(C.repo)}/contents/${FILE}`;
  const hdr=extra=>Object.assign({Authorization:'Bearer '+C.token,'X-GitHub-Api-Version':'2022-11-28'},extra||{});
  async function pull(){ // -> profile object or null if the file does not exist yet
    const r=await fetch(url()+'?t='+Date.now(),{headers:hdr({Accept:'application/vnd.github+json'}),cache:'no-store'});
    if(r.status===404){sha=null;return null}
    if(!r.ok)throw new Error(r.status===401?'The token was refused. Check it in Settings.':'GitHub answered '+r.status+'.');
    const j=await r.json();sha=j.sha;let bytes;
    if(j.content)bytes=unb64(j.content);
    else{const raw=await fetch(j.git_url,{headers:hdr({Accept:'application/vnd.github.raw'})});bytes=new Uint8Array(await raw.arrayBuffer())}
    return JSON.parse(await gunzip(bytes));
  }
  async function push(obj){
    const body={message:'Progress '+new Date().toISOString().slice(0,16).replace('T',' '),content:b64(await gz(JSON.stringify(obj)))};
    if(sha)body.sha=sha;
    const r=await fetch(url(),{method:'PUT',headers:hdr({Accept:'application/vnd.github+json','Content-Type':'application/json'}),body:JSON.stringify(body)});
    if(r.status===409||r.status===422)return'conflict';
    if(!r.ok)throw new Error(r.status===401?'The token was refused. Check it in Settings.':r.status===403||r.status===404?'The token cannot write to '+C.owner+'/'+C.repo+'.':'GitHub answered '+r.status+'.');
    sha=(await r.json()).content.sha;return'ok';
  }

  // ---------- merge two copies of the profile without losing anything ----------
  function merge(a,b){ // a = this device, b = GitHub; the newer one wins for single values, lists are joined
    const newer=(a.updatedAt||0)>=(b.updatedAt||0)?a:b,older=newer===a?b:a,m=Object.assign({},older,newer);
    const byId=new Map();[...(older.tests||[]),...(newer.tests||[])].forEach(t=>byId.set(t.id,t));
    m.tests=[...byId.values()].sort((x,y)=>(x.at||0)-(y.at||0));
    m.days=Object.assign({},older.days||{});for(const[d,r]of Object.entries(newer.days||{})){const o=m.days[d];m.days[d]=o?Object.assign({},o,r,{secs:Math.max(o.secs||0,r.secs||0),tests:Math.max(o.tests||0,r.tests||0),done:!!(o.done||r.done)}):r}
    m.ach=Object.assign({},older.ach||{},newer.ach||{});
    m.cleared=Object.assign({},older.cleared||{},newer.cleared||{});
    // Review: both lists joined; a question cleared on either browser after it was added stays cleared
    m.review=Object.assign({},older.review||{},newer.review||{});
    for(const id of Object.keys(m.review)){const c=m.cleared[id];if(c&&c>=(m.review[id].added||''))delete m.review[id]}
    m.xp=Math.max(a.xp||0,b.xp||0);
    m.stats=Object.assign({},older.stats||{},newer.stats||{});
    m.updatedAt=Math.max(a.updatedAt||0,b.updatedAt||0);
    return m;
  }

  // ---------- upload after changes: batched, never in the way of a click ----------
  async function upload(){
    if(!on()||!S||!S.setup)return;if(busy){again=true;return}busy=true;status.t='saving';paint();
    try{
      let res=await push(S);
      if(res==='conflict'){const remote=await pull();if(remote){S=merge(S,remote);localStorage.setItem(KEY,JSON.stringify(S))}res=await push(S)}
      if(res!=='ok')throw new Error('GitHub kept refusing the upload; it will try again.');
      status={t:'saved',when:Date.now(),err:''};
    }catch(e){status={t:'error',when:status.when,err:navigator.onLine===false?'Offline. Saved on this device; it uploads when you are back online.':e.message}}
    busy=false;paint();if(again){again=false;schedule(2000)}
  }
  function schedule(ms){if(!on())return;clearTimeout(timer);timer=setTimeout(upload,ms)}
  // every local save also queues an upload (20 s after the last change), and a finished test uploads at once
  const _saveNow=saveNow;
  saveNow=function(){if(S)S.updatedAt=Date.now();_saveNow();schedule(4000)};
  const _finish=finishTest;finishTest=function(o){const t=_finish(o);schedule(1500);return t};
  addEventListener('online',()=>schedule(1000));
  // other browsers' changes arrive while this one is open: on returning to the tab, and every 45 s while it is in view
  // (never in the middle of a test or practice session, which would redraw the question)
  const idle=()=>S&&S.setup&&!S.active&&!S.practice&&!S.fxrun&&!busy;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&idle())syncDown()});
  setInterval(()=>{if(!document.hidden&&idle())syncDown()},45000);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&timer){clearTimeout(timer);upload()}});

  // ---------- on open: bring in anything newer from GitHub ----------
  async function syncDown(){
    if(!on()||!S||!S.setup)return;
    try{const remote=await pull();
      if(!remote){upload();return}
      if(remote.updatedAt!==S.updatedAt||(remote.tests||[]).length!==(S.tests||[]).length){
        const was=JSON.stringify(S);S=merge(S,remote);if(JSON.stringify(S)!==was){localStorage.setItem(KEY,JSON.stringify(S));if(!S.active&&!S.practice&&!S.fxrun)render()}}
      if(JSON.stringify(S)!==JSON.stringify(remote))upload();
      status={t:'saved',when:Date.now(),err:''};
    }catch(e){status={t:'error',when:0,err:navigator.onLine===false?'Offline. Using the copy on this device.':e.message}}
    paint();
  }

  // ---------- Settings card ----------
  const ago=ms=>{const s=Math.round((Date.now()-ms)/1000);return s<60?'just now':s<3600?Math.round(s/60)+' min ago':new Date(ms).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})};
  function cardHTML(){
    const st=!on()?'':status.t==='saving'?'Saving to GitHub…':status.t==='error'?status.err:status.when?'Saved to GitHub '+ago(status.when)+'.':'Connected.';
    return`<section class="sheet" id="ghcard"><h2>GitHub storage</h2>
     ${st?`<p id="ghstat" style="margin-bottom:14px">${esc(st)}</p>`:''}
     ${on()?`<div class="row"><button class="btn" data-act="ghsave">Save to GitHub now</button><button class="btn quiet" data-act="ghoff">Disconnect this browser</button></div>`
     :`<form id="ghForm"><div class="field"><label for="gh-tok">Access token</label><input type="password" id="gh-tok" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required></div>
       <div class="error" id="gherr"></div><button class="btn" type="submit">Connect</button></form>`}</section>`}
  function paint(){const c=document.getElementById('ghcard');if(c&&view==='settings'){c.outerHTML=cardHTML();bindForm()}}
  function bindForm(){const f=document.getElementById('ghForm');if(!f)return;f.onsubmit=async e=>{e.preventDefault();const tok=document.getElementById('gh-tok').value.trim(),err=document.getElementById('gherr');
    C.token=tok;err.textContent='Checking…';
    try{const remote=await pull();
      if(remote&&remote.setup){S=merge(S,remote);localStorage.setItem(KEY,JSON.stringify(S))}
      saveC();await upload();
      // connected only if the first upload really reached GitHub; otherwise say why and stay disconnected
      if(status.t!=='saved'){const why=status.err;C.token='';saveC();err.textContent='Could not save to GitHub: '+why;return}
      render();plainToast('Connected. Your progress is saved in '+C.owner+'/'+C.repo+'.')}
    catch(x){C.token='';err.textContent=x.message}}}
  const _set=VIEWS.settings;VIEWS.settings=a=>{const h=_set(a);const i=h.indexOf('<section class="sheet"><h2>Papers in this copy');return i<0?h+cardHTML():h.slice(0,i)+cardHTML()+h.slice(i)};
  const _hs=HOOKS.settings;HOOKS.settings=a=>{_hs&&_hs(a);bindForm()};
  ACT.ghsave=()=>{clearTimeout(timer);upload()};
  ACT.ghoff=()=>modal(`<h2>Disconnect this browser?</h2><p>Progress stays on GitHub and in this browser, but this browser stops uploading until you connect again.</p><div class="row"><button class="btn" data-act="ghoffok">Disconnect</button><button class="btn quiet" data-act="close">Cancel</button></div>`);
  ACT.ghoffok=()=>{closeModal();C.token='';saveC();status={t:'',when:0,err:''};render()};

  // the lock screen says "No practice for 0 days" on a new browser; say what is happening instead
  const _lock=showLock;showLock=gap=>{_lock(gap);if(!gap){const p=document.querySelector('#modal p');if(p)p.textContent='Progress loaded from GitHub. Enter your unlock password to open it on this browser.'}};

  // a setup screen already on view (new browser) gets the GitHub form; an open profile checks GitHub for newer progress
  if(view!=='setup')syncDown();
})();
