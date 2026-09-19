// iPlug2 WebView bridge. The native WebView injects IPlugSendMsg(), but it does NOT
// inject the SPVFUI/SAMFUI helper functions from the example web script, so the
// SOLAR AMP VST3 keeps its own explicit bridge here.
function byte64(value){ const n=Math.max(0,Math.min(255,Number(value)||0)); return btoa(String.fromCharCode(n)); }
function _solarSend(msg){
 if(typeof IPlugSendMsg!=='function') throw new Error('iPlugSendMsg bridge is unavailable');
 IPlugSendMsg(msg);
}
function SPVFD(paramIdx,val){ if(window.SOLARParamFromHost) window.SOLARParamFromHost(paramIdx,val); }
function SCVFD(ctrlTag,val){ if(window.SOLARControlFromHost) window.SOLARControlFromHost(ctrlTag,val); }
function SCMFD(ctrlTag,msgTag,msg){ if(window.SOLARMessageFromHost) window.SOLARMessageFromHost(ctrlTag,msgTag,msg); }
function SAMFD(msgTag,dataSize,msg){ if(window.SOLARMessageFromHost) window.SOLARMessageFromHost(msgTag,dataSize,msg); }
function SMMFD(statusByte,dataByte1,dataByte2){ if(window.SOLARMidiFromHost) window.SOLARMidiFromHost(statusByte,dataByte1,dataByte2); }
function SSMFD(offset,size,msg){ if(window.SOLARSysexFromHost) window.SOLARSysexFromHost(offset,size,msg); }
function SAMFUI(msgTag,ctrlTag=-1,data=0){ _solarSend({msg:'SAMFUI',msgTag,ctrlTag,data}); }
function SMMFUI(statusByte,dataByte1,dataByte2){ _solarSend({msg:'SMMFUI',statusByte,dataByte1,dataByte2}); }
function SSMFUI(data=0){ _solarSend({msg:'SSMFUI',data}); }
function EPCFUI(paramIdx){ if(paramIdx>=0) _solarSend({msg:'EPCFUI',paramIdx:parseInt(paramIdx)}); }
function BPCFUI(paramIdx){ if(paramIdx>=0) _solarSend({msg:'BPCFUI',paramIdx:parseInt(paramIdx)}); }
function SPVFUI(paramIdx,value){ if(paramIdx>=0) _solarSend({msg:'SPVFUI',paramIdx:parseInt(paramIdx),value}); }

