#include <algorithm> // std::clamp, std::min
#include <cmath> // pow
#include <filesystem>
#include <iostream>
#include <utility>
#ifdef OS_WIN
#include <windows.h>
#endif

#include "../NeuralAmpModelerCore/NAM/activations.h"
#include "../NeuralAmpModelerCore/NAM/get_dsp.h"
// clang-format off
// These includes need to happen in this order or else the latter won't know
// a bunch of stuff.
#include "NeuralAmpModeler.h"
#include "IPlug_include_in_plug_src.h"
#include "IPlugPaths.h"
#include <fstream>
// clang-format on
#include "architecture.hpp"


using namespace iplug;

#ifdef OS_WIN
static void NeuralAmpModuleAnchor() {}
#endif

const double kDCBlockerFrequency = 5.0;

const std::string kCalibrateInputParamName = "CalibrateInput";
const bool kDefaultCalibrateInput = false;
const std::string kInputCalibrationLevelParamName = "InputCalibrationLevel";
const double kDefaultInputCalibrationLevel = 12.0;



NeuralAmpModeler::NeuralAmpModeler(const InstanceInfo& info)
: Plugin(info, MakeConfig(kNumParams, kNumPresets))
{
  _InitToneStack();
  nam::activations::Activation::enable_fast_tanh();
  GetParam(kInputLevel)->InitGain("Input", 0.0, -20.0, 20.0, 0.1);
  GetParam(kToneBass)->InitDouble("Bass", 5.0, 0.0, 10.0, 0.1);
  GetParam(kToneMid)->InitDouble("Middle", 5.0, 0.0, 10.0, 0.1);
  GetParam(kToneTreble)->InitDouble("Treble", 5.0, 0.0, 10.0, 0.1);
  GetParam(kOutputLevel)->InitGain("Output", 0.0, -40.0, 40.0, 0.1);
  GetParam(kNoiseGateThreshold)->InitGain("Threshold", -80.0, -100.0, 0.0, 0.1);
  GetParam(kNoiseGateActive)->InitBool("NoiseGateActive", true);
  GetParam(kEQActive)->InitBool("ToneStack", true);
  GetParam(kOutputMode)->InitEnum("OutputMode", 1, {"Raw", "Normalized", "Calibrated"}); // TODO DRY w/ control
  GetParam(kIRToggle)->InitBool("IRToggle", true);
  GetParam(kCalibrateInput)->InitBool(kCalibrateInputParamName.c_str(), kDefaultCalibrateInput);
  GetParam(kInputCalibrationLevel)
    ->InitDouble(kInputCalibrationLevelParamName.c_str(), kDefaultInputCalibrationLevel, -60.0, 60.0, 0.1, "dBu");
  GetParam(kSlim)->InitDouble("Slim", 0.0, 0.0, 1.0, 0.01);
  GetParam(kAmpPresence)->InitDouble("Presence", 50.0, 0.0, 100.0, 1.0);
  GetParam(kODDrive)->InitDouble("OD Drive", 35.0, 0.0, 100.0, 1.0);
  GetParam(kODTone)->InitDouble("OD Tone", 50.0, 0.0, 100.0, 1.0);
  GetParam(kODLevel)->InitDouble("OD Level", 72.0, 0.0, 100.0, 1.0);
  GetParam(kEQLow)->InitDouble("EQ Low", 50.0, 0.0, 100.0, 1.0);
  GetParam(kEQMid)->InitDouble("EQ Mid", 50.0, 0.0, 100.0, 1.0);
  GetParam(kEQHigh)->InitDouble("EQ High", 50.0, 0.0, 100.0, 1.0);
  GetParam(kFXDelay)->InitDouble("FX Delay", 28.0, 0.0, 100.0, 1.0);
  GetParam(kFXReverb)->InitDouble("FX Reverb", 22.0, 0.0, 100.0, 1.0);
  GetParam(kODActive)->InitBool("OD Active", true);
  GetParam(kFXActive)->InitBool("FX Active", true);
  GetParam(kFXMode)->InitEnum("FX Mode", 0, {"DELAY", "REVERB", "CHORUS", "PHASER", "TREMOLO"});
  GetParam(kAmpModel)->InitEnum("AMP Model", 0, {"British 800", "American Clean", "Modern 5150"});

  mNoiseGateTrigger.AddListener(&mNoiseGateGain);


  mEditorInitFunc = [&]()
  {
    WDL_String resourcePath;
#ifdef OS_WIN
    // Resolve the module that contains this code, i.e. SOLARAMP.vst3.
    // Passing 0 resolves the DAW/host executable and breaks the resource path.
    HMODULE pluginModule = nullptr;
    if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                             GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           reinterpret_cast<LPCWSTR>(&NeuralAmpModuleAnchor),
                           &pluginModule))
      BundleResourcePath(resourcePath, pluginModule);
#else
    BundleResourcePath(resourcePath);
