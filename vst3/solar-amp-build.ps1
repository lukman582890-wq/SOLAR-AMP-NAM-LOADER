param([string]$SourceDir = "nam-vst3-source")

$ErrorActionPreference = "Stop"
$cpp = Join-Path $SourceDir "NeuralAmpModeler/NeuralAmpModeler.cpp"
$h = Join-Path $SourceDir "NeuralAmpModeler/NeuralAmpModeler.h"
$controls = Join-Path $SourceDir "NeuralAmpModeler/NeuralAmpModelerControls.cpp"

foreach ($f in @($cpp,$h,$controls)) {
  if (Test-Path $f) {
    $s = Get-Content $f -Raw
    $s = $s -replace "Neural Amp Modeler", "SOLAR AMP"
    $s = $s -replace "NeuralAmpModeler", "SOLAR AMP"
    Set-Content -Path $f -Value $s -Encoding UTF8
  }
}

# Brand the plugin while keeping the proven NAM DSP implementation and VST3 shell.
$plist = Get-ChildItem -Path $SourceDir -Recurse -Filter "*VST3*Info.plist" -ErrorAction SilentlyContinue
foreach ($p in $plist) {
  $s = Get-Content $p.FullName -Raw
  $s = $s -replace "Neural Amp Modeler", "SOLAR AMP"
  $s = $s -replace "NeuralAmpModeler", "SOLAR AMP"
  Set-Content -Path $p.FullName -Value $s -Encoding UTF8
}
Write-Host "SOLAR AMP source branding applied."
