/* Ascension: timed questions (Practice and Real test).
   Part 1, the engine: pure functions, no DOM, no clock (every call takes `now`), so it can be tested on its own.
   Part 2, the app layer: settings, the timer bar, ticking, expiry, reserve, wired into the existing runners.

   Model (only spent[] is stored; reserve and deficit are derived every time):
     left    = totalSeconds - sum(all spent)          (the real clock: time never stops counting)
     owed[u] = max(0, baseSeconds - spent[u])        for every unanswered u
     reserve = left - sum(owed)                       > 0 time saved, < 0 deficit
     own     = owed + min(0,reserve) / (questions still owed time)   on screen, unanswered      */
(function(root){
  'use strict';
  const E={};
  // ---------- config ----------
  E.MIN_MANUAL=5;E.CAP=60;E.MAX_MANUAL=60;
  E.baseSeconds=(cfg,N,totalSeconds)=>cfg.mode==='manual'?cfg.manualSecondsPerQ:Math.min(E.CAP,totalSeconds/Math.max(1,N));
  E.totalSeconds=(cfg,N,minutes)=>cfg.mode==='manual'?N*cfg.manualSecondsPerQ:(minutes>0?minutes*60:N*E.CAP);
  E.validate=cfg=>cfg.mode!=='manual'||(Number.isFinite(cfg.manualSecondsPerQ)&&cfg.manualSecondsPerQ>=E.MIN_MANUAL&&cfg.manualSecondsPerQ<=E.MAX_MANUAL)?null:`Use ${E.MIN_MANUAL} to ${E.MAX_MANUAL} seconds a question.`;
  E.create=(ids,totalSeconds,baseSeconds,now)=>({ids:ids.slice(),total:totalSeconds,base:baseSeconds,spent:{},timedOut:{},reserveOn:{},cur:ids[0],last:now,off:false});

  // ---------- derived values ----------
  // answered: id -> bool, supplied by the caller (practice: checked answer; real test: an option chosen)
  // The real clock: every second spent anywhere (answered, unanswered, lingering after answering, overtime)
  // comes out of the same remaining time. Nothing is "free".
  //   left    = total - all time spent
  //   owed[u] = base - spent[u] for each unanswered u (never below 0): what that question is still promised
  //   reserve = left - sum(owed)   > 0: time saved, < 0: deficit (shared out over the questions still owed time)
  E.derive=(st,answered)=>{
    let spentAll=0,U=0,owedSum=0,Uo=0;
    for(const id of st.ids){const sp=st.spent[id]||0;spentAll+=sp;if(!answered(id)){U++;const o=Math.max(0,st.base-sp);owedSum+=o;if(o>0)Uo++}}
    const left=Math.max(0,st.total-spentAll),reserve=left-owedSum;
    // what a question not yet opened gets now
    const fresh=Uo?Math.max(0,st.base+Math.min(0,reserve)/Uo):0;
    return{spentAll,left,U,Uo,owedSum,reserve,deficit:reserve<0,fresh};
  };
  // the question on screen
  E.current=(st,answered,id)=>{
    const d=E.derive(st,answered),sp=st.spent[id]||0,isAns=answered(id);
    const owed=isAns?0:Math.max(0,st.base-sp);
    const own=owed>0?Math.max(0,owed+Math.min(0,d.reserve)/d.Uo):0;
    const usingReserve=!isAns&&own<=0&&d.reserve>0;
    return Object.assign(d,{id,spent:sp,answered:isAns,owed,own,usingReserve,
      remaining:isAns?0:own>0?own:usingReserve?d.reserve:0});
  };
  // time passes on the question on screen (paused: no time is added)
  E.tick=(st,now,paused)=>{const dt=Math.max(0,(now-st.last)/1000);st.last=now;if(!paused&&!st.off&&st.cur!=null)st.spent[st.cur]=(st.spent[st.cur]||0)+dt;return st};
  E.enter=(st,id,now,paused)=>{E.tick(st,now,paused);st.cur=id;return st};
  E.totalSpent=st=>Object.values(st.spent).reduce((a,b)=>a+b,0);
  // next unanswered question after `id` (wrapping round); null when every other one is answered
  E.nextUnanswered=(st,answered,id)=>{const i=st.ids.indexOf(id),n=st.ids.length;for(let k=1;k<n;k++){const x=st.ids[(i+k)%n];if(!answered(x))return x}return null};

  root.TimingEngine=E;
  if(typeof module!=='undefined')module.exports=E;
  if(typeof document==='undefined'||typeof S==='undefined')return;

  // ======================= app layer =======================
  const K='ascension.timed';
  let CFG=(()=>{const d={enabled:false,mode:'auto',manualSecondsPerQ:40};try{return Object.assign(d,JSON.parse(localStorage.getItem(K)||'{}'))}catch(e){return d}})();
  const saveCfg=()=>{try{localStorage.setItem(K,JSON.stringify(CFG))}catch(e){}};
  let qtH=null,lastSave=0;

  // which session is running, and what "answered" means in it
  function ctx(){
    if(view==='run'&&S.practice&&S.practice.qt&&!S.practice.qt.off){const P=S.practice;
      return{kind:'practice',st:P.qt,id:P.qids[P.i],answered:id=>!!(P.res[id]&&P.res[id].r!=='s'),paused:!!(P.timer&&!P.timer.run)}}
    if(view==='exam'&&S.active&&S.active.qt){const A=S.active;
      return{kind:'real',st:A.qt,id:A.qids[A.cur],answered:id=>!!A.ans[id],paused:false}}
    return null;
  }
  const fmtS=s=>{s=Math.ceil(s);return s>=60?Math.floor(s/60)+':'+String(s%60).padStart(2,'0'):s+'s'};

  // ---------- settings card (Practice and Real test pages) ----------
  function settingsHTML(kind){
    const N=kind==='real'?(realCfg.order||buildRealQids()).length:Math.min(prCfg.count,(typeof prPool==='function'?prPool().length:prCfg.count));
    const mins=kind==='real'?(realCfg.paper==='mixed'?180:paperMins(realCfg.paper)):(prCfg.tmin||0);
    const total=E.totalSeconds(CFG,N,mins),base=E.baseSeconds(CFG,N,total),err=E.validate(CFG);
    const seg=(v,l)=>`<button type="button" class="chip" data-act="qtmode" data-v="${v}" aria-pressed="${CFG.mode===v}">${l}</button>`;
    const preview=err?err:`${N} questions × ${Math.round(base)}s${kind==='practice'&&CFG.mode==='manual'&&mins&&Math.round(total/60)!==mins?` · session ${Math.round(total/60)} min (replaces ${mins} min)`:''}`;
    return`<section class="sheet" id="qtcard"><h2>Timed questions</h2>
      <div class="row" style="gap:12px;align-items:center"><button type="button" class="chip" data-act="qttoggle" aria-pressed="${CFG.enabled}">${CFG.enabled?'On':'Off'}</button>
      ${CFG.enabled?`${seg('auto','Auto')}${seg('manual','Manual')}${CFG.mode==='manual'?`<label class="qt-sec">Seconds a question <input type="number" id="qt-sec" min="${E.MIN_MANUAL}" max="${E.MAX_MANUAL}" step="5" value="${CFG.manualSecondsPerQ}"></label>`:''}`:''}</div>
      ${CFG.enabled?`<p class="muted" id="qt-prev" style="margin-top:10px">${esc(preview)}</p>`:''}</section>`;
  }
  const inject=(html,card,before)=>{const i=html.indexOf(before);return i<0?html+card:html.slice(0,i)+card+html.slice(i)};
  // practice: Timed questions (left) and the Timer (right) share one panel
  const _vp=VIEWS.practice;VIEWS.practice=a=>{const h=_vp(a);if(S.practice&&S.practice.kind==='practice')return h;
    const open='<section class="sheet" id="ptimer">',i=h.indexOf(open);if(i<0)return inject(h,settingsHTML('practice'),'<section class="sheet"><h2>Order</h2>');
    const j=h.indexOf('</section>',i),timer=h.slice(i+open.length,j);
    return h.slice(0,i)+'<section class="sheet qt-pair" id="qtcard"><div class="qt-col">'+settingsHTML('practice').replace(/^<section[^>]*>/,'').replace(/<\/section>\s*$/,'')+'</div><div class="qt-col" id="ptimer">'+timer+'</div></section>'+h.slice(j+10)};
  // a finished session keeps a short timing summary for achievements: base, questions, answered,
  // timed out, answered within own time, and the time saved (negative: deficit) at the end
  // practice clears S.practice before it records the session, so the session is held for the summary
  let finP=null;const _pf=ACT.pfinish;ACT.pfinish=(...a)=>{finP=S.practice;try{return _pf(...a)}finally{finP=null}};
  const _ft=finishTest;finishTest=function(o){
    const src=o.kind==='real'?S.active:o.kind==='practice'?(S.practice||finP):null,st=src&&src.qt;let sum=null;
    if(st&&!st.off){E.tick(st,Date.now(),o.kind==='practice'&&!!(src.timer&&!src.timer.run));
      const A=o.kind==='real'?id=>!!src.ans[id]:id=>!!(src.res[id]&&src.res[id].r!=='s'),d=E.derive(st,A);
      sum={b:Math.round(st.base),n:st.ids.length,ans:st.ids.filter(A).length,to:Object.keys(st.timedOut).length,
        inT:st.ids.filter(id=>A(id)&&(st.spent[id]||0)<=st.base+0.5).length,res:Math.round(d.reserve)}}
    const t=_ft.apply(this,arguments);if(sum&&t){t.qt=sum;save()}return t};
  const _vr=VIEWS.real;VIEWS.real=a=>inject(_vr(a),settingsHTML('real'),'<section class="sheet"><h2>Before you start</h2>');
  ACT.qttoggle=()=>{CFG.enabled=!CFG.enabled;saveCfg();render()};
  ACT.qtmode=el=>{CFG.mode=el.dataset.v;saveCfg();render()};
  document.addEventListener('change',e=>{if(e.target&&e.target.id==='qt-sec'){const v=Math.min(E.MAX_MANUAL,Math.max(E.MIN_MANUAL,Math.round(+e.target.value)||E.MAX_MANUAL));CFG.manualSecondsPerQ=v;saveCfg();render()}});

  // ---------- starting a session ----------
  const _ps=ACT.pstart;ACT.pstart=(...a)=>{
    if(CFG.enabled&&E.validate(CFG))return plainToast(E.validate(CFG));
    const N=prCfg.order?prCfg.order.length:prCfg.count,mins=prCfg.tmin||0;
    _ps(...a);const P=S.practice;if(!CFG.enabled||!P||P.kind!=='practice')return;
    const now=Date.now(),total=E.totalSeconds(CFG,P.qids.length,mins),base=E.baseSeconds(CFG,P.qids.length,total);
    P.qt=E.create(P.qids,total,base,now);
    // the session clock follows the timed total (Manual wins over the chosen minutes)
    P.timer={mins:Math.round(total/60*10)/10,left:total*1000,run:now};save();render()};
  const _rg=ACT.rgo;ACT.rgo=(...a)=>{
    if(CFG.enabled&&E.validate(CFG))return plainToast(E.validate(CFG));
    _rg(...a);const A=S.active;if(!CFG.enabled||!A)return;
    const now=Date.now(),mins=(A.end-A.start)/60000,total=E.totalSeconds(CFG,A.qids.length,mins),base=E.baseSeconds(CFG,A.qids.length,total);
    A.qt=E.create(A.qids,total,base,now);A.end=A.start+total*1000;save();render()};
  const _rs=ACT.rstart;ACT.rstart=(...a)=>{_rs(...a);if(CFG.enabled&&CFG.mode==='manual'){const N=(realCfg.order||buildRealQids()).length,m=Math.round(N*CFG.manualSecondsPerQ/60),p=document.querySelector('#modal p');if(p)p.textContent=`${m} minutes (${N} questions × ${CFG.manualSecondsPerQ}s) begin as soon as you press Start. There is no pause.`}};

  // ---------- the timer: right end of the question line ----------
  // Built once per question; each tick only changes text, the ring and which chip is showing.
  //   own time running  -> countdown, plus "Time saved +Ns" when the pool holds spare time
  //   own time used up  -> the spare time is drawn automatically: a green "Reserve" countdown
  //   used up, no spare -> "Time up", plus "Deficit" once staying here takes time from the questions left
  const R=13,L=2*Math.PI*R;
  function build(){
    const b=document.createElement('div');b.id='qtbar';b.className='qt-t';b.setAttribute('role','timer');
    b.innerHTML=`<span class="qt-chip ok qt-saved" hidden></span><span class="qt-chip warn qt-def" hidden></span>
      <span class="qt-clock"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="${R}" class="qt-trk"/><circle cx="16" cy="16" r="${R}" class="qt-arc" style="stroke-dasharray:${L}"/></svg><span class="qt-lbl"></span><b class="qt-num"></b></span>`;
    b._={saved:b.querySelector('.qt-saved'),def:b.querySelector('.qt-def'),arc:b.querySelector('.qt-arc'),lbl:b.querySelector('.qt-lbl'),num:b.querySelector('.qt-num'),k:{}};
    return b;
  }
  // all on the one clock: lingering on an answered question, or staying past time, is paid for by the questions left
  function state(c,b){
    const cur=E.current(c.st,c.answered,c.id),base=c.st.base;
    const def=cur.reserve<0&&Math.floor(cur.fresh)<Math.floor(base)?cur.fresh:null;
    if(cur.answered)return{s:'done',frac:1,num:'✓',lbl:'Answered',saved:cur.reserve,def};
    if(cur.own>0)return{s:cur.own<=10?'low':'own',frac:cur.own/Math.max(1,base),num:fmtS(cur.own),lbl:'',saved:cur.reserve,def:null};
    if(cur.usingReserve){b._.resFull=Math.max(b._.resFull||0,cur.reserve);
      return{s:'res',frac:cur.reserve/b._.resFull,num:fmtS(cur.reserve),lbl:'Reserve',saved:0,def:null}}
    // nothing left for this question and no reserve: the deficit runs while it stays on screen
    return{s:'up',frac:0,num:'−'+fmtS(Math.max(0,-cur.reserve)),lbl:'Deficit',saved:0,def:Math.max(0,cur.fresh)};
  }
  function paintBar(c){
    const host=c.kind==='real'?document.querySelector('.exam-q .qmeta'):document.querySelector('#main .sheet .qmeta');if(!host)return;
    let b=document.getElementById('qtbar'),fresh=false;
    if(!b||b.parentNode!==host||b.dataset.q!==String(c.id)){if(b)b.remove();b=build();b.dataset.q=c.id;fresh=true}
    const v=state(c,b),x=b._;
    if(b.dataset.s!==v.s){
      // switching to the reserve refills the ring: a slower sweep instead of a jump
      if(!fresh&&v.s==='res'){x.arc.classList.add('qt-refill');setTimeout(()=>x.arc.classList.remove('qt-refill'),700)}
      b.dataset.s=v.s}
    const off=(L*(1-Math.max(0,Math.min(1,v.frac)))).toFixed(2);
    if(x.k.off!==off){x.k.off=off;x.arc.style.strokeDashoffset=off}
    if(x.k.num!==v.num){x.k.num=v.num;x.num.textContent=v.num}
    if(x.k.lbl!==v.lbl){x.k.lbl=v.lbl;x.lbl.textContent=v.lbl;x.lbl.hidden=!v.lbl}
    const sv=v.saved>=1?`Time saved +${fmtS(v.saved)}`:'';
    if(x.k.sv!==sv){x.k.sv=sv;x.saved.textContent=sv;x.saved.hidden=!sv}
    const df=v.def!=null?`Deficit: next questions ${Math.floor(v.def)}s`:'';
    if(x.k.df!==df){x.k.df=df;x.def.textContent=df;x.def.hidden=!df}
    if(fresh)host.appendChild(b);
    // palette and strip: timed-out questions
    if(c.kind==='real')c.st.ids.forEach((id,i)=>{const cell=document.querySelector(`.pal [data-i="${i}"]`);if(cell)cell.classList.toggle('to',!!c.st.timedOut[id]&&!c.answered(id))});
    else document.querySelectorAll('.pstrip i').forEach((el,i)=>{const id=c.st.ids[i];el.classList.toggle('to',!!c.st.timedOut[id]&&!c.answered(id))});
  }

  // ---------- ticking: timestamps, not interval counting ----------
  let prevOwn=null,prevId=null;
  function tick(){
    const c=ctx();if(!c)return;const now=Date.now();
    if(c.st.cur!==c.id){E.enter(c.st,c.id,now,c.paused);prevOwn=null}else E.tick(c.st,now,c.paused);
    // the reserve is drawn automatically: remaining runs on from own time into the reserve without a break
    const cur=E.current(c.st,c.answered,c.id);
    // expiry: own time and reserve are both used up while this question is on screen, unanswered
    const crossed=!cur.answered&&prevId===c.id&&prevOwn>0&&cur.remaining<=0;
    prevOwn=cur.remaining;prevId=c.id;
    if(crossed){c.st.timedOut[c.id]=1;const nx=E.nextUnanswered(c.st,c.answered,c.id);save();
      if(nx!=null){plainToast('Time up on this question. Moving to the next unanswered one.');
        if(c.kind==='real')xgo(c.st.ids.indexOf(nx));else{const P=S.practice;pMove(P.qids.indexOf(nx)-P.i)}return}}
    if(now-lastSave>5000){lastSave=now;save()}
    paintBar(c);
  }
  function start(){clearInterval(qtH);qtH=null;const c=ctx();if(!c)return;
    // reopening: a real test never pauses, so the time away counts on the question that was open; practice does not count it
    if(c.kind==='practice'&&Date.now()-c.st.last>10000)c.st.last=Date.now();
    prevOwn=null;tick();qtH=setInterval(tick,250)}
  const _render=render;render=function(){clearInterval(qtH);qtH=null;const c=ctx();if(c){E.tick(c.st,Date.now(),c.paused)}_render.apply(this,arguments)};
  const _hr=HOOKS.run;HOOKS.run=a=>{_hr&&_hr(a);start()};
  const _he=HOOKS.exam;HOOKS.exam=a=>{_he&&_he(a);start()};
  // answering and moving flush the time first, so it lands on the right question
  const _pr=pRecord;pRecord=function(id,R){const c=ctx();if(c)E.tick(c.st,Date.now(),c.paused);return _pr.apply(this,arguments)};
  const _pm=pMove;pMove=function(){const c=ctx();if(c)E.tick(c.st,Date.now(),c.paused);return _pm.apply(this,arguments)};
  const _xg=xgo;xgo=function(){const c=ctx();if(c)E.tick(c.st,Date.now(),false);return _xg.apply(this,arguments)};
  // practice: the session clock ran out and the learner keeps going -> untimed from here
  const _pk=ACT.ptkeep;ACT.ptkeep=(...a)=>{const P=S.practice;if(P&&P.qt){P.qt.off=true;save()}_pk(...a);render()};
  const _pp=ACT.ptpause;ACT.ptpause=(...a)=>{const c=ctx();if(c)E.tick(c.st,Date.now(),c.paused);_pp(...a)};

  // ---------- styles ----------
  const css=document.createElement('style');css.textContent=`
  .qt-t{margin-left:auto;align-self:center;display:inline-flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;font-family:var(--font-text)}
  .qt-clock{display:inline-flex;align-items:center;gap:7px;padding:3px 12px 3px 4px;border:1px solid var(--line);border-radius:999px;background:var(--sheet);transition:border-color .3s,background-color .3s}
  .qt-clock svg{width:26px;height:26px;transform:rotate(-90deg);flex:none}
  .qt-clock circle{fill:none;stroke-width:4}.qt-trk{stroke:var(--fill)}
  .qt-arc{stroke:var(--p-action);stroke-linecap:round;transition:stroke-dashoffset .25s linear,stroke .3s}
  .qt-arc.qt-refill{transition:stroke-dashoffset .65s cubic-bezier(.2,.7,.2,1),stroke .3s}
  .qt-num{font-weight:600;font-size:14px;line-height:1;font-variant-numeric:tabular-nums;min-width:2.6ch;text-align:right;transition:color .3s}
  .qt-lbl{font-size:12.5px;font-weight:600;line-height:1}.qt-lbl[hidden]{display:none}
  .qt-t[data-s=low] .qt-arc{stroke:var(--bad)}.qt-t[data-s=low] .qt-num{color:var(--bad)}
  .qt-t[data-s=res] .qt-arc{stroke:var(--ok)}.qt-t[data-s=res] .qt-lbl,.qt-t[data-s=res] .qt-num{color:var(--ok)}
  .qt-t[data-s=res] .qt-clock{border-color:color-mix(in srgb,var(--ok) 45%,var(--line));background:color-mix(in srgb,var(--ok) 7%,var(--sheet))}
  .qt-t[data-s=up] .qt-lbl,.qt-t[data-s=up] .qt-num{color:#b45309}
  .qt-t[data-s=done] .qt-arc{stroke:var(--ok)}.qt-t[data-s=done] .qt-num{color:var(--ok)}
  .qt-chip{font-size:12.5px;font-weight:600;line-height:1;padding:6px 10px;border-radius:999px;white-space:nowrap;animation:qtIn .32s cubic-bezier(.2,.7,.2,1)}
  .qt-chip[hidden]{display:none}
  .qt-chip.ok{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
  .qt-chip.warn{background:color-mix(in srgb,#d97706 16%,transparent);color:#b45309}
  @keyframes qtIn{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.qt-arc,.qt-arc.qt-refill{transition:none}.qt-chip{animation:none}}
  .pal .bub.to{box-shadow:0 0 0 2px #d97706}.pstrip i.to{background:#d97706}
  .qt-pair{display:grid;grid-template-columns:1fr 1fr;gap:28px}.qt-pair>.qt-col{min-width:0}.qt-pair h2{margin-bottom:14px}.qt-pair>.qt-col+.qt-col{border-left:1px solid var(--line);padding-left:28px}
  @media (max-width:760px){.qt-pair{grid-template-columns:1fr}.qt-pair>.qt-col+.qt-col{border-left:0;padding-left:0;border-top:1px solid var(--line);padding-top:20px}}
  .qt-sec{display:inline-flex;align-items:center;gap:8px;font-size:14px}.qt-sec input{width:72px}`;
  document.head.appendChild(css);
  if(view==='run'||view==='exam'||view==='practice'||view==='real')render();
})(typeof window!=='undefined'?window:globalThis);
