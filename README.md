# Text to Podcast：本地语音生成后端

业务后端、LLM 与 TTS 服务放在同一仓库，使用各自的 Conda 环境，通过 HTTP 通信。

```text
backend/  业务 API :8000 → 数据库任务 → 独立 Worker
                                       ├─ HTTP → llm/ :8002 → Qwen2.5 脚本
                                       └─ HTTP → tts/ :8001 → Qwen3-TTS 台词音频
                                                 ↓
                                 backend 拼接、编码并发布完整 MP3
```

| 目录 | 职责 | Conda 环境 |
| --- | --- | --- |
| backend/ | 项目、脚本确认、异步任务、角色、MP3 发布下载 | podcast-backend |
| tts/ | 引擎协议、Mock/Qwen 适配、短文本 WAV API | podcast-tts-service 或原 podcast-tts |
| llm/ | Qwen2.5-0.5B 脚本生成 HTTP 服务 :8002 | podcast-llm |
| scripts/、tests/ | 完整闭环验证、源码导出、跨模块测试 | podcast-tts-service |
| docs/ | 统一验证、接口、模型部署和来源 |

本机已准备真实模型，可直接按 [真实 Qwen 启动与验证](docs/local-qwen.md) 生成脚本和人声。
新机器的无模型测试及通用部署步骤见 [完整验证](docs/verification.md)。
backend 已包含接入改动，**不需要再克隆另一个后端或应用 patch**。

LLM 可配置为固定 Mock 或本地 Qwen2.5-0.5B，支持自然语言创作要求，见
[Qwen LLM 接入指南](docs/local-llm.md)。本分支没有前端。Mock TTS 是音调，不是人声。
真实模型需实际验收，不能用 Mock/ASGI 通过代替。开发身份固定、尚无正式鉴权，
服务默认只监听 127.0.0.1；LAN 服务需明确配置保护，也不是调用端设备内推理。

只交付源码、配置示例、测试与文档；唯一音频素材是上游合成测试音 fixture。
不上传权重、真实 .env、数据库、参考录音、生成音频、环境或旧 Git 历史。
本机配置和运行产物保留在本地；克隆仓库后需按文档准备环境、权重和 `.env`。

- [完整验证步骤](docs/verification.md)
- [TTS HTTP 契约](docs/tts-api.md)
- [模型准备](docs/model-setup.md)
- [回归测试记录](docs/validation.json)
- [真实 Qwen 生成记录](docs/qwen-validation.json)
- [来源与许可情况](docs/provenance.md)

验证命令会将 `script.json`、可读的 `script.txt`、`full.mp3` 和 `report.json`
保存到 `outputs/backend-verification/<时间戳>/`；这些生成结果不进入 Git。
