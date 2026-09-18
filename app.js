let ctx,stream,inputAnalyser,outputAnalyser,master,nodes={};let running=false,raf,installEvent;const moduleBypass={amp:false,od:false,eq:false,cab:false,fx:false};let eqGraph={low:0,mid:0,high:0};
const notes=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const state={gain:25,bass:100,mid:50,treble:50,presence:50,master:100,drive:35,tone:50,level:72,mic:50,low:50,high:70,delay:28,reverb:22,eqLow:50,eqMid:50,eqHigh:50};
const presets=[
 {name:'Default Preset',amp:'British 800',od:'Tube Screamer',cab:'4x12 V30',fx:'Hall Reverb'},
 {name:'Clean Glass',amp:'American Clean',od:'Off',cab:'2x12 Blue',fx:'Plate Reverb'},
 {name:'Modern High Gain',amp:'Modern 5150',od:'Tight OD',cab:'4x12 V30',fx:'Studio Hall'}
];
let presetIndex=0;let savedPresets=[];try{savedPresets=JSON.parse(localStorage.getItem('solarSavedPresets')||'[]');if(!Array.isArray(savedPresets))savedPresets=[]}catch{savedPresets=[]}let selectedAmp='British 800',selectedOd='Tube Screamer',selectedEq='Default',selectedCab='4x12 V30',selectedFx='Hall Reverb',selectedFxMode='DELAY';let setAmp,setOd,setEq,setCab,setFx;let knobSetters={};let ampBaseDrive=.52,odBaseDrive=.34,fxBaseDelay=.42,fxBaseReverb=.30;let irBuffer=null,irName='';let irFiles=new Map();let pendingIRFiles=[];let identityIRBuffer=null;const irPackV1=['6100_ZCB_57_API','6100_ZCB_57_NV','6100_ZCB_57OFF_API','6100_ZCB_57OFF_NV','6100_ZCB_201_API','6100_ZCB_201_NV','6100_ZCB_421_API','6100_ZCB_421_NV','6100_ZCB_906_API','6100_ZCB_906_NV','6505_ZCB_57_API','6505_ZCB_57_NV','6505_ZCB_57OFF_API','6505_ZCB_57OFF_NV','6505_ZCB_201_API','6505_ZCB_201_NV','6505_ZCB_421_API','6505_ZCB_421_NV','6505_ZCB_906_API','6505_ZCB_906_NV'];
const $=id=>document.getElementById(id);
function curve(k){const c=new Float32Array(44100);for(let i=0;i<c.length;i++){const x=i*2/c.length-1;c[i]=Math.tanh(k*x*4)/Math.tanh(k*4)}return c}
function setText(el,t){if(el)el.textContent=t}
function refreshFx(){
 if(!ctx)return;
 const d=state.delay/100,r=state.reverb/100,m=selectedFxMode,q=moduleBypass.fx?0:1;
 if(nodes.dw)nodes.dw.gain.value=q*(m==='DELAY'?d*fxBaseDelay/.42:(m==='REVERB'?0:d*fxBaseDelay/.42*.35));
 if(nodes.rw)nodes.rw.gain.value=q*(m==='REVERB'?r*fxBaseReverb/.30:(m==='DELAY'?r*fxBaseReverb/.30*.35:r*fxBaseReverb/.30*.55));
 if(nodes.chorusGain)nodes.chorusGain.gain.value=q*(m==='CHORUS'?.55:0);
 if(nodes.tremLfoGain)nodes.tremLfoGain.gain.value=q*(m==='TREMOLO'?.45:0);
 if(nodes.tremolo)nodes.tremolo.gain.value=q*(m==='TREMOLO'?1:0);
 if(nodes.phaserGain)nodes.phaserGain.gain.value=q*(m==='PHASER'?.45:0);
 if(nodes.chorusDelay)nodes.chorusDelay.delayTime.value=m==='CHORUS'?.025:.001;
}
function refreshDrive(){
 if(!ctx)return;
 if(nodes.ampDrive)nodes.ampDrive.curve=moduleBypass.amp?null:curve(Math.max(.03,ampBaseDrive*(.35+state.gain/100*1.45)));
 if(nodes.odDrive)nodes.odDrive.curve=moduleBypass.od?null:curve(Math.max(.01,odBaseDrive*(.25+state.drive/100*1.5)));
}
function refreshEq(){
 if(!ctx)return;
 const q=moduleBypass.eq?0:1;
 if(nodes.bass)nodes.bass.gain.value=moduleBypass.eq?0:(state.eqLow-50)*.24*q;
 if(nodes.mid)nodes.mid.gain.value=moduleBypass.eq?0:(state.eqMid-50)*.24*q;
 if(nodes.treble)nodes.treble.gain.value=moduleBypass.eq?0:(state.eqHigh-50)*.24*q;
 if(nodes.presence)nodes.presence.gain.value=(state.presence-50)*.22*q;
 if(nodes.low)nodes.low.frequency.value=moduleBypass.eq?20:40+state.low*1.2;
 if(nodes.high)nodes.high.frequency.value=moduleBypass.eq?20000:4000+state.high*60;
 eqGraph.low=(state.eqLow-50)*.24;eqGraph.mid=(state.eqMid-50)*.24;eqGraph.high=(state.eqHigh-50)*.24;updateEqGraph();
}
function refreshCab(){
 if(!ctx)return;
 if(nodes.ir&&identityIRBuffer)nodes.ir.buffer=moduleBypass.cab?identityIRBuffer:(irBuffer||identityIRBuffer);
 const cut=moduleBypass.cab?20000:({ '4x12 V30':20000,'2x12 Blue':20000,'4x10 Green':20000}[selectedCab]||20000);
 if(nodes.cab)nodes.cab.frequency.value=cut;
 if(nodes.cabPresence)nodes.cabPresence.gain.value=moduleBypass.cab?0:0;
}
function refreshAllBypass(){refreshDrive();refreshEq();refreshCab();refreshFx()}
function toggleModule(name){
 if(!(name in moduleBypass))return;
 moduleBypass[name]=!moduleBypass[name];
 const icon=document.querySelector('.module-bypass[data-module="'+name+'"]');
 if(icon){icon.textContent=moduleBypass[name]?'🖕':'👍';icon.classList.toggle('bypassed',moduleBypass[name]);icon.setAttribute('aria-pressed',String(!moduleBypass[name]));}
 refreshAllBypass();
}
function apply(k,v){
 if(!ctx)return;
 if(k==='gain'||k==='drive')refreshDrive();
 if(k==='bass'||k==='mid'||k==='treble'||k==='presence'||k==='low'||k==='high'||k==='eqLow'||k==='eqMid'||k==='eqHigh')refreshEq();
 if(k==='master'&&master)master.gain.value=v/100;
 if(k==='tone'&&nodes.tone)nodes.tone.frequency.value=1800+v*110;
 if(k==='level'&&nodes.driveLevel)nodes.driveLevel.gain.value=v/100;
 if(k==='low'&&nodes.low)nodes.low.frequency.value=40+v*1.2;
 if(k==='high'&&nodes.high)nodes.high.frequency.value=4000+v*60;
 if(k==='delay'||k==='reverb')refreshFx();
}
function makeKnobs(id,names){
 const root=$(id);if(!root)return;root.innerHTML='';
 names.forEach(name=>{
  const key=id==='eq'?'eq'+name.toLowerCase().replace(' ',''):name.toLowerCase().replace(' ','');
  const d=document.createElement('div');d.className='knob';
  const f=document.createElement('div');f.className='knobface';
  const scale=document.createElement('div');scale.className='knobscale';
  const finger=document.createElement('div');finger.className='fingerpointer';finger.textContent='🖕';
  f.append(scale,finger);
  const v=document.createElement('b'),l=document.createElement('small');l.textContent=name;
  d.append(f,v,l);let value=state[key]??50;
  function set(x){value=Math.max(0,Math.min(100,Math.round(x)));state[key]=value;v.textContent=value+'%';f.style.setProperty('--pct',value);f.style.setProperty('--angle',(-135+value*2.7)+'deg');apply(key,value)}
  knobSetters[key]=set;set(value);
  let sy,sv;
  f.addEventListener('pointerdown',e=>{e.preventDefault();sy=e.clientY;sv=value;f.setPointerCapture?.(e.pointerId)});
  f.addEventListener('pointermove',e=>{if(sy!==undefined)set(sv+(sy-e.clientY)*.5)});
  f.addEventListener('pointerup',()=>sy=undefined);f.addEventListener('pointercancel',()=>sy=undefined);
  f.addEventListener('wheel',e=>{e.preventDefault();set(value+(e.deltaY<0?2:-2))},{passive:false});
  root.append(d);
 });
}
function impulse(sec,decay){
 const b=ctx.createBuffer(2,Math.floor(ctx.sampleRate*sec),ctx.sampleRate);
 for(let c=0;c<2;c++){const a=b.getChannelData(c);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*Math.pow(1-i/a.length,decay)}
 return b;
}
async function start(){
 if(running)return;
 try{
  ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
  if(ctx.state==='suspended')await ctx.resume();
  const s=ctx.createMediaStreamSource(stream);
  inputAnalyser=ctx.createAnalyser();outputAnalyser=ctx.createAnalyser();inputAnalyser.fftSize=outputAnalyser.fftSize=2048;
  const gate=ctx.createDynamicsCompressor();gate.threshold.value=-42;gate.ratio.value=12;gate.attack.value=.003;gate.release.value=.12;
  nodes.odDrive=ctx.createWaveShaper();nodes.odDrive.oversample='4x';
  nodes.ampDrive=ctx.createWaveShaper();nodes.ampDrive.oversample='4x';
  nodes.tone=ctx.createBiquadFilter();nodes.tone.type='lowpass';nodes.tone.frequency.value=7000;
  nodes.driveLevel=ctx.createGain();nodes.driveLevel.gain.value=.72;
  nodes.bass=ctx.createBiquadFilter();nodes.bass.type='lowshelf';nodes.bass.frequency.value=140;
  nodes.mid=ctx.createBiquadFilter();nodes.mid.type='peaking';nodes.mid.frequency.value=900;nodes.mid.Q.value=.8;
  nodes.treble=ctx.createBiquadFilter();nodes.treble.type='highshelf';nodes.treble.frequency.value=2800;
  nodes.presence=ctx.createBiquadFilter();nodes.presence.type='peaking';nodes.presence.frequency.value=4500;nodes.presence.Q.value=.7;
  nodes.low=ctx.createBiquadFilter();nodes.low.type='highpass';
  nodes.high=ctx.createBiquadFilter();nodes.high.type='lowpass';nodes.high.frequency.value=7600;
  nodes.cab=ctx.createBiquadFilter();nodes.cab.type='lowpass';nodes.cab.frequency.value=7200;
  nodes.cabPresence=ctx.createBiquadFilter();nodes.cabPresence.type='peaking';nodes.cabPresence.frequency.value=2800;nodes.cabPresence.Q.value=.8;
  nodes.ir=ctx.createConvolver();nodes.ir.normalize=false;identityIRBuffer=ctx.createBuffer(1,1,ctx.sampleRate);identityIRBuffer.getChannelData(0)[0]=1;nodes.ir.buffer=identityIRBuffer;
  const delay=ctx.createDelay(1.2);delay.delayTime.value=.42;nodes.dw=ctx.createGain();
  const rev=ctx.createConvolver();rev.buffer=impulse(1.6,2.1);nodes.rw=ctx.createGain();
  nodes.chorusDelay=ctx.createDelay(.08);nodes.chorusDelay.delayTime.value=.025;nodes.chorusGain=ctx.createGain();
  nodes.chorusLfo=ctx.createOscillator();nodes.chorusLfoGain=ctx.createGain();nodes.chorusLfo.frequency.value=.8;nodes.chorusLfoGain.gain.value=.008;nodes.chorusLfo.connect(nodes.chorusLfoGain).connect(nodes.chorusDelay.delayTime);nodes.chorusLfo.start();
  nodes.tremolo=ctx.createGain();nodes.tremolo.gain.value=0;nodes.tremLfo=ctx.createOscillator();nodes.tremLfoGain=ctx.createGain();nodes.tremLfo.frequency.value=4.5;nodes.tremLfoGain.gain.value=0;nodes.tremLfo.connect(nodes.tremLfoGain).connect(nodes.tremolo.gain);nodes.tremLfo.start();
  nodes.phaser1=ctx.createBiquadFilter();nodes.phaser1.type='allpass';nodes.phaser1.frequency.value=700;nodes.phaser1.Q.value=.7;
  nodes.phaser2=ctx.createBiquadFilter();nodes.phaser2.type='allpass';nodes.phaser2.frequency.value=1800;nodes.phaser2.Q.value=.7;nodes.phaserGain=ctx.createGain();nodes.phaserGain.gain.value=0;
  nodes.phaserLfo=ctx.createOscillator();nodes.phaserLfoGain=ctx.createGain();nodes.phaserLfo.frequency.value=.32;nodes.phaserLfoGain.gain.value=650;nodes.phaserLfo.connect(nodes.phaserLfoGain).connect(nodes.phaser1.frequency);nodes.phaserLfo.connect(nodes.phaserLfoGain).connect(nodes.phaser2.frequency);nodes.phaserLfo.start();
  const dry=ctx.createGain();dry.gain.value=1;master=ctx.createGain();
  s.connect(inputAnalyser);s.connect(gate).connect(nodes.odDrive).connect(nodes.ampDrive).connect(nodes.tone).connect(nodes.driveLevel).connect(nodes.bass).connect(nodes.mid).connect(nodes.treble).connect(nodes.presence).connect(nodes.low).connect(nodes.high).connect(nodes.cab).connect(nodes.cabPresence);
  nodes.cabPresence.connect(nodes.ir).connect(dry).connect(master);
  nodes.cabPresence.connect(nodes.ir).connect(delay).connect(nodes.dw).connect(master);
  nodes.cabPresence.connect(nodes.ir).connect(rev).connect(nodes.rw).connect(master);
  nodes.cabPresence.connect(nodes.chorusDelay).connect(nodes.chorusGain).connect(master);
  nodes.cabPresence.connect(nodes.tremolo).connect(master);
  nodes.cabPresence.connect(nodes.phaser1).connect(nodes.phaser2).connect(nodes.phaserGain).connect(master);
  master.connect(outputAnalyser).connect(ctx.destination);
  Object.entries(state).forEach(([k,v])=>apply(k,v));applyAmpModel(selectedAmp);applyOdModel(selectedOd);applyEqModel(selectedEq);applyFxModel(selectedFx);applyFxMode(selectedFxMode);
  await applyCabModel(selectedCab);
  for(const file of pendingIRFiles.splice(0))await loadIRFile(file);
  refreshAllBypass();
  running=true;setText($('engine'),'WEB AUDIO');setText($('rate'),ctx.sampleRate+' Hz');setText($('latency'),((ctx.baseLatency||0)*1000).toFixed(1)+' ms');$('start').classList.add('on');$('start').textContent='👍';tick();
 }catch(err){
  setText($('engine'),'AUDIO ERROR');setText($('latency'),err?.name||'Permission denied');
  try{ctx?.close()}catch{}ctx=null;stream?.getTracks().forEach(t=>t.stop());stream=null;
 }
}
function stop(){
 cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;ctx?.close();ctx=null;running=false;
 $('start').classList.remove('on');$('start').textContent='🖕';setText($('engine'),'WEB AUDIO');setText($('rate'),'—');setText($('latency'),'—');$('in').value=0;$('out').value=0;setText($('note'),'—');setText($('hz'),'—');setText($('cents'),'PLAY A NOTE');
}
function tick(){
 if(!running)return;
 const a=new Float32Array(2048),o=new Float32Array(2048);inputAnalyser.getFloatTimeDomainData(a);outputAnalyser.getFloatTimeDomainData(o);
 const pk=x=>{let m=0;for(const v of x)m=Math.max(m,Math.abs(v));return m};
 $('in').value=Math.min(1,pk(a));$('out').value=Math.min(1,pk(o));
 let rms=0;for(const v of a)rms+=v*v;
 if(Math.sqrt(rms/a.length)>.012){
  let best=0,bc=-Infinity;
  for(let lag=44;lag<630;lag++){let s=0;for(let i=0;i<a.length-lag;i++)s+=a[i]*a[i+lag];if(s>bc){bc=s;best=lag}}
  if(best){const hz=ctx.sampleRate/best,m=69+12*Math.log2(hz/440),n=Math.round(m);setText($('hz'),hz.toFixed(1)+' Hz');setText($('note'),notes[(n+120)%12]+(Math.floor(n/12)-1));setText($('cents'),(m-n>=0?'+':'')+Math.round((m-n)*100)+' cents')}
 }
 raf=requestAnimationFrame(tick);
}
function updatePreset(){
 const p=presets[presetIndex];setText($('presetName'),String(presetIndex+1).padStart(2,'0')+'  '+p.name);
 setAmp?.(p.amp);setOd?.(p.od);setEq?.(p.amp==='American Clean'?'Default':p.amp==='Modern 5150'?'V-Curve':'Mid Focus');
 setCab?.(p.cab);setFx?.(p.fx);
}
function cyclePreset(dir){presetIndex=(presetIndex+dir+presets.length)%presets.length;updatePreset()}
function savePreset(){
 const name=prompt('Nama preset:',String($('presetName')?.textContent||'My Preset').trim())?.trim();if(!name)return;
 const p={name,amp:selectedAmp,od:selectedOd,eq:selectedEq,cab:$('cabModel')?.textContent||'4x12 V30',fx:$('fxModel')?.textContent||'Hall Reverb',state:{...state}};
 savedPresets=savedPresets.filter(x=>x.name!==name);savedPresets.push(p);localStorage.setItem('solarSavedPresets',JSON.stringify(savedPresets));alert('Preset tersimpan: '+name);
}
function loadSavedPreset(p){
 if(!p)return;
 Object.assign(state,p.state||{});
 setAmp?.(p.amp||'British 800');setOd?.(p.od||'Tube Screamer');setEq?.(p.eq||'Default');setCab?.(p.cab||'4x12 V30');setFx?.(p.fx||'Hall Reverb');
 setText($('presetName'),'★  '+p.name);
 Object.entries(moduleBypass).forEach(k=>moduleBypass[k]=Boolean(p.bypass?.[k]));
 document.querySelectorAll('.module-bypass[data-module]').forEach(icon=>{const n=icon.dataset.module;icon.textContent=moduleBypass[n]?'🖕':'👍';icon.classList.toggle('bypassed',moduleBypass[n]);icon.setAttribute('aria-pressed',String(!moduleBypass[n]))});
 Object.entries(state).forEach(([k,v])=>knobSetters[k]?.(v));
 applyAmpModel(selectedAmp);applyOdModel(selectedOd);applyEqModel(selectedEq);applyCabModel(selectedCab);applyFxModel(selectedFx);applyFxMode(selectedFxMode);
}
function manageSavedPresets(){
 if(!savedPresets.length){alert('Belum ada preset tersimpan.');return}
 const list=savedPresets.map((p,i)=>(i+1)+'. '+p.name).join('\n');
 const choice=prompt('SAVED PRESETS\n\n'+list+'\n\nKetik nomor untuk LOAD, atau D1/D2... untuk DELETE:');
 if(!choice)return;
 const m=choice.trim().toUpperCase().match(/^([LD])(\\d+)$/);
 const n=m?Number(m[2]):Number(choice);
 if(!Number.isInteger(n)||n<1||n>savedPresets.length){alert('Pilihan tidak valid.');return}
 if(m?.[1]==='D'){
  savedPresets.splice(n-1,1);localStorage.setItem('solarSavedPresets',JSON.stringify(savedPresets));alert('Preset dihapus.');return;
 }
 loadSavedPreset(savedPresets[n-1]);
}
function wireModelSelector(selector,values,onChange){
 const box=document.querySelector(selector);if(!box)return ()=>{};
 let i=0;const label=box.querySelector('strong'),buttons=box.querySelectorAll('button');
 function update(){if(label)label.textContent=values[i];onChange?.(values[i],i)}
 const set=value=>{const n=values.indexOf(value);if(n>=0){i=n;update()}};
 buttons[0]?.addEventListener('click',()=>{i=(i-1+values.length)%values.length;update()});
 buttons[1]?.addEventListener('click',()=>{i=(i+1)%values.length;update()});update();return set;
}
function updateEqGraph(){
 const path=$('eqCurve'),fill=$('eqFill'),svg=document.querySelector('.eq-graph svg');if(!path||!svg)return;
 const y=g=>50-(Math.max(-12,Math.min(12,g))*2.65);
 const d='M0 '+y(eqGraph.low)+' C55 '+y(eqGraph.low)+' 92 '+y(eqGraph.mid)+' 150 '+y(eqGraph.mid)+' C208 '+y(eqGraph.mid)+' 245 '+y(eqGraph.high)+' 300 '+y(eqGraph.high);
 path.setAttribute('d',d);
 if(fill)fill.setAttribute('d',d+' L300 100 L0 100 Z');
 const pts=[['eqLowPoint',42,eqGraph.low],['eqMidPoint',150,eqGraph.mid],['eqHighPoint',258,eqGraph.high]];
 pts.forEach(([id,x,g])=>{let q=$(id);if(!q){q=document.createElementNS('http://www.w3.org/2000/svg','circle');q.id=id;q.setAttribute('r','5');q.classList.add('eq-point');svg.append(q)}q.setAttribute('cx',x);q.setAttribute('cy',y(g));});
}
function wireEqGraph(){
 const svg=document.querySelector('.eq-graph svg');if(!svg)return;
 let active=null;
 const pointMap={eqLowPoint:'low',eqMidPoint:'mid',eqHighPoint:'high'};
 const move=e=>{
  if(!active)return;const r=svg.getBoundingClientRect(),id=active,key=pointMap[id];
  const yy=Math.max(0,Math.min(100,e.clientY-r.top)),gain=Math.max(-12,Math.min(12,(50-yy)/2.65));
  eqGraph[key]=gain;
  if(key==='low')state.eqLow=50+gain/.24;
  if(key==='mid')state.eqMid=50+gain/.24;
  if(key==='high')state.eqHigh=50+gain/.24;
  knobSetters[key==='low'?'eqLow':key==='mid'?'eqMid':'eqHigh']?.(key==='low'?state.eqLow:key==='mid'?state.eqMid:state.eqHigh);
  updateEqGraph();
 };
 svg.addEventListener('pointerdown',e=>{const p=e.target;if(p.id&&pointMap[p.id]){active=p.id;p.setPointerCapture?.(e.pointerId);move(e);e.preventDefault()}});
 svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',()=>active=null);svg.addEventListener('pointercancel',()=>active=null);
 updateEqGraph();
}
function applyAmpModel(name){
 selectedAmp=name;
 const profiles={'British 800':{drive:.52,tone:6100},'American Clean':{drive:.16,tone:8200},'Modern 5150':{drive:.68,tone:5600}};
 const p=profiles[name]||profiles['British 800'];ampBaseDrive=p.drive;
 if(ctx){refreshDrive();if(nodes.tone)nodes.tone.frequency.value=p.tone}
}
function applyEqModel(name){
 selectedEq=name;const profiles={
  'Default':{bass:0,mid:0,treble:0,d:'M0 54 C55 51 95 45 150 52 C205 59 245 53 300 48'},
  'V-Curve':{bass:4,mid:-5,treble:4,d:'M0 42 C55 36 100 45 150 70 C200 45 245 35 300 40'},
  'Mid Focus':{bass:-2,mid:5,treble:-1,d:'M0 62 C55 60 95 48 150 30 C205 48 245 59 300 58'}
 };
 const p=profiles[name]||profiles.Default;
 if(ctx)refreshEq();
 eqGraph={low:p.bass,mid:p.mid,high:p.treble};
 state.eqLow=50+p.bass/.24;state.eqMid=50+p.mid/.24;state.eqHigh=50+p.treble/.24;
 knobSetters.eqLow?.(state.eqLow);knobSetters.eqHigh?.(state.eqHigh);updateEqGraph();
}
function applyOdModel(name){
 selectedOd=name;const profiles={'Tube Screamer':.34,'Tight OD':.48,'Off':.01};odBaseDrive=profiles[name]??.01;
 if(ctx)refreshDrive();
}
async function applyCabModel(name){
 selectedCab=name;
 if(irPackV1.includes(name)){
  if(!ctx){setText($('irStatus'),'PACK V1 • READY');return}
  try{
   const r=await fetch('./ir/'+encodeURIComponent(name)+'.wav',{cache:'force-cache'});
   if(!r.ok)throw new Error('HTTP '+r.status);
   const decoded=await ctx.decodeAudioData(await r.arrayBuffer());
   irBuffer=decoded;irName=name;irFiles.set(name,{buffer:decoded});renderIRLibrary();
   setText($('cabModel'),name);setText($('irStatus'),'PACK V1 • '+name);refreshCab();return;
  }catch(err){
   setText($('irStatus'),'PACK V1 LOAD ERROR');console.error('IR load failed',name,err);
  }
 }
 if(ctx)refreshCab();
}
function renderIRLibrary(){
 const box=$('irLibrary');if(!box)return;box.innerHTML='';
 irFiles.forEach((v,name)=>{
  const b=document.createElement('button');b.type='button';b.className='ir-item';b.textContent=name;b.title=name;
  b.addEventListener('click',()=>{irBuffer=v.buffer;irName=name;selectedCab=name;setText($('cabModel'),name.replace(/\.(wav|aiff?|flac)$/i,''));setText($('irStatus'),irPackV1.includes(name)?'PACK V1 • '+name:'CUSTOM • '+name);refreshCab()});
  box.appendChild(b);
 });
}
async function loadIRFile(file){
 if(!file)return;
 if(!ctx){pendingIRFiles.push(file);setText($('irStatus'),'CUSTOM • QUEUED — START AUDIO');return}
 try{
  const buf=await file.arrayBuffer();const decoded=await ctx.decodeAudioData(buf.slice(0));
  irBuffer=decoded;irName=file.name;selectedCab=file.name;irFiles.set(file.name,{buffer:decoded});renderIRLibrary();
  setText($('cabModel'),file.name.replace(/\.(wav|aiff?|flac)$/i,''));setText($('irStatus'),'CUSTOM • '+file.name);refreshCab();
 }catch(e){setText($('irStatus'),'IR LOAD ERROR');console.error('Custom IR load failed',e)}
}
function saveIRLocal(name,buffer){try{const data=buffer.getChannelData(0);const arr=new Float32Array(data);localStorage.setItem('solarLastIRName',name);localStorage.setItem('solarLastIR',btoa(String.fromCharCode(...new Uint8Array(arr.buffer))));}catch{}}

