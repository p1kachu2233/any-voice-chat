$ErrorActionPreference = "Stop"

$python = "D:\ProgramData\anaconda3\envs\GPTSoVits\python.exe"

if (-not (Test-Path $python)) {
    conda run -n GPTSoVits python -m uvicorn app.main:app --host 127.0.0.1 --port 7860
    exit $LASTEXITCODE
}

& $python -m uvicorn app.main:app --host 127.0.0.1 --port 7860
