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
- `start.py`：Python 启动入口。用户通常通过 `start.bat` 调用 `GPT-SoVITS/runtime/python.exe` 启动网页；网页内可启动 GSV API。
- `start.bat`：Windows 启动脚本，使用 GPT-SoVITS 整合包自带 Python 启动本项目，并透传命令行参数。

## Python 环境约定

当前项目不再默认使用官方安装脚本创建的 conda 环境。用户已将 GPT-SoVITS 整合包拷贝到 `GPT-SoVITS/`，该目录内自带 Python：

```powershell
GPT-SoVITS\runtime\python.exe
```

之后执行本项目相关 Python 命令、运行脚本、调试 ASR/LLM/TTS 流程、验证编译时，默认必须使用这个整合包 Python。

在交互式 PowerShell 中优先使用：

```powershell
.\start.bat
```

在 Codex/Agent 的非交互式命令中，如果需要确保环境生效，优先使用：

```powershell
.\GPT-SoVITS\runtime\python.exe <command>
```

该整合包 Python 使用 `python39._pth` 隔离路径；如果命令需要 import 本项目模块，必须像 `start.bat` 一样先把项目根目录插入 `sys.path`，或直接通过 `start.bat` 启动。

整合包 Python 版本为 3.9，FastAPI 路由函数的参数注解不要使用 `X | None` 这类 Python 3.10+ 写法；需要可选参数时使用 `typing.Optional[X]`。

如果需要启动网页时同时启动 GSV API：

```powershell
.\start.bat --with-gsv
```

不要随意创建新的 Python 虚拟环境或 conda 环境，除非用户明确要求。

## Web 应用约定

本项目的网页聊天链路为：

```text
浏览器录音 -> GPT-SoVITS/tools/asr -> OpenAI 兼容 chat/completions 流式输出 -> GPT-SoVITS API /tts 分段流式合成 -> 浏览器通过音频流 URL 排队播放
```

后端使用 FastAPI，入口为：

```powershell
.\start.bat
```

如果需要启动网页时同时启动 GSV API：

```powershell
.\start.bat --with-gsv
```

GSV 语音合成通过 GPT-SoVITS 的 `api_v2.py` 提供。默认由网页右侧 GSV 设置区的 `启动 GSV` 按钮通过后端接口拉起，不再要求用户单独手动启动 `api_v2.py`。

`检查 GSV` 必须使用 GSV 专属接口 `/control` 探测，不要只检查 `/docs`，否则可能把旧进程、半死进程或其它 FastAPI 服务误判为 GSV 已连接。不要使用 GSV 的 `/set_gpt_weights` 或 `/set_sovits_weights` 做网页切换；GSV 启动时根据网页中的 GSV 版本、Device、Half Precision 和权重路径生成 `runtime/tts_infer_runtime.yaml`，该运行时 YAML 只保留 `custom` 分组，并通过 `api_v2.py -c` 加载。用户未填写 GPT/SoVITS 权重路径时，使用所选 GSV 版本对应的默认权重路径。不要在网页暴露 TTS YAML 路径配置。

网页中的配置保存到 `config/user_settings.json`。该文件包含 OpenAI API Key 等个人信息，必须保持 git ignored。新增配置项时，需要同步更新默认配置、前端表单和 README。README 面向用户，保持简洁，不写后端轮询、接口实现等程序逻辑。

聊天页只放聊天主流程和 `enable_gsv_tts` 语音开关；详细设置在 `/admin` 的设置页签中。`enable_gsv_tts` 关闭时聊天只输出文字，不请求 GSV；开启时必须先校验 GSV 已连接，未连接则提示用户并保持关闭。

聊天页录音按钮用于开启/关闭连续语音输入。连续语音输入由前端浏览器常驻麦克风监听和 VAD 音量检测实现，VAD 要使用动态底噪和连续命中帧，不要只靠过低的单帧 RMS 阈值；确认用户开始录音时同步打断当前 OpenAI 流、TTS 合成、ASR 请求和 Web Audio 播放。不要启用浏览器 Web Speech API 做实时临时字幕，它容易累积错误文本并拾取助手外放声音；检测到句尾静音后，将该段录音发送到现有 `/api/asr`，用后端 ASR 最终文本覆盖草稿气泡，再自动进入 `/api/chat/stream`。不要把 ASR 改成后端常驻阻塞进程，除非用户明确要求。

连续监听开启时，助手自己的外放语音可能被麦克风拾取；前端在检测到助手音频正在播放或刚刚调度播放时，必须提高开始录音/打断阈值，避免助手声音把自己的下一轮回复取消掉。新一轮回复开始前也要清理上一轮未播放的音频调度状态。

ASR 默认使用 GPT-SoVITS `tools/asr` 下的 FunASR 模型，并在本应用进程内常驻复用模型；`/api/asr` 不应把上传音频保存成 wav 文件再识别，应尽量在内存中解码音频并送入 FunASR。前端每次 ASR 请求带 `asr_id`，新语音或打断时要同时 abort 前端请求并调用后端取消接口。FunASR `model.generate()` 是同步推理，已进入推理后的请求只能忽略结果，不能假装可以像 HTTP response 一样硬关闭。

