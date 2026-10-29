@echo off
setlocal

:: Pokedex installer (Windows, no Docker). Run once, then run\start_windows_native.bat.
::
:: For PCs that can't run Docker Desktop (no virtualisation / WSL). Everything
:: runs natively: MongoDB as a Windows service, the frontend built with Node
:: and served by Python, the backend in backend\.venv. This script makes sure
:: Python, Node.js, Git, the .NET 9 runtime and MongoDB are installed (asking
:: before installing anything), downloads the card images and figurine model
:: weights, builds the frontend and seeds the database. Safe to re-run.

:: this file lives in run\; work from the repo root
cd /d "%~dp0.."
set NEED_NEW_CONSOLE=

:: ---------------------------------------------------------------- Python
:: "python" can be the Microsoft Store stub, which fails (9009) -- counts as missing
set PY=
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY python --version >nul 2>&1 && set "PY=python"
if defined PY goto :python_ok
call :winget_install "Python 3.12" Python.Python.3.12 || goto :fail
set NEED_NEW_CONSOLE=1
:python_ok

:: ---------------------------------------------------------------- Node.js (builds the frontend)
where node >nul 2>&1 && goto :node_ok
call :winget_install "Node.js LTS" OpenJS.NodeJS.LTS || goto :fail
set NEED_NEW_CONSOLE=1
:node_ok

:: ---------------------------------------------------------------- Git Bash (runs the card download script)
if exist "%ProgramFiles%\Git\bin\bash.exe" goto :git_ok
call :winget_install "Git for Windows" Git.Git || goto :fail
:git_ok

:: ---------------------------------------------------------------- .NET 9 runtime (runs the database seeder)
if exist "%ProgramFiles%\dotnet\shared\Microsoft.NETCore.App\9.*" goto :dotnet_ok
call :winget_install ".NET 9 runtime" Microsoft.DotNet.Runtime.9 || goto :fail
:dotnet_ok

:: ---------------------------------------------------------------- MongoDB (Windows service on 27017)
sc query MongoDB >nul 2>&1 && goto :mongo_ok
call :winget_install "MongoDB Server" MongoDB.Server "ADDLOCAL=ServerService SHOULD_INSTALL_COMPASS=0" || goto :fail
sc query MongoDB >nul 2>&1 && goto :mongo_ok
echo [install] MongoDB installed but its Windows service wasn't created. Re-run the
echo [install] MongoDB installer and tick "Install MongoD as a Service", then re-run this.
goto :fail
:mongo_ok

:: new installs aren't on this console's PATH yet
if defined NEED_NEW_CONSOLE (
    echo.
    echo [install] Close this window, open a new one and run run\install_windows_native.bat again.
    goto :done
)

:: ---------------------------------------------------------------- Settings
if not exist .env (
    copy /y .env.example .env >nul
    echo [install] Created .env from .env.example.
)

:: ---------------------------------------------------------------- Backend venv
call "%~dp0setup_backend_venv.bat" || goto :fail

:: ---------------------------------------------------------------- Card images
set CARD_COUNT=0
for /f %%n in ('dir /b backend\data\cards\images\*.webp 2^>nul ^| find /c /v ""') do set CARD_COUNT=%%n
if %CARD_COUNT% geq 100 (
    echo [install] Card images already cached - skipping.
    goto :cards_ok
)
echo [install] Downloading card reference images...
:: the script calls "python"; the venv's comes first on PATH
set "PATH=%CD%\backend\.venv\Scripts;%PATH%"
"%ProgramFiles%\Git\bin\bash.exe" backend/scripts/download_card_set.sh
if errorlevel 1 (
    echo [install] Downloading the card images failed.
    goto :fail
)
:cards_ok

:: ---------------------------------------------------------------- Frontend
echo [install] Building the frontend...
pushd frontend
call npx --yes pnpm install && call npx --yes pnpm build
set BUILD_ERR=%errorlevel%
popd
if not %BUILD_ERR%==0 (
    echo [install] Building the frontend failed.
    goto :fail
)

:: ---------------------------------------------------------------- Database
call :ensure_mongo || goto :fail
if not exist "backend\scripts\net9.0\ProcessPokeData.exe" (
    tar -xf backend\scripts\pokedb-setup.zip -C backend\scripts || goto :fail
)
echo [install] Seeding the database...
:: the seeder reads pokemon_utf8.csv from its working directory and always uses 127.0.0.1:27017
pushd backend\scripts\net9.0
ProcessPokeData.exe > "%TEMP%\pokedex-seed.log" 2>&1
set SEED_ERR=%errorlevel%
popd
:: a re-run stops at the first duplicate _id having changed nothing
if not %SEED_ERR%==0 findstr /c:"duplicate key" "%TEMP%\pokedex-seed.log" >nul && set "SEED_ERR=0" && echo [install] Already seeded - skipping.
if not %SEED_ERR%==0 (
    type "%TEMP%\pokedex-seed.log"
    echo [install] Seeding the database failed.
    goto :fail
)

echo.
echo [install] Done. Start the Pokedex with: run\start_windows_native.bat
goto :done

:: ---------------------------------------------------------------- helpers
:: call :winget_install "Display name" Winget.Id ["extra installer args"]
:winget_install
echo [install] %~1 is not installed. It's required to run the Pokedex.
choice /c YN /m "Install %~1 now with winget"
if errorlevel 2 exit /b 1
where winget >nul 2>&1 || (
    echo [install] winget isn't available. Install "App Installer" from the Microsoft Store,
    echo [install] or install %~1 yourself, then re-run.
    exit /b 1
)
if "%~3"=="" (
    winget install -e --id %2 --accept-package-agreements --accept-source-agreements
) else (
    winget install -e --id %2 --accept-package-agreements --accept-source-agreements --custom "%~3"
)
if errorlevel 1 (
    echo [install] %~1 install failed.
    exit /b 1
)
exit /b 0

:ensure_mongo
sc query MongoDB | find "RUNNING" >nul && exit /b 0
echo [install] Starting the MongoDB service (asks for administrator rights)...
powershell -NoProfile -Command "Start-Process net -ArgumentList 'start','MongoDB' -Verb RunAs -Wait"
sc query MongoDB | find "RUNNING" >nul && exit /b 0
echo [install] MongoDB didn't start. Open "Services", start "MongoDB Server", then re-run.
exit /b 1

:fail
echo.
pause
exit /b 1

:done
echo.
pause
endlocal
