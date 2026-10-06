@echo off
setlocal

:: Pokedex kiosk backend launcher.
::
:: Ensures a venv exists with the backend's dependencies installed, then runs
:: app/main.py directly in THIS console window (never a detached one) so its
:: headless keyboard listener can read keys from it while it's running --
:: e.g. pressing "m" live to switch card/figurine mode without restarting.

cd /d "%~dp0"

set VENV_DIR=.venv

if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [backend_launch] No venv found at %VENV_DIR% - creating one...
    python -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo [backend_launch] Failed to create the venv. Is Python installed and on PATH?
        pause
        exit /b 1
    )
    call "%VENV_DIR%\Scripts\activate.bat"
    echo [backend_launch] Installing requirements...
    python -m pip install --upgrade pip >nul
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [backend_launch] Failed to install requirements.
        pause
        exit /b 1
    )
) else (
    call "%VENV_DIR%\Scripts\activate.bat"
)

:menu
echo.
echo ============================================
echo  Pokedex backend launcher
echo ============================================
echo   1) Server - card mode       (default; what the frontend talks to)
echo   2) Server - figurine mode
echo   3) Dev window - card mode       (cv2 debug window, no server)
echo   4) Dev window - figurine mode
echo.
choice /c 1234 /n /m "Select a version to launch [1-4]: "

if errorlevel 4 (
    set MODE_ARGS=--dev-window --mode figurine
    goto :camera
)
if errorlevel 3 (
    set MODE_ARGS=--dev-window --mode card
    goto :camera
)
if errorlevel 2 (
    set MODE_ARGS=--mode figurine
    goto :camera
)
set MODE_ARGS=--mode card

:camera
set CAMERA_INDEX=
set /p CAMERA_INDEX="Camera index [0]: "
if "%CAMERA_INDEX%"=="" set CAMERA_INDEX=0

echo.
echo [backend_launch] Starting: python -m app.main %MODE_ARGS% --camera %CAMERA_INDEX%
echo [backend_launch] This console stays open for keyboard control (space/m/q).
echo.
python -m app.main %MODE_ARGS% --camera %CAMERA_INDEX%

echo.
echo [backend_launch] Backend exited.
pause
endlocal
