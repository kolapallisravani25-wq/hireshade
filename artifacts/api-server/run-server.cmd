@echo off
cd /d "%~dp0"
node --env-file-if-exists=.env --enable-source-maps .\dist\index.mjs > server-run.log 2>&1
