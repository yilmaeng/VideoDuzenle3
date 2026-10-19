param(
    [string]$HostName = '159.195.31.84',
    [int]$Port = 22179,
    [string]$User = 'root',
    [string]$RemoteAppDir = '/var/www/evd/evd-yayinodasi-server',
    [string]$RemoteTmpDir = '/tmp/evd-yayinodasi-deploy',
    [string]$IdentityFile = $env:EVD_DEPLOY_IDENTITY_FILE,
    [switch]$ForceFullUpload,
    [switch]$RestartOnly,
    [switch]$InstallMediaTools,
    [switch]$SkipRestart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-CommandAvailable([string]$CommandName) {
    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Gerekli komut bulunamadı: $CommandName"
    }
}

function Get-SshArgumentList() {
    $args = @('-p', "$Port")
    if ($IdentityFile) {
        $args += @('-i', $IdentityFile)
    }
    return $args
}

function Invoke-SshCommand([string]$CommandText) {
    $sshArgs = @(Get-SshArgumentList)
    $sshArgs += @($remoteTarget, $CommandText)
    & ssh @sshArgs
    if ($LASTEXITCODE -ne 0) {
        throw "SSH komutu başarısız oldu."
    }
}

function Invoke-ScpUpload([string]$LocalPath, [string]$RemotePath) {
    $scpArgs = @('-P', "$Port")
    if ($IdentityFile) {
        $scpArgs += @('-i', $IdentityFile)
    }
    $scpArgs += @($LocalPath, "${remoteTarget}:$RemotePath")
    & scp @scpArgs
    if ($LASTEXITCODE -ne 0) {
        throw "SCP yüklemesi başarısız oldu: $LocalPath"
    }
}

function Convert-ToUnixRelativePath([string]$RelativePath) {
    return ($RelativePath -replace '\\', '/')
}

