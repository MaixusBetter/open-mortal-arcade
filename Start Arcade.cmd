@echo off
rem Mortal Arcade launcher for Windows: double-click to start.
rem Uses Node.js 20+ if the computer has it, otherwise fetches a private copy into .runtime\node.
rem Then tools\setup.mjs gets the Windows file system, starts the arcade and opens the browser.
setlocal EnableExtensions
title Mortal Arcade
pushd "%~dp0"

set "NODE="
if exist ".runtime\node\node.exe" set "NODE=%CD%\.runtime\node\node.exe"
if defined NODE goto run

where node >nul 2>nul
if errorlevel 1 goto getnode
node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto getnode
set "NODE=node"
goto run

:getnode
echo.
echo   Mortal Arcade needs Node.js 20 or newer. Fetching a private copy into this folder.
echo   This happens once, about 30 MB. Nothing is installed on the computer.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\tools\get-node.ps1"
if errorlevel 1 goto failed
if not exist ".runtime\node\node.exe" goto failed
set "NODE=%CD%\.runtime\node\node.exe"

:run
"%NODE%" "%CD%\tools\setup.mjs" %*
if errorlevel 1 goto failed
popd
exit /b 0

:failed
echo.
echo   Mortal Arcade stopped with a problem. Read the message above,
echo   then press any key to close this window.
pause >nul
popd
exit /b 1
