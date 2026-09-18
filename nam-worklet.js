// AudioWorkletGlobalScope does not guarantee the Window URL constructor.
// @opendaw/nam-wasm's Emscripten loader uses new URL(..., import.meta.url)
// to locate its WASM binary. AudioWorkletGlobalScope does not support
// dynamic import(), so the package must be a static module dependency.
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = class SolarWorkletURL {
    constructor(input, base) {
      const value = String(input ?? '');
      const baseValue = String(base ?? '');
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) this.href = value;
      else if (baseValue) {
        const slash = baseValue.lastIndexOf('/');
        this.href = (slash >= 0 ? baseValue.slice(0, slash + 1) : baseValue + '/') + value;
      } else this.href = value;
    }
    toString() { return this.href; }
  };
}

import { createNamModule, NamWasmModule } from 'https://cdn.jsdelivr.net/npm/@opendaw/nam-wasm@1.2.0/dist/index.js';

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
  }

  async init() {
    try {
      const emscriptenModule = await createNamModule();
      this.nam = NamWasmModule.fromModule(emscriptenModule);
      this.nam.setSampleRate(sampleRate);
      this.instanceId = this.nam.createInstance();
      this.ready = true;
      this.port.postMessage({ type: 'ready', sampleRate });
      if (this.pendingModelJson) {
        const json = this.pendingModelJson;
        const bypass = this.pendingBypass;
        this.pendingModelJson = '';
        this.handleMessage({ type: 'loadModel', modelJson: json, bypass });
      }
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error?.message || error) });
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
        this.modelLoaded = Boolean(this.nam.loadModel(this.instanceId, String(data.modelJson || '')));
        const hasModel = this.modelLoaded && Boolean(this.nam.hasModel(this.instanceId));
        this.modelLoaded = hasModel;
        this.bypassed = !hasModel || Boolean(data.bypass);
        this.processedBlocks = 0;
        this.processErrorSent = false;
        this.port.postMessage({
          type: 'modelLoaded',
          success: hasModel,
          hasModel,
          sampleRate: this.nam.getSampleRate()
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
