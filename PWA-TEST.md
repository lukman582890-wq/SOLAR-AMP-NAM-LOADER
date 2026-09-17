# Solar Amp PWA Test Plan

## Browser test build
The PWA stage is for validating the complete user workflow before creating an APK.

### Must work
- microphone/guitar input permission
- realtime input/output metering
- realtime tuner
- amp controls
- OD controls
- EQ/cab controls
- delay/reverb controls
- local NAM file selection and metadata validation
- TONE3000 OAuth 2.0 + PKCE integration
- TONE3000 tone/model discovery
- preset state management
- responsive mobile UI

### Important limitation
Browser Web Audio is the test/reference engine. It does not provide Android NDK/Oboe NAM inference. Native NAM A1/A2 inference is the APK-stage engine.

## Acceptance gate
Do not create the production APK until the PWA workflow is stable and the physical guitar test has passed.