let ctx,stream,inputAnalyser,outputAnalyser,master,nodes={};let running=false,raf,installEvent;let namNode=null,namReady=false,namModelLoaded=false,namMode=false,namSourceActive=false,namSourceRequested=false,namPending=false,namModelJson='';const moduleBypass={amp:false,od:false,eq:false,cab:false,fx:false};let eqGraph={low:0,mid:0,high:0};
const notes=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const state={gain:25,bass:100,mid:50,treble:50,presence:50,master:100,drive:35,tone:50,level:72,mic:50,low:50,high:70,delay:28,reverb:22,eqLow:50,eqMid:50,eqHigh:50};
const presets=[
 {name:'Default Preset',amp:'British 800',od:'Tube Screamer',cab:'6100_ZCB_57_API',fx:'Hall Reverb',fxMode:'REVERB'},
 {name:'Clean Glass',amp:'American Clean',od:'Off',cab:'6100_ZCB_421_API',fx:'Plate Reverb',fxMode:'REVERB'},
 {name:'Modern High Gain',amp:'Modern 5150',od:'Tight OD',cab:'6505_ZCB_57_API',fx:'Studio Hall',fxMode:'REVERB'}
];
let presetIndex=0;let savedPresets=[];try{savedPresets=JSON.parse(localStorage.getItem('solarSavedPresets')||'[]');if(!Array.isArray(savedPresets))savedPresets=[]}catch{savedPresets=[]}let selectedAmp='British 800',selectedOd='Tube Screamer',selectedEq='Default',selectedCab='4x12 V30',selectedFx='Hall Reverb',selectedFxMode='DELAY';let setAmp,setOd,setEq,setCab,setFx,setFxMode;let knobSetters={};let ampBaseDrive=.52,odBaseDrive=.34,fxBaseDelay=.42,fxBaseReverb=.30;let irBuffer=null,irName='';let irFiles=new Map();let pendingIRFiles=[];let identityIRBuffer=null;const irPackV1=['6100_ZCB_57_API','6100_ZCB_57_NV','6100_ZCB_57OFF_API','6100_ZCB_57OFF_NV','6100_ZCB_201_API','6100_ZCB_201_NV','6100_ZCB_421_API','6100_ZCB_421_NV','6100_ZCB_906_API','6100_ZCB_906_NV','6505_ZCB_57_API','6505_ZCB_57_NV','6505_ZCB_57OFF_API','6505_ZCB_57OFF_NV','6505_ZCB_201_API','6505_ZCB_201_NV','6505_ZCB_421_API','6505_ZCB_421_NV','6505_ZCB_906_API','6505_ZCB_906_NV'];
const $=id=>document.getElementById(id);
function curve(k){const c=new Float32Array(44100);for(let i=0;i<c.length;i++){const x=i*2/c.length-1;c[i]=Math.tanh(k*x*4)/Math.tanh(k*4)}return c}
function setText(el,t){if(el)el.textContent=t}
function formatIRName(name){
 const m=String(name||'').match(/^(6100|6505)_ZCB_(57OFF|57|201|421|906)_(API|NV)$/i);
 if(!m)return String(name||'').replace(/\.(wav|aiff?|flac)$/i,'');
 return m[1].toUpperCase()+' • '+m[2].toUpperCase().replace('57OFF','57 OFF')+' • '+m[3].toUpperCase();
}
function refreshNamBypass(){const active=!!(namMode&&!moduleBypass.amp);window.__solarNamActive=active;const b=$('sourceSwitch');if(b){b.classList.toggle('nam-selected',active);b.textContent=active?'SWITCH → AMP':'SWITCH → NAM';}}
let namRequestSeq=1,namRequestMap=new Map(),namEnginePromise=null;
function namRequest(message,transfer=[]){
 if(!namNode)return Promise.reject(new Error('NAM AudioWorklet node is not initialized'));
 const requestId=namRequestSeq++;
 return new Promise((resolve,reject)=>{
  namRequestMap.set(requestId,{resolve,reject});
  try{namNode.port.postMessage({...message,requestId},transfer)}catch(error){namRequestMap.delete(requestId);reject(error)}
 });
}
async function initNamEngine(){
 if(namNode&&namReady)return true;
 if(!ctx)throw new Error('AudioContext is not initialized');
 if(namEnginePromise)return namEnginePromise;
 namEnginePromise=(async()=>{
  try{
   setText($('modelStatus'),'NAM ENGINE • loading official WASM…');
   await ctx.audioWorklet.addModule('./nam-worklet.js?v=60');
   const response=await fetch('./nam-engine.wasm?v=60',{cache:'no-store'});
   if(!response.ok)throw new Error('nam-engine.wasm HTTP '+response.status);
   const wasmBytes=await response.arrayBuffer();
   namNode=new AudioWorkletNode(ctx,'nam-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
   namNode.port.onmessage=e=>{
    const d=e.data||{};
    if(d.type!=='response')return;
    const pending=namRequestMap.get(d.requestId);if(!pending)return;
    namRequestMap.delete(d.requestId);
    if(d.ok)pending.resolve(d.modelInfo);else pending.reject(new Error(d.error||'NAM request failed'));
   };
   await namRequest({type:'init',wasmBytes},[wasmBytes]);
   namReady=true;
   setText($('engine'),'NAM WASM READY');
   return true;
  }catch(error){
   namNode=null;namReady=false;namModelLoaded=false;namMode=false;namSourceActive=false;
   const msg=String(error?.stack||error?.message||error||'unknown error');
   setText($('modelStatus'),'NAM ENGINE ERROR • '+msg);setText($('engine'),'NAM ERROR');refreshStatusIndicators();
   throw error;
  }finally{namEnginePromise=null}
 })();
 return namEnginePromise;
}
async function loadNamModel(json){if(!json)throw Error('NAM model is empty');namModelJson=String(json);namPending=true;setText($('modelStatus'),'NAM MODEL • sending to native DSP…');try{SAMFUI(100,-1,namModelJson);namModelLoaded=true;namReady=true;namPending=false;namMode=true;namSourceActive=true;moduleBypass.amp=false;SAMFUI(103,-1,byte64(true));SAMFUI(102,-1,byte64(false));refreshAllBypass();refreshNamBypass();setText($('modelStatus'),'NAM ACTIVE • native DSP');return true}catch(e){namModelLoaded=false;namReady=false;setText($('modelStatus'),'NAM MODEL ERROR • '+(e?.message||e));refreshStatusIndicators();throw e}}

function refreshFx(){SPVFUI(20,state.delay/100);SPVFUI(21,state.reverb/100);SPVFUI(23,moduleBypass.fx?0:1);const modes={DELAY:0,REVERB:1,CHORUS:2,PHASER:3,TREMOLO:4};const mode=modes[selectedFxMode]??0;SAMFUI(111,-1,byte64(mode))}
function refreshDrive(){SPVFUI(14,state.drive/100);SPVFUI(15,state.tone/100);SPVFUI(16,state.level/100)}
function setNamAmpMode(active){
 namMode=Boolean(active)&&Boolean(namModelLoaded)&&Boolean(namReady);
 namSourceActive=Boolean(active)&&Boolean(namModelLoaded);
 if(namModelLoaded)moduleBypass.amp=false;
 const section=$('ampModule');
 if(section){
  section.classList.toggle('nam-active',namMode);
  const select=$('ampSelect');
  select?.querySelectorAll('button').forEach(b=>b.disabled=namMode);
  const knobs=$('amp');
  if(knobs){
   knobs.style.pointerEvents=namMode?'none':'';
   knobs.style.opacity=namMode?'.45':'';
   knobs.setAttribute('aria-disabled',String(namMode));
  }
  const label=$('ampModel');
  if(label)label.title=namMode?'NAM mode active — click AMP power to return to the legacy AMP':'';
  const power=$('start');
  if(power){
   power.setAttribute('aria-label',moduleBypass.amp?'Enable AMP/NAM signal':'Bypass AMP/NAM signal');
   power.setAttribute('aria-pressed',String(moduleBypass.amp));
  }
 }
 refreshDrive();refreshAmpTone();refreshNamBypass();refreshStatusIndicators();
}
async function toggleAmpSource(){if(!namModelLoaded||!namModelJson){setText($('modelStatus'),'NO NAM MODEL • choose a .NAM file first');return}const next=!namMode;namMode=next;namSourceActive=next;SAMFUI(103,-1,byte64(next));if(next&&moduleBypass.amp){moduleBypass.amp=false;SAMFUI(102,-1,byte64(false))}refreshAllBypass();refreshNamBypass();setText($('modelStatus'),next?'NAM ACTIVE • native DSP':'AMP ACTIVE • native legacy amp')}
function refreshAmpTone(){SPVFUI(0,Math.max(0,Math.min(1,state.gain/100)));SPVFUI(2,state.bass/100);SPVFUI(3,state.mid/100);SPVFUI(4,state.treble/100);SPVFUI(13,state.presence/100);SPVFUI(26,state.master/100)}
function refreshEq(){SPVFUI(17,state.eqLow/100);SPVFUI(18,state.eqMid/100);SPVFUI(19,state.eqHigh/100);eqGraph.low=(state.eqLow-50)*.24;eqGraph.mid=(state.eqMid-50)*.24;eqGraph.high=(state.eqHigh-50)*.24;updateEqGraph()}
function refreshCab(){SPVFUI(8,moduleBypass.cab?0:1)}
function refreshStatusIndicators(){
 const bypassActive=Boolean(moduleBypass.amp);
 const namActive=!bypassActive&&Boolean(namMode);
 const ampActive=!bypassActive&&!namActive;
 const ampEl=$('stateAmp');
 const ampLabel=ampEl?.querySelector('b');
 if(ampEl){
  ampEl.classList.toggle('selected',ampActive||namActive);
  ampEl.classList.toggle('nam-active',namActive);
  if(ampLabel)ampLabel.textContent=namActive?'NAM':'AMP';
 }
 const bypassEl=$('stateBypass');
 if(bypassEl)bypassEl.classList.toggle('selected',bypassActive);
 const switchBtn=$('sourceSwitch');
 if(switchBtn){
  const hasModel=Boolean(namModelJson);
  const loaded=Boolean(namModelLoaded&&namReady);
  switchBtn.disabled=!hasModel;
  switchBtn.classList.toggle('nam-selected',namActive);
  switchBtn.textContent=namActive?'SWITCH → AMP':(namSourceRequested&&!loaded?'WAIT NAM…':'SWITCH → NAM');
  switchBtn.setAttribute('aria-label',namActive?'Switch active source to legacy AMP':'Switch active source to NAM');
  switchBtn.title=!hasModel?'Choose a .NAM model first':(namActive?'NAM active — switch to legacy AMP':loaded?'AMP active — switch to NAM':'NAM will activate when the loader finishes');
 }
 const chainMap={od:'odModule',amp:'ampModule',cab:'cabModule',eq:'eqModule',fx:'fxModule'};
 Object.entries(chainMap).forEach(([name,id])=>{
  const node=document.querySelector('.chain-node[data-target="'+id+'"]');
  if(!node)return;
  const active=name==='amp'?(!bypassActive):!moduleBypass[name];
  node.classList.toggle('active',active);
  node.classList.toggle('bypassed',!active);
  node.classList.toggle('nam-active',name==='amp'&&namActive);
 });
}
function refreshAllBypass(){refreshDrive();refreshAmpTone();refreshEq();refreshCab();refreshFx();refreshStatusIndicators()}
function toggleModule(name){if(!(name in moduleBypass))return;moduleBypass[name]=!moduleBypass[name];const icon=document.querySelector('.module-bypass[data-module="'+name+'"]');if(icon){icon.textContent=moduleBypass[name]?'🖕':'👍';icon.classList.toggle('bypassed',moduleBypass[name]);icon.setAttribute('aria-pressed',String(!moduleBypass[name]))}const tags={od:0,amp:1,eq:2,cab:3,fx:4};if(tags[name]!==undefined)SAMFUI(110,tags[name],byte64(!moduleBypass[name]));if(name==='amp')SAMFUI(102,-1,byte64(moduleBypass.amp));if(name==='eq')SPVFUI(7,moduleBypass.eq?0:1);if(name==='cab')SPVFUI(8,moduleBypass.cab?0:1);if(name==='od')SPVFUI(22,moduleBypass.od?0:1);if(name==='fx')SPVFUI(23,moduleBypass.fx?0:1);refreshAllBypass();refreshNamBypass();refreshStatusIndicators()}
function apply(k,v){const m={gain:[0,v/100],bass:[2,v/100],mid:[3,v/100],treble:[4,v/100],presence:[13,v/100],master:[26,v/100],drive:[14,v/100],tone:[15,v/100],level:[16,v/100],eqLow:[17,v/100],eqMid:[18,v/100],eqHigh:[19,v/100],delay:[20,v/100],reverb:[21,v/100]};if(m[k])SPVFUI(m[k][0],m[k][1])}
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
async function start(){if(running)return;running=true;namReady=true;$('start')?.classList.add('on');if($('start'))$('start').textContent='👍';$('stopAudio')?.removeAttribute('hidden');setText($('engine'),'NATIVE DSP');setText($('rate'),'HOST');setText($('latency'),'NATIVE');refreshAllBypass();refreshStatusIndicators();setText($('modelStatus'),namModelLoaded?'NATIVE NAM • READY':'NATIVE AMP • READY')}
function stop(){running=false;namReady=false;namSourceActive=false;$('stopAudio')?.setAttribute('hidden','');$('start')?.classList.remove('on');if($('start'))$('start').textContent='🖕';setText($('engine'),'NATIVE DSP');setText($('rate'),'HOST');setText($('latency'),'NATIVE');refreshStatusIndicators()}
function tick(){}
function updatePreset(){
 const p=presets[presetIndex];setText($('presetName'),String(presetIndex+1).padStart(2,'0')+'  '+p.name);
 setAmp?.(p.amp);setOd?.(p.od);setEq?.(p.amp==='American Clean'?'Default':p.amp==='Modern 5150'?'V-Curve':'Mid Focus');
 setCab?.(p.cab);setFx?.(p.fx);setFxMode?.(p.fxMode||'DELAY');
}
function cyclePreset(dir){presetIndex=(presetIndex+dir+presets.length)%presets.length;updatePreset()}
function savePreset(){
 const name=prompt('Nama preset:',String($('presetName')?.textContent||'My Preset').trim())?.trim();if(!name)return;
 const p={name,amp:selectedAmp,od:selectedOd,eq:selectedEq,cab:selectedCab||$('cabModel')?.textContent||irPackV1[0],fx:$('fxModel')?.textContent||'Hall Reverb',fxMode:selectedFxMode,state:{...state},bypass:{...moduleBypass},irName:irName||selectedCab};
 savedPresets=savedPresets.filter(x=>x.name!==name);savedPresets.push(p);localStorage.setItem('solarSavedPresets',JSON.stringify(savedPresets));alert('Preset tersimpan: '+name);
}
function loadSavedPreset(p){
 if(!p)return;
 Object.assign(state,p.state||{});
 setAmp?.(p.amp||'British 800');setOd?.(p.od||'Tube Screamer');setEq?.(p.eq||'Default');
 const savedIR=p.irName||p.cab;
 if(irPackV1.includes(savedIR))setCab?.(savedIR);
 else if(irFiles.has(savedIR)){irBuffer=irFiles.get(savedIR).buffer;irName=savedIR;selectedCab=savedIR;setText($('cabModel'),savedIR.replace(/\.(wav|aiff?|flac)$/i,''));setText($('irStatus'),'CUSTOM • '+savedIR);refreshCab()}
 else setCab?.(p.cab||irPackV1[0]);
 setFx?.(p.fx||'Hall Reverb');setFxMode?.(p.fxMode||'DELAY');
 setText($('presetName'),'★  '+p.name);
 Object.entries(moduleBypass).forEach(([k])=>moduleBypass[k]=Boolean(p.bypass?.[k]));
 document.querySelectorAll('.module-bypass[data-module]').forEach(icon=>{const n=icon.dataset.module;icon.textContent=moduleBypass[n]?'🖕':'👍';icon.classList.toggle('bypassed',moduleBypass[n]);icon.setAttribute('aria-pressed',String(!moduleBypass[n]))});
 Object.entries(state).forEach(([k,v])=>knobSetters[k]?.(v));
 applyAmpModel(selectedAmp);applyOdModel(selectedOd);applyEqModel(selectedEq);applyCabModel(selectedCab);applyFxModel(selectedFx);applyFxMode(selectedFxMode);
}
function manageSavedPresets(){
 if(!savedPresets.length){alert('Belum ada preset tersimpan.');return}
 const list=savedPresets.map((p,i)=>(i+1)+'. '+p.name).join('\\n');
 const choice=prompt('SAVED PRESETS\\n\\n'+list+'\\n\\nKetik nomor untuk LOAD, atau D1/D2... untuk DELETE:');
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
 function update(){if(label)label.textContent=selector==='#cabSelect'?formatIRName(values[i]):values[i];onChange?.(values[i],i)}
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
function applyAmpModel(name){selectedAmp=name;const p={'British 800':0,'American Clean':1,'Modern 5150':2}[name]??0;SPVFUI(25,p/2)}
function applyEqModel(name){selectedEq=name;const profiles={'Default':[50,50,50],'V-Curve':[66.7,29.2,66.7],'Mid Focus':[41.7,70.8,45.8]};const p=profiles[name]||profiles.Default;state.eqLow=p[0];state.eqMid=p[1];state.eqHigh=p[2];knobSetters.eqLow?.(state.eqLow);knobSetters.eqMid?.(state.eqMid);knobSetters.eqHigh?.(state.eqHigh);refreshEq()}
function applyOdModel(name){selectedOd=name;const p={'Tube Screamer':[35,50,72,true],'Tight OD':[48,58,70,true],'Off':[0,50,100,false]}[name]||[35,50,72,true];state.drive=p[0];state.tone=p[1];state.level=p[2];SPVFUI(14,p[0]/100);SPVFUI(15,p[1]/100);SPVFUI(16,p[2]/100);SPVFUI(22,p[3]?1:0);moduleBypass.od=!p[3];const icon=document.querySelector('.module-bypass[data-module="od"]');if(icon){icon.textContent=moduleBypass.od?'🖕':'👍';icon.classList.toggle('bypassed',moduleBypass.od)}}
const builtInCabMap={
 '4x12 V30':'6100_ZCB_57_API',
 '4x12 V30 57':'6100_ZCB_57_API',
 '4x12 V30 421':'6100_ZCB_421_API',
 '4x12 V30 201':'6100_ZCB_201_API',
 '4x12 V30 906':'6100_ZCB_906_API',
 '4x12 6505':'6505_ZCB_57_API',
 '4x12 6505 57':'6505_ZCB_57_API'
};
async function applyCabModel(name){
 selectedCab=name;if(!name)return;
 const nativeName=builtInCabMap[name]||name;
 setText($('cabModel'),formatIRName(nativeName));
 setText($('irStatus'),'CAB • loading native IR…');
 try{
  const bytes=new TextEncoder().encode(String(nativeName));
  let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  SAMFUI(104,-1,btoa(s));
  setText($('irStatus'),'CAB • native IR '+formatIRName(nativeName));
 }catch(e){setText($('irStatus'),'CAB IR ERROR • '+(e?.message||e))}
}
function renderIRLibrary(){
 const box=$('irLibrary');if(!box)return;box.innerHTML='';
 irFiles.forEach((v,name)=>{
  const b=document.createElement('button');b.type='button';b.className='ir-item';b.textContent=name;b.title=name;
  b.addEventListener('click',()=>{irBuffer=v.buffer;irName=name;selectedCab=name;setText($('cabModel'),formatIRName(name));setText($('irStatus'),irPackV1.includes(name)?'PACK V1 • '+formatIRName(name):'CUSTOM • '+name);refreshCab()});
  box.appendChild(b);
 });
}
async function loadIRFile(file){if(!file)return;try{const u=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));SAMFUI(101,-1,btoa(s));irName=file.name;selectedCab=file.name;setText($('cabModel'),formatIRName(file.name));setText($('irStatus'),'NATIVE DSP • loading '+file.name)}catch(e){setText($('irStatus'),'IR LOAD ERROR • '+(e?.message||e))}}
function saveIRLocal(name,buffer){try{const data=buffer.getChannelData(0);const arr=new Float32Array(data);localStorage.setItem('solarLastIRName',name);localStorage.setItem('solarLastIR',btoa(String.fromCharCode(...new Uint8Array(arr.buffer))));}catch{}}

