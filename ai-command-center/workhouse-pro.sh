#!/bin/sh
# Workhouse Pro UI. Run from the folder that contains ai-command-center (cd ~/workhouse), then: sh workhouse-pro.sh
set -e
[ -d ai-command-center/mobile ] || { echo "Run this from the folder that contains ai-command-center (cd ~/workhouse)."; exit 1; }
cat > ai-command-center/mobile/pro-ui.html <<'WH_PRO_EOF'
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Workhouse</title>
<style>
:root{--bg:#0b0f17;--card:#141b29;--line:#243049;--tx:#e8eefc;--mut:#8b9ab8;--ac:#4f8cff;--ok:#2fd08a;--bad:#ff5d6c}
:root.light{--bg:#f3f6fb;--card:#fff;--line:#dbe3f0;--tx:#111a2b;--mut:#5b6b88}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px system-ui,sans-serif;padding-top:env(safe-area-inset-top)}
main{padding:16px 16px 100px;max-width:640px;margin:auto}h1{font-size:22px;margin:8px 0 14px}h3{margin:0 0 8px;font-size:15px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;margin-bottom:12px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.sp{justify-content:space-between}.row>*{flex:1}
input,select{width:100%;background:var(--bg);color:var(--tx);border:1px solid var(--line);border-radius:10px;padding:11px;margin:4px 0;font:inherit}
button{background:var(--ac);color:#fff;border:0;border-radius:10px;padding:11px 14px;font:inherit;font-weight:600}
button.g{background:transparent;border:1px solid var(--line);color:var(--tx)}button.ok{background:var(--ok)}button.bad{background:var(--bad)}
.pill{flex:none;font-size:12px;padding:3px 9px;border-radius:99px;background:var(--line);color:var(--mut)}.pill.on{background:#12382b;color:var(--ok)}.pill.warn{background:#3b2a12;color:#ffb454}
.big{font-size:28px;font-weight:700}.mut{color:var(--mut);font-size:13px}.up{color:var(--ok)}.dn{color:var(--bad)}.err{border-color:var(--bad);color:var(--bad)}
nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--card);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
nav button{flex:1;background:none;color:var(--mut);border-radius:0;padding:9px 0;font-size:11px}nav button b{display:block;font-size:19px}nav button.on{color:var(--ac)}
.msg{padding:9px 12px;border-radius:12px;margin:6px 0;white-space:pre-wrap}.me{background:var(--ac);color:#fff;margin-left:30px}.ai{background:var(--bg);border:1px solid var(--line);margin-right:30px}
canvas{width:100%;height:120px;display:block}#lock{position:fixed;inset:0;background:var(--bg);display:none;flex-direction:column;justify-content:center;padding:30px;gap:10px;z-index:9}
</style></head><body><main id="m"></main><nav id="nav"></nav><div id="lock"></div>
<script src="engine.js"></script><script>
const $=s=>document.getElementById(s),E=(t,a,...c)=>{const e=document.createElement(t);for(const k in a||{})k.startsWith('on')||k==='value'?e[k]=a[k]:e.setAttribute(k,a[k]);e.append(...c.flat().filter(x=>x!=null&&x!==false));return e};
const api=async(p,m='GET',b)=>{try{const r=await fetch('/api/'+p,{method:m,headers:m==='GET'?{}:{'content-type':'application/json'},body:m==='GET'?undefined:JSON.stringify(b||{})});let j={};try{j=await r.json()}catch{}return{status:r.status,json:j}}catch(e){return{status:0,json:{error:e.message}}}};
const LS=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem('wh_'+k));localStorage.setItem('wh_'+k,JSON.stringify(v))}catch{return null}};
const AI=[['xai','xAI Grok','grok-4'],['openai','OpenAI','gpt-5'],['anthropic','Anthropic Claude','claude-sonnet-5-5']];
const D={st:'off',bal:null,cur:'USD',virt:null,price:null,ticks:[],log:LS('log')||[],err:'',ws:null};
const R=()=>Object.assign({stake:1,max:5,loss:10,kill:false,real:false},LS('risk')||{});
let tab='home',chat=[],aist=LS('aist')||{};
const today=()=>new Date().toISOString().slice(0,10),send=o=>D.ws&&D.ws.readyState===1&&D.ws.send(JSON.stringify(o));
const pl=()=>D.log.filter(x=>x.d===today()&&x.p!=null).reduce((a,x)=>a+x.p,0),f2=n=>(n>=0?'+':'')+n.toFixed(2);
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('wh'+s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const pill=(t,c)=>E('span',{class:'pill '+(c||'')},t);

async function dconnect(){const c=LS('deriv');if(!c)return;D.err='';D.st='connecting';draw();
 try{const H={Authorization:'Bearer '+c.token,'Deriv-App-ID':c.app};let acc=c.acc;
  if(!acc){const r=await fetch('https://api.derivws.com/trading/v1/options/accounts',{headers:H}),j=await r.json(),l=Array.isArray(j.data)?j.data:[];if(!l.length)throw new Error('No accounts: '+JSON.stringify(j).slice(0,160));const a=l.find(x=>JSON.stringify(x).toLowerCase().includes(c.mode))||l[0];acc=a.account_id||a.id||a.loginid}
  const o=await fetch('https://api.derivws.com/trading/v1/options/accounts/'+acc+'/otp',{method:'POST',headers:H}),oj=await o.json();
  if(!oj.data||!oj.data.url)throw new Error('OTP failed: '+JSON.stringify(oj).slice(0,160));
  D.virt=oj.data.url.includes('/demo');const ws=D.ws=new WebSocket(oj.data.url);
  ws.onopen=()=>{D.st='on';send({balance:1,subscribe:1});send({ticks:c.sym||'R_100',subscribe:1});draw()};
  ws.onmessage=e=>onmsg(JSON.parse(e.data));ws.onclose=()=>{D.st='off';draw()};ws.onerror=()=>{D.err='Connection error'}
 }catch(e){D.st='off';D.err=e.message;draw()}}
function onmsg(m){if(m.error){D.err=m.error.message||'API error';return draw()}
 if(m.balance){D.bal=m.balance.balance;D.cur=m.balance.currency}
 if(m.tick){D.price=m.tick.quote;D.ticks.push(m.tick.quote);if(D.ticks.length>60)D.ticks.shift()}
 if(m.proposal&&m.echo_req.passthrough&&m.echo_req.passthrough.go)send({buy:m.proposal.id,price:m.proposal.ask_price,passthrough:{t:m.echo_req.contract_type}});
 if(m.buy){D.log.unshift({id:m.buy.contract_id,t:m.echo_req.passthrough.t,s:m.buy.buy_price,p:null,d:today()});LS('log',D.log.slice(0,50));send({proposal_open_contract:1,contract_id:m.buy.contract_id,subscribe:1})}
 const p=m.proposal_open_contract;if(p&&p.is_sold){const x=D.log.find(l=>l.id==p.contract_id);if(x&&x.p==null){x.p=+p.profit;LS('log',D.log.slice(0,50));if(pl()<=-R().loss){LS('risk',{...R(),kill:true});D.err='Daily loss limit hit. Trading stopped.'}}}
 if(tab==='home'||tab==='trade')draw()}
function trade(t){const r=R();if(D.st!=='on')return alert('Connect Deriv first (Connect tab)');if(r.kill)return alert('Kill switch is ON');
 if(!D.virt&&!r.real)return alert('Real account blocked. Turn on real trading in Settings first.');if(r.stake>r.max)return alert('Stake is above your max stake');if(pl()<=-r.loss)return alert('Daily loss limit reached');
 send({proposal:1,amount:r.stake,basis:'stake',contract_type:t,currency:D.cur,duration:5,duration_unit:'t',symbol:(LS('deriv')||{}).sym||'R_100',passthrough:{go:1}})}
function spark(cv){const t=D.ticks;if(t.length<2)return;const w=cv.width=cv.clientWidth*2,h=cv.height=240,mn=Math.min(...t),mx=Math.max(...t)||1,x=cv.getContext('2d');
 x.strokeStyle=t[t.length-1]>=t[0]?'#2fd08a':'#ff5d6c';x.lineWidth=4;x.beginPath();t.forEach((v,i)=>{const px=i/(t.length-1)*w,py=h-10-(v-mn)/((mx-mn)||1)*(h-20);i?x.lineTo(px,py):x.moveTo(px,py)});x.stroke()}
const errBox=()=>D.err?E('div',{class:'card err'},D.err):null;
const dpill=()=>D.st==='on'?pill(D.virt?'DEMO · live':'REAL · live','on'):pill(D.st==='connecting'?'connecting…':'not connected');

const V={
home:()=>[E('h1',{},'Workhouse'),errBox(),
 E('div',{class:'card'},E('div',{class:'row sp'},E('h3',{},'Deriv'),dpill()),E('div',{class:'big'},D.bal!=null?D.bal+' '+D.cur:'—'),E('div',{class:'mut'},'Today P/L: ',E('b',{class:pl()>=0?'up':'dn'},f2(pl())))),
 E('div',{class:'card'},E('h3',{},'AI providers'),E('div',{class:'row'},AI.map(a=>pill(a[1],aist[a[0]]==='on'?'on':'')))),
 E('div',{class:'row'},E('button',{onclick:()=>go('chat')},'Ask AI'),E('button',{class:'g',onclick:()=>go('trade')},'Trade'),E('button',{class:'g',onclick:()=>go('conn')},'Connect'))],
chat:()=>{const ok=AI.filter(a=>aist[a[0]]==='on'),sel=E('select',{},ok.map(a=>E('option',{value:a[0]},a[1])));const inp=E('input',{placeholder:ok.length?'Message…':'Connect an AI key first'});
 const go2=async()=>{const t=inp.value.trim();if(!t||!ok.length)return;chat.push({r:'me',t});chat.push({r:'ai',t:'…'});draw();const r=await api('chat','POST',{providerId:sel.value,message:t});chat[chat.length-1].t=r.status===200?String((r.json.messages||[]).slice(-1)[0]?.content??''):'Error: '+JSON.stringify(r.json).slice(0,200);draw()};
 inp.onkeydown=e=>{if(e.key==='Enter')go2()};return[E('h1',{},'Chat'),sel,chat.map(m=>E('div',{class:'msg '+m.r},m.t)),inp,E('button',{onclick:go2},'Send')]},
trade:()=>{const r=R(),s=(LS('deriv')||{}).sym||'R_100',cv=E('canvas',{});setTimeout(()=>spark(cv));
 return[E('h1',{},'Trade'),errBox(),E('div',{class:'card'},E('div',{class:'row sp'},E('h3',{},s),dpill()),E('div',{class:'big'},D.price??'—'),cv),
 E('div',{class:'card'},E('div',{class:'mut'},'Stake '+r.stake+' · 5 ticks · max '+r.max+' · daily loss limit '+r.loss),E('div',{class:'row'},E('button',{class:'ok',onclick:()=>trade('CALL')},'Rise'),E('button',{class:'bad',onclick:()=>trade('PUT')},'Fall')),E('button',{class:'g',style:'width:100%;margin-top:8px',onclick:()=>{LS('risk',{...r,kill:!r.kill});draw()}},r.kill?'Kill switch ON · tap to resume':'Kill switch (stop trading)')),
 E('div',{class:'card'},E('h3',{},'History'),D.log.length?D.log.slice(0,15).map(l=>E('div',{class:'row sp mut'},E('span',{},l.t+' · '+l.s),E('b',{class:l.p==null?'':l.p>=0?'up':'dn'},l.p==null?'open':f2(l.p)))):E('div',{class:'mut'},'No trades yet'))]},
conn:()=>{const c=LS('deriv')||{};return[E('h1',{},'Connections'),errBox(),
 AI.map(([id,name,mdl])=>{const k=E('input',{type:'password',placeholder:'API key',autocomplete:'off'}),m=E('input',{value:mdl,placeholder:'Model'}),st=E('div',{class:'mut'},aist[id]==='on'?'Connected':aist[id]==='fail'?'Failed: check key/model':'Not connected');
  return E('div',{class:'card'},E('div',{class:'row sp'},E('h3',{},name),pill(aist[id]==='on'?'connected':'off',aist[id]==='on'?'on':'')),k,m,st,E('button',{onclick:async()=>{if(!k.value)return;st.textContent='Testing…';await api('providers/'+id,'PUT',{apiKey:k.value,model:m.value});const t=await api('providers/'+id+'/test','POST');aist[id]=t.json.status==='connected'?'on':'fail';LS('aist',aist);draw()}},'Save & test'))}),
 (()=>{const a=E('input',{placeholder:'App ID',value:c.app||''}),t=E('input',{type:'password',placeholder:'API token (PAT)',value:c.token||''}),ac=E('input',{placeholder:'Account ID (optional)',value:c.acc||''}),sy=E('input',{placeholder:'Symbol',value:c.sym||'R_100'}),md=E('select',{},E('option',{value:'demo'},'Demo account'),E('option',{value:'real'},'Real account'));md.value=c.mode||'demo';
  return E('div',{class:'card'},E('div',{class:'row sp'},E('h3',{},'Deriv'),dpill()),a,t,ac,sy,md,E('div',{class:'mut'},'Create the App ID and token at developers.deriv.com. Start with demo.'),E('div',{class:'row'},E('button',{onclick:()=>{if(!a.value||!t.value)return alert('App ID and token needed');LS('deriv',{app:a.value.trim(),token:t.value.trim(),acc:ac.value.trim(),sym:sy.value.trim()||'R_100',mode:md.value});if(D.ws)D.ws.close();dconnect()}},'Save & connect'),E('button',{class:'g',onclick:()=>{if(D.ws)D.ws.close();localStorage.removeItem('wh_deriv');D.st='off';draw()}},'Disconnect')))})()]},
set:()=>{const r=R(),n=(k,l)=>[E('div',{class:'mut'},l),E('input',{type:'number',value:r[k],onchange:e=>LS('risk',{...R(),[k]:+e.target.value})})];
 return[E('h1',{},'Settings'),E('div',{class:'card'},E('h3',{},'Risk controls'),n('stake','Stake per trade'),n('max','Max stake allowed'),n('loss','Daily loss limit (stops trading)'),
  E('button',{class:'g',style:'width:100%;margin-top:8px',onclick:()=>{LS('risk',{...r,real:!r.real});draw()}},r.real?'Real trading: ALLOWED (tap to block)':'Real trading: BLOCKED (tap to allow)')),
 E('div',{class:'card'},E('h3',{},'Security'),E('button',{style:'width:100%',onclick:async()=>{const p=prompt('New PIN (4+ digits). Leave empty to remove.');if(p===null)return;LS('pin',p?await hash(p):null);alert(p?'PIN set':'PIN removed')}},'Set / remove app PIN')),
 E('div',{class:'card'},E('h3',{},'App'),E('div',{class:'row'},E('button',{class:'g',onclick:()=>{const l=document.documentElement.classList.toggle('light');LS('theme',l?'light':'dark')}},'Dark / light'),E('button',{class:'g',onclick:()=>{navigator.clipboard.writeText(JSON.stringify({risk:r,log:D.log})).then(()=>alert('Backup copied (no keys included)'))}},'Copy backup')))]}};
const NAV=[['home','⌂','Home'],['chat','💬','Chat'],['trade','📈','Trade'],['conn','🔌','Connect'],['set','⚙','Settings']];
function go(t){tab=t;draw()}
function draw(){const m=$('m');m.replaceChildren(...V[tab]().flat().filter(Boolean));$('nav').replaceChildren(...NAV.map(([k,i,l])=>E('button',{class:tab===k?'on':'',onclick:()=>go(k)},E('b',{},i),l)))}
async function lockCheck(){const p=LS('pin');if(!p)return;const L=$('lock'),i=E('input',{type:'password',inputmode:'numeric',placeholder:'PIN'});L.style.display='flex';L.replaceChildren(E('h1',{},'Workhouse locked'),i,E('button',{onclick:async()=>{if(await hash(i.value)===p){L.style.display='none'}else i.value=''}},'Unlock'))}
(async()=>{if(LS('theme')==='light')document.documentElement.classList.add('light');lockCheck();draw();try{await window.__workhouse.ready}catch{}if(LS('deriv'))dconnect()})();
</script></body></html>
WH_PRO_EOF
if ! grep -q "pro-ui.html" ai-command-center/mobile/build-www.js; then
cat >> ai-command-center/mobile/build-www.js <<'WH_PATCH_EOF'
// Pro UI replaces the original screen (the in-app engine is unchanged)
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync(path.join(__dirname, 'pro-ui.html'), 'utf8'));
WH_PATCH_EOF
fi
node ai-command-center/mobile/build-www.js
echo ""
echo "Pro UI added. Now run:"
echo "  git add -A && git commit -m 'Workhouse Pro UI' && git push"
