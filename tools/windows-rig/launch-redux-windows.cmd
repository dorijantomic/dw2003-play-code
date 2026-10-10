@echo off
rem Optional convenience launcher. The real rig logic lives in launch-redux-windows.ps1.
rem This avoids changing the machine-wide PowerShell execution policy.
setlocal
set RIG_ROOT=%DW3_RIG_ROOT%
if "%RIG_ROOT%"=="" set RIG_ROOT=C:\dw3-rig
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RIG_ROOT%\launch-redux-windows.ps1"
