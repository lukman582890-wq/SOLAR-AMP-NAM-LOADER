# Native NAM Engine Roadmap

This module is reserved for the Android NDK/Oboe realtime path.

## Target pipeline
USB audio input -> Oboe/AAudio callback -> NAM A1/A2 inference -> output gain -> USB/headphone output.

## Constraints
- Never run model inference on the UI thread.
- Keep allocations and blocking I/O out of the realtime callback.
- Model loading happens off the audio thread and swaps an immutable/owned model state at a safe boundary.
- Report sample rate, buffer size, underruns and processing time to the UI.
- TONE3000 access tokens stay outside native model code.

## Current status
The repository currently contains the TypeScript/Web Audio reference engine. Native inference is scaffolded as a design target; no fake C++ implementation is claimed to execute NAM models yet.
