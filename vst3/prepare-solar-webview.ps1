$ErrorActionPreference='Stop'
$root=Resolve-Path 'nam-vst3-source'
$src=Join-Path $root 'NeuralAmpModeler\NeuralAmpModeler.cpp'
$hdr=Join-Path $root 'NeuralAmpModeler\NeuralAmpModeler.h'
$props=Join-Path $root 'NeuralAmpModeler\config\NeuralAmpModeler-win.props'
$proj=Join-Path $root 'NeuralAmpModeler\projects\NeuralAmpModeler-vst3.vcxproj'
$web=Join-Path $root 'NeuralAmpModeler\Resources\web'
New-Item -ItemType Directory -Force $web | Out-Null
Copy-Item 'vst3\solar-amp-native.cpp' $src -Force
Copy-Item 'vst3\solar-amp-native.h' $hdr -Force
Copy-Item 'index.html', 'styles.css', 'icon.svg', 'app.js' -Destination $web -Force
Copy-Item 'vst3\solar-amp-web.js' (Join-Path $web 'solar-amp-web.js') -Force
$html=[IO.File]::ReadAllText((Join-Path $web 'index.html'))
$html=[regex]::Replace($html,'<script>\(\(\)=>\{if\(!\(''serviceWorker'' in navigator\).*?</script>','',[Text.RegularExpressions.RegexOptions]::Singleline)
$html=$html.Replace('<link rel="manifest" href="manifest.webmanifest">','')
$html=[regex]::Replace($html,'<script src="app\.js[^"]*"></script>','<script src="solar-amp-web.js"></script><script src="app.js"></script>')
[IO.File]::WriteAllText((Join-Path $web 'index.html'),$html,(New-Object Text.UTF8Encoding($false)))

$c=[IO.File]::ReadAllText((Join-Path $root 'NeuralAmpModeler\config.h'))
$c=$c.Replace('#define PLUG_NAME "NeuralAmpModeler"','#define PLUG_NAME "SOLAR AMP"').Replace('#define PLUG_MFR "Steven Atkinson"','#define PLUG_MFR "SOLAR AMP"').Replace("#define PLUG_UNIQUE_ID '1YEo'","#define PLUG_UNIQUE_ID 'SAMP'").Replace("#define PLUG_MFR_ID 'SDAa'","#define PLUG_MFR_ID 'SLAr'").Replace('#define BUNDLE_NAME "NeuralAmpModeler"','#define BUNDLE_NAME "SOLAR AMP"').Replace('#define BUNDLE_MFR "StevenAtkinson"','#define BUNDLE_MFR "SOLARAMP"').Replace('#define SHARED_RESOURCES_SUBPATH "NeuralAmpModeler"','#define SHARED_RESOURCES_SUBPATH "SOLAR AMP"').Replace('#define PLUG_WIDTH 600','#define PLUG_WIDTH 1080').Replace('#define PLUG_HEIGHT 400','#define PLUG_HEIGHT 780').Replace('#define PLUG_HOST_RESIZE 0','#define PLUG_HOST_RESIZE 1')
[IO.File]::WriteAllText((Join-Path $root 'NeuralAmpModeler\config.h'),$c,(New-Object Text.UTF8Encoding($false)))

