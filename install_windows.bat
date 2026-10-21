@echo off
setlocal

:: Pokedex installer (Windows). Run once, then start_windows.bat.
::
:: Windows runs the database and frontend in Docker and the backend natively
:: (Docker Desktop can't pass a webcam through to a container). This script
:: makes sure WSL, Docker Desktop and Python are installed (asking before
:: installing anything), sets up the backend's .venv, downloads the card
:: images and figurine model weights, builds the images and seeds the
:: database. Safe to re-run: finished steps are skipped.

cd /d "%~dp0"
set NEED_RESTART=

:: ---------------------------------------------------------------- WSL
wsl --status >nul 2>&1
if not errorlevel 1 goto :wsl_ok
echo [install] WSL (Windows Subsystem for Linux) is not installed. Docker Desktop needs it.
choice /c YN /m "Install WSL now (asks for administrator rights)"
if errorlevel 2 goto :declined
powershell -NoProfile -Command "Start-Process wsl -ArgumentList '--install','--no-distribution' -Verb RunAs -Wait"
if errorlevel 1 (
    echo [install] WSL install failed or was cancelled.
    goto :fail
)
set NEED_RESTART=1
:wsl_ok

:: ---------------------------------------------------------------- Docker Desktop
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" goto :docker_ok
echo [install] Docker Desktop is not installed.
choice /c YN /m "Install Docker Desktop now with winget"
if errorlevel 2 goto :declined
call :need_winget || goto :fail
winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo [install] Docker Desktop install failed.
    goto :fail
)
set NEED_RESTART=1
:docker_ok

:: ---------------------------------------------------------------- Python
:: "python" can be the Microsoft Store stub, which fails (9009) -- counts as missing
set PY=
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY python --version >nul 2>&1 && set "PY=python"
if defined PY goto :python_ok
echo [install] Python is not installed.
choice /c YN /m "Install Python 3.12 now with winget"
if errorlevel 2 goto :declined
call :need_winget || goto :fail
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
    echo [install] Python install failed.
    goto :fail
)
:: this console still has the old PATH
if not defined NEED_RESTART (
    echo.
    echo [install] Python installed. Close this window, open a new one and run install_windows.bat again.
    goto :done
)
:python_ok

if defined NEED_RESTART (
    echo.
    echo [install] Restart Windows to finish installing WSL / Docker Desktop,
    echo [install] then run install_windows.bat again.
    goto :done
)

:: ---------------------------------------------------------------- Settings
if not exist .env (
    copy /y .env.example .env >nul
    echo [install] Created .env from .env.example.
)

:: ---------------------------------------------------------------- Backend venv
if not exist ".venv\Scripts\python.exe" (
    echo [install] Creating the backend's Python environment...
    %PY% -m venv .venv || goto :fail
)
echo [install] Installing backend packages (the first time downloads ~1 GB)...
.venv\Scripts\python -m pip install --upgrade pip >nul
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [install] Installing the backend packages failed.
    goto :fail
)
echo [install] Downloading figurine model weights...
.venv\Scripts\python -c "import torch; torch.hub.load('facebookresearch/dinov2', 'dinov2_vits14_reg', verbose=False); print('DINOv2 weights cached')"
if errorlevel 1 (
    echo [install] Downloading the figurine model weights failed.
    goto :fail
)

:: ---------------------------------------------------------------- Docker side
call "%~dp0scripts\ensure_docker.bat" || goto :fail

echo [install] Downloading card reference images...
docker compose --profile setup run --rm cards || goto :compose_fail

echo [install] Building the frontend image...
docker compose build || goto :compose_fail

echo [install] Seeding the database...
docker compose --profile seed run --rm seed || goto :compose_fail
docker compose stop mongo >nul 2>&1

echo.
echo [install] Done. Start the Pokedex with: start_windows.bat
goto :done

:: ---------------------------------------------------------------- helpers
:need_winget
where winget >nul 2>&1 && exit /b 0
echo [install] winget isn't available. Install "App Installer" from the Microsoft Store,
echo [install] or install the missing program yourself, then re-run.
exit /b 1

:compose_fail
echo [install] A Docker step failed (see above). If it says a port is already
echo [install] allocated, another program uses it -- e.g. set MONGO_PORT=27018 in .env.
goto :fail

:declined
echo [install] It's required to run the Pokedex, so the install stops here.
goto :fail

:fail
echo.
pause
exit /b 1

:done
echo.
pause
endlocal
