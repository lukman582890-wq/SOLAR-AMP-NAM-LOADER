$ErrorActionPreference = 'Stop'
$root = Resolve-Path 'nam-vst3-source'
$src = Join-Path $root 'NeuralAmpModeler\NeuralAmpModeler.cpp'
$hdr = Join-Path $root 'NeuralAmpModeler\NeuralAmpModeler.h'
$proj = Join-Path $root 'NeuralAmpModeler\projects\NeuralAmpModeler-vst3.vcxproj'
$web = Join-Path $root 'NeuralAmpModeler\Resources\web'
New-Item -ItemType Directory -Force $web | Out-Null
Copy-Item 'index.html' "$web/index.html" -Force
Copy-Item 'styles.css' "$web/styles.css" -Force
Copy-Item 'icon.svg' "$web/icon.svg" -Force
Copy-Item 'vst3\solar-amp-web.js' "$web/solar-amp-web.js" -Force
$html = [IO.File]::ReadAllText("$web/index.html")
$html = [regex]::Replace($html, "<script>\(\(\)=>\{if\(!\('serviceWorker' in navigator\).*?</script>", "", [Text.RegularExpressions.RegexOptions]::Singleline)
$html = $html.Replace('<script src="app.js?v=61"></script>', '<script src="solar-amp-web.js"></script>')
$html = $html.Replace('<link rel="manifest" href="manifest.webmanifest">','')
[IO.File]::WriteAllText("$web/index.html",$html,(New-Object Text.UTF8Encoding($false)))
$s = [IO.File]::ReadAllText($src)
$start = $s.IndexOf('  mMakeGraphicsFunc = [&]()')
$end = $s.IndexOf("}" + [Environment]::NewLine + [Environment]::NewLine + "NeuralAmpModeler::~NeuralAmpModeler()", $start)
if ($end -lt 0) { $end = $s.IndexOf("}" + [Environment]::NewLine + [Environment]::NewLine + "NeuralAmpModeler::~NeuralAmpModeler()", $start) }
if ($start -lt 0 -or $end -lt 0) { throw 'Could not isolate old IGraphics constructor block.' }
$ui = @'
  mEditorInitFunc = [&]()
  {
    WDL_String resourcePath;
    BundleResourcePath(resourcePath);
    resourcePath.Append("/web/index.html");
    LoadFile(resourcePath.Get(), GetBundleID());
    EnableScroll(false);
  };