$p=[IO.File]::ReadAllText($props)
$p=$p.Replace('<BINARY_NAME>NeuralAmpModeler</BINARY_NAME>','<BINARY_NAME>SOLARAMP</BINARY_NAME>')
$p=$p.Replace('<EXTRA_ALL_DEFS>IGRAPHICS_NANOVG;IGRAPHICS_GL2;GRAYED_ALPHA=0.5f;NAM_ENABLE_A2_FAST</EXTRA_ALL_DEFS>','<EXTRA_ALL_DEFS>WEBVIEW_EDITOR_DELEGATE;NO_IGRAPHICS;GRAYED_ALPHA=0.5f;NAM_ENABLE_A2_FAST</EXTRA_ALL_DEFS>')
$p=$p.Replace('<AdditionalIncludeDirectories>$(SolutionDir)dsp;$(IPLUG2_ROOT)\..\eigen;$(EXTRA_INC_PATHS);$(IPLUG_INC_PATHS);$(IGRAPHICS_INC_PATHS);$(GLAD_GL2_PATHS);%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories>','<AdditionalIncludeDirectories>$(SolutionDir)dsp;$(IPLUG2_ROOT)\..\eigen;$(EXTRA_INC_PATHS);$(IPLUG_INC_PATHS);$(IPLUG2_ROOT)\Dependencies\Extras\wil\include;$(IPLUG2_ROOT)\Dependencies\Extras\WebView2\build\native\include;%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories>')
$p=$p.Replace('<AdditionalDependencies>wininet.lib;comctl32.lib;Shlwapi.lib;%(AdditionalDependencies)</AdditionalDependencies>','<AdditionalDependencies>wininet.lib;comctl32.lib;Shlwapi.lib;ole32.lib;user32.lib;advapi32.lib;shell32.lib;WebView2LoaderStatic.lib;%(AdditionalDependencies)</AdditionalDependencies>')
$p=$p.Replace('<ProgramDatabaseFile>$(PDB_FILE)</ProgramDatabaseFile>','<ProgramDatabaseFile>$(PDB_FILE)</ProgramDatabaseFile>'+[Environment]::NewLine+'      <AdditionalLibraryDirectories>$(IPLUG2_ROOT)\Dependencies\Extras\WebView2\build\native\x64;%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories>')
[IO.File]::WriteAllText($props,$p,(New-Object Text.UTF8Encoding($false)))

$x=[IO.File]::ReadAllText($proj)
# Force the editor/DSP preprocessor contract at project level; this avoids relying on property-sheet evaluation order.
$x=$x.Replace('<PreprocessorDefinitions>$(VST3_DEFS);$(RELEASE_DEFS);$(EXTRA_RELEASE_DEFS);%(PreprocessorDefinitions)</PreprocessorDefinitions>','<PreprocessorDefinitions>WEBVIEW_EDITOR_DELEGATE;NO_IGRAPHICS;$(VST3_DEFS);$(RELEASE_DEFS);$(EXTRA_RELEASE_DEFS);%(PreprocessorDefinitions)</PreprocessorDefinitions>')
$x=$x.Replace('<PreprocessorDefinitions>$(VST3_DEFS);$(DEBUG_DEFS);$(EXTRA_DEBUG_DEFS);%(PreprocessorDefinitions)</PreprocessorDefinitions>','<PreprocessorDefinitions>WEBVIEW_EDITOR_DELEGATE;NO_IGRAPHICS;$(VST3_DEFS);$(DEBUG_DEFS);$(EXTRA_DEBUG_DEFS);%(PreprocessorDefinitions)</PreprocessorDefinitions>')
$x=[regex]::Replace($x, '\s*<ClInclude Include="[^"]*IGraphics[^"]*" ?/>', '')
$x=[regex]::Replace($x, '\s*<ClCompile Include="[^"]*IGraphics[^"]*" ?/>', '')
$nl=[Environment]::NewLine
$webItemGroup = $nl + '  <ItemGroup>' + $nl +
'    <ClInclude Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebView.h" />' + $nl +
'    <ClInclude Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebViewEditorDelegate.h" />' + $nl +
'    <ClCompile Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebView.cpp" />' + $nl +
'    <ClCompile Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebViewEditorDelegate.cpp" />' + $nl +
'  </ItemGroup>' + $nl
$x=$x.Replace('</Project>', $webItemGroup + '</Project>')
try { [xml]$x | Out-Null } catch { throw "Generated VST3 project XML is invalid: $($_.Exception.Message)" }
[IO.File]::WriteAllText($proj,$x,(New-Object Text.UTF8Encoding($false)))