打断助手回复时，前端不能只调用 `AbortController.abort()` 关闭浏览器到本地后端的连接；必须同时调用后端取消接口。后端按 `chat_id` 持有当前 OpenAI 上游 response 和多个 GSV TTS response，取消时必须显式 `close()` 所有活跃上游连接，并用取消标记阻止未开始的 GSV 分段继续执行。`busy` 只表示前端当前页面正在跑一条助手回复流水线；后端可以在同一个 `chat_id` 下用 OpenAI producer 和 GSV worker 并行处理。

GSV 首次 TTS 可能因为模型加载、CUDA 初始化或推理缓存较慢。后台设置页点击 `启动 GSV` 时必须自动进行一次短文本 TTS 预热；预热完成后才算启动成功，不再提供单独预热接口或按钮。

GSV 文本切分方式只能使用上游支持的 `cut0`、`cut1`、`cut2`、`cut3`、`cut4`、`cut5`，网页必须用下拉枚举并带提示，不要让用户自由输入。

默认 GSV 参考音频路径为 `D:\jjy_cut\cut_1_voice\mp4_360P_xtdowner.com_新华社采访完整版，鞠婧祎：“我不太能够接受原地踏步，我需要学习，需要汲取更多的能量，在这个过程中，我一定会成为更好的人”-00.00.16.577-00.00.19.288-seg01_Vocals.wav`，默认参考文本为 `新华社的朋友们大家好，我是鞠婧祎`。

后台页面入口为 `/admin`，用于查看服务状态、应用日志和 GSV 日志。应用日志写入 `runtime/app.log`，GSV API 日志写入 `runtime/gsv_api.log`。用户反馈服务无响应或 GSV 报错时，优先查看后台页和这两个日志。

OpenAI 流式响应必须按 UTF-8 bytes 解码，不要使用 `requests.iter_lines(decode_unicode=True)` 的默认响应编码，否则中文会变成 mojibake。GSV 子进程启动时设置 `PYTHONIOENCODING=utf-8` 和 `PYTHONUTF8=1`，避免 Windows 控制台 GBK 编码导致 `'gbk' codec can't encode character`。

聊天语音播放默认在 `/api/chat/stream` 的 NDJSON 里发送 `audio_start`、`audio_chunk`、`audio_end` 事件；后端从 GSV `/tts` 读取到一块音频就立即 base64 后发给前端。默认 `streaming_mode` 为 `1`；`1/2/3` 对应 GSV 的生成流式模式，`0` 也走同一套播放链路，但 GSV 端会完整生成后才开始返回音频。开启 GSV 语音时，后端发送给 GSV 的文本段必须按完整句聚合到 `tts_min_segment_chars` 个非空白字符，短句要继续拼下一句，最终收尾段例外；`tts_soft_segment_chars` 和 `tts_force_segment_chars` 分别控制长文本软切和强切，填 `0` 表示关闭。所有后端切分出来的展示段必须能无损拼回大模型全文，不能在切分函数里 `strip()` 掉空白；只允许在真正调用 GSV TTS 前对送入 TTS 的文本做 `strip()` 清理。句末连续终止标点必须并入上一段；如果流式切分导致 buffer 开头出现孤立终止标点，该标点段只能作为展示文本进入气泡，不允许送 GSV。emoji-only、punctuation-only 段同样只展示不合成。GPT-SoVITS 上游在首个切分标点前文本少于 4 个字符时可能自行给目标文本前补 `。`，不要为了规避这条上游预处理而改写本应用发送的 TTS 文本；本应用优先保证聊天气泡内容与大模型输出完全一致。该阈值和 `text_display_mode` 属于本应用体验设置，放在后台 `应用` 页签，不放在 GSV 页签。`text_display_mode=speech_sync` 时，前端文字必须在对应音频段被 Web Audio 排到实际播放时间线时才进入单一 `runChat` 打字机队列；`text_display_mode=text_first` 时才允许按 OpenAI token 先显示文字。等待生成或等待播放期间，助手气泡末尾显示 `...` 作为状态感知。前端不要直接把 GSV 流 URL 塞给 `<audio>` 播放，浏览器对 GSV 的 wav/raw chunk 流不稳定；应解析 wav header，并用 Web Audio API 按 PCM chunk 调度播放。

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

如果用户仍选择官方安装脚本，并在安装依赖时遇到 `pyopenjtalk` 构建失败，出现 `nmake: no such file or directory`、`CMAKE_C_COMPILER not set` 或 `CMAKE_CXX_COMPILER not set`，通常是 Windows 缺少 MSVC C/C++ 编译工具链。优先让用户安装 Visual Studio 2022 Build Tools 的 `Desktop development with C++` / `Microsoft.VisualStudio.Workload.VCTools`，然后重新打开 PowerShell 后重跑安装脚本。

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
