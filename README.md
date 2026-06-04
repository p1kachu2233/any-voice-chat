# Any Voice Chat

基于 [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 构建的语音聊天项目。

项目目标流程：

```text
语音输入 -> ASR/识别 -> 大模型思考 -> 文本输出 -> TTS/声线克隆 -> 语音输出
```

当前第一步是先配置 GPT-SoVITS，也就是本项目里的 `GPT-SoVITS` 子模块。后续本项目的 Python 依赖都优先安装到同一个 conda 环境中，避免语音识别、LLM 调用和 TTS 推理之间出现环境割裂。

## 克隆项目

本项目使用 git submodule 引入 GPT-SoVITS。首次克隆时建议直接拉取子模块：

```powershell
git clone --recurse-submodules https://github.com/<your-name>/any-voice-chat.git
cd any-voice-chat
```

如果已经普通克隆了本项目，可以补执行：

```powershell
git submodule update --init --recursive
```

## 第一步：配置 GPT-SoVITS 环境

进入 GPT-SoVITS 目录：

```powershell
cd GPT-SoVITS
```

创建并激活 conda 环境：

```powershell
conda create -n GPTSoVits python=3.10
conda activate GPTSoVits
```

按设备和下载源执行安装脚本：

```powershell
pwsh -F install.ps1 --Device <CU126|CU128|CPU> --Source <HF|HF-Mirror|ModelScope> [--DownloadUVR5]
```

如果本机没有安装 PowerShell 7，执行 `pwsh` 时会提示“无法将 pwsh 项识别为 cmdlet”。这时可以先用 Windows 自带的 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Device <CU126|CU128|CPU> -Source <HF|HF-Mirror|ModelScope>
```

更推荐加上 `-NoProfile`，避免 PowerShell 启动时加载用户配置，导致 conda 初始化脚本和 GPT-SoVITS 安装脚本里的函数名冲突：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Device <CU126|CU128|CPU> -Source <HF|HF-Mirror|ModelScope>
```

也可以安装 PowerShell 7 后继续使用 `pwsh`：

```powershell
winget install --id Microsoft.PowerShell --source winget
```

### pyopenjtalk 构建失败

如果安装过程中出现 `Failed to build 'pyopenjtalk'`、`nmake: no such file or directory`、`CMAKE_C_COMPILER not set` 或 `CMAKE_CXX_COMPILER not set`，说明当前 Windows 环境缺少 MSVC C/C++ 编译工具链。

可以安装 Visual Studio 2022 Build Tools：

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

安装完成后重新打开 PowerShell，再执行：

```powershell
conda activate GPTSoVits
cd D:\Users\13677\Documents\any-voice-chat\GPT-SoVITS
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Device CU126 -Source ModelScope
```

如果使用 Visual Studio Installer 图形界面安装，请勾选 `Desktop development with C++`，并确保包含 MSVC 编译工具和 Windows SDK。

参数说明：

- `--Device CU126`：使用 CUDA 12.6。
- `--Device CU128`：使用 CUDA 12.8。
- `--Device CPU`：不使用 GPU，仅使用 CPU。
- `--Source HF`：从 Hugging Face 下载模型和依赖资源。
- `--Source HF-Mirror`：从 Hugging Face 镜像下载，适合 Hugging Face 访问不稳定时使用。
- `--Source ModelScope`：从 ModelScope 下载。
- `--DownloadUVR5`：可选，下载 UVR5 相关模型，用于人声/伴奏分离、混响移除等功能。

示例：

```powershell
pwsh -F install.ps1 --Device CU126 --Source ModelScope --DownloadUVR5
```

或仅使用 CPU：

```powershell
pwsh -F install.ps1 --Device CPU --Source ModelScope
```

## 环境约定

后续开发本项目时，默认使用同一个 conda 环境：

```powershell
conda activate GPTSoVits
```

项目新增的 ASR、大模型调用、音频处理、TTS 推理等 Python 依赖，也应安装到 `GPTSoVits` 环境中。

如果后续需要记录额外依赖，可以在根目录新增项目自己的依赖文件，例如：

```text
requirements.txt
```

但安装时仍建议先激活 `GPTSoVits` 环境。

## 参考

- GPT-SoVITS 官方仓库：[RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)
- GPT-SoVITS 本地文档：`GPT-SoVITS/docs/cn/README.md`