if(-not (Select-String -Path $src -Pattern 'mEditorInitFunc' -SimpleMatch -Quiet)){throw 'Native WebView source was not installed.'}
if(-not (Select-String -Path $src -Pattern 'case 100:' -SimpleMatch -Quiet)){throw 'Native NAM bridge was not installed.'}
if(-not (Select-String -Path $proj -Pattern 'IPlugWebViewEditorDelegate.cpp' -SimpleMatch -Quiet)){throw 'WebView sources missing from VST3 project.'}
Write-Host 'SOLAR AMP native WebView source installed and verified.'$p=$p.Replace('IGRAPHICS_NANOVG;IGRAPHICS_GL2;','WEBVIEW_EDITOR_DELEGATE;NO_IGRAPHICS;')
$root=Resolve-Path 'nam-vst3-source'
$src=Join-Path $root 'NeuralAmpModeler\NeuralAmpModeler.cpp'
$hdr=Join-Path $root 'NeuralAmpModeler\NeuralAmpModeler.h'
$props=Join-Path $root 'NeuralAmpModeler\config\NeuralAmpModeler-win.props'
$proj=Join-Path $root 'NeuralAmpModeler\projects\NeuralAmpModeler-vst3.vcxproj'
$web=Join-Path $root 'NeuralAmpModeler\Resources\web'
New-Item -ItemType Directory -Force $web | Out-Null
Copy-Item 'vst3\solar-amp-native.cpp' $src -Force
Copy-Item 'vst3\solar-amp-native.h' $hdr -Force
Copy-Item 'index.html', 'styles.css', 'icon.svg' -Destination $web -Force
Copy-Item 'vst3\solar-amp-web.js' (Join-Path $web 'solar-amp-web.js') -Force
$html=[IO.File]::ReadAllText((Join-Path $web 'index.html'))
$html=[regex]::Replace($html,'<script>\(\(\)=>\{if\(!\(''serviceWorker'' in navigator\).*?</script>','',[Text.RegularExpressions.RegexOptions]::Singleline)
$html=$html.Replace('<link rel="manifest" href="manifest.webmanifest">','')
$html=[regex]::Replace($html,'<script src="app\.js[^"]*"></script>','<script src="solar-amp-web.js"></script>')
[IO.File]::WriteAllText((Join-Path $web 'index.html'),$html,(New-Object Text.UTF8Encoding($false)))

$c=[IO.File]::ReadAllText((Join-Path $root 'NeuralAmpModeler\config.h'))
$c=$c.Replace('#define PLUG_NAME "NeuralAmpModeler"','#define PLUG_NAME "SOLAR AMP"').Replace('#define PLUG_MFR "Steven Atkinson"','#define PLUG_MFR "SOLAR AMP"').Replace("#define PLUG_UNIQUE_ID '1YEo'","#define PLUG_UNIQUE_ID 'SAMP'").Replace("#define PLUG_MFR_ID 'SDAa'","#define PLUG_MFR_ID 'SLAr'").Replace('#define BUNDLE_NAME "NeuralAmpModeler"','#define BUNDLE_NAME "SOLAR AMP"').Replace('#define BUNDLE_MFR "StevenAtkinson"','#define BUNDLE_MFR "SOLARAMP"').Replace('#define SHARED_RESOURCES_SUBPATH "NeuralAmpModeler"','#define SHARED_RESOURCES_SUBPATH "SOLAR AMP"').Replace('#define PLUG_WIDTH 600','#define PLUG_WIDTH 1080').Replace('#define PLUG_HEIGHT 400','#define PLUG_HEIGHT 780').Replace('#define PLUG_HOST_RESIZE 0','#define PLUG_HOST_RESIZE 1')
[IO.File]::WriteAllText((Join-Path $root 'NeuralAmpModeler\config.h'),$c,(New-Object Text.UTF8Encoding($false)))

