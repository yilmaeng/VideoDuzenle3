@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
"node_modules\electron\dist\electron.exe" . --enable-logging 2>&1 | more
pause
