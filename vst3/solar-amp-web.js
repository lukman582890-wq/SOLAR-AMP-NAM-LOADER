/* SOLAR AMP native VST3 WebView UI
 * The WebView is UI only: audio/NAM DSP remains native C++.
 */
(function(){
  const $=id=>document.getElementById(id);
  const send=(m)=>window.IPlugSendMsg&&IPlugSendMsg(m);
  function b64(buf){let s='';const a=new Uint8Array(buf);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s)}
  function param(idx,value,begin=false,end=false){
    if(begin)send({msg:'BPCFUI',paramIdx:idx});
    send({msg:'SPVFUI',paramIdx:idx,value});
    if(end)send({msg:'EPCFUI',paramIdx:idx});
  }
  const defs=[
    ['Input',0, -20,20,0],['Threshold',1,-100,0,-80],
    ['Bass',2,0,10,5],['Middle',3,0,10,5],['Treble',4,0,10,5],['Output',5,-40,40,0]
  ];
  function makeKnobs(){
    const host=$('amp'); if(!host)return;
    host.innerHTML='';
    defs.forEach(([name,idx,min,max,val])=>{
      const wrap=document.createElement('div');wrap.className='knob';
      wrap.innerHTML='<div class="knobface"><div class="knobmark"></div></div><div class="knoblabel"></div><div class="knobvalue"></div>';
      wrap.querySelector('.knoblabel').textContent=name.toUpperCase();
      const face=wrap.querySelector('.knobface'), value=wrap.querySelector('.knobvalue');
      let v=val;
      const render=()=>{const n=(v-min)/(max-min);face.style.transform='rotate('+(-135+n*270)+'deg)';value.textContent=(name==='Bass'||name==='Middle'||name==='Treble'?v.toFixed(1):v.toFixed(1))+(name==='Threshold'||name==='Input'||name==='Output'?' dB':'')};
      let sy=0,sv=0;
      face.addEventListener('pointerdown',e=>{e.preventDefault();face.setPointerCapture(e.pointerId);sy=e.clientY;sv=v;param(idx,(sv-min)/(max-min),true)});
      face.addEventListener('pointermove',e=>{if(!face.hasPointerCapture(e.pointerId))return;v=Math.max(min,Math.min(max,sv+(sy-e.clientY)*(max-min)/180));param(idx,(v-min)/(max-min));render()});
      face.addEventListener('pointerup',e=>{if(face.hasPointerCapture(e.pointerId)){face.releasePointerCapture(e.pointerId);param(idx,(v-min)/(max-min),false,true)}});
      wrap.addEventListener('wheel',e=>{e.preventDefault();v=Math.max(min,Math.min(max,v-e.deltaY*(max-min)/1000));param(idx,(v-min)/(max-min));render()},{passive:false});
      render();host.appendChild(wrap);
    });
  }
  function setStatus(t){if($('modelStatus'))$('modelStatus').textContent=t}
  function setup(){
    makeKnobs();
    if($('engine'))$('engine').textContent='NATIVE NAM DSP';
    if($('rate'))$('rate').textContent='HOST';
    if($('latency'))$('latency').textContent='NATIVE';
    const input=$('nam');
    if(input)input.addEventListener('change',async()=>{
      const f=input.files&&input.files[0];if(!f)return;
      if(f.size>32*1024*1024){setStatus('MODEL TOO LARGE');return}
      setStatus('NAM MODEL • sending to native DSP…');
      try{
        const data=await f.arrayBuffer();
        send({msg:'SOLAR_LOAD_NAM',name:f.name,data:b64(data)});
      }catch(e){setStatus('NAM UI ERROR • '+e.message)}
    });
    const start=$('start');
    if(start){start.textContent='POWER';start.onclick=()=>send({msg:'SOLAR_TOGGLE_NAM'});}
    const sw=$('sourceSwitch');
    if(sw){sw.disabled=false;sw.onclick=()=>send({msg:'SOLAR_TOGGLE_NAM'});}
    document.querySelectorAll('.module-bypass').forEach(b=>b.addEventListener('click',()=>{
      const mod=b.dataset.module;if(mod==='amp')send({msg:'SOLAR_TOGGLE_NAM'});
      else b.classList.toggle('active');
    }));
    setStatus('NATIVE NAM • choose a .NAM model');
  }
  window.SPVFD=(idx,val)=>{};
  window.SAMFD=(tag,size,msg)=>{};
  window.OnParamChange=(idx,n)=>{
    const d=defs.find(x=>x[1]===idx);if(!d)return;
    const n0=Math.max(0,Math.min(1,n));const v=d[2]+n0*(d[3]-d[2]);
    const host=$('amp');const k=host&&host.children[idx];if(k){const face=k.querySelector('.knobface');if(face)face.style.transform='rotate('+(-135+n0*270)+'deg)';const out=k.querySelector('.knobvalue');if(out)out.textContent=v.toFixed(1)+(idx===0||idx===1||idx===5?' dB':'')}
  };
  window.OnMessage=(tag,size,data)=>{try{const j=JSON.parse(atob(data));if(j.type==='nam-status')setStatus(j.text)}catch{}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();