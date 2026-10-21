@echo off
:: Makes sure the Docker engine is answering, starting Docker Desktop if not.
:: Used by install_windows.bat and start_windows.bat. Exit code 1 = not up.

docker info >nul 2>&1 && exit /b 0

set "DD_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "%DD_EXE%" (
    echo [docker] Docker Desktop isn't installed - run install_windows.bat first.
    exit /b 1
)

echo [docker] Starting Docker Desktop (this can take a minute)...
start "" "%DD_EXE%"

:: poll every 3 s for up to ~2 minutes
for /l %%i in (1,1,40) do (
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1 && (
        echo [docker] Docker is running.
        exit /b 0
    )
)

echo [docker] Docker Desktop didn't start in time. Open it from the Start menu,
echo [docker] wait for "Engine running", then try again.
exit /b 1
