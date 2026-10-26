@echo off
setlocal
rem ================================================================
rem  OpenMortal launcher for Windows 10/11  (uOttawa Game Dev Club)
rem  Why it would not boot: SDL 1.2 asks DirectDraw for a 640x480
rem  16-bit fullscreen mode and Windows 11 refuses it. This launcher
rem  switches SDL to its GDI driver (windib). The game is untouched.
rem ================================================================
set "HERE=%~dp0"
set "BIN="
if exist "%HERE%bin\OpenMortal.exe" set "BIN=%HERE%bin"
if exist "%HERE%OpenMortal.exe" set "BIN=%HERE%."
if not defined BIN (
  echo Could not find OpenMortal.exe next to this launcher.
  echo Put this file in your OpenMortal folder ^(the one that has bin and data inside^).
  pause
  exit /b 1
)
cd /d "%BIN%"
if not exist "OpenMortal.exe.ini" copy /y "%HERE%OpenMortal.exe.ini.win11" "OpenMortal.exe.ini" >nul
set SDL_VIDEODRIVER=windib
set SDL_AUDIODRIVER=waveout
powershell -NoProfile -Command "(Get-Content OpenMortal.exe.ini) -replace 'FULLSCREEN=\d','FULLSCREEN=0' | Set-Content OpenMortal.exe.ini"
start "" "OpenMortal.exe"