#endif
    resourcePath.Append("web/index.html");
    LoadFile(resourcePath.Get(), GetBundleID());
    EnableScroll(false);
  };
}

NeuralAmpModeler::~NeuralAmpModeler()
{
  _DeallocateIOPointers();
}

void NeuralAmpModeler::ProcessBlock(iplug::sample** inputs, iplug::sample** outputs, int nFrames)
{
  const size_t numChannelsExternalIn = (size_t)NInChansConnected();
  const size_t numChannelsExternalOut = (size_t)NOutChansConnected();
  const size_t numChannelsInternal = kNumChannelsInternal;
  const size_t numFrames = (size_t)nFrames;
  const double sampleRate = GetSampleRate();

  // Disable floating point denormals
  std::fenv_t fe_state;
  std::feholdexcept(&fe_state);
  disable_denormals();

  _PrepareBuffers(numChannelsInternal, numFrames);
  // Input is collapsed to mono in preparation for the native SOLAR AMP chain.
  _ProcessInput(inputs, numFrames, numChannelsExternalIn, numChannelsInternal);

  // OD / drive stage. This is intentionally simple and allocation-free on the
  // audio thread; the NAM remains the main amp-modeling stage.
  if (GetParam(kODActive)->Bool())
  {
    const double drive = GetParam(kODDrive)->Value() / 100.0;
    const double tone = GetParam(kODTone)->Value() / 100.0;
    const double level = GetParam(kODLevel)->Value() / 100.0;
    const double amount = 1.0 + drive * 19.0;
    const double norm = std::tanh(amount);
    const double sr = sampleRate;
    const double cutoff = 500.0 + tone * 7500.0;
    const double alpha = 1.0 - std::exp(-2.0 * 3.14159265358979323846 * cutoff / sr);
    for (size_t s = 0; s < numFrames; ++s)
    {
      const float x = mInputArray[0][s];
      const float clipped = static_cast<float>(std::tanh(x * amount) / norm);
      mODToneState += static_cast<float>(alpha) * (clipped - mODToneState);
      const float y = mODToneState * static_cast<float>(1.0 - tone) + clipped * static_cast<float>(tone);
      mInputArray[0][s] = y * static_cast<float>(0.65 + level * 0.55);
    }
  }

  const bool nativeAmpBypass = mNativeAmpBypass.load();
  const bool namActive = mNamActive.load() && mModel != nullptr;
  // Staging must continue even while AMP is bypassed so CAB/IR/model changes do
  // not get stuck waiting for the next un-bypass.
  _ApplyDSPStaging();
  const bool noiseGateActive = GetParam(kNoiseGateActive)->Value();
  const bool toneStackActive = GetParam(kEQActive)->Value();

  // Noise gate trigger
  sample** triggerOutput = mInputPointers;
  if (noiseGateActive)
  {
    const double time = 0.01;
    const double threshold = GetParam(kNoiseGateThreshold)->Value(); // GetParam...
    const double ratio = 0.1; // Quadratic...
    const double openTime = 0.005;
    const double holdTime = 0.01;
    const double closeTime = 0.05;
    const dsp::noise_gate::TriggerParams triggerParams(time, threshold, ratio, openTime, holdTime, closeTime);
    mNoiseGateTrigger.SetParams(triggerParams);
    mNoiseGateTrigger.SetSampleRate(sampleRate);
    triggerOutput = mNoiseGateTrigger.Process(mInputPointers, numChannelsInternal, numFrames);
  }

  if (nativeAmpBypass)
  {
    // AMP bypass is transparent but leaves OD/CAB/EQ/FX in the chain.
    _FallbackDSP(triggerOutput, mOutputPointers, numChannelsInternal, numFrames);
  }
  else if (namActive)
  {
    mModel->process(triggerOutput, mOutputPointers, nFrames);
  }
  else
  {
    // Native SOLAR AMP legacy stage. This is deliberately simple and stable:
    // profile-dependent pre-gain + soft clipping, followed by the shared tone
    // stack below. The NAM source is completely separate from this path.
    const double gain = GetParam(kInputLevel)->GetNormalized();
    const int profile = GetParam(kAmpModel)->Int();
    const double profileDrive = profile == 1 ? 0.38 : (profile == 2 ? 1.65 : 1.05);
    const double amount = 0.35 + gain * 5.0 * profileDrive;
    const double norm = std::tanh(std::max(0.35, amount));
    for (size_t s = 0; s < numFrames; ++s)
    {
      const float x = triggerOutput[0][s];
      const float clipped = static_cast<float>(std::tanh(x * amount) / norm);
      mAmpState += 0.18f * (clipped - mAmpState);
      mOutputArray[0][s] = mAmpState;
    }
    // Presence is a native post-amp high-frequency tilt.
    const double presence = (GetParam(kAmpPresence)->Value() - 50.0) / 50.0;
    const double pGain = std::pow(10.0, presence * 6.0 / 20.0);
    const double pAlpha = 1.0 - std::exp(-2.0 * 3.14159265358979323846 * 3200.0 / sampleRate);
    float pState = 0.0f;
    for (size_t s = 0; s < numFrames; ++s)
    {
      const float x = mOutputArray[0][s];
      pState += static_cast<float>(pAlpha) * (x - pState);
      mOutputArray[0][s] = pState * static_cast<float>(pGain) + x - pState;
    }
  }
  // Apply the noise gate after the NAM
  sample** gateGainOutput =
    noiseGateActive ? mNoiseGateGain.Process(mOutputPointers, numChannelsInternal, numFrames) : mOutputPointers;

  sample** toneStackOutPointers = (toneStackActive && mToneStack != nullptr)
                                    ? mToneStack->Process(gateGainOutput, numChannelsInternal, nFrames)
                                    : gateGainOutput;

  sample** irPointers = toneStackOutPointers;
  if (mIR != nullptr && GetParam(kIRToggle)->Value())
    irPointers = mIR->Process(toneStackOutPointers, numChannelsInternal, numFrames);

  // And the HPF for DC offset (Issue 271)
  const double highPassCutoffFreq = kDCBlockerFrequency;
  // const double lowPassCutoffFreq = 20000.0;
  const recursive_linear_filter::HighPassParams highPassParams(sampleRate, highPassCutoffFreq);
  // const recursive_linear_filter::LowPassParams lowPassParams(sampleRate, lowPassCutoffFreq);
  mHighPass.SetParams(highPassParams);
  // mLowPass.SetParams(lowPassParams);
  sample** hpfPointers = mHighPass.Process(irPointers, numChannelsInternal, numFrames);

  // Native 3-band EQ.
  if (GetParam(kEQActive)->Bool())
  {
    const double sr = sampleRate;
    const double lowAlpha = 1.0 - std::exp(-2.0 * 3.14159265358979323846 * 180.0 / sr);
    const double highAlpha = 1.0 - std::exp(-2.0 * 3.14159265358979323846 * 4200.0 / sr);
    const double lowGain = std::pow(10.0, ((GetParam(kEQLow)->Value() - 50.0) * 24.0 / 100.0) / 20.0);
    const double midGain = std::pow(10.0, ((GetParam(kEQMid)->Value() - 50.0) * 24.0 / 100.0) / 20.0);
    const double highGain = std::pow(10.0, ((GetParam(kEQHigh)->Value() - 50.0) * 24.0 / 100.0) / 20.0);
    for (size_t s = 0; s < numFrames; ++s)
    {
      const float x = hpfPointers[0][s];
      mEQLowState += static_cast<float>(lowAlpha) * (x - mEQLowState);
      mEQHighState += static_cast<float>(highAlpha) * (x - mEQHighState);
      const float low = mEQLowState;
      const float high = x - mEQHighState;
      const float mid = x - low - high;
      hpfPointers[0][s] = static_cast<float>(low * lowGain + mid * midGain + high * highGain);
    }
  }

  // Native delay / reverb / modulation FX. Every mode has a real,
  // allocation-free DSP path and all paths are bypassable from the UI.
  if (GetParam(kFXActive)->Bool() && !mDelayBuffer.empty())
  {
    const int mode = GetParam(kFXMode)->Int();
    const double wetDelay = GetParam(kFXDelay)->Value() / 100.0;
    const double wetReverb = GetParam(kFXReverb)->Value() / 100.0;
    const double sr = sampleRate;
    const double baseDelay = 0.08 + wetDelay * 0.52;
    const size_t reverbSamples = std::min(mReverbBuffer.size() - 1, static_cast<size_t>(0.23 * sr));
    for (size_t s = 0; s < numFrames; ++s)
    {
      const float x = hpfPointers[0][s];
      float y = x;

      if (mode == 0 || mode == 1)
      {
        const size_t delaySamples = std::min(mDelayBuffer.size() - 1, static_cast<size_t>(baseDelay * sr));
        const size_t dp = (mDelayWritePos + mDelayBuffer.size() - delaySamples) % mDelayBuffer.size();
        const size_t rp = (mReverbWritePos + mReverbBuffer.size() - reverbSamples) % mReverbBuffer.size();
        const float delayed = mDelayBuffer[dp];
        const float reverbed = mReverbBuffer[rp];
        if (mode == 0) y += delayed * static_cast<float>(wetDelay * 0.65);
        else y += reverbed * static_cast<float>(wetReverb * 0.70);
        mDelayBuffer[mDelayWritePos] = x + delayed * 0.30f;
        mReverbBuffer[mReverbWritePos] = x + reverbed * static_cast<float>(0.72 * wetReverb);
        mDelayWritePos = (mDelayWritePos + 1) % mDelayBuffer.size();
        mReverbWritePos = (mReverbWritePos + 1) % mReverbBuffer.size();
      }
      else if (mode == 2)
      {
        // Chorus: 8..28 ms modulated delay.
        const double lfo = 0.5 + 0.5 * std::sin(mChorusPhase);
        const size_t delaySamples = std::min(mDelayBuffer.size() - 2,
          static_cast<size_t>((0.008 + lfo * 0.020) * sr));
        const size_t dp = (mDelayWritePos + mDelayBuffer.size() - delaySamples) % mDelayBuffer.size();
        y += mDelayBuffer[dp] * static_cast<float>(0.55 * wetReverb);
        mDelayBuffer[mDelayWritePos] = x;
        mDelayWritePos = (mDelayWritePos + 1) % mDelayBuffer.size();
        mChorusPhase += 2.0 * 3.14159265358979323846 * 0.8 / sr;
        if (mChorusPhase > 2.0 * 3.14159265358979323846) mChorusPhase -= 2.0 * 3.14159265358979323846;
      }
      else if (mode == 3)
      {
        // Two-stage all-pass phaser with a slow LFO.
        const double lfo = 0.5 + 0.5 * std::sin(mChorusPhase * 0.4);
        const double freq = 350.0 + lfo * 2200.0;
        const double t = std::tan(3.14159265358979323846 * freq / sr);
        const float a = static_cast<float>((1.0 - t) / (1.0 + t));
        const float in = x;
        const float y1 = -a * in + mPhaserState1;
        mPhaserState1 = in + a * y1;
        const float y2 = -a * y1 + mPhaserState2;
        mPhaserState2 = y1 + a * y2;
        y += (y2 - x) * static_cast<float>(0.55 * wetReverb);
        mChorusPhase += 2.0 * 3.14159265358979323846 * 0.25 / sr;
        if (mChorusPhase > 2.0 * 3.14159265358979323846) mChorusPhase -= 2.0 * 3.14159265358979323846;
      }
      else
      {
        // Tremolo.
        const double lfo = 0.5 + 0.5 * std::sin(mTremoloPhase);
        const float depth = static_cast<float>(0.15 + wetReverb * 0.75);
        y *= static_cast<float>(1.0 - depth * lfo);
        mTremoloPhase += 2.0 * 3.14159265358979323846 * 4.5 / sr;
        if (mTremoloPhase > 2.0 * 3.14159265358979323846) mTremoloPhase -= 2.0 * 3.14159265358979323846;
      }
      hpfPointers[0][s] = y;
    }
  }

  // restore previous floating point state
  std::feupdateenv(&fe_state);

  // Let's get outta here
  // This is where we exit mono for whatever the output requires.
  _ProcessOutput(hpfPointers, outputs, numFrames, numChannelsInternal, numChannelsExternalOut);
  // _ProcessOutput(lpfPointers, outputs, numFrames, numChannelsInternal, numChannelsExternalOut);
  // * Output of input leveling (inputs -> mInputPointers),
  // * Output of output leveling (mOutputPointers -> outputs)
  _UpdateMeters(mInputPointers, outputs, numFrames, numChannelsInternal, numChannelsExternalOut);
}

