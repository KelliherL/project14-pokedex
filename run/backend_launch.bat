@echo off
setlocal

:: Pokedex kiosk backend launcher.
::
:: Ensures a venv exists with the backend's dependencies installed, then runs
:: app/main.py directly in THIS console window (never a detached one) so its
:: headless keyboard listener can read keys from it while it's running --
:: e.g. pressing "m" live to switch card/figurine mode without restarting.
::
:: The backend reports back through its exit code (app/capture.py EXIT_*):
::   0 = q (quit launcher)   3 = r (back to this menu)   9 = x (force shutdown)

:: this file lives in run\; the backend (and its .venv) live in backend\
cd /d "%~dp0..\backend"

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

:: Venvs made before the camera menu existed lack pygrabber (camera names).
:: Without it scripts/list_cameras.py still works, just with unnamed cameras.
python -c "import pygrabber" 2>nul || (
    echo [backend_launch] Installing pygrabber for camera names...
    pip install pygrabber >nul 2>&1
)

set LAST_MODE_ARGS=

:menu
cls
echo ============================================
echo  Pokedex backend launcher
echo ============================================
echo   1) Server - card mode       (default; what the frontend talks to)
echo   2) Server - figurine mode
echo   3) Dev window - card mode       (cv2 debug window, no server)
echo   4) Dev window - figurine mode
:: Q goes first so the mode keys keep the same errorlevels with or without 5.
:: Single-line ifs, not a ( ) block: a ")" in a camera name would end the block.
set MENU_KEYS=Q1234
if defined LAST_MODE_ARGS echo   5^) Same as last: %LAST_LABEL%, camera %LAST_CAMERA%:%LAST_CAMERA_NAME%
if defined LAST_MODE_ARGS set MENU_KEYS=Q12345
echo   Q) Quit
echo.
choice /c %MENU_KEYS% /n /m "Select an option: "
set PICK=%errorlevel%

if %PICK%==1 goto :end
if %PICK%==2 (
    set MODE_ARGS=--mode card
    set MODE_LABEL=Server - card mode
)
if %PICK%==3 (
    set MODE_ARGS=--mode figurine
    set MODE_LABEL=Server - figurine mode
)
if %PICK%==4 (
    set MODE_ARGS=--dev-window --mode card
    set MODE_LABEL=Dev window - card mode
)
if %PICK%==5 (
    set MODE_ARGS=--dev-window --mode figurine
    set MODE_LABEL=Dev window - figurine mode
)
if %PICK%==6 (
    set "MODE_ARGS=%LAST_MODE_ARGS%"
    set "MODE_LABEL=%LAST_LABEL%"
    set "CAMERA_INDEX=%LAST_CAMERA%"
    set "CAMERA_NAME=%LAST_CAMERA_NAME%"
    goto :launch
)

:camera
echo.
echo Cameras found:
python scripts\list_cameras.py
set CAM_COUNT=%errorlevel%
:: One key per camera found: "0123456789" cut down to CAM_COUNT characters.
set CAM_KEYS=0123456789
call set CAM_KEYS=%%CAM_KEYS:~0,%CAM_COUNT%%%
echo.
echo   R) Rescan cameras   B) Back to menu
echo.
choice /c RB%CAM_KEYS% /n /m "Select a camera: "
set PICK=%errorlevel%
if %PICK%==1 goto :camera
if %PICK%==2 goto :menu
set /a CAMERA_INDEX=PICK-3

set CAMERA_NAME=
for /f "tokens=1,* delims=)" %%a in ('python scripts\list_cameras.py') do (
    if "%%a"=="  %CAMERA_INDEX%" set "CAMERA_NAME=%%b"
)

:launch
set LAST_MODE_ARGS=%MODE_ARGS%
set LAST_LABEL=%MODE_LABEL%
set LAST_CAMERA=%CAMERA_INDEX%
set LAST_CAMERA_NAME=%CAMERA_NAME%

cls
echo [backend_launch] Starting: python -m app.main %MODE_ARGS% --camera %CAMERA_INDEX%
echo [backend_launch] Camera %CAMERA_INDEX%:%CAMERA_NAME%
echo [backend_launch] Keys: c = clear console, r = restart (back to menu), q = quit, x = force shutdown
echo [backend_launch] (dev window modes read keys from the cv2 window, not this console)
echo.
python -m app.main %MODE_ARGS% --camera %CAMERA_INDEX%
set EXIT_CODE=%errorlevel%

if %EXIT_CODE%==3 goto :menu
if %EXIT_CODE%==0 goto :end
if %EXIT_CODE%==9 goto :end
echo.
echo [backend_launch] Backend exited with code %EXIT_CODE%.
echo [backend_launch] Press any key to return to the menu...
pause >nul
goto :menu

:end
endlocal