'@
$s = $s.Substring(0,$start) + $ui + $s.Substring($end)
$oldInclude = '#include "IPlug_include_in_plug_src.h"'
$newInclude = @'
#include "IPlug_include_in_plug_src.h"
#include "IPlugPaths.h"
#include "wdl_base64.h"
#include <nlohmann/json.hpp>
#include <fstream>
'@
$s = $s.Replace($oldInclude, $newInclude)`n$s = $s.Replace('#include "NeuralAmpModelerControls.h"', '')
$s = [regex]::Replace($s, 'void NeuralAmpModeler::OnIdle\(\)\s*\{.*?\n\}', @'
void NeuralAmpModeler::OnIdle()
{
  mInputSender.TransmitData(*this);
  mOutputSender.TransmitData(*this);
  if (mNewModelLoadedInDSP)
    mNewModelLoadedInDSP = false;
  if (mModelCleared)
    mModelCleared = false;
}
'@, [Text.RegularExpressions.RegexOptions]::Singleline)
$s = [regex]::Replace($s, 'void NeuralAmpModeler::OnUIOpen\(\)\s*\{.*?\n\}', @'
void NeuralAmpModeler::OnUIOpen()
{
  Plugin::OnUIOpen();
}
'@, [Text.RegularExpressions.RegexOptions]::Singleline)
$s = [regex]::Replace($s, 'void NeuralAmpModeler::OnParamChangeUI\(int paramIdx, EParamSource source\)\s*\{.*?\n\}', @'
void NeuralAmpModeler::OnParamChangeUI(int paramIdx, EParamSource source)
{
}
'@, [Text.RegularExpressions.RegexOptions]::Singleline)
$s = [regex]::Replace($s, 'void NeuralAmpModeler::_UpdateControlsFromModel\(\)\s*\{.*?\n\}', @'
void NeuralAmpModeler::_UpdateControlsFromModel()
{
}
'@, [Text.RegularExpressions.RegexOptions]::Singleline)
$msgStart = $s.IndexOf('bool NeuralAmpModeler::OnMessage(')
$msgEnd = $s.IndexOf('std::string NeuralAmpModeler::_StageModel', $msgStart)
if ($msgStart -ge 0 -and $msgEnd -gt $msgStart) {
$replacement = @'
bool NeuralAmpModeler::OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData)
{
  switch (msgTag)
  {
    case kMsgTagClearModel: mShouldRemoveModel = true; return true;
    case kMsgTagClearIR: mShouldRemoveIR = true; return true;
    default: return false;
  }
}

void NeuralAmpModeler::OnMessageFromWebView(const char* jsonStr)
{
  iplug::WebViewEditorDelegate::OnMessageFromWebView(jsonStr);
  const auto json = nlohmann::json::parse(jsonStr, nullptr, false);
  if (json.is_discarded() || !json.contains("msg"))
    return;
  const std::string msg = json["msg"].get<std::string>();
  if (msg == "SOLAR_LOAD_NAM")
  {
    try
    {
      const std::string b64 = json.value("data", "");
      if (b64.empty() || b64.size() > 64 * 1024 * 1024)
        throw std::runtime_error("Invalid or oversized model payload.");
      size_t padding = 0;
      if (!b64.empty() && b64.back() == '=') padding++;
      if (b64.size() >= 2 && b64[b64.size()-2] == '=') padding++;
      const size_t decodedSize = (b64.size() * 3) / 4 - padding;
      std::vector<unsigned char> bytes(decodedSize);
      if (decodedSize && wdl_base64decode(b64.c_str(), bytes.data(), static_cast<int>(decodedSize)) < 0)
        throw std::runtime_error("Base64 decode failed.");
      std::string name = json.value("name", "model.nam");
      std::filesystem::path safeName = std::filesystem::path(name).filename();
      if (safeName.extension() != ".nam" && safeName.extension() != ".json")
        safeName.replace_extension(".nam");
      auto dir = std::filesystem::temp_directory_path() / "SOLAR AMP Models";
      std::filesystem::create_directories(dir);
      auto path = dir / safeName;
      std::ofstream out(path, std::ios::binary | std::ios::trunc);
      if (!out) throw std::runtime_error("Cannot create temporary NAM file.");
      if (!bytes.empty()) out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
      out.close();
      WDL_String modelPath(path.u8string().c_str());
      const std::string error = _StageModel(modelPath);
      if (!error.empty()) throw std::runtime_error(error);
      const std::string status = "NAM MODEL • " + safeName.filename().u8string() + " • loaded";
      std::string js = "document.getElementById('modelStatus').textContent=" + nlohmann::json(status).dump() + ";";
      EvaluateJavaScript(js.c_str());
    }
    catch (const std::exception& e)
    {
      const std::string status = std::string("NAM MODEL ERROR • ") + e.what();
      std::string js = "document.getElementById('modelStatus').textContent=" + nlohmann::json(status).dump() + ";";
      EvaluateJavaScript(js.c_str());
    }
  }
  else if (msg == "SOLAR_TOGGLE_NAM")
  {
    EvaluateJavaScript("document.getElementById('modelStatus').textContent='NAM NATIVE DSP • ready';");
  }
}

'@
$s = $s.Substring(0,$msgStart) + $replacement + $s.Substring($msgEnd)
}
[IO.File]::WriteAllText($src,$s,(New-Object Text.UTF8Encoding($false)))
$h = [IO.File]::ReadAllText($hdr)
$needle = '  bool OnMessage(int msgTag, int ctrlTag, int dataSize, const void* pData) override;'
$h = $h.Replace($needle, $needle + [Environment]::NewLine + '  void OnMessageFromWebView(const char* jsonStr) override;')
[IO.File]::WriteAllText($hdr,$h,(New-Object Text.UTF8Encoding($false)))
$p = [IO.File]::ReadAllText($proj)
$p = [regex]::Replace($p, '\s*<ClInclude Include="[^"]*IGraphics[^"]*" ?/>', '')
$p = [regex]::Replace($p, '\s*<ClCompile Include="[^"]*IGraphics[^"]*" ?/>', '')
$webIncludes = @'
    <ClInclude Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebView.h" />
    <ClInclude Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebViewEditorDelegate.h" />
'@
$webSources = @'
    <ClCompile Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebView.cpp" />
    <ClCompile Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebViewEditorDelegate.cpp" />
'@
$p = $p.Replace('    <ClInclude Include="..\NeuralAmpModeler.h" />', $webIncludes + '    <ClInclude Include="..\NeuralAmpModeler.h" />')
$p = $p.Replace('    <ClCompile Include="..\NeuralAmpModeler.cpp" />', $webSources + '    <ClCompile Include="..\NeuralAmpModeler.cpp" />')
[IO.File]::WriteAllText($proj,$p,(New-Object Text.UTF8Encoding($false)))
if (-not (Select-String -Path $proj -Pattern 'IPlugWebView.cpp' -SimpleMatch -Quiet)) { throw 'WebView sources not added to project.' }
Write-Host 'SOLAR AMP WebView source and PWA UI prepared.'