void NeuralAmpModeler::OnReset()
{
  const auto sampleRate = GetSampleRate();
  const int maxBlockSize = GetBlockSize();

  // Tail is because the HPF DC blocker has a decay.
  // 10 cycles should be enough to pass the VST3 tests checking tail behavior.
  // I'm ignoring the model & IR, but it's not the end of the world.
  const int tailCycles = 10;
  SetTailSize(tailCycles * (int)(sampleRate / kDCBlockerFrequency));
  mDelayBuffer.assign(static_cast<size_t>(sampleRate * 1.25) + static_cast<size_t>(maxBlockSize) + 1, 0.0f);
  mReverbBuffer.assign(static_cast<size_t>(sampleRate * 0.45) + static_cast<size_t>(maxBlockSize) + 1, 0.0f);
  mDelayWritePos = 0;
  mReverbWritePos = 0;
  mODToneState = 0.0f;
  mEQLowState = 0.0f;
  mEQHighState = 0.0f;
  mAmpState = 0.0f;
  mPhaserState1 = 0.0f;
  mPhaserState2 = 0.0f;
  mChorusPhase = 0.0;
  mTremoloPhase = 0.0;
  mInputSender.Reset(sampleRate);
  mOutputSender.Reset(sampleRate);
  // If there is a model or IR loaded, they need to be checked for resampling.
  _ResetModelAndIR(sampleRate, GetBlockSize());
  mToneStack->Reset(sampleRate, maxBlockSize);
  _UpdateLatency();
}

