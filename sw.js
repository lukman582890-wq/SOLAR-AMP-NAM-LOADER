const CACHE='solar-amp-v59';
const ASSETS=['./','./index.html','./styles.css?v=45','./app.js?v=59','./manifest.webmanifest','./t3k-wasm-module.js?v=59','./nam-default.nam'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).then(r=>{
 if(e.request.method!=='GET')return r;
 const sameOrigin=new URL(e.request.url).origin===location.origin;
 if(!sameOrigin)return r;
 const headers=new Headers(r.headers);
 headers.set('Cross-Origin-Opener-Policy','same-origin');
 headers.set('Cross-Origin-Embedder-Policy','require-corp');
 headers.set('Cross-Origin-Resource-Policy','cross-origin');
 const response=new Response(r.body,{status:r.status,statusText:r.statusText,headers});
 caches.open(CACHE).then(c=>c.put(e.request,response.clone())).catch(()=>{});
 return response;
}).catch(()=>caches.match(e.request))));
