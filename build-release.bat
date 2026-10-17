@echo off
chcp 65001 >nul
setlocal
rem Subaudi one-click release build. Double-click, or run from a terminal:
rem   build-release.bat              full build: env check, tests, sidecars, EXE, smoke test
rem   build-release.bat --fast       skip type check and tests
rem   build-release.bat --smoke-only only re-check the sidecars in release\win-unpacked
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，请安装 Node.js 22.13 或更高版本后重试。
  goto :end_fail
)

node scripts\release.mjs %*
if errorlevel 1 goto :end_fail

echo.
echo 发布版已生成在 release\ 目录。
if not defined SUBAUDI_NO_PAUSE pause
exit /b 0

:end_fail
echo.
echo 打包未完成，请查看上方的错误信息。
if not defined SUBAUDI_NO_PAUSE pause
exit /b 1
