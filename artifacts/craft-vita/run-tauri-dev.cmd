@echo off
cd /d "%~dp0"
pnpm tauri dev > tauri-run.log 2>&1