void NeuralAmpModeler::OnIdle()
{
  mInputSender.TransmitData(*this);
  mOutputSender.TransmitData(*this);
  if (mNewModelLoadedInDSP) mNewModelLoadedInDSP = false;
  if (mModelCleared) mModelCleared = false;
}

bool NeuralAmpModeler::SerializeState(IByteChunk& chunk) const
{
  // If this isn't here when unserializing, then we know we're dealing with something before v0.8.0.
  WDL_String header("###NeuralAmpModeler###"); // Don't change this!
  chunk.PutStr(header.Get());
  // Plugin version, so we can load legacy serialized states in the future!
  WDL_String version(PLUG_VERSION_STR);
  chunk.PutStr(version.Get());
  // Model directory (don't serialize the model itself; we'll just load it again
  // when we unserialize)
  chunk.PutStr(mNAMPath.Get());
  chunk.PutStr(mIRPath.Get());
  return SerializeParams(chunk);
}

int NeuralAmpModeler::UnserializeState(const IByteChunk& chunk, int startPos)
{
  // Look for the expected header. If it's there, then we'll know what to do.
  WDL_String header;
  int pos = startPos;
  pos = chunk.GetStr(header, pos);

  const char* kExpectedHeader = "###NeuralAmpModeler###";
  if (strcmp(header.Get(), kExpectedHeader) == 0)
  {
    return _UnserializeStateWithKnownVersion(chunk, pos);
  }
  else
  {
    return _UnserializeStateWithUnknownVersion(chunk, startPos);
  }
}

