/* SOLAR AMP native VST3 UI bridge.
   IMPORTANT: this file never creates Web Audio. Cubase owns the audio stream and
   the C++ DSP owns OD/AMP/NAM/CAB/EQ/FX. The WebView is only the control surface. */
(() => {
  const $ = id => document.getElementById(id);
  const state = {gain:25,bass:100,mid:50,treble:50,presence:50,master:100,drive:35,tone:50,level:72,eqLow:50,eqMid:50,eqHigh:50,delay:28,reverb:22};
  const bypass = {amp:false,od:false,eq:false,cab:false,fx:false};
  let namLoaded=false, namActive=false;
  let selectedAmp='British 800', selectedOd='Tube Screamer', selectedEq='Default', selectedCab='6100_ZCB_57_API', selectedFx='Hall Reverb', selectedFxMode='DELAY';
  let knobSetters={}; let irNames=[];
  const ampModels=['British 800','American Clean','Modern 5150'];
  const odModels=['Tube Screamer','Tight OD','Off'];
  const eqModels=['Default','V-Curve','Mid Focus'];
  const cabModels=['6100_ZCB_57_API','6100_ZCB_57_NV','6100_ZCB_57OFF_API','6100_ZCB_57OFF_NV','6100_ZCB_201_API','6100_ZCB_201_NV','6100_ZCB_421_API','6100_ZCB_421_NV','6100_ZCB_906_API','6100_ZCB_906_NV','6505_ZCB_57_API','6505_ZCB_57_NV','6505_ZCB_57OFF_API','6505_ZCB_57OFF_NV','6505_ZCB_201_API','6505_ZCB_201_NV','6505_ZCB_421_API','6505_ZCB_421_NV','6505_ZCB_906_API','6505_ZCB_906_NV'];
  const fxModels=['Hall Reverb','Plate Reverb','Room Reverb','Studio Hall'];
  const fxModes=['DELAY','REVERB','CHORUS','PHASER','TREMOLO'];
  const presets=[
    {name:'Default Preset',amp:'British 800',od:'Tube Screamer',eq:'Default',cab:'6100_ZCB_57_API',fx:'Hall Reverb',fxMode:'REVERB'},
    {name:'Clean Glass',amp:'American Clean',od:'Off',eq:'Default',cab:'6100_ZCB_421_API',fx:'Plate Reverb',fxMode:'REVERB'},
    {name:'Modern High Gain',amp:'Modern 5150',od:'Tight OD',eq:'V-Curve',cab:'6505_ZCB_57_API',fx:'Studio Hall',fxMode:'REVERB'}
  ];
  let presetIndex=0;

  const send=(m)=>{ try{ if(window.IPlugSendMsg) window.IPlugSendMsg(m); }catch(e){ console.error(e); } };
  const b64=buf=>{let s='',a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)};
  const byte64=v=>btoa(String.fromCharCode(v?1:0));
  const u8b64=v=>btoa(String.fromCharCode(Number(v)&255));
  const sendParam=(idx,v)=>send({msg:'SPVFUI',paramIdx:idx,value:Math.max(0,Math.min(1,Number(v)))});
  const sendModule=(module,on)=>send({msg:'SAMFUI',msgTag:110,ctrlTag:{od:0,amp:1,eq:2,cab:3,fx:4}[module],data:byte64(on)});
  const setStatus=t=>{if($('modelStatus'))$('modelStatus').textContent=t};
  window.SOLARSetStatus=setStatus;
  window.SAMFD=(msgTag,dataSize,msg)=>{ if(msgTag===-1){try{const j=JSON.parse(atob(msg||''));if(j.id==='solar-status')setStatus(j.message||'');}catch{}} };
  window.SPVFD=(idx,val)=>{};
  window.__SOLAR_VST3__=true;

  function refreshIndicators(){
    const nam=namActive&&!bypass.amp;
    const amp=$('stateAmp'), bp=$('stateBypass');
    amp?.classList.toggle('selected',!bypass.amp);
    amp?.classList.toggle('nam-active',nam);
    const lab=amp?.querySelector('b'); if(lab)lab.textContent=nam?'NAM':'AMP';
    bp?.classList.toggle('selected',bypass.amp);
    const sw=$('sourceSwitch');
    if(sw){sw.disabled=!namLoaded;sw.textContent=nam?'SWITCH → AMP':'SWITCH → NAM';sw.classList.toggle('nam-selected',nam);}
    const map={od:'odModule',amp:'ampModule',cab:'cabModule',eq:'eqModule',fx:'fxModule'};
    Object.entries(map).forEach(([n,id])=>{const node=document.querySelector('.chain-node[data-target="'+id+'"]');node?.classList.toggle('active',!bypass[n]);node?.classList.toggle('bypassed',bypass[n]);});
  }

  function toggleModule(name){
    bypass[name]=!bypass[name];
    const active=!bypass[name];
    const icon=document.querySelector('.module-bypass[data-module="'+name+'"]');
    if(icon){icon.textContent=bypass[name]?'🖕':'👍';icon.classList.toggle('bypassed',bypass[name]);icon.setAttribute('aria-pressed',String(active));}
    // Native DSP gets an immediate dedicated module message. We also update the
    // VST3 parameter so automation/state remain correct.
    sendModule(name,active);
    if(name==='amp'){
      // AMP bypass must also clear the NAM source selector. Re-enabling AMP does
      // not implicitly select NAM; the explicit source switch controls that.
      if(bypass.amp)namActive=false;
      send({msg:'SAMFUI',msgTag:103,ctrlTag:-1,data:byte64(namActive)});
      send({msg:'SAMFUI',msgTag:102,ctrlTag:-1,data:byte64(bypass.amp)});
    }
    else if(name==='eq')sendParam(7,active?1:0);
    else if(name==='cab')sendParam(8,active?1:0);
    else if(name==='od')sendParam(22,active?1:0);
    else if(name==='fx')sendParam(23,active?1:0);
    refreshIndicators();
  }

  async function toggleSource(){
    if(!namLoaded){setStatus('NO NAM MODEL • choose a .NAM file first');return;}
    if(bypass.amp)bypass.amp=false;
    namActive=!namActive;
    send({msg:'SAMFUI',msgTag:103,ctrlTag:-1,data:byte64(namActive)});
    send({msg:'SAMFUI',msgTag:102,ctrlTag:-1,data:byte64(false)});
    setStatus(namActive?'NAM ACTIVE • native DSP':'AMP ACTIVE • native legacy stage');
    refreshIndicators();
  }

  function apply(k,v){
    state[k]=v;
    const map={gain:0,bass:2,mid:3,treble:4,presence:13,master:26,drive:14,tone:15,level:16,eqLow:17,eqMid:18,eqHigh:19,delay:20,reverb:21};
    if(map[k]!==undefined) sendParam(map[k],v/100);
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
      const v=document.createElement('b'),l=document.createElement('small');l.textContent=name;d.append(f,v,l);
      let value=state[key]??50;
      const set=x=>{value=Math.max(0,Math.min(100,Math.round(x)));state[key]=value;v.textContent=value+'%';f.style.setProperty('--pct',value);f.style.setProperty('--angle',(-135+value*2.7)+'deg');apply(key,value)};
      knobSetters[key]=set;set(value);
      let sy,sv;
      f.addEventListener('pointerdown',e=>{e.preventDefault();sy=e.clientY;sv=value;f.setPointerCapture?.(e.pointerId)});
      f.addEventListener('pointermove',e=>{if(sy!==undefined)set(sv+(sy-e.clientY)*.5)});
      f.addEventListener('pointerup',()=>sy=undefined);f.addEventListener('pointercancel',()=>sy=undefined);
      f.addEventListener('wheel',e=>{e.preventDefault();set(value+(e.deltaY<0?2:-2))},{passive:false});
      root.append(d);
    });
  }

  function formatIR(n){return String(n).replace(/_ZCB_/,' • ').replace(/_/g,' • ').replace('57OFF','57 OFF').replace(/\.wav$/i,'')}

  function wireSelector(selector,values,onChange){
    const box=document.querySelector(selector);if(!box)return;
    const label=box.querySelector('strong'),bs=box.querySelectorAll('button');let i=0;
    const update=()=>{label&&(label.textContent=selector==='#cabSelect'?formatIR(values[i]):values[i]);onChange?.(values[i],i)};
    bs[0]?.addEventListener('click',()=>{i=(i-1+values.length)%values.length;update()});
    bs[1]?.addEventListener('click',()=>{i=(i+1)%values.length;update()});
    update();
    return value=>{const n=values.indexOf(value);if(n>=0){i=n;update()}};
  }

  function selectAmp(name,idx){
    selectedAmp=name;sendParam(25,idx/Math.max(1,ampModels.length-1));
    setStatus('AMP • '+name);
  }
  function selectOd(name){
    selectedOd=name;
    if(name==='Off'){knobSetters.drive?.(0);bypass.od=true;sendParam(22,0);}
    else {bypass.od=false;sendParam(22,1);if(name==='Tight OD'){knobSetters.drive?.(48);knobSetters.tone?.(62)}else{knobSetters.drive?.(35);knobSetters.tone?.(50)}}
    refreshIndicators();
  }
  function selectEq(name){
    selectedEq=name;
    const p=name==='V-Curve'?[75,30,75]:name==='Mid Focus'?[42,72,46]:[50,50,50];
    knobSetters.eqLow?.(p[0]);knobSetters.eqMid?.(p[1]);knobSetters.eqHigh?.(p[2]);
  }
  function selectFx(name){
    selectedFx=name;
    const p={ 'Hall Reverb':[28,35], 'Plate Reverb':[18,42], 'Room Reverb':[10,22], 'Studio Hall':[32,38]}[name]||[28,35];
    knobSetters.delay?.(p[0]);knobSetters.reverb?.(p[1]);
  }
  function selectFxMode(mode,idx){
    selectedFxMode=mode;
    const i=Number.isInteger(idx)?idx:Math.max(0,fxModes.indexOf(mode));
    document.querySelectorAll('.fx-modes button').forEach(b=>b.classList.toggle('selected',b.textContent.trim()===mode));
    sendParam(24,i/4);
    send({msg:'SAMFUI',msgTag:111,ctrlTag:-1,data:u8b64(i)});
  }

  async function loadBuiltInIR(name){
    setStatus('CAB • loading '+name+'…');
    // 104 is the dedicated native built-in IR selector. Do NOT send 103 here:
    // 103 is the NAM/legacy AMP source selector and must never be used for CAB.
    send({msg:'SAMFUI',msgTag:104,ctrlTag:-1,data:btoa(name)});
    selectedCab=name;bypass.cab=false;sendParam(8,1);
    if($('cabModel'))$('cabModel').textContent=formatIR(name);
    if($('irStatus'))$('irStatus').textContent='PACK V1 • '+formatIR(name);
    refreshIndicators();
  }

  async function loadCustomIR(file){
    if(!file)return;
    try{
      send({msg:'SAMFUI',msgTag:101,ctrlTag:-1,data:b64(await file.arrayBuffer())});
      selectedCab=file.name;
      if($('cabModel'))$('cabModel').textContent=file.name;
      if($('irStatus'))$('irStatus').textContent='CUSTOM • native DSP loading';
      bypass.cab=false;sendParam(8,1);refreshIndicators();
    }catch(e){setStatus('IR ERROR • '+e.message)}
  }

  function wireEqGraph(){
    const svg=document.querySelector('.eq-graph svg'),path=$('eqCurve'),fill=$('eqFill');if(!svg)return;
    const draw=()=>{const a=(state.eqLow-50)*.24,b=(state.eqMid-50)*.24,c=(state.eqHigh-50)*.24,y=g=>50-Math.max(-12,Math.min(12,g))*2.65,d='M0 '+y(a)+' C55 '+y(a)+' 92 '+y(b)+' 150 '+y(b)+' C208 '+y(b)+' 245 '+y(c)+' 300 '+y(c);path?.setAttribute('d',d);fill?.setAttribute('d',d+' L300 100 L0 100 Z');};
    const map={eqLowPoint:'eqLow',eqMidPoint:'eqMid',eqHighPoint:'eqHigh'};let active=null;
    ['eqLowPoint','eqMidPoint','eqHighPoint'].forEach((id,i)=>{const p=document.createElementNS('http://www.w3.org/2000/svg','circle');p.id=id;p.setAttribute('r','5');p.classList.add('eq-point');p.setAttribute('cx',[42,150,258][i]);svg.append(p)});
    const move=e=>{if(!active)return;const r=svg.getBoundingClientRect(),k=map[active],gain=Math.max(-12,Math.min(12,(50-(e.clientY-r.top))/2.65));knobSetters[k]?.(50+gain/.24);draw()};
    svg.addEventListener('pointerdown',e=>{if(map[e.target.id]){active=e.target.id;e.target.setPointerCapture?.(e.pointerId);move(e);e.preventDefault()}});
    svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',()=>active=null);svg.addEventListener('pointercancel',()=>active=null);draw();
  }

  function updatePreset(){
    const p=presets[presetIndex];$('presetName').textContent=String(presetIndex+1).padStart(2,'0')+'  '+p.name;
    setAmp?.(p.amp);setOd?.(p.od);setEq?.(p.eq);setCab?.(p.cab);setFx?.(p.fx);setFxMode?.(p.fxMode);
  }
  function cyclePreset(dir){presetIndex=(presetIndex+dir+presets.length)%presets.length;updatePreset()}

  function wireUI(){
    $('start')?.addEventListener('click',()=>toggleModule('amp'));
    $('sourceSwitch')?.addEventListener('click',toggleSource);
    $('stopAudio')?.addEventListener('click',()=>setStatus('Audio is host-controlled in VST3'));
    $('presetPrev')?.addEventListener('click',()=>cyclePreset(-1));$('presetNext')?.addEventListener('click',()=>cyclePreset(1));
    document.querySelectorAll('.chain-node[data-target]').forEach(n=>n.addEventListener('click',()=>$(n.dataset.target)?.scrollIntoView({behavior:'smooth',block:'center'})));
    document.querySelectorAll('.module-bypass[data-module]:not(#start)').forEach(b=>b.addEventListener('click',()=>toggleModule(b.dataset.module)));
    setAmp=wireSelector('#ampSelect',ampModels,selectAmp);
    setOd=wireSelector('#odSelect',odModels,selectOd);
    setEq=wireSelector('#eqSelect',eqModels,selectEq);
    setCab=wireSelector('#cabSelect',cabModels,loadBuiltInIR);
    setFx=wireSelector('#fxSelect',fxModels,selectFx);
    setFxMode=selectFxMode;
    document.querySelectorAll('.fx-modes button').forEach((b,i)=>b.addEventListener('click',()=>selectFxMode(b.textContent.trim(),i)));
    $('nam')?.addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;
      try{
        send({msg:'SAMFUI',msgTag:100,ctrlTag:-1,data:b64(await file.arrayBuffer())});
        namLoaded=true;namActive=true;bypass.amp=false;
        $('fileName').textContent=file.name;setStatus('NAM MODEL • sending to native DSP…');
        send({msg:'SAMFUI',msgTag:103,ctrlTag:-1,data:byte64(true)});send({msg:'SAMFUI',msgTag:102,ctrlTag:-1,data:byte64(false)});
        refreshIndicators();
      }catch(err){setStatus('NAM ERROR • '+err.message)}
    });
    $('irInput')?.addEventListener('change',async e=>{for(const f of [...(e.target.files||[])])await loadCustomIR(f);e.target.value=''});
    $('savePreset')?.addEventListener('click',()=>{const name=prompt('Nama preset:',$('presetName')?.textContent||'My Preset');if(name){localStorage.setItem('solar-last-preset',name);setStatus('Preset saved • '+name)}});
    $('presetMenu')?.addEventListener('click',()=>setStatus('Preset menu • use PREV/NEXT'));
  }

  wireUI();
  makeKnobs('amp',['GAIN','BASS','MID','TREBLE','PRESENCE','MASTER']);
  makeKnobs('od',['DRIVE','TONE','LEVEL']);
  makeKnobs('eq',['LOW','MID','HIGH']);
  makeKnobs('fx',['DELAY','REVERB']);
  wireEqGraph();
  refreshIndicators();
  setStatus('NATIVE DSP • choose a .NAM model');
  if($('engine'))$('engine').textContent='NATIVE NAM DSP';
  if($('rate'))$('rate').textContent='HOST';
  if($('latency'))$('latency').textContent='NATIVE';
})();
