$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot\GPT-SoVITS"
try {
    conda run -n GPTSoVits python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
}
finally {
    Pop-Location
}
