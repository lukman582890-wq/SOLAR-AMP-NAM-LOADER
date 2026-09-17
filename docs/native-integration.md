# Android native integration

Target pipeline:
USB audio input -> Oboe/AAudio callback -> NAM A1/A2 inference -> output -> USB/headphones.

Rules:
- Model loading/download happens off the realtime audio thread.
- No allocation, blocking I/O, JSON parsing, or locks in the callback.
- Swap model state safely at a callback boundary.
- Report sample rate, buffer size, processing time and underruns to the UI.
- Keep TONE3000 OAuth tokens out of native model code.

Next implementation:
1. Android NDK/CMake host.
2. Oboe/AAudio realtime stream.
3. Concrete NAM A1/A2 inference implementation.
4. JNI bridge.
5. USB audio device/sample-rate negotiation.
6. Physical-device latency and underrun tests.

The TypeScript engine in src/audio is a Web Audio reference/fallback, not native NAM inference.
