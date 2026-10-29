@echo off
setlocal

:: Pokedex launcher (Windows, no Docker). Run run\install_windows_native.bat once first.
::
:: Makes sure the MongoDB service is running, serves frontend\dist in the
:: background, then runs the backend via backend_launch.bat in this window.
:: Frontend: http://localhost:5173

:: this file lives in run\; work from the repo root
cd /d "%~dp0.."

if not exist "frontend\dist\index.html" (
    echo [start] Not installed yet - run run\install_windows_native.bat first.
    pause
    exit /b 1
)

sc query MongoDB | find "RUNNING" >nul && goto :mongo_ok
echo [start] Starting the MongoDB service (asks for administrator rights)...
powershell -NoProfile -Command "Start-Process net -ArgumentList 'start','MongoDB' -Verb RunAs -Wait"
sc query MongoDB | find "RUNNING" >nul && goto :mongo_ok
echo [start] MongoDB didn't start. Open "Services", start "MongoDB Server", then try again.
pause
exit /b 1
:mongo_ok

:: hidden, so it can't steal keys from the backend's console; PID kept to stop it after
set WEB_PID=
for /f %%p in ('powershell -NoProfile -Command "(Start-Process -PassThru -WindowStyle Hidden -FilePath 'backend\.venv\Scripts\python.exe' -ArgumentList '-m','http.server','5173','--bind','127.0.0.1','-d','frontend\dist').Id"') do set WEB_PID=%%p

echo.
echo [start] Frontend: http://localhost:5173  (works once the backend below is running)
echo.
call "%~dp0backend_launch.bat"

:: /t: the venv's python.exe is a launcher with the real server as its child
if defined WEB_PID taskkill /pid %WEB_PID% /t /f >nul 2>&1

endlocal