void NeuralAmpModeler::OnUIOpen()
{
  Plugin::OnUIOpen();
}

void NeuralAmpModeler::OnParamChange(int paramIdx)
{
  switch (paramIdx)
  {
    case kCalibrateInput:
    case kInputCalibrationLevel:
    case kInputLevel: _SetInputGain(); break;
    case kOutputLevel:
    case kOutputMode: _SetOutputGain(); break;
    case kToneBass: mToneStack->SetParam("bass", GetParam(paramIdx)->Value()); break;
    case kToneMid: mToneStack->SetParam("middle", GetParam(paramIdx)->Value()); break;
    case kToneTreble: mToneStack->SetParam("treble", GetParam(paramIdx)->Value()); break;
    case kSlim: _ApplySlimParamToLoadedNAMs(); break;
    default: break;
  }
}

void NeuralAmpModeler::OnParamChangeUI(int paramIdx, EParamSource source)
{
}

bool NeuralAmpModeler::OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData)
{
  auto setStatus = [&](std::string status)
  {
    for (size_t i = 0; i < status.size(); ++i)
    {
      if (status[i] == '\\') { status.insert(i, "\\"); ++i; }
      else if (status[i] == '\'') { status.insert(i, "\\"); ++i; }
      else if (status[i] == '\n') { status.replace(i, 1, "\\n"); }
    }
    const std::string js = "if(window.SOLARSetStatus)window.SOLARSetStatus('" + status + "');";
    EvaluateJavaScript(js.c_str());
  };

  switch (msgTag)
  {
    case kMsgTagClearModel: mShouldRemoveModel = true; return true;
    case kMsgTagClearIR: mShouldRemoveIR = true; return true;
    case 100:
    {
      try
      {
        if (!pData || dataSize <= 0 || dataSize > 64 * 1024 * 1024)
          throw std::runtime_error("Invalid NAM payload.");
        auto dir = std::filesystem::temp_directory_path() / "SOLAR AMP Models";
        std::filesystem::create_directories(dir);
        auto path = dir / ("model_" + std::to_string(reinterpret_cast<uintptr_t>(this)) + ".nam");
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        if (!f) throw std::runtime_error("Cannot create temporary NAM file.");
        f.write(reinterpret_cast<const char*>(pData), dataSize);
        f.close();
        WDL_String modelPath(path.string().c_str());
        const std::string err = _StageModel(modelPath);
        setStatus(err.empty() ? "NAM MODEL - loaded into native DSP" : std::string("NAM MODEL ERROR - ") + err);
      }
      catch (const std::exception& e)
      {
        setStatus(std::string("NAM MODEL ERROR - ") + e.what());
      }
      return true;
    }
    case 101:
    {
      try
      {
        if (!pData || dataSize <= 0 || dataSize > 64 * 1024 * 1024)
          throw std::runtime_error("Invalid IR payload.");
        auto dir = std::filesystem::temp_directory_path() / "SOLAR AMP IR";
        std::filesystem::create_directories(dir);
        auto path = dir / ("ir_" + std::to_string(reinterpret_cast<uintptr_t>(this)) + ".wav");
        std::ofstream f(path, std::ios::binary | std::ios::trunc);
        if (!f) throw std::runtime_error("Cannot create temporary IR file.");
        f.write(reinterpret_cast<const char*>(pData), dataSize);
        f.close();
        WDL_String irPath(path.string().c_str());
        const auto rc = _StageIR(irPath);
        setStatus(rc == dsp::wav::LoadReturnCode::SUCCESS ? "IR - loaded into native DSP" : "IR LOAD ERROR");
      }
      catch (const std::exception& e)
      {
        setStatus(std::string("IR ERROR - ") + e.what());
      }
      return true;
    }
    case 102:
      // AMP module bypass: 1 = transparent bypass, 0 = process selected source.
      mNativeAmpBypass = dataSize > 0 && pData && (*reinterpret_cast<const uint8_t*>(pData) != 0);
      return true;
    case 103:
      // Source selector: 1 = NAM, 0 = native legacy AMP.
      mNamActive = dataSize > 0 && pData && (*reinterpret_cast<const uint8_t*>(pData) != 0);
      return true;

    case 104:
      // Built-in CAB/IR selector. The WebView sends the plain UTF-8 filename
      // (without extension) after iPlug has decoded the base64 payload.
      try
      {
        if (!pData || dataSize <= 0 || dataSize > 256)
          throw std::runtime_error("Invalid built-in IR name.");
        std::string name(reinterpret_cast<const char*>(pData), dataSize);
        if (name.find("..") != std::string::npos || name.find('/') != std::string::npos || name.find('\\') != std::string::npos)
          throw std::runtime_error("Invalid IR name.");
        WDL_String resources;
        BundleResourcePath(resources, GetBundleID());
        resources.Append("web/ir/");
        resources.Append(name.c_str());
        resources.Append(".wav");
        const auto rc = _StageIR(resources);
        setStatus(rc == dsp::wav::LoadReturnCode::SUCCESS ? "CAB • built-in IR loaded" : "CAB • built-in IR load failed");
      }
      catch (const std::exception& e)
      {
        setStatus(std::string("CAB IR ERROR • ") + e.what());
      }
      return true;

    default: return false;
  }
}

