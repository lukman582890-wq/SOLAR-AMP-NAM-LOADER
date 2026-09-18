let ctx,stream,inputAnalyser,outputAnalyser,master,nodes={};let running=false,raf,installEvent;
const notes=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const state={gain:25,bass:100,mid:50,treble:50,presence:50,master:100,drive:35,tone:50,level:72,mic:50,low:50,high:70,delay:28,reverb:22};
const presets=[
 {name:'Default Preset',amp:'British 800',od:'Tube Screamer',cab:'4x12 V30',fx:'Hall Reverb'},
 {name:'Clean Glass',amp:'American Clean',od:'Off',cab:'2x12 Blue',fx:'Plate Reverb'},
 {name:'Modern High Gain',amp:'Modern 5150',od:'Tight OD',cab:'4x12 V30',fx:'Studio Hall'}
];
let presetIndex=0;let savedPresets=JSON.parse(localStorage.getItem('solarSavedPresets')||'[]');let selectedAmp='British 800',selectedOd='Tube Screamer',selectedEq='Default';let setAmp,setOd,setEq;
const $=id=>document.getElementById(id);
function curve(k){const c=new Float32Array(44100);for(let i=0;i<c.length;i++){const x=i*2/c.length-1;c[i]=Math.tanh(k*x*4)/Math.tanh(k*4)}return c}
function setText(el,t){if(el)el.textContent=t}
function apply(k,v){
 if(!ctx)return;
 if((k==='gain'||k==='drive')&&nodes.drive)nodes.drive.curve=curve(.08+v/180);
 if(k==='bass'&&nodes.bass)nodes.bass.gain.value=(v-50)*.24;
 if(k==='mid'&&nodes.mid)nodes.mid.gain.value=(v-50)*.24;
 if(k==='treble'&&nodes.treble)nodes.treble.gain.value=(v-50)*.24;
 if(k==='presence'&&nodes.presence)nodes.presence.gain.value=(v-50)*.22;
 if(k==='master'&&master)master.gain.value=v/100;
 if(k==='tone'&&nodes.tone)nodes.tone.frequency.value=1800+v*110;
 if(k==='level'&&nodes.driveLevel)nodes.driveLevel.gain.value=v/100;
 if(k==='low'&&nodes.low)nodes.low.frequency.value=40+v*1.2;
 if(k==='high'&&nodes.high)nodes.high.frequency.value=4000+v*60;
 if(k==='delay'&&nodes.dw)nodes.dw.gain.value=v/100;
 if(k==='reverb'&&nodes.rw)nodes.rw.gain.value=v/100;
}
function makeKnobs(id,names){
 const root=$(id);if(!root)return;root.innerHTML='';
 names.forEach(name=>{
  const key=name.toLowerCase().replace(' ','');
  const d=document.createElement('div');d.className='knob';
  const f=document.createElement('div');f.className='knobface';
  const scale=document.createElement('div');scale.className='knobscale';
  const finger=document.createElement('div');finger.className='fingerpointer';finger.textContent='🖕';
  f.append(scale,finger);
  const v=document.createElement('b'),l=document.createElement('small');l.textContent=name;
  d.append(f,v,l);let value=state[key]??50;
  function set(x){value=Math.max(0,Math.min(100,Math.round(x)));state[key]=value;v.textContent=value+'%';f.style.setProperty('--pct',value);f.style.setProperty('--angle',(-135+value*2.7)+'deg');apply(key,value)}
  set(value);
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
  nodes.drive=ctx.createWaveShaper();nodes.drive.curve=curve(.45);nodes.drive.oversample='4x';
  nodes.tone=ctx.createBiquadFilter();nodes.tone.type='lowpass';nodes.tone.frequency.value=7000;
  nodes.driveLevel=ctx.createGain();nodes.driveLevel.gain.value=.72;
  nodes.bass=ctx.createBiquadFilter();nodes.bass.type='lowshelf';nodes.bass.frequency.value=140;
  nodes.mid=ctx.createBiquadFilter();nodes.mid.type='peaking';nodes.mid.frequency.value=900;nodes.mid.Q.value=.8;
  nodes.treble=ctx.createBiquadFilter();nodes.treble.type='highshelf';nodes.treble.frequency.value=2800;
  nodes.presence=ctx.createBiquadFilter();nodes.presence.type='peaking';nodes.presence.frequency.value=4500;nodes.presence.Q.value=.7;
  nodes.low=ctx.createBiquadFilter();nodes.low.type='highpass';
  nodes.high=ctx.createBiquadFilter();nodes.high.type='lowpass';nodes.high.frequency.value=7600;
  const delay=ctx.createDelay(1.2);delay.delayTime.value=.42;nodes.dw=ctx.createGain();
  const rev=ctx.createConvolver();rev.buffer=impulse(1.6,2.1);nodes.rw=ctx.createGain();
  const dry=ctx.createGain();dry.gain.value=1;master=ctx.createGain();
  s.connect(inputAnalyser);s.connect(gate).connect(nodes.drive).connect(nodes.tone).connect(nodes.driveLevel).connect(nodes.bass).connect(nodes.mid).connect(nodes.treble).connect(nodes.presence).connect(nodes.low).connect(nodes.high);
  nodes.high.connect(dry).connect(master);
  nodes.high.connect(delay).connect(nodes.dw).connect(master);
  nodes.high.connect(rev).connect(nodes.rw).connect(master);
  master.connect(outputAnalyser).connect(ctx.destination);
  Object.entries(state).forEach(([k,v])=>apply(k,v));applyAmpModel(selectedAmp);applyOdModel(selectedOd);applyEqModel(selectedEq);
  running=true;setText($('engine'),'WEB AUDIO');setText($('rate'),ctx.sampleRate+' Hz');setText($('latency'),((ctx.baseLatency||0)*1000).toFixed(1)+' ms');$('start').classList.add('on');tick();
 }catch(err){
  setText($('engine'),'AUDIO ERROR');setText($('latency'),err?.name||'Permission denied');
  try{ctx?.close()}catch{}ctx=null;stream?.getTracks().forEach(t=>t.stop());stream=null;
 }
}
function stop(){
 cancelAnimationFrame(raf);stream?.getTracks().forEach(t=>t.stop());stream=null;ctx?.close();ctx=null;running=false;
 $('start').classList.remove('on');setText($('engine'),'WEB AUDIO');setText($('rate'),'—');setText($('latency'),'—');$('in').value=0;$('out').value=0;setText($('note'),'—');setText($('hz'),'—');setText($('cents'),'PLAY A NOTE');
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
 setText($('cabModel'),p.cab);setText($('fxModel'),p.fx);
}
function cyclePreset(dir){presetIndex=(presetIndex+dir+presets.length)%presets.length;updatePreset()}
function savePreset(){
 const name=prompt('Nama preset:',String($('presetName')?.textContent||'My Preset').trim())?.trim();if(!name)return;
 const p={name,amp:selectedAmp,od:selectedOd,eq:selectedEq,cab:$('cabModel')?.textContent||'4x12 V30',fx:$('fxModel')?.textContent||'Hall Reverb',state:{...state}};
 savedPresets=savedPresets.filter(x=>x.name!==name);savedPresets.push(p);localStorage.setItem('solarSavedPresets',JSON.stringify(savedPresets));alert('Preset tersimpan: '+name);
}
function loadSavedPreset(p){
 Object.assign(state,p.state||{});
 setAmp?.(p.amp||'British 800');setOd?.(p.od||'Tube Screamer');setEq?.(p.eq||'Default');setText($('cabModel'),p.cab||'4x12 V30');setText($('fxModel'),p.fx||'Hall Reverb');
 Object.entries(state).forEach(([k,v])=>apply(k,v));applyAmpModel(selectedAmp);applyOdModel(selectedOd);applyEqModel(selectedEq);
}
function wireModelSelector(selector,values,onChange){
 const box=document.querySelector(selector);if(!box)return ()=>{};
 let i=0;const label=box.querySelector('strong'),buttons=box.querySelectorAll('button');
 function update(){if(label)label.textContent=values[i];onChange?.(values[i],i)}
 const set=value=>{const n=values.indexOf(value);if(n>=0){i=n;update()}};
 buttons[0]?.addEventListener('click',()=>{i=(i-1+values.length)%values.length;update()});
 buttons[1]?.addEventListener('click',()=>{i=(i+1)%values.length;update()});update();return set;
}
function applyAmpModel(name){
 selectedAmp=name;if(!ctx)return;
 const profiles={
  'British 800':{drive:.52,tone:6100,bass:0,mid:3,treble:4,presence:2},
  'American Clean':{drive:.16,tone:8200,bass:2,mid:-2,treble:3,presence:1},
  'Modern 5150':{drive:.68,tone:5600,bass:3,mid:-4,treble:5,presence:4}
 };
 const p=profiles[name];if(!p)return;
 nodes.drive.curve=curve(p.drive);
 if(nodes.tone)nodes.tone.frequency.value=p.tone;
 if(nodes.bass)nodes.bass.gain.value=p.bass;
 if(nodes.mid)nodes.mid.gain.value=p.mid;
 if(nodes.treble)nodes.treble.gain.value=p.treble;
 if(nodes.presence)nodes.presence.gain.value=p.presence;
}
function applyEqModel(name){
 selectedEq=name;const profiles={
  'Default':{bass:0,mid:0,treble:0,d:'M0 54 C55 51 95 45 150 52 C205 59 245 53 300 48'},
  'V-Curve':{bass:4,mid:-5,treble:4,d:'M0 42 C55 36 100 45 150 70 C200 45 245 35 300 40'},
  'Mid Focus':{bass:-2,mid:5,treble:-1,d:'M0 62 C55 60 95 48 150 30 C205 48 245 59 300 58'}
 };
 const p=profiles[name]||profiles.Default;
 if(ctx){if(nodes.bass)nodes.bass.gain.value=p.bass;if(nodes.mid)nodes.mid.gain.value=p.mid;if(nodes.treble)nodes.treble.gain.value=p.treble}
 const path=$('eqCurve');if(path)path.setAttribute('d',p.d);
}
function applyOdModel(name){
 selectedOd=name;if(!ctx||!nodes.drive)return;
 const profiles={'Tube Screamer':.34,'Tight OD':.48,'Off':.08};
 nodes.drive.curve=curve(profiles[name]??.08);
}
function wireUI(){
 $('start').addEventListener('click',()=>running?stop():start());
 $('presetPrev')?.addEventListener('click',()=>cyclePreset(-1));$('presetNext')?.addEventListener('click',()=>cyclePreset(1));
$('savePreset')?.addEventListener('click',savePreset);
 document.querySelectorAll('.chain-node[data-target]').forEach(n=>n.addEventListener('click',()=>$(n.dataset.target)?.scrollIntoView({behavior:'smooth',block:'center'})));
 document.querySelectorAll('.fx-modes button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.fx-modes button').forEach(x=>x.classList.remove('selected'));b.classList.add('selected')}));
 setAmp=wireModelSelector('#ampSelect',['British 800','American Clean','Modern 5150'],applyAmpModel);
 setOd=wireModelSelector('#odSelect',['Tube Screamer','Tight OD','Off'],applyOdModel);
 setEq=wireModelSelector('#eqSelect',['Default','V-Curve','Mid Focus'],applyEqModel);
 wireModelSelector('#cabSelect',['4x12 V30','2x12 Blue','4x10 Green']);
 wireModelSelector('#fxSelect',['Hall Reverb','Plate Reverb','Room Reverb']);
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
