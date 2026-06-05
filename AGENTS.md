# AGENTS.md

本文件记录本项目中 Codex/Agent 工作时必须遵守的上下文、环境约定和需求维护规则。需求或项目方向发生变化时，需要同步更新本文件。

## 项目目标

本项目是基于 `RVC-Boss/GPT-SoVITS` 构建的语音聊天项目，目标链路为：

```text
语音输入 -> ASR/识别 -> 大模型思考 -> 文本输出 -> TTS/声线克隆 -> 语音输出
```

当前阶段的重点是先完成 GPT-SoVITS/GSV 环境配置，并在此基础上继续开发语音聊天主流程。

## 代码结构

- `GPT-SoVITS/`：通过 git submodule 引入的上游 GPT-SoVITS 项目。
- `app/`：本项目的 FastAPI Web 应用，负责网页、设置保存、ASR、OpenAI 聊天请求和 GSV TTS 代理。
- `config/user_settings.json`：网页保存的本地用户配置，包含 API Key，不提交。
- `runtime/`：上传音频和生成语音的运行时目录，不提交。
- `README.md`：面向使用者的项目说明和环境配置步骤。
- `AGENTS.md`：面向 Codex/Agent 的协作规则和项目上下文。
- `start.py`：唯一启动入口。用户激活 `GPTSoVits` 后执行 `python start.py` 启动网页；网页内可启动 GSV API。

## Conda 环境约定

用户已经创建并使用以下 conda 环境：

```powershell
GPTSoVits
```

之后执行本项目相关 Python 命令、安装依赖、运行脚本、调试 ASR/LLM/TTS 流程时，默认必须使用这个 conda 环境。

在交互式 PowerShell 中优先使用：

```powershell
conda activate GPTSoVits
```

在 Codex/Agent 的非交互式命令中，如果需要确保环境生效，优先使用：

```powershell
conda run -n GPTSoVits <command>
```

不要随意创建新的 Python 虚拟环境，除非用户明确要求。

## Web 应用约定

本项目的网页聊天链路为：

```text
浏览器录音 -> GPT-SoVITS/tools/asr -> OpenAI 兼容 chat/completions 流式输出 -> GPT-SoVITS API /tts 分段流式合成 -> 浏览器通过音频流 URL 排队播放
```

后端使用 FastAPI，入口为：

```powershell
python start.py
```

如果需要启动网页时同时启动 GSV API：

```powershell
python start.py --with-gsv
```

GSV 语音合成通过 GPT-SoVITS 的 `api_v2.py` 提供。默认由网页右侧 GSV 设置区的 `启动 GSV` 按钮通过后端接口拉起，不再要求用户单独手动启动 `api_v2.py`。

`检查 GSV` 必须使用 GSV 专属接口 `/control` 探测，不要只检查 `/docs`，否则可能把旧进程、半死进程或其它 FastAPI 服务误判为 GSV 已连接。不要使用 GSV 的 `/set_gpt_weights` 或 `/set_sovits_weights` 做网页切换；GSV 启动时根据网页中的 GSV 版本、Device、Half Precision 和权重路径生成 `runtime/tts_infer_runtime.yaml`，该运行时 YAML 只保留 `custom` 分组，并通过 `api_v2.py -c` 加载。用户未填写 GPT/SoVITS 权重路径时，使用所选 GSV 版本对应的默认权重路径。不要在网页暴露 TTS YAML 路径配置。

网页中的配置保存到 `config/user_settings.json`。该文件包含 OpenAI API Key 等个人信息，必须保持 git ignored。新增配置项时，需要同步更新默认配置、前端表单和 README。README 面向用户，保持简洁，不写后端轮询、接口实现等程序逻辑。

聊天页只放聊天主流程和 `enable_gsv_tts` 语音开关；详细设置在 `/admin` 的设置页签中。`enable_gsv_tts` 关闭时聊天只输出文字，不请求 GSV；开启时必须先校验 GSV 已连接，未连接则提示用户并保持关闭。

