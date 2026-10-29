@echo off
:: Creates backend\.venv, installs backend\requirements.txt and caches the
:: DINOv2 weights. Used by install_windows.bat and install_windows_native.bat,
:: run from the repo root with PY set to a working Python. Exit code 1 = failed.

if not exist "backend\.venv\Scripts\python.exe" (
    echo [install] Creating the backend's Python environment...
    %PY% -m venv backend\.venv || exit /b 1
)
echo [install] Installing backend packages (the first time downloads ~1 GB)...
backend\.venv\Scripts\python -m pip install --upgrade pip >nul
backend\.venv\Scripts\python -m pip install -r backend\requirements.txt
if errorlevel 1 (
    echo [install] Installing the backend packages failed.
    exit /b 1
)
echo [install] Downloading figurine model weights...
backend\.venv\Scripts\python -c "import torch; torch.hub.load('facebookresearch/dinov2', 'dinov2_vits14_reg', verbose=False); print('DINOv2 weights cached')"
if errorlevel 1 (
    echo [install] Downloading the figurine model weights failed.
    exit /b 1
)
exit /b 0
