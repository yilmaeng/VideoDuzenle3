param(
    [string]$EngineVersion = '1.0.0',
    [string]$PythonVersion = '3.12.4'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePackages = Join-Path $projectRoot 'temp\karaoke-align-packages'
$outputRoot = Join-Path $projectRoot 'dist\karaoke-engine'
$stagingRoot = Join-Path $outputRoot ("staging-win32-x64-{0}" -f $EngineVersion)
$pythonRoot = Join-Path $stagingRoot 'python'
$packagesRoot = Join-Path $stagingRoot 'packages'
$archiveName = "karaoke-engine-win32-x64-$EngineVersion.zip"
$archivePath = Join-Path $outputRoot $archiveName
$pythonArchive = Join-Path $outputRoot ("python-{0}-embed-amd64.zip" -f $PythonVersion)
$pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$manifestPath = Join-Path $outputRoot 'manifest.json'

if (-not (Test-Path $sourcePackages)) {
    throw "Karaoke Python packages were not found: $sourcePackages"
}

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
if (-not (Test-Path $pythonArchive)) {
    Write-Host "Downloading the portable Python runtime..."
    Invoke-WebRequest -Uri $pythonUrl -OutFile $pythonArchive -UseBasicParsing
}

Remove-Item $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $pythonRoot -Force | Out-Null
Write-Host "Extracting the portable Python runtime..."
Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonRoot -Force

Write-Host "Copying karaoke engine dependencies..."
Copy-Item -LiteralPath $sourcePackages -Destination $packagesRoot -Recurse

$pythonMinor = ($PythonVersion -split '\.')[0..1] -join ''
$pthPath = Join-Path $pythonRoot ("python{0}._pth" -f $pythonMinor)
@(
    ("python{0}.zip" -f $pythonMinor)
    '.'
    '..\packages'
    'import site'
) | Set-Content -LiteralPath $pthPath -Encoding ascii

$pythonExe = Join-Path $pythonRoot 'python.exe'
Write-Host "Validating the portable karaoke runtime..."
& $pythonExe -c "import lyric_align, torch, faster_whisper, demucs; print('KARAOKE_ENGINE_OK')"
if ($LASTEXITCODE -ne 0) {
    throw 'The portable karaoke runtime validation failed.'
}

Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
$sevenZip = @(
    (Join-Path $env:ProgramFiles '7-Zip\7z.exe'),
    (Join-Path ${env:ProgramFiles(x86)} '7-Zip\7z.exe'),
    (Get-Command 7z.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

Write-Host "Creating the optional karaoke engine archive..."
if ($sevenZip) {
    Push-Location $stagingRoot
    try {
        & $sevenZip a -tzip -mx=7 $archivePath 'python' 'packages'
        if ($LASTEXITCODE -ne 0) { throw "7-Zip exited with code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
} else {
    Compress-Archive -Path (Join-Path $stagingRoot 'python'), (Join-Path $stagingRoot 'packages') -DestinationPath $archivePath -CompressionLevel Optimal
}

$archive = Get-Item -LiteralPath $archivePath
$sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$downloadUrl = "https://evd.drenginyilmaz.net/downloads/karaoke-engine/$archiveName"
$manifest = [ordered]@{
    version = $EngineVersion
    platforms = [ordered]@{
        'win32-x64' = [ordered]@{
            version = $EngineVersion
            url = $downloadUrl
            sha256 = $sha256
            size = $archive.Length
        }
    }
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

Write-Host 'Windows karaoke engine artifacts are ready:'
Write-Host "- $archivePath"
Write-Host "- $manifestPath"
Write-Host "- SHA-256: $sha256"
