@echo off
setlocal

:: Pokedex launcher (Windows). Run run\install_windows.bat once first.
::
:: Starts the database and frontend containers, then the backend natively via
:: backend_launch.bat in this window. Frontend: http://localhost:5173

:: this file lives in run\; work from the repo root
cd /d "%~dp0.."

if not exist .env (
    echo [start] Not installed yet - run run\install_windows.bat first.
    pause
    exit /b 1
)

call "%~dp0ensure_docker.bat" || (pause & exit /b 1)

echo [start] Starting the database and frontend...
docker compose up -d
if errorlevel 1 (
    echo [start] Starting the containers failed. If a port is already allocated,
    echo [start] set MONGO_PORT in .env to a free one, e.g. 27018.
    pause
    exit /b 1
)

echo.
echo [start] Frontend: http://localhost:5173  (works once the backend below is running)
echo.
call "%~dp0backend_launch.bat"

echo.
choice /c YN /m "Stop the database and frontend containers"
if not errorlevel 2 docker compose stop

endlocal
