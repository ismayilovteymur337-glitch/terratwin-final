@echo off
REM TerraTwin + Meridian: one double-click starts both apps.
REM   Earth (Meridian, Python)  -> http://localhost:8001   (opens in the browser)
REM   Moon  (TerraTwin, Node)   -> http://localhost:5173   (opened from the "Moon 3D" button)
cd /d "%~dp0"

REM Use the bundled Node from start-localhost.cmd if it exists, otherwise the system Node.
if exist "%LOCALAPPDATA%\terratwin-node\node-v26.13.1-win-x64\node.exe" set "PATH=%LOCALAPPDATA%\terratwin-node\node-v26.13.1-win-x64;%PATH%"

if not exist node_modules (
  echo Installing TerraTwin packages once...
  call npm.cmd install
)

echo Starting TerraTwin Moon server on http://localhost:5173 ...
start "TerraTwin Moon (5173)" cmd /k "cd /d ""%~dp0"" && npm.cmd run dev"

echo Starting Meridian Earth server on http://localhost:8001 ...
start "Meridian Earth (8001)" cmd /k "cd /d ""%~dp0earth\backend"" && start.bat"

echo.
echo Both servers are starting in their own windows. Close those windows to stop them.
timeout /t 4 >nul
