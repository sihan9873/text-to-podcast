# 本机真实 Qwen：描述生成脚本，再生成语音

本机使用两套模型，各负责一个阶段：

| 阶段 | 模型 | Conda 环境 | HTTP 地址 |
| --- | --- | --- | --- |
| 自然语言描述 → 播客脚本 | Qwen2.5-0.5B-Instruct | podcast-llm | 127.0.0.1:8002 |
| 脚本台词 → 主持人人声 | Qwen3-TTS-12Hz-0.6B-CustomVoice | podcast-tts | 127.0.0.1:8001 |
| 项目、确认、任务、MP3 保存 | 业务 API + 数据库 Worker | podcast-backend | 127.0.0.1:8000 |
| 发请求、轮询、下载和解码验证 | 轻量 HTTP 客户端，不运行模型 | podcast-tts-service | 调用上面的服务 |

`--engine-id qwen3-customvoice` 选择的是 **TTS 语音模型**。脚本模型由后端的
`LLM_PROVIDER` / `LOCAL_LLM_MODEL_ID` 配置，不由这个命令行参数选择。
模型均在本机 GPU 上推理，客户端只是通过 HTTP 发请求。

## 1. 本机配置

本机已经准备好各 Conda 环境和权重；不需要重复下载、安装 GPU 包或复制模型。
实际 `backend/.env` 已设置：

```dotenv
LLM_PROVIDER=local_http
LOCAL_LLM_MODEL_ID=Qwen/Qwen2.5-0.5B-Instruct
LOCAL_LLM_BASE_URL=http://127.0.0.1:8002
AUDIO_PROVIDER=local_http
LOCAL_TTS_ENGINE_ID=qwen3-customvoice
LOCAL_TTS_BASE_URL=http://127.0.0.1:8001
```

`tts/.env` 保存语音服务自己的部署配置。当前 `TTS_QWEN_MODEL_PATH` 指向本机
原有的完整 CustomVoice 权重目录，`TTS_QWEN_DEVICE=cuda:0`，
`TTS_QWEN_DTYPE=bfloat16`。没有复制、修改原权重；不能用 Base 权重替代 CustomVoice。
这份 `.env` 不提交源码；新机器可复制 `tts/.env.example` 后填写自己的模型目录。
统一启动工具读取该文件并传给独立 TTS 进程；直接运行 TTS 模块时需自行 export 对应变量。

## 2. 启动服务

以下命令均从仓库根目录执行：

```bash
conda run --no-capture-output -n podcast-backend python scripts/local_services.py start
```

修改配置后，需要先 `stop` 再 `start`；单独执行 `start` 不会重启已有服务：

```bash
conda run --no-capture-output -n podcast-backend python scripts/local_services.py stop
conda run --no-capture-output -n podcast-backend python scripts/local_services.py start
```

工具会选择 `podcast-llm` 和 `podcast-tts`，检查本地资源，增量初始化当前模型的
两名主持人角色，再启动 API/Worker。旧角色、脚本和音频保留，不覆盖用户资产。
默认 `host_a → vivian`，`host_b → uncle_fu`。模型在首次生成时加载；
启动、健康检查、引擎和音色列表都不会加载权重或联网。
Linux/WSL 使用用户级 systemd 托管，不设置开机自启。

```bash
conda run --no-capture-output -n podcast-backend python scripts/local_services.py status
curl --noproxy '*' http://127.0.0.1:8000/api/v1/health/ready
curl --noproxy '*' http://127.0.0.1:8001/v1/engines
```

后端应显示 `llm_provider=local_http`、`tts_engine_id=qwen3-customvoice`；
TTS 应列出已安装的 `qwen3-customvoice`。`loaded=false` 表示尚未首次推理，并非启动失败。

## 3. 用自然语言生成完整人声 MP3

这就是原 Mock 命令对应的真实模型版本：

```bash
conda run --no-capture-output -n podcast-tts-service python scripts/verify_backend_flow.py \
  --engine-id qwen3-customvoice \
  --task-timeout 1800 \
  --description '写一段双人播客，介绍太阳系，语气轻松。'
```