// Private methods ============================================================

void NeuralAmpModeler::_AllocateIOPointers(const size_t nChans)
{
  if (mInputPointers != nullptr)
    throw std::runtime_error("Tried to re-allocate mInputPointers without freeing");
  mInputPointers = new sample*[nChans];
  if (mInputPointers == nullptr)
    throw std::runtime_error("Failed to allocate pointer to input buffer!\n");
  if (mOutputPointers != nullptr)
    throw std::runtime_error("Tried to re-allocate mOutputPointers without freeing");
  mOutputPointers = new sample*[nChans];
  if (mOutputPointers == nullptr)
    throw std::runtime_error("Failed to allocate pointer to output buffer!\n");
}

void NeuralAmpModeler::_ApplyDSPStaging()
{
  // Remove marked modules
  if (mShouldRemoveModel)
  {
    mModel = nullptr;
    mNAMPath.Set("");
    mShouldRemoveModel = false;
    mModelCleared = true;
    _UpdateLatency();
    _SetInputGain();
    _SetOutputGain();
  }
  if (mShouldRemoveIR)
  {
    mIR = nullptr;
    mIRPath.Set("");
    mShouldRemoveIR = false;
  }
  // Move things from staged to live
  if (mStagedModel != nullptr)
  {
    mModel = std::move(mStagedModel);
    mStagedModel = nullptr;
    mNewModelLoadedInDSP = true;
    _UpdateLatency();
    _SetInputGain();
    _SetOutputGain();
  }
  if (mStagedIR != nullptr)
  {
    mIR = std::move(mStagedIR);
    mStagedIR = nullptr;
  }
}

void NeuralAmpModeler::_DeallocateIOPointers()
{
  if (mInputPointers != nullptr)
  {
    delete[] mInputPointers;
    mInputPointers = nullptr;
  }
  if (mInputPointers != nullptr)
    throw std::runtime_error("Failed to deallocate pointer to input buffer!\n");
  if (mOutputPointers != nullptr)
  {
    delete[] mOutputPointers;
    mOutputPointers = nullptr;
  }
  if (mOutputPointers != nullptr)
    throw std::runtime_error("Failed to deallocate pointer to output buffer!\n");
}

void NeuralAmpModeler::_FallbackDSP(iplug::sample** inputs, iplug::sample** outputs, const size_t numChannels,
                                    const size_t numFrames)
{
  for (auto c = 0; c < numChannels; c++)
    for (auto s = 0; s < numFrames; s++)
      mOutputArray[c][s] = mInputArray[c][s];
}

void NeuralAmpModeler::_ResetModelAndIR(const double sampleRate, const int maxBlockSize)
{
  // Model
  if (mStagedModel != nullptr)
  {
    mStagedModel->Reset(sampleRate, maxBlockSize);
  }
  else if (mModel != nullptr)
  {
    mModel->Reset(sampleRate, maxBlockSize);
  }

  // IR
  if (mStagedIR != nullptr)
  {
    const double irSampleRate = mStagedIR->GetSampleRate();
    if (irSampleRate != sampleRate)
    {
      const auto irData = mStagedIR->GetData();
      mStagedIR = std::make_unique<dsp::ImpulseResponse>(irData, sampleRate);
    }
  }
  else if (mIR != nullptr)
  {
    const double irSampleRate = mIR->GetSampleRate();
    if (irSampleRate != sampleRate)
    {
      const auto irData = mIR->GetData();
      mStagedIR = std::make_unique<dsp::ImpulseResponse>(irData, sampleRate);
    }
  }
}

