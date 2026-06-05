@echo off
setlocal

cd /d "%~dp0"

set "GSV_PYTHON=%~dp0GPT-SoVITS\runtime\python.exe"
if not exist "%GSV_PYTHON%" (
  echo [ERROR] Cannot find GPT-SoVITS bundled Python:
  echo         %GSV_PYTHON%
  echo Please copy the GPT-SoVITS package with its runtime directory first.
  exit /b 1
)

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "AVC_ROOT=%~dp0"

"%GSV_PYTHON%" -c "import os, sys; sys.path.insert(0, os.environ['AVC_ROOT']); sys.argv[0] = 'start.py'; from start import main; main()" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Any Voice Chat failed to start.
  pause
  exit /b %errorlevel%
)
