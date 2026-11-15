@echo off
REM Meridian: double-click, or run from PowerShell inside this folder:  .\start.bat
cd /d "%~dp0"
if not exist .venv\Scripts\activate.bat python -m venv .venv
call .venv\Scripts\activate.bat
pip install -q -r requirements.txt
if not exist static\vendor\leaflet.js python -m app.vendor
start "" http://localhost:8001
uvicorn app.main:app --port 8001
pause
