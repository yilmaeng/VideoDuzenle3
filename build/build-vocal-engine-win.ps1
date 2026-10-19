param([string]$EngineVersion = '1.0.0', [switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
if ($EngineVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Invalid version' }
$project = Split-Path -Parent $PSScriptRoot
$output = Join-Path $project 'dist\vocal-engine'
$stage = Join-Path $output "staging-win32-x64-$EngineVersion"
New-Item -ItemType Directory -Path $output -Force | Out-Null
if (-not (Test-Path $stage)) {
    $pythonZip = Join-Path $project 'dist\karaoke-engine\python-3.12.4-embed-amd64.zip'
    if (-not (Test-Path $pythonZip)) { throw 'Prepare Python 3.12.4 embedded runtime first.' }
    New-Item -ItemType Directory -Path $stage | Out-Null
    Expand-Archive -LiteralPath $pythonZip -DestinationPath (Join-Path $stage 'python')
    # Preserve the exact tested dependency precedence instead of merging incompatible Torch versions.
    Copy-Item -LiteralPath (Join-Path $project 'temp\vocal-test-packages') -Destination (Join-Path $stage 'packages') -Recurse
    Copy-Item -LiteralPath (Join-Path $project 'temp\vocal-quality-runtime') -Destination (Join-Path $stage 'quality') -Recurse
    Copy-Item -LiteralPath (Join-Path $project 'temp\karaoke-align-packages') -Destination (Join-Path $stage 'base') -Recurse
    New-Item -ItemType Directory -Path (Join-Path $stage 'models') | Out-Null
    foreach ($file in @('mel_band_roformer_instrumental_becruily.ckpt', 'config_mel_band_roformer_instrumental_becruily.yaml')) {
        Copy-Item -LiteralPath (Join-Path $project "temp\getem-separation\roformer-models\$file") -Destination (Join-Path $stage 'models')
    }
    @('python312.zip', '.', '..\quality', '..\packages', '..\base', 'import site') |
        Set-Content -LiteralPath (Join-Path $stage 'python\python312._pth') -Encoding ascii
}
$env:PATH = "$(Join-Path $project 'node_modules\@ffmpeg-installer\win32-x64');$env:PATH"
& (Join-Path $stage 'python\python.exe') -c "import torch, soundfile; from audio_separator.separator import Separator; assert torch.__version__ == '2.8.0+cpu'; print('VOCAL_ENGINE_OK', torch.__version__)"
if ($LASTEXITCODE -ne 0) { throw 'Optional runtime validation failed' }
if ($PrepareOnly) { Write-Host "Prepared: $stage"; exit 0 }
$archiveName = "vocal-engine-win32-x64-$EngineVersion.zip"
$archive = Join-Path $output $archiveName
if (Test-Path $archive) { throw 'Archive already exists; use a new engine version or move the old artifact first.' }
$sevenZip = Join-Path $env:ProgramFiles '7-Zip\7z.exe'
if (-not (Test-Path $sevenZip)) { throw '7-Zip is required for the large optional archive.' }
Push-Location $stage
try {
    & $sevenZip a -tzip -mx=5 $archive 'python' 'quality' 'packages' 'base' 'models'
    if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed' }
} finally { Pop-Location }
$manifest = @{ platforms = @{ 'win32-x64' = @{
    version = $EngineVersion
    url = "https://evd.drenginyilmaz.net/downloads/vocal-engine/$archiveName"
    sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    size = (Get-Item -LiteralPath $archive).Length
    unpackedSize = (Get-ChildItem -LiteralPath $stage -Recurse -File | Measure-Object Length -Sum).Sum
} } }
[IO.File]::WriteAllText((Join-Path $output 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Host "Ready for optional-component publishing: $archive"
