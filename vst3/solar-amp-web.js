/* SOLAR AMP native VST3 WebView UI — UI only; NAM DSP stays native C++. */
(function(){
  const $=id=>document.getElementById(id);
  const send=m=>window.IPlugSendMsg&&IPlugSendMsg(m);
  const b64=buf=>{let s='',a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)};
  const byte64=v=>btoa(String.fromCharCode(v?1:0));
  window.__SOLAR_VST3__=true;
  window.SOLARSetStatus=function(t){
    const s=String(t||'');
    const el=document.getElementById('modelStatus');if(el)el.textContent=s;
    if(/^NAM MODEL - loaded into native DSP/i.test(s)){
      window.__solarNativeModelLoaded=true;
      if(typeof namReady!=='undefined')namReady=true;
      if(typeof namModelLoaded!=='undefined')namModelLoaded=true;
      if(typeof namMode!=='undefined' && typeof setNamAmpMode==='function')setNamAmpMode(true);
    }
    if(/^NAM MODEL ERROR/i.test(s)){
      window.__solarNativeModelLoaded=false;
      if(typeof namModelLoaded!=='undefined')namModelLoaded=false;
    }
  };
  window.SPVFUI=(idx,value)=>send({msg:'SPVFUI',paramIdx:idx,value:Number(value)});
  window.BPCFUI=idx=>send({msg:'BPCFUI',paramIdx:idx});
  window.EPCFUI=idx=>send({msg:'EPCFUI',paramIdx:idx});
  window.SAMFUI=(msgTag,ctrlTag=-1,data=0)=>send({msg:'SAMFUI',msgTag,ctrlTag,data});
  window.SAMFD=(msgTag,dataSize,msg)=>{
    if(msgTag!==-1)return;
    try{
      const raw=atob(msg||'');const j=JSON.parse(raw);
      if(j.id==='solar-status'){
        if($('modelStatus'))$('modelStatus').textContent=j.message||'';
        if(j.type==='model-loaded'){window.__solarModelLoaded=true;window.__solarModelReady=true;}
        if(j.type==='error'){window.__solarModelLoaded=false;}
      }
      if(j.id==='solar-host'){
        if($('engine'))$('engine').textContent='NATIVE NAM DSP';
        if($('rate'))$('rate').textContent=(j.sampleRate||0)+' Hz';
        if($('latency'))$('latency').textContent=(j.latencyMs||0).toFixed(1)+' ms';
      }
    }catch{}
  };
  window.SPVFD=(idx,val)=>{};
  window.SAMFD_native=window.SAMFD;
  function status(t){if($('modelStatus'))$('modelStatus').textContent=t}
  function setEngine(){if($('engine'))$('engine').textContent='NATIVE NAM DSP';if($('rate'))$('rate').textContent=window.__solarRate?window.__solarRate+' Hz':'HOST';if($('latency'))$('latency').textContent=window.__solarLatency?window.__solarLatency.toFixed(1)+' ms':'NATIVE'}
  window.start=function(){
    if(window.running)return;
    window.running=true;
    setEngine();
    $('start')?.classList.add('on');
    if($('start'))$('start').textContent='👍';
    $('stopAudio')?.removeAttribute('hidden');
    status(window.__solarModelLoaded?'NATIVE NAM • READY':'NATIVE NAM • choose a .NAM model');
  };
  window.stop=function(){
    window.running=false;
    $('stopAudio')?.setAttribute('hidden','');
    $('start')?.classList.remove('on');
    if($('start'))$('start').textContent='🖕';
    setEngine();
  };
  window.toggleAmpSource=function(){
    const next=!Boolean(window.__solarNamActive);
    window.__solarNamActive=next;
    SAMFUI(102,-1,byte64(next));
    if($('sourceSwitch')){$('sourceSwitch').classList.toggle('nam-selected',next);$('sourceSwitch').textContent=next?'SWITCH → AMP':'SWITCH → NAM'}
    status(next?'NATIVE NAM • ACTIVE':'NATIVE AMP • BYPASS');
  };
  window.toggleModule=function(name){
    const on=!(window.__solarBypass||{})[name];
    window.__solarBypass=window.__solarBypass||{};
    window.__solarBypass[name]=on;
    const icon=document.querySelector('.module-bypass[data-module="'+name+'"]');
    if(icon){icon.textContent=on?'🖕':'👍';icon.classList.toggle('bypassed',on);icon.setAttribute('aria-pressed',String(on));}
    if(name==='amp'){SAMFUI(102,-1,byte64(on));window.__solarNamActive=!on;}
    if(name==='eq')SPVFUI(7,on?0:1);
    if(name==='cab')SPVFUI(8,on?0:1);
    if(typeof refreshStatusIndicators==='function')refreshStatusIndicators();
  };
  window.apply=function(k,v){
    const m={gain:[0, v/100],bass:[2,v/100],mid:[3,v/100],treble:[4,v/100],master:[5,v/100]};
    if(m[k])SPVFUI(m[k][0],m[k][1]);
  };
  async function loadNativeModel(file){
    if(!file)return;
    if(file.size>64*1024*1024){status('MODEL TOO LARGE');return}
    status('NAM MODEL • sending to native DSP…');
    try{SAMFUI(100,-1,b64(await file.arrayBuffer()));$('fileName').textContent=file.name;}
    catch(e){status('NAM UI ERROR • '+e.message)}
  }
  async function loadNativeIR(file){
    if(!file)return;
    if(file.size>64*1024*1024){status('IR TOO LARGE');return}
    status('IR • sending to native DSP…');
    try{SAMFUI(101,-1,b64(await file.arrayBuffer()));$('irStatus').textContent='NATIVE DSP • loading';$('cabModel').textContent=file.name.replace(/\.(wav|aiff?|flac)$/i,'');}
    catch(e){status('IR UI ERROR • '+e.message)}
  }
  function setup(){
    setEngine();
    const nam=$('nam'); if(nam)nam.addEventListener('change',()=>loadNativeModel(nam.files?.[0]));
    const ir=$('irInput'); if(ir)ir.addEventListener('change',()=>loadNativeIR(ir.files?.[0]));
    $('start')?.addEventListener('click',()=>window.start());
    $('sourceSwitch')?.addEventListener('click',()=>window.toggleAmpSource());
    document.querySelectorAll('.module-bypass[data-module]').forEach(b=>b.addEventListener('click',()=>window.toggleModule(b.dataset.module)));
    status('NATIVE NAM • choose a .NAM model');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();