void NeuralAmpModeler::_SetInputGain()
{
  iplug::sample inputGainDB = GetParam(kInputLevel)->Value();
  // Input calibration
  if ((mModel != nullptr) && (mModel->HasInputLevel()) && GetParam(kCalibrateInput)->Bool())
  {
    inputGainDB += GetParam(kInputCalibrationLevel)->Value() - mModel->GetInputLevel();
  }
  mInputGain = DBToAmp(inputGainDB);
}

void NeuralAmpModeler::_SetOutputGain()
{
  double gainDB = GetParam(kOutputLevel)->Value();
  if (mModel != nullptr)
  {
    const int outputMode = GetParam(kOutputMode)->Int();
    switch (outputMode)
    {
      case 1: // Normalized
        if (mModel->HasLoudness())
        {
          const double loudness = mModel->GetLoudness();
          const double targetLoudness = -18.0;
          gainDB += (targetLoudness - loudness);
        }
        break;
      case 2: // Calibrated
        if (mModel->HasOutputLevel())
        {
          const double inputLevel = GetParam(kInputCalibrationLevel)->Value();
          const double outputLevel = mModel->GetOutputLevel();
          gainDB += (outputLevel - inputLevel);
        }
        break;
      case 0: // Raw
      default: break;
    }
  }
  mOutputGain = DBToAmp(gainDB);
}

void NeuralAmpModeler::_ApplySlimParamToLoadedNAMs()
{
  const double v = GetParam(kSlim)->Value();
  auto apply = [v](ResamplingNAM* p) {
    if (p == nullptr)
      return;
    if (nam::SlimmableModel* s = p->GetSlimmableModel())
      s->SetSlimmableSize(v);
  };
  apply(mModel.get());
  apply(mStagedModel.get());
}

std::string NeuralAmpModeler::_StageModel(const WDL_String& modelPath)
{
  WDL_String previousNAMPath = mNAMPath;
  try
  {
    auto dspPath = std::filesystem::u8path(modelPath.Get());
    std::unique_ptr<nam::DSP> model = nam::get_dsp(dspPath);

    // Check that the model has 1 input and 1 output channel
    if (model->NumInputChannels() != 1)
    {
      throw std::runtime_error("Model must have 1 input channel, but has " + std::to_string(model->NumInputChannels()));
    }
    if (model->NumOutputChannels() != 1)
    {
      throw std::runtime_error("Model must have 1 output channel, but has "
                               + std::to_string(model->NumOutputChannels()));
    }

    std::unique_ptr<ResamplingNAM> temp = std::make_unique<ResamplingNAM>(std::move(model), GetSampleRate());
    temp->Reset(GetSampleRate(), GetBlockSize());
    if (nam::SlimmableModel* slimmable = temp->GetSlimmableModel())
    {
      slimmable->SetSlimmableSize(GetParam(kSlim)->Value());
    }
    mStagedModel = std::move(temp);
    mNAMPath = modelPath;
  }
  catch (std::runtime_error& e)
  {
    SendControlMsgFromDelegate(kCtrlTagModelFileBrowser, kMsgTagLoadFailed, 0, nullptr);

    if (mStagedModel != nullptr)
    {
      mStagedModel = nullptr;
    }
    mNAMPath = previousNAMPath;
    std::cerr << "Failed to read DSP module" << std::endl;
    std::cerr << e.what() << std::endl;
    return e.what();
  }
  return "";
}

dsp::wav::LoadReturnCode NeuralAmpModeler::_StageIR(const WDL_String& irPath)
{
  // FIXME it'd be better for the path to be "staged" as well. Just in case the
  // path and the model got caught on opposite sides of the fence...
  WDL_String previousIRPath = mIRPath;
  const double sampleRate = GetSampleRate();
  dsp::wav::LoadReturnCode wavState = dsp::wav::LoadReturnCode::ERROR_OTHER;
  try
  {
    mStagedIR = std::make_unique<dsp::ImpulseResponse>(irPath.Get(), sampleRate);
    wavState = mStagedIR->GetWavState();
  }
  catch (std::runtime_error& e)
  {
    wavState = dsp::wav::LoadReturnCode::ERROR_OTHER;
    std::cerr << "Caught unhandled exception while attempting to load IR:" << std::endl;
    std::cerr << e.what() << std::endl;
  }

  if (wavState == dsp::wav::LoadReturnCode::SUCCESS)
  {
    mIRPath = irPath;
  }
  else
  {
    if (mStagedIR != nullptr)
    {
      mStagedIR = nullptr;
    }
    mIRPath = previousIRPath;
    SendControlMsgFromDelegate(kCtrlTagIRFileBrowser, kMsgTagLoadFailed, 0, nullptr);
  }

  return wavState;
}

size_t NeuralAmpModeler::_GetBufferNumChannels() const
{
  // Assumes input=output (no mono->stereo effects)
  return mInputArray.size();
}

