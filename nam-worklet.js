import { createNamModule, NamWasmModule } from './vendor/nam-wasm/index.js';

class SolarNamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.nam = null;
    this.instanceId = -1;
    this.ready = false;
    this.modelLoaded = false;
    this.bypassed = true;
    this.processedBlocks = 0;
    this.processErrorSent = false;
    this.pendingModelJson = '';
    this.pendingBypass = true;
    this.init();
    this.port.onmessage = e => this.handleMessage(e.data || {});
    this.port.postMessage({ type: 'processorStarted', sampleRate });
  }

  async init() {
    const watchdog = setTimeout(() => {
      if (!this.ready) this.port.postMessage({ type: 'loaderTimeout', message: 'NAM WASM initialization exceeded 10s' });
    }, 10000);
    try {
      const wasmUrl = new URL('./vendor/nam-wasm/nam.wasm', import.meta.url);
      const wasmResponse = await fetch(wasmUrl, { cache: 'no-store' });
      if (!wasmResponse.ok) throw new Error('nam.wasm HTTP '+wasmResponse.status);
      const wasmBinary = await wasmResponse.arrayBuffer();
      this.port.postMessage({ type: 'wasmFetched', bytes: wasmBinary.byteLength });

      const emscriptenModule = await createNamModule({
        wasmBinary,
        locateFile: (path) => new URL('./vendor/nam-wasm/' + path, import.meta.url).href
      });
      this.nam = NamWasmModule.fromModule(emscriptenModule);
      this.nam.setSampleRate(sampleRate);
      this.nam.setMaxBufferSize(128);
      this.instanceId = this.nam.createInstance();
      if (this.instanceId < 0) throw new Error('NAM createInstance failed');
      this.ready = true;
      clearTimeout(watchdog);
      this.port.postMessage({ type: 'ready', sampleRate, instanceId: this.instanceId });
      if (this.pendingModelJson) {
        const json = this.pendingModelJson;
        const bypass = this.pendingBypass;
        this.pendingModelJson = '';
        this.handleMessage({ type: 'loadModel', modelJson: json, bypass });
      }
    } catch (error) {
      clearTimeout(watchdog);
      this.port.postMessage({ type: 'error', message: String(error?.stack || error?.message || error) });
    }
  }
  handleMessage(data) {
    if (data.type === 'loadModel' && !this.ready) {
      this.pendingModelJson = String(data.modelJson || '');
      this.pendingBypass = Boolean(data.bypass);
      return;
    }
    if (!this.nam || !this.ready) return;
    if (data.type === 'loadModel') {
      try {
        const modelJson = String(data.modelJson || '');
        let meta = {};
        try {
          const parsed = JSON.parse(modelJson);
          meta = {
            version: String(parsed.version || ''),
            architecture: String(parsed.architecture || ''),
            sampleRate: Number(parsed.sample_rate || parsed.sampleRate || 0) || 0,
            weights: Array.isArray(parsed.weights) ? parsed.weights.length : 0
          };
        } catch {}
        this.modelLoaded = Boolean(this.nam.loadModel(this.instanceId, modelJson));
        const hasModel = this.modelLoaded && Boolean(this.nam.hasModel(this.instanceId));
        this.modelLoaded = hasModel;
        this.bypassed = !hasModel || Boolean(data.bypass);
        this.processedBlocks = 0;
        this.processErrorSent = false;
        this.port.postMessage({
          type: 'modelLoaded',
          success: hasModel,
          hasModel,
          sampleRate: this.nam.getSampleRate(),
          version: meta.version,
          architecture: meta.architecture,
          modelSampleRate: meta.sampleRate,
          weights: meta.weights
        });
      } catch (error) {
        this.modelLoaded = false;
        this.bypassed = true;
        this.port.postMessage({ type: 'modelError', message: String(error?.message || error) });
      }
    } else if (data.type === 'bypass') {
      this.bypassed = Boolean(data.value);
    } else if (data.type === 'reset') {
      try { this.nam.reset(this.instanceId); } catch {}
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;

    if (!input || this.bypassed || !this.modelLoaded || !this.nam || !this.ready) {
      if (input) output.set(input);
      else output.fill(0);
      return true;
    }

    try {
      this.nam.process(this.instanceId, input, output);
      this.processedBlocks++;
      if ((this.processedBlocks & 63) === 0) {
        let inputPeak = 0, outputPeak = 0;
        for (let i = 0; i < input.length; i++) {
          const a = Math.abs(input[i]), b = Math.abs(output[i]);
          if (a > inputPeak) inputPeak = a;
          if (b > outputPeak) outputPeak = b;
        }
        this.port.postMessage({ type: 'processing', blocks: this.processedBlocks, inputPeak, outputPeak });
      }
    } catch (error) {
      this.modelLoaded = false;
      this.bypassed = true;
      output.fill(0);
      if (!this.processErrorSent) {
        this.processErrorSent = true;
        this.port.postMessage({ type: 'processError', message: String(error?.message || error) });
      }
    }
    return true;
  }
}

registerProcessor('solar-nam-processor', SolarNamProcessor);
