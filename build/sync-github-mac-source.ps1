param(
    [string]$SourceRoot = '',
    [Parameter(Mandatory = $true)]
    [string]$TargetRoot
)

$ErrorActionPreference = 'Stop'
if (-not $SourceRoot) {
    $SourceRoot = Split-Path -Parent $PSScriptRoot
}
$source = (Resolve-Path -LiteralPath $SourceRoot).Path
$target = (Resolve-Path -LiteralPath $TargetRoot).Path

if (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) {
    throw "Target is not a Git repository: $target"
}
if ($source -eq $target) {
    throw 'Source and target directories must be different.'
}

function Copy-Tree([string]$RelativePath, [string[]]$ExcludedDirectories = @()) {
    $sourcePath = Join-Path $source $RelativePath
    $targetPath = Join-Path $target $RelativePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        return
    }
    New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
    $arguments = @($sourcePath, $targetPath, '/E', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($ExcludedDirectories.Count -gt 0) {
        $arguments += '/XD'
        $arguments += $ExcludedDirectories | ForEach-Object { Join-Path $sourcePath $_ }
    }
    & robocopy @arguments | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Directory synchronization failed: $RelativePath (robocopy exit $LASTEXITCODE)"
    }
}

Copy-Tree 'src' @('resources\obs-studio')
Copy-Tree 'build'
Copy-Tree 'assets'
Copy-Tree 'Animation Sounds'
Copy-Tree 'Geçiş Sesleri'
Copy-Tree 'tools' @('EvdProcessLoopbackCapture\bin', 'EvdProcessLoopbackCapture\obj')

$rootFiles = @(
    '.gitattributes',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'entitlements.mac.plist',
    'Start_icon.png',
    'Start_icon.ico',
    'README.md',
    'start.sh',
    'start-debug.sh',
    'setup-mac.sh'
)
foreach ($relativePath in $rootFiles) {
    $sourcePath = Join-Path $source $relativePath
    if (Test-Path -LiteralPath $sourcePath) {
        Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $target $relativePath) -Force
    }
}

$workflowSource = Join-Path $source '.github\workflows\build-mac-arm-only.yml'
$workflowTarget = Join-Path $target '.github\workflows\build-mac-arm-only.yml'
New-Item -ItemType Directory -Path (Split-Path -Parent $workflowTarget) -Force | Out-Null
Copy-Item -LiteralPath $workflowSource -Destination $workflowTarget -Force

Write-Host "Mac GitHub source synchronized: $target"
