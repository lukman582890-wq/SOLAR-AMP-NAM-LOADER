# SOLAR AMP — NAM Loader

Android-oriented guitar amp/model loader prototype for NAM A1/A2 with TONE3000 OAuth 2.0 + PKCE.

Current reference engine: realtime Web Audio guitar input, tuner, amp/OD/EQ/cab/delay/reverb controls. True native NAM inference belongs in the Android NDK/Oboe stage and is not falsely represented as implemented here.

Security: only use the TONE3000 Publishable Key/client_id in client code. Never ship the TONE3000 Secret Key in an APK.