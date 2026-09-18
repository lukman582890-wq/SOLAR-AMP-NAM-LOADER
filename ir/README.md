# SOLAR AMP — IR Pack v1

The built-in IR library contains 20 cabinet impulse responses for the PWA.

## 6100
- 6100_ZCB_57_API.wav
- 6100_ZCB_57_NV.wav
- 6100_ZCB_57OFF_API.wav
- 6100_ZCB_57OFF_NV.wav
- 6100_ZCB_201_API.wav
- 6100_ZCB_201_NV.wav
- 6100_ZCB_421_API.wav
- 6100_ZCB_421_NV.wav
- 6100_ZCB_906_API.wav
- 6100_ZCB_906_NV.wav

## 6505
- 6505_ZCB_57_API.wav
- 6505_ZCB_57_NV.wav
- 6505_ZCB_57OFF_API.wav
- 6505_ZCB_57OFF_NV.wav
- 6505_ZCB_201_API.wav
- 6505_ZCB_201_NV.wav
- 6505_ZCB_421_API.wav
- 6505_ZCB_421_NV.wav
- 6505_ZCB_906_API.wav
- 6505_ZCB_906_NV.wav

## PWA behavior

The files are packaged under `/ir/` and loaded through the Web Audio `ConvolverNode` when selected. The CAB selector exposes all 20 built-in IRs.

Users can also add their own WAV/AIFF/FLAC IRs from the CAB module. Custom IRs are kept in the current browser session and are not uploaded to GitHub.

The built-in WAV files are 44.1 kHz, mono, 24-bit PCM in the current Pack v1.