function applyFxModel(name){
 selectedFx=name;const profiles={'Hall Reverb':{delay:.42,rev:.30},'Plate Reverb':{delay:.18,rev:.38},'Room Reverb':{delay:.10,rev:.20},'Studio Hall':{delay:.32,rev:.34}};
 const p=profiles[name]||profiles['Hall Reverb'];fxBaseDelay=p.delay;fxBaseReverb=p.rev;refreshFx();
}
function applyFxMode(mode){
 selectedFxMode=mode;
 const b=document.querySelectorAll('.fx-modes button');b.forEach(x=>x.classList.toggle('selected',x.textContent.trim()===mode));
 refreshFx();
}
function wireUI(){
 $('start').addEventListener('click',()=>running?stop():start());
 $('presetPrev')?.addEventListener('click',()=>cyclePreset(-1));$('presetNext')?.addEventListener('click',()=>cyclePreset(1));
$('savePreset')?.addEventListener('click',savePreset);
$('presetMenu')?.addEventListener('click',manageSavedPresets);
 document.querySelectorAll('.chain-node[data-target]').forEach(n=>n.addEventListener('click',()=>$(n.dataset.target)?.scrollIntoView({behavior:'smooth',block:'center'})));
 setAmp=wireModelSelector('#ampSelect',['British 800','American Clean','Modern 5150'],applyAmpModel);
 setOd=wireModelSelector('#odSelect',['Tube Screamer','Tight OD','Off'],applyOdModel);
 setEq=wireModelSelector('#eqSelect',['Default','V-Curve','Mid Focus'],applyEqModel);
 wireEqGraph();
 setCab=wireModelSelector('#cabSelect',irPackV1,applyCabModel);
document.querySelector('#irInput')?.addEventListener('change',async e=>{for(const f of [...(e.target.files||[])])await loadIRFile(f);e.target.value=''});renderIRLibrary();
 setFx=wireModelSelector('#fxSelect',['Hall Reverb','Plate Reverb','Room Reverb','Studio Hall'],applyFxModel);
 document.querySelectorAll('.fx-modes button').forEach(b=>b.addEventListener('click',()=>applyFxMode(b.textContent.trim())));
document.querySelectorAll('.module-bypass[data-module]').forEach(icon=>icon.addEventListener('click',()=>toggleModule(icon.dataset.module)));
 $('nam').addEventListener('change',async e=>{
  const f=e.target.files?.[0];if(!f)return;setText($('fileName'),f.name);
  try{const raw=JSON.parse(await f.text());const a=String(raw.architecture??raw.model?.architecture??'').toUpperCase();setText($('modelStatus'),f.name+' • '+(a.includes('A2')?'NAM A2':a.includes('A1')?'NAM A1':'NAM architecture unknown')+' • parsed')}
  catch{setText($('modelStatus'),'Invalid/unsupported NAM JSON')}
 });
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('install').hidden=false});
 $('install').addEventListener('click',async()=>{if(!installEvent)return;installEvent.prompt();await installEvent.userChoice;installEvent=null;$('install').hidden=true});
}
wireUI();updatePreset();
makeKnobs('amp',['GAIN','BASS','MID','TREBLE','PRESENCE','MASTER']);
makeKnobs('od',['DRIVE','TONE','LEVEL']);
makeKnobs('eq',['LOW','HIGH']);
makeKnobs('fx',['DELAY','REVERB']);
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