$p=[IO.File]::ReadAllText($props)
$p=$p.Replace('<BINARY_NAME>NeuralAmpModeler</BINARY_NAME>','<BINARY_NAME>SOLARAMP</BINARY_NAME>')
$p=$p.Replace('<EXTRA_ALL_DEFS>IGRAPHICS_NANOVG;IGRAPHICS_GL2;GRAYED_ALPHA=0.5f;NAM_ENABLE_A2_FAST</EXTRA_ALL_DEFS>','<EXTRA_ALL_DEFS>WEBVIEW_EDITOR_DELEGATE;NO_IGRAPHICS;GRAYED_ALPHA=0.5f;NAM_ENABLE_A2_FAST</EXTRA_ALL_DEFS>')
$p=$p.Replace('<AdditionalIncludeDirectories>$(SolutionDir)dsp;$(IPLUG2_ROOT)\..\eigen;$(EXTRA_INC_PATHS);$(IPLUG_INC_PATHS);$(IGRAPHICS_INC_PATHS);$(GLAD_GL2_PATHS);%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories>','<AdditionalIncludeDirectories>$(SolutionDir)dsp;$(IPLUG2_ROOT)\..\eigen;$(EXTRA_INC_PATHS);$(IPLUG_INC_PATHS);$(IPLUG2_ROOT)\Dependencies\Extras\wil\include;$(IPLUG2_ROOT)\Dependencies\Extras\WebView2\build\native\include;%(AdditionalIncludeDirectories)</AdditionalIncludeDirectories>')
$p=$p.Replace('<AdditionalDependencies>wininet.lib;comctl32.lib;Shlwapi.lib;%(AdditionalDependencies)</AdditionalDependencies>','<AdditionalDependencies>wininet.lib;comctl32.lib;Shlwapi.lib;ole32.lib;user32.lib;advapi32.lib;shell32.lib;WebView2LoaderStatic.lib;%(AdditionalDependencies)</AdditionalDependencies>')
$p=$p.Replace('<ProgramDatabaseFile>$(PDB_FILE)</ProgramDatabaseFile>','<ProgramDatabaseFile>$(PDB_FILE)</ProgramDatabaseFile>'+[Environment]::NewLine+'      <AdditionalLibraryDirectories>$(IPLUG2_ROOT)\Dependencies\Extras\WebView2\build\native\x64;%(AdditionalLibraryDirectories)</AdditionalLibraryDirectories>')
[IO.File]::WriteAllText($props,$p,(New-Object Text.UTF8Encoding($false)))

$x=[IO.File]::ReadAllText($proj)
$x=[regex]::Replace($x, '\s*<ClInclude Include="[^"]*IGraphics[^"]*" ?/>', '')
$x=[regex]::Replace($x, '\s*<ClCompile Include="[^"]*IGraphics[^"]*" ?/>', '')
$nl=[Environment]::NewLine
$webItemGroup = $nl + '  <ItemGroup>' + $nl +
'    <ClInclude Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebView.h" />' + $nl +
'    <ClInclude Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebViewEditorDelegate.h" />' + $nl +
'    <ClCompile Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebView.cpp" />' + $nl +
'    <ClCompile Include="..\..\iPlug2\IPlug\Extras\WebView\IPlugWebViewEditorDelegate.cpp" />' + $nl +
'  </ItemGroup>' + $nl
$x=$x.Replace('</Project>', $webItemGroup + '</Project>')
try { [xml]$x | Out-Null } catch { throw "Generated VST3 project XML is invalid: $($_.Exception.Message)" }
[IO.File]::WriteAllText($proj,$x,(New-Object Text.UTF8Encoding($false)))

if(-not (Select-String -Path $src -Pattern 'mEditorInitFunc' -SimpleMatch -Quiet)){throw 'Native WebView source was not installed.'}
if(-not (Select-String -Path $src -Pattern 'case 100:' -SimpleMatch -Quiet)){throw 'Native NAM bridge was not installed.'}
if(-not (Select-String -Path $proj -Pattern 'IPlugWebViewEditorDelegate.cpp' -SimpleMatch -Quiet)){throw 'WebView sources missing from VST3 project.'}
Write-Host 'SOLAR AMP native WebView source installed and verified.'