默认 GSV 参考音频路径为 `D:\jjy_cut\cut_1_voice\mp4_360P_xtdowner.com_新华社采访完整版，鞠婧祎：“我不太能够接受原地踏步，我需要学习，需要汲取更多的能量，在这个过程中，我一定会成为更好的人”-00.00.16.577-00.00.19.288-seg01_Vocals.wav`，默认参考文本为 `新华社的朋友们大家好，我是鞠婧祎`。

后台页面入口为 `/admin`，用于查看服务状态、应用日志和 GSV 日志。应用日志写入 `runtime/app.log`，GSV API 日志写入 `runtime/gsv_api.log`。用户反馈服务无响应或 GSV 报错时，优先查看后台页和这两个日志。

OpenAI 流式响应必须按 UTF-8 bytes 解码，不要使用 `requests.iter_lines(decode_unicode=True)` 的默认响应编码，否则中文会变成 mojibake。GSV 子进程启动时设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONUTF8=1`，避免 Windows 控制台 GBK 编码导致 `'gbk' codec can't encode character`。

聊天语音播放默认在 `/api/chat/stream` 的 NDJSON 里发送 `audio_start`、`audio_chunk`、`audio_end` 事件；后端从 GSV `/tts` 读取到一块音频就立即 base64 后发给前端。默认 `streaming_mode` 为 `1`；`1/2/3` 对应 GSV 的生成流式模式，`0` 也走同一套播放链路，但 GSV 端会完整生成后才开始返回音频。前端文字显示使用单一 `runChat` 函数里的打字机队列，不要新增临时替代入口。前端不要直接把 GSV 流 URL 塞给 `<audio>` 播放，浏览器对 GSV 的 wav/raw chunk 流不稳定；应解析 wav header，并用 Web Audio API 按 PCM chunk 调度播放。

## GPT-SoVITS 安装注意事项

GPT-SoVITS 安装脚本位于：

```text
GPT-SoVITS/install.ps1
```

Windows 下如果没有安装 PowerShell 7，`pwsh` 命令可能不可用。已验证可使用 Windows PowerShell 执行：

```powershell
cd .\GPT-SoVITS
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Device CU126 -Source ModelScope
```

其中 `-NoProfile` 用于避免 PowerShell 用户配置中的 conda 初始化脚本与 GPT-SoVITS 安装脚本里的函数名冲突。

如果安装依赖时 `pyopenjtalk` 构建失败，并出现 `nmake: no such file or directory`、`CMAKE_C_COMPILER not set` 或 `CMAKE_CXX_COMPILER not set`，通常是 Windows 缺少 MSVC C/C++ 编译工具链。优先让用户安装 Visual Studio 2022 Build Tools 的 `Desktop development with C++` / `Microsoft.VisualStudio.Workload.VCTools`，然后重新打开 PowerShell，激活 `GPTSoVits` 环境后重跑安装脚本。

## 子模块与生成文件

`GPT-SoVITS/` 是子模块。除非任务明确要求修改上游代码，否则不要随意编辑或提交子模块内部文件。

安装 GPT-SoVITS 后，子模块目录内可能出现模型、缓存、依赖产物或未跟踪文件。主仓库中看到类似以下状态通常是正常的：

```text
 ? GPT-SoVITS
```

不要把模型权重、缓存、临时输出等大文件提交进主仓库。

## 需求维护规则

当用户提出新的长期约定、项目目标、目录结构、运行环境、依赖策略或工作流变化时，需要同步更新：

- `AGENTS.md`：记录 Agent 后续执行任务时必须记住的规则。
- `README.md`：如果变化会影响用户安装、运行或理解项目，也同步更新。

提交代码前应检查：

```powershell
git status --short --branch
```

只提交与当前需求相关的文件，避免把 GPT-SoVITS 子模块内部安装产物一起提交。