验证工具默认引擎也已改为 `qwen3-customvoice`，但建议保留参数，明确显示使用的语音模型。
`--task-timeout 1800` 是等待每个业务任务的最长时间；首次调用包含模型冷启动。
命令会显示当前阶段、任务ID和等待时长，每30秒更新一次，便于判断是否仍在运行。
HTTP 客户端运行在轻量环境是正常的，不需要切到模型环境来调用服务。
当前配置使用 PyTorch SDPA；即使 SDK 提示未安装 flash-attn，也不要求安装该扩展。

工具会创建新联调项目，选择当前模型的角色，调用 Qwen LLM 生成脚本，自动确认
该测试脚本，然后提交音频任务、下载完整 MP3 并解码验证。自动确认仅用于这条联调
命令；产品流程仍应先人工检查脚本。它不会修改或删除已有项目。

## 4. 看结果和排错

默认产物位于新的 `outputs/backend-verification/<时间戳>/`：

- `full.mp3`：真实 Qwen TTS 生成的完整人声。
- `script.txt`：便于阅读的标题、摘要、按顺序排列的主持人台词。
- `script.json`：后端返回的完整脚本快照，包括脚本ID、版本、角色、台词及声音配置。
- `report.json`：项目/任务 ID、脚本生成信息、音频元数据、播放/下载地址与解码时长。

脚本在提交语音任务前导出，所以后续语音失败时也能查看生成的台词。
脚本原始记录保存在后端数据库，可以通过报告中的 `script_url` 或
`GET /api/v1/scripts/{script_id}` 查看。旧报告可补导出，不需要重新生成音频：

```bash
conda run --no-capture-output -n podcast-tts-service python scripts/verify_backend_flow.py \
  --export-script-from-report outputs/backend-verification/你的时间戳/report.json
```

该命令会在原报告目录增加 `script.json` 和 `script.txt`，已有脚本文件不覆盖。

成功报告必须包含以下信息；工具会自动核对，不符合就失败：

```json
{
  "script_generation": {
    "provider": "local_http",
    "model_id": "Qwen/Qwen2.5-0.5B-Instruct",
    "simulated": false
  },
  "audio_result": {
    "metadata": {
      "engine_id": "qwen3-customvoice",
      "simulated": false,
      "real_speech": true,
      "script_simulated": false
    }
  }
}
```

元数据证明采用的生成路径，MP3 解码证明音频结构可读取。请播放文件检查台词完整性、
音色、顺序和停顿；0.5B 脚本模型仍可能有事实错误或不满足句数要求。

如果提示引擎不匹配或缺少角色，请核对两份 `.env`，然后执行 `stop` / `start`。
如果任务停在 queued，先检查 Worker；若 running，查看日志，不要重复提交：

```bash
tail -n 50 outputs/local-services/worker.log
tail -n 50 outputs/local-services/tts.log
journalctl --user -u text-to-podcast-local.service -n 50
```

超时不会取消已有的 GPU 推理；报告保留任务 ID，应先查询原任务状态。
指定 `--engine-id mock` 仅用于显式的无模型音调测试，必须同时将后端和服务配置切回
Mock；仅改客户端参数不会切换已运行服务的模型。

## 本次本机验证

2026-11-10，使用上面的太阳系描述，已完成真实 Qwen LLM → Qwen TTS → MP3：
生成4条台词、4个合成块，最终 MP3 为944,685字节，解码时长59.04秒。
项目ID为3，脚本任务ID为5，音频任务ID为6，资产ID为3；
两阶段真实生成标识均符合要求。播放地址为
`http://127.0.0.1:8000/api/v1/audio-assets/3/play`。
这次验证确认了真实推理与文件解码，发音和台词完整性仍需人工播放检查。
可提交源码的验证记录见 [qwen-validation.json](qwen-validation.json)；完整 MP3 留在本机输出目录。
