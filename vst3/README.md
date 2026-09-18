# VST3 Test Build

This folder is intentionally separate from the SOLAR AMP PWA.

The VST3 test is built from the official Neural Amp Modeler plugin source and is used first to verify NAM model loading and realtime processing in Cubase on Windows x64.

- The PWA source is not replaced.
- The PWA source is not deleted.
- No PWA runtime is used by this VST3 test.
- The VST3 build is produced by GitHub Actions as an artifact.

Once the native NAM path is verified in Cubase, we can use the same native NAM DSP architecture for the SOLAR AMP VST3.


WebView build pipeline verified on 2026-09-18.