function Get-UnixDirectoryName([string]$UnixPath) {
    $normalized = ([string]$UnixPath).Replace('\', '/')
    $lastSlashIndex = $normalized.LastIndexOf('/')
    if ($lastSlashIndex -lt 0) {
        return ''
    }
    return $normalized.Substring(0, $lastSlashIndex)
}

function Get-LocalFileHashValue([string]$Path) {
    $getFileHash = Get-Command Get-FileHash -ErrorAction SilentlyContinue
    if ($getFileHash) {
        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha256.ComputeHash($stream)
            return ([System.BitConverter]::ToString($hashBytes) -replace '-', '').ToLowerInvariant()
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Get-RemoteFileHashValue([string]$RemoteFilePath) {
    $commandTemplate = @'
if [ -f '__REMOTE_FILE_PATH__' ]; then sha256sum '__REMOTE_FILE_PATH__' | awk '{print $1}'; fi
'@
    $command = $commandTemplate.Replace('__REMOTE_FILE_PATH__', $RemoteFilePath)
    $sshArgs = @(Get-SshArgumentList)
    $sshArgs += @($remoteTarget, $command)
    $output = & ssh @sshArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Uzak dosya özeti alınamadı: $RemoteFilePath"
    }
    if ($null -eq $output) {
        return ''
    }
    return [string]::Join('', $output).Trim().ToLowerInvariant()
}

$repoRoot = Split-Path -Parent $PSScriptRoot

$fileMappings = @(
    @{ Source = 'src\broadcast-room-web\backend\src\services\recording-media.js'; Remote = 'src/services/recording-media.js' },
    @{ Source = 'src\broadcast-room-web\backend\deploy\storage\recording-retention.py'; Remote = 'deploy/storage/recording-retention.py' },
    @{ Source = 'src\broadcast-room-web\backend\deploy\storage\update-api-read-timeout.py'; Remote = 'deploy/storage/update-api-read-timeout.py' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\participant-presence.js'; Remote = 'src/services/participant-presence.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\system-admin-accounts.js'; Remote = 'src/routes/system-admin-accounts.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\meeting-recording-access.js'; Remote = 'src/routes/meeting-recording-access.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\recordings.html'; Remote = 'public/recordings.html' },
    @{ Source = 'src\broadcast-room-web\frontend\public\recordings.js'; Remote = 'public/recordings.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\admin-recordings.js'; Remote = 'public/admin-recordings.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\admin-managers.js'; Remote = 'public/admin-managers.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\admin-managers.js'; Remote = 'src/routes/admin-managers.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\web-host.js'; Remote = 'public/web-host.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\admin-meeting.js'; Remote = 'src/routes/admin-meeting.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\admin-recordings.js'; Remote = 'src/routes/admin-recordings.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\server-recordings.js'; Remote = 'src/services/server-recordings.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\admin-rooms.js'; Remote = 'public/admin-rooms.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\admin-rooms.js'; Remote = 'src/routes/admin-rooms.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\admin.html'; Remote = 'public/admin.html' },
    @{ Source = 'src\broadcast-room-web\frontend\public\admin.js'; Remote = 'public/admin.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\admin.css'; Remote = 'public/admin.css' },
    @{ Source = 'src\broadcast-room-web\backend\package-lock.json'; Remote = 'package-lock.json' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\admin-auth.js'; Remote = 'src/routes/admin-auth.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\desktop-room-account.js'; Remote = 'src/routes/desktop-room-account.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\admin-account-store.js'; Remote = 'src/services/admin-account-store.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\admin-mailer.js'; Remote = 'src/services/admin-mailer.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\icons\LICENSE.txt'; Remote = 'public/icons/LICENSE.txt' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\microphone-on.wav'; Remote = 'public/sounds/microphone-on.wav' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\microphone-off.wav'; Remote = 'public/sounds/microphone-off.wav' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\camera-on.mp3'; Remote = 'public/sounds/camera-on.mp3' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\camera-off.wav'; Remote = 'public/sounds/camera-off.wav' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\room-join.mp3'; Remote = 'public/sounds/room-join.mp3' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\room-leave.mp3'; Remote = 'public/sounds/room-leave.mp3' },
    @{ Source = 'src\broadcast-room-web\frontend\public\sounds\LICENSES.txt'; Remote = 'public/sounds/LICENSES.txt' },
    @{ Source = 'src\broadcast-room-web\frontend\public\join.html'; Remote = 'public/join.html' },
    @{ Source = 'src\broadcast-room-web\frontend\public\join.js'; Remote = 'public/join.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\waiting-room.js'; Remote = 'public/waiting-room.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\join.css'; Remote = 'public/join.css' },
    @{ Source = 'src\broadcast-room-web\frontend\public\camera-framing\blaze_face_short_range.tflite'; Remote = 'public/camera-framing/blaze_face_short_range.tflite' },
    @{ Source = 'src\broadcast-room-web\frontend\public\camera-framing\vision_bundle.mjs'; Remote = 'public/camera-framing/vision_bundle.mjs' },
    @{ Source = 'src\broadcast-room-web\frontend\public\camera-framing\vision_wasm_internal.js'; Remote = 'public/camera-framing/vision_wasm_internal.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\camera-framing\vision_wasm_internal.wasm'; Remote = 'public/camera-framing/vision_wasm_internal.wasm' },
    @{ Source = 'src\broadcast-room-web\frontend\public\camera-framing\vision_wasm_nosimd_internal.js'; Remote = 'public/camera-framing/vision_wasm_nosimd_internal.js' },
    @{ Source = 'src\broadcast-room-web\frontend\public\camera-framing\vision_wasm_nosimd_internal.wasm'; Remote = 'public/camera-framing/vision_wasm_nosimd_internal.wasm' },
    @{ Source = 'src\broadcast-room-web\backend\package.json'; Remote = 'package.json' },
    @{ Source = 'src\broadcast-room-web\backend\src\config.js'; Remote = 'src/config.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\server.js'; Remote = 'src/server.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\monitor-audio-hub.js'; Remote = 'src/monitor-audio-hub.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\routes\broadcast-room.js'; Remote = 'src/routes/broadcast-room.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\participant-avatar-store.js'; Remote = 'src/services/participant-avatar-store.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\room-authorization.js'; Remote = 'src/services/room-authorization.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\waiting-room.js'; Remote = 'src/services/waiting-room.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\services\token-service.js'; Remote = 'src/services/token-service.js' },
    @{ Source = 'src\broadcast-room-web\backend\src\store\room-store.js'; Remote = 'src/store/room-store.js' },
    @{ Source = 'src\locales\tr.json'; Remote = 'locales/tr.json' },
    @{ Source = 'src\locales\en.json'; Remote = 'locales/en.json' },
    @{ Source = 'src\locales\de.json'; Remote = 'locales/de.json' },
    @{ Source = 'src\locales\es.json'; Remote = 'locales/es.json' },
    @{ Source = 'src\locales\fr.json'; Remote = 'locales/fr.json' }
)

foreach ($mapping in $fileMappings) {
    $fullPath = Join-Path $repoRoot $mapping.Source
    if (-not (Test-Path -LiteralPath $fullPath)) {
        throw "Dağıtım dosyası bulunamadı: $fullPath"
    }
}

Assert-CommandAvailable 'scp'
Assert-CommandAvailable 'ssh'

$defaultIdentityFile = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
if (-not $IdentityFile -and (Test-Path -LiteralPath $defaultIdentityFile)) {
    $IdentityFile = $defaultIdentityFile
}

$remoteTarget = "$User@$HostName"
$changedFiles = @()

if (-not $RestartOnly) {
    Write-Step 'Değişen dosyalar denetleniyor'
    foreach ($mapping in $fileMappings) {
        $localPath = Join-Path $repoRoot $mapping.Source
        $localHash = Get-LocalFileHashValue $localPath
        $remoteRelativePath = Convert-ToUnixRelativePath $mapping.Remote
        $remoteFullPath = "$RemoteAppDir/$remoteRelativePath"
        $remoteHash = if ($ForceFullUpload) { '' } else { Get-RemoteFileHashValue $remoteFullPath }
        if ($ForceFullUpload -or -not $remoteHash -or $localHash -ne $remoteHash) {
            $changedFiles += ,@{
                Source = $mapping.Source
                Remote = $mapping.Remote
            }
        }
    }

    if ($changedFiles.Count -gt 0) {
        Write-Step "Sunucuya yüklenecek dosya sayısı: $($changedFiles.Count)"
        foreach ($mapping in $changedFiles) {
            Write-Host " - $($mapping.Remote)"
        }

        Write-Step 'Sunucudaki geçici dağıtım klasörü hazırlanıyor'
        Invoke-SshCommand "rm -rf '$RemoteTmpDir' && mkdir -p '$RemoteTmpDir'"

        Write-Step 'Değişen dosyalar sunucuya yükleniyor'
        foreach ($mapping in $changedFiles) {
            $sourcePath = Join-Path $repoRoot $mapping.Source
            $remoteRelativePath = Convert-ToUnixRelativePath $mapping.Remote
            $remoteFilePath = "$RemoteTmpDir/$remoteRelativePath"
            $remoteDirPath = Get-UnixDirectoryName $remoteFilePath
            if ($remoteDirPath) {
                Invoke-SshCommand "mkdir -p '$remoteDirPath'"
            }
            Invoke-ScpUpload $sourcePath $remoteFilePath
        }
    } else {
        Write-Step 'Değişen dosya bulunmadı'
    }
}

if (-not $SkipRestart) {
    Write-Step 'Sunucuda dosyalar yerine alınıp uygulama yeniden başlatılıyor'
    $restartScriptTemplate = @'
set -e
APP_DIR='__REMOTE_APP_DIR__'
TMP_DIR='__REMOTE_TMP_DIR__'
# Verify media processing tools before stopping the running service.
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if [ '__INSTALL_MEDIA_TOOLS__' != 'yes' ]; then
    echo 'FFmpeg/FFprobe missing. Re-run with -InstallMediaTools after approval.'
    exit 1
  fi
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg
fi
BACKUP_DIR="/var/backups/evd-yayinodasi/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
tar -C "$APP_DIR" -czf "$BACKUP_DIR/app.tar.gz" src public locales package.json package-lock.json .env data
chmod 600 "$BACKUP_DIR/app.tar.gz"
echo "Backup: $BACKUP_DIR/app.tar.gz"
if [ '__INSTALL_MEDIA_TOOLS__' = 'yes' ]; then
  NGINX_SITE=/etc/nginx/sites-enabled/evd.drenginyilmaz.net
  NGINX_TARGET=$(readlink -f "$NGINX_SITE")
  [ -f "$NGINX_TARGET" ] || { echo 'Nginx site config missing'; exit 1; }
  cp -p "$NGINX_TARGET" "$BACKUP_DIR/nginx-site.conf"
  TIMEOUT_HELPER="$TMP_DIR/deploy/storage/update-api-read-timeout.py"
  [ -f "$TIMEOUT_HELPER" ] || TIMEOUT_HELPER="$APP_DIR/deploy/storage/update-api-read-timeout.py"
  python3 "$TIMEOUT_HELPER" "$NGINX_SITE"
  if ! nginx -t || ! systemctl reload nginx; then
    cp -p "$BACKUP_DIR/nginx-site.conf" "$NGINX_TARGET"
    nginx -t && systemctl reload nginx
    exit 1
  fi
fi
MANAGED_SERVICE=''
if systemctl cat evd-yayinodasi.service >/dev/null 2>&1; then
  SERVICE_DIR=$(systemctl show evd-yayinodasi.service -p WorkingDirectory --value)
  [ "$SERVICE_DIR" = "$APP_DIR" ] || { echo 'Service directory mismatch'; exit 1; }
  MANAGED_SERVICE=evd-yayinodasi.service
  systemctl stop "$MANAGED_SERVICE"
fi
# Retire only orphaned processes belonging to this app, never other Node apps.
for PID in $(pgrep -f '^(/usr/bin/)?node src/server\.js$' || true); do
  [ "$(readlink /proc/$PID/cwd 2>/dev/null)" = "$APP_DIR" ] || continue
  kill "$PID" 2>/dev/null || true
  for WAIT in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$PID" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null && [ "$(readlink /proc/$PID/cwd 2>/dev/null)" = "$APP_DIR" ]; then
    kill -9 "$PID"
  fi
done
if [ -d "$TMP_DIR" ]; then
  cp -R "$TMP_DIR/." "$APP_DIR/"
fi
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts
if [ -f "$APP_DIR/deploy/storage/recording-retention.py" ] && [ -d /usr/local/lib/evd ]; then
  if [ -f /usr/local/lib/evd/recording-retention.py ]; then
    cp /usr/local/lib/evd/recording-retention.py "$BACKUP_DIR/recording-retention.py"
  fi
  install -m 644 -o root -g root "$APP_DIR/deploy/storage/recording-retention.py" /usr/local/lib/evd/recording-retention.py
fi
if [ -n "$MANAGED_SERVICE" ]; then
  SERVICE_USER=$(systemctl show "$MANAGED_SERVICE" -p User --value)
  SERVICE_GROUP=$(systemctl show "$MANAGED_SERVICE" -p Group --value)
  if [ -n "$SERVICE_USER" ]; then
    chown -R "$SERVICE_USER:${SERVICE_GROUP:-$SERVICE_USER}" "$APP_DIR/data"
  fi
  systemctl reset-failed "$MANAGED_SERVICE"
  systemctl start "$MANAGED_SERVICE"
else
  set -a
  . ./.env
  set +a
  nohup /usr/bin/node src/server.js > server.log 2>&1 &
fi
sleep 4
curl -fsS http://127.0.0.1:4100/api/health
if [ -n "$MANAGED_SERVICE" ]; then systemctl is-active "$MANAGED_SERVICE"; fi
'@
    $restartScript = $restartScriptTemplate.Replace('__REMOTE_APP_DIR__', $RemoteAppDir).Replace('__REMOTE_TMP_DIR__', $RemoteTmpDir)
    $restartScript = $restartScript.Replace('__INSTALL_MEDIA_TOOLS__', $(if ($InstallMediaTools) { 'yes' } else { 'no' }))
    Invoke-SshCommand $restartScript
} else {
    Write-Step 'SkipRestart seçildi, sunucuda restart yapılmadı'
}

if (-not $RestartOnly -and $changedFiles.Count -gt 0) {
    Write-Step 'Sunucudaki geçici dağıtım klasörü temizleniyor'
    Invoke-SshCommand "rm -rf '$RemoteTmpDir'"
}

Write-Step 'Dağıtım tamamlandı'
if ($IdentityFile) {
    Write-Host "SSH anahtarı kullanıldı: $IdentityFile" -ForegroundColor DarkGray
}
Write-Host "Komut tamamlandı. Gerekirse EVD uygulamasını yeniden açın." -ForegroundColor Green