function applyFxModel(name){selectedFx=name;const p={'Hall Reverb':[42,30],'Plate Reverb':[18,38],'Room Reverb':[10,20],'Studio Hall':[32,34]}[name]||[42,30];state.delay=p[0];state.reverb=p[1];refreshFx()}
function applyFxMode(mode){selectedFxMode=mode;document.querySelectorAll('.fx-modes button').forEach(x=>x.classList.toggle('selected',x.textContent.trim()===mode));refreshFx()}
function wireUI(){$('start')?.addEventListener('click',()=>{if(!running)start();else toggleModule('amp')});$('stopAudio')?.addEventListener('click',stop);$('presetPrev')?.addEventListener('click',()=>cyclePreset(-1));$('presetNext')?.addEventListener('click',()=>cyclePreset(1));$('savePreset')?.addEventListener('click',savePreset);$('presetMenu')?.addEventListener('click',manageSavedPresets);document.querySelectorAll('.chain-node[data-target]').forEach(n=>n.addEventListener('click',()=>$(n.dataset.target)?.scrollIntoView({behavior:'smooth',block:'center'})));setAmp=wireModelSelector('#ampSelect',['British 800','American Clean','Modern 5150'],applyAmpModel);setOd=wireModelSelector('#odSelect',['Tube Screamer','Tight OD','Off'],applyOdModel);setEq=wireModelSelector('#eqSelect',['Default','V-Curve','Mid Focus'],applyEqModel);wireEqGraph();setCab=wireModelSelector('#cabSelect',irPackV1,applyCabModel);document.querySelector('#irInput')?.addEventListener('change',async e=>{for(const f of [...(e.target.files||[])])await loadIRFile(f);e.target.value=''});renderIRLibrary();setFx=wireModelSelector('#fxSelect',['Hall Reverb','Plate Reverb','Room Reverb','Studio Hall'],applyFxModel);setFxMode=applyFxMode;document.querySelectorAll('.fx-modes button').forEach(b=>b.addEventListener('click',()=>applyFxMode(b.textContent.trim())));document.querySelectorAll('.module-bypass[data-module]:not(#start)').forEach(icon=>icon.addEventListener('click',()=>toggleModule(icon.dataset.module)));$('sourceSwitch')?.addEventListener('click',()=>toggleAmpSource());$('nam')?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;setText($('fileName'),f.name);try{const u=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));namModelJson=btoa(s);namModelLoaded=false;namReady=true;namPending=true;SAMFUI(100,-1,namModelJson);namModelLoaded=true;namMode=true;namSourceActive=true;moduleBypass.amp=false;SAMFUI(103,-1,byte64(true));SAMFUI(102,-1,byte64(false));namPending=false;refreshAllBypass();refreshNamBypass();setText($('modelStatus'),f.name+' • NAM ACTIVE • native DSP');refreshStatusIndicators()}catch(e){namModelJson='';setText($('modelStatus'),'NAM LOAD ERROR • '+(e?.message||e))}})}
window.SOLARSetStatus=t=>{
 const msg=String(t??'');
 setText($('modelStatus'),msg);
 if(/^NAM MODEL - loaded into native DSP/i.test(msg)){
   namModelLoaded=true;namReady=true;namPending=false;
   refreshStatusIndicators();
 }else if(/^NAM MODEL ERROR/i.test(msg)){
   namModelLoaded=false;namReady=false;namPending=false;namMode=false;namSourceActive=false;
   refreshStatusIndicators();
 }else if(/^IR - loaded into native DSP/i.test(msg)||/^CAB • built-in IR loaded/i.test(msg)){
   refreshCab();
 }
};
wireUI();updatePreset();
makeKnobs('amp',['GAIN','BASS','MID','TREBLE','PRESENCE','MASTER']);
makeKnobs('od',['DRIVE','TONE','LEVEL']);
makeKnobs('eq',['LOW','HIGH']);
makeKnobs('fx',['DELAY','REVERB']);

