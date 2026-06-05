# Any Voice Chat

基于 [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 构建的本地语音聊天项目。

```text
语音输入 -> ASR 识别 -> 大模型回复 -> GPT-SoVITS 语音输出
```

## 获取项目

```powershell
git clone --recurse-submodules https://github.com/<your-name>/any-voice-chat.git
cd any-voice-chat
```

如果已经普通克隆过：

```powershell
git submodule update --init --recursive
```

## 推荐方式：使用 GPT-SoVITS 整合包

推荐直接使用 GPT-SoVITS 整合包，不需要自己配置 conda 环境。

把整合包解压后的内容放到本项目根目录下，并确保目录名是 `GPT-SoVITS`。如果整合包解压出来的文件夹名字不是 `GPT-SoVITS`，请先重命名。

目录结构应类似：

```text
any-voice-chat/
├─ app/
├─ GPT-SoVITS/
│  ├─ api_v2.py
│  ├─ GPT_SoVITS/
│  ├─ tools/
│  └─ runtime/
│     └─ python.exe
├─ start.bat
└─ start.py
```

确认存在：

```text
GPT-SoVITS\runtime\python.exe
```

然后在项目根目录启动：

```powershell
.\start.bat
```

如果希望启动网页时同时启动 GSV API：

```powershell
.\start.bat --with-gsv
```

打开聊天页面：

```text
http://127.0.0.1:7860
```

后台设置页面：

```text
http://127.0.0.1:7860/admin
```

在 Codex 的环境设置里，可以把 Windows 启动脚本设置为：

```powershell
cd "$env:CODEX_WORKTREE_PATH"
.\start.bat
```

## 备选方式：官方脚本安装

如果你想按 GPT-SoVITS 官方方式安装，可以参考 [RVC-Boss/GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 的说明，并使用 conda 环境：

```powershell
cd GPT-SoVITS
conda create -n GPTSoVits python=3.10
conda activate GPTSoVits
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Device CU126 -Source ModelScope
```

安装完成后回到项目根目录启动：

```powershell
cd D:\Users\13677\Documents\any-voice-chat
conda activate GPTSoVits
python start.py
```

## 基本使用

1. 打开后台页面 `/admin`。
2. 在设置里填写 OpenAI、GSV 和 ASR 相关信息。
3. 保存设置。
4. 在后台启动 GSV，或使用 `.\start.bat --with-gsv` 启动。
5. 回到聊天页，输入文字或录音开始聊天。

个人配置会保存在：

```text
config/user_settings.json
```

该文件包含 API Key 等个人信息。
