/* SOLAR AMP native VST3 WebView bridge.
 * Native UI/DSP integration revision: full app.js is loaded after this bridge.
 * The full UI/interaction logic lives in app.js; this file only bridges
 * iPlug2 WebView messages to the native DSP.
 */
(function(){
  const send=m=>window.IPlugSendMsg&&IPlugSendMsg(m);
  const b64=buf=>{
    let s='',a=new Uint8Array(buf);
    for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));
    return btoa(s);
  };
  const byte64=v=>btoa(String.fromCharCode(v?1:0));
  window.__SOLAR_VST3__=true;
  window.SPVFUI=(idx,value)=>send({msg:'SPVFUI',paramIdx:idx,value:Number(value)});
  window.BPCFUI=idx=>send({msg:'BPCFUI',paramIdx:idx});
  window.EPCFUI=idx=>send({msg:'EPCFUI',paramIdx:idx});
  window.SAMFUI=(msgTag,ctrlTag=-1,data=0)=>send({msg:'SAMFUI',msgTag,ctrlTag,data});
  window.SOLARSetStatus=function(t){
    const s=String(t||'');
    const el=document.getElementById('modelStatus');if(el)el.textContent=s;
    if(/^NAM MODEL - loaded into native DSP/i.test(s)){
      window.__solarNativeModelLoaded=true;
      if(typeof namReady!=='undefined')namReady=true;
      if(typeof namModelLoaded!=='undefined')namModelLoaded=true;
      if(typeof refreshStatusIndicators==='function')refreshStatusIndicators();
    }
    if(/^NAM MODEL ERROR/i.test(s)){
      window.__solarNativeModelLoaded=false;
      if(typeof namModelLoaded!=='undefined')namModelLoaded=false;
      if(typeof refreshStatusIndicators==='function')refreshStatusIndicators();
    }
  };
  window.SAMFD=(msgTag,dataSize,msg)=>{
    if(msgTag!==-1)return;
    try{
      const raw=atob(msg||'');const j=JSON.parse(raw);
      if(j.id==='solar-status')window.SOLARSetStatus(j.message||'');
      if(j.id==='solar-host'){
        const e=document.getElementById('engine'),r=document.getElementById('rate'),l=document.getElementById('latency');
        if(e)e.textContent='NATIVE NAM DSP';
        if(r)r.textContent=(j.sampleRate||0)+' Hz';
        if(l)l.textContent=(j.latencyMs||0).toFixed(1)+' ms';
      }
    }catch{}
  };
  window.__SOLAR_B64__=b64;
  window.__SOLAR_BYTE64__=byte64;
})();