size_t NeuralAmpModeler::_GetBufferNumFrames() const
{
  if (_GetBufferNumChannels() == 0)
    return 0;
  return mInputArray[0].size();
}

void NeuralAmpModeler::_InitToneStack()
{
  // If you want to customize the tone stack, then put it here!
  mToneStack = std::make_unique<dsp::tone_stack::BasicNamToneStack>();
}
void NeuralAmpModeler::_PrepareBuffers(const size_t numChannels, const size_t numFrames)
{
  const bool updateChannels = numChannels != _GetBufferNumChannels();
  const bool updateFrames = updateChannels || (_GetBufferNumFrames() != numFrames);
  //  if (!updateChannels && !updateFrames)  // Could we do this?
  //    return;

  if (updateChannels)
  {
    _PrepareIOPointers(numChannels);
    mInputArray.resize(numChannels);
    mOutputArray.resize(numChannels);
  }
  if (updateFrames)
  {
    for (auto c = 0; c < mInputArray.size(); c++)
    {
      mInputArray[c].resize(numFrames);
      std::fill(mInputArray[c].begin(), mInputArray[c].end(), 0.0);
    }
    for (auto c = 0; c < mOutputArray.size(); c++)
    {
      mOutputArray[c].resize(numFrames);
      std::fill(mOutputArray[c].begin(), mOutputArray[c].end(), 0.0);
    }
  }
  // Would these ever get changed by something?
  for (auto c = 0; c < mInputArray.size(); c++)
    mInputPointers[c] = mInputArray[c].data();
  for (auto c = 0; c < mOutputArray.size(); c++)
    mOutputPointers[c] = mOutputArray[c].data();
}

void NeuralAmpModeler::_PrepareIOPointers(const size_t numChannels)
{
  _DeallocateIOPointers();
  _AllocateIOPointers(numChannels);
}

void NeuralAmpModeler::_ProcessInput(iplug::sample** inputs, const size_t nFrames, const size_t nChansIn,
                                     const size_t nChansOut)
{
  // We'll assume that the main processing is mono for now. We'll handle dual amps later.
  if (nChansOut != 1)
  {
    std::stringstream ss;
    ss << "Expected mono output, but " << nChansOut << " output channels are requested!";
    throw std::runtime_error(ss.str());
  }

  // On the standalone, we can probably assume that the user has plugged into only one input and they expect it to be
  // carried straight through. Don't apply any division over nChansIn because we're just "catching anything out there."
  // However, in a DAW, it's probably something providing stereo, and we want to take the average in order to avoid
  // doubling the loudness. (This would change w/ double mono processing)
  double gain = mInputGain;
#ifndef APP_API
  gain /= (float)nChansIn;
#endif
  // Assume _PrepareBuffers() was already called
  for (size_t c = 0; c < nChansIn; c++)
    for (size_t s = 0; s < nFrames; s++)
      if (c == 0)
        mInputArray[0][s] = gain * inputs[c][s];
      else
        mInputArray[0][s] += gain * inputs[c][s];
}

void NeuralAmpModeler::_ProcessOutput(iplug::sample** inputs, iplug::sample** outputs, const size_t nFrames,
                                      const size_t nChansIn, const size_t nChansOut)
{
  const double gain = mOutputGain;
  // Assume _PrepareBuffers() was already called
  if (nChansIn != 1)
    throw std::runtime_error("Plugin is supposed to process in mono.");
  // Broadcast the internal mono stream to all output channels.
  const size_t cin = 0;
  for (auto cout = 0; cout < nChansOut; cout++)
    for (auto s = 0; s < nFrames; s++)
#ifdef APP_API // Ensure valid output to interface
      outputs[cout][s] = std::clamp(gain * inputs[cin][s], -1.0, 1.0);
#else // In a DAW, other things may come next and should be able to handle large
      // values.
      outputs[cout][s] = gain * inputs[cin][s];
#endif
}

void NeuralAmpModeler::_UpdateControlsFromModel()
{
}

void NeuralAmpModeler::_UpdateLatency()
{
  int latency = 0;
  if (mModel)
  {
    latency += mModel->GetLatency();
  }
  // Other things that add latency here...

  // Feels weird to have to do this.
  if (GetLatency() != latency)
  {
    SetLatency(latency);
  }
}

void NeuralAmpModeler::_UpdateMeters(sample** inputPointer, sample** outputPointer, const size_t nFrames,
                                     const size_t nChansIn, const size_t nChansOut)
{
  // Right now, we didn't specify MAXNC when we initialized these, so it's 1.
  const int nChansHack = 1;
  mInputSender.ProcessBlock(inputPointer, (int)nFrames, kCtrlTagInputMeter, nChansHack);
  mOutputSender.ProcessBlock(outputPointer, (int)nFrames, kCtrlTagOutputMeter, nChansHack);
}

// HACK
#include "Unserialization.cpp"
