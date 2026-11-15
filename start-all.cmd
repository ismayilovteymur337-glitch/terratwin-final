@echo off
REM Starts Earth (Meridian, this folder) and Mars (TerraTwin, sibling folder "terratwin").
cd /d "%~dp0"
set "MARS=%~dp0..\terratwin"
if not exist "%MARS%\package.json" (
  echo TerraTwin folder not found at "%MARS%".
  echo Put this folder next to the "terratwin" folder on the Desktop.
  pause
  exit /b 1
)
if exist "%LOCALAPPDATA%\terratwin-node\node-v26.13.1-win-x64\node.exe" set "PATH=%LOCALAPPDATA%\terratwin-node\node-v26.13.1-win-x64;%PATH%"
if not exist "%MARS%\node_modules" (
  echo Installing TerraTwin packages once...
  pushd "%MARS%" && call npm.cmd install && popd
)
echo Starting Mars 3D on http://localhost:5173 ...
start "TerraTwin Mars (5173)" cmd /k "cd /d ""%MARS%"" && npm.cmd run dev"
echo Starting Earth on http://localhost:8001 ...
start "Meridian Earth (8001)" cmd /k "cd /d ""%~dp0backend"" && start.bat"
echo.
echo Two windows opened. Keep them open while you use the site.
timeout /t 4 >nul
