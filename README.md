# Any Voice Chat

基于 [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 构建的本地语音聊天项目。

```text
语音输入 -> ASR 识别 -> 大模型回复 -> GPT-SoVITS 语音输出
```

## 克隆项目

```powershell
git clone --recurse-submodules https://github.com/<your-name>/any-voice-chat.git
cd any-voice-chat
```

如果已经普通克隆过：

```powershell
git submodule update --init --recursive
```

## 配置 GPT-SoVITS 环境

```powershell
cd GPT-SoVITS
conda create -n GPTSoVits python=3.10
conda activate GPTSoVits
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Device CU126 -Source ModelScope
```

按自己的设备替换 `-Device`：

- `CU126`：CUDA 12.6
- `CU128`：CUDA 12.8
- `CPU`：仅使用 CPU

按网络情况替换 `-Source`：

- `HF`
- `HF-Mirror`
- `ModelScope`

如果需要 UVR5，追加：

```powershell
-DownloadUVR5
```

如果安装 `pyopenjtalk` 时提示缺少 `nmake`、`CMAKE_C_COMPILER` 或 `CMAKE_CXX_COMPILER`，请安装 Visual Studio 2022 Build Tools，并勾选 `Desktop development with C++`。

## 启动网页

回到项目根目录：

```powershell
cd D:\Users\13677\Documents\any-voice-chat
conda activate GPTSoVits
python start.py
```

在 Codex 的环境设置里，可以把 Windows 启动脚本设置为：

```powershell
cd "$env:CODEX_WORKTREE_PATH"
conda run -n GPTSoVits python start.py
```

打开：

```text
http://127.0.0.1:7860
```

## 页面设置

`OpenAI` 页签填写：

- API Key
- Base URL
- Model
- System Prompt

`GSV` 页签填写：

- GSV API URL，默认 `http://127.0.0.1:9880`
- 是否启用 GSV 语音合成；关闭后只进行文字聊天
- GSV 版本，可选 `v1`、`v2`、`v2Pro`、`v2ProPlus`、`v3`、`v4`
- Device 和 Half Precision
- GPT 权重路径，可选；不填则使用所选版本的默认路径
- SoVITS 权重路径，可选；不填则使用所选版本的默认路径
- 参考音频、参考文本、语种和生成参数

修改 GSV 版本、Device、Half Precision 或权重路径后，需要先停止 GSV，再重新启动 GSV。

启用 GSV 语音合成时，发送聊天前会检查 GSV 是否已连接。聊天时文本会逐字显示，语音会通过 GPT-SoVITS TTS 代理边接收边播放。Streaming Mode 默认使用 `1`；`1/2/3` 是 GSV 的生成流式模式，`0` 会完整生成后再通过同一个流式代理传输。

默认参考音频：

```text
D:\jjy_cut\cut_1_voice\mp4_360P_xtdowner.com_新华社采访完整版，鞠婧祎：“我不太能够接受原地踏步，我需要学习，需要汲取更多的能量，在这个过程中，我一定会成为更好的人”-00.00.16.577-00.00.19.288-seg01_Vocals.wav
```

默认参考文本：

```text
新华社的朋友们大家好，我是鞠婧祎
```

`ASR` 页签选择识别语言。

## 后台

```text
http://127.0.0.1:7860/admin
```

后台可以查看服务状态和最近日志。

个人设置会保存到：

```text
config/user_settings.json
```

该文件包含 API Key，已被 `.gitignore` 忽略，不应提交。
