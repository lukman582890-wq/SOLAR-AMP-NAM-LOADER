import { createNamModule, NamWasmModule } from 'https://cdn.jsdelivr.net/npm/@opendaw/nam-wasm@1.2.0/dist/index.js';

class SolarNamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.nam = null;
    this.instanceId = -1;
    this.ready = false;
    this.modelLoaded = false;
    this.bypassed = true;
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
    } catch (error) {
      this.port.postMessage({ type: 'error', message: String(error?.message || error) });
    }
  }

  handleMessage(data) {
    if (!this.nam || !this.ready) return;
    if (data.type === 'loadModel') {
      try {
        this.modelLoaded = Boolean(this.nam.loadModel(this.instanceId, String(data.modelJson || '')));
        this.bypassed = !this.modelLoaded || Boolean(data.bypass);
        this.port.postMessage({
          type: 'modelLoaded',
          success: this.modelLoaded,
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
    } catch {
      output.set(input);
    }
    return true;
  }
}

registerProcessor('solar-nam-processor', SolarNamProcessor);
