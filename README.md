# Text to Podcast：本地语音生成后端

业务后端与 TTS 服务放在同一仓库，分别安装依赖、分别运行，通过 HTTP 通信。

```text
backend/  业务 API :8000 → 数据库任务 → 独立 Worker
                                       ↓ HTTP
tts/                             TTS 服务 :8001 → Mock / Qwen
                                       ↓
                                分块拼接后的完整 MP3
```

| 目录 | 职责 | Conda 环境 |
| --- | --- | --- |
| backend/ | 项目、脚本确认、异步任务、角色、MP3 发布下载 | podcast-backend |
| tts/ | 引擎协议、Mock/Qwen 适配、短文本 WAV API | podcast-tts-service 或原 podcast-tts |
| scripts/、tests/ | 完整闭环验证、源码导出、跨模块测试 | podcast-tts-service |
| docs/ | 统一验证、接口、模型部署和来源 |

第一次使用按 [完整验证](docs/verification.md) 操作：先 Mock，再真实 Qwen。
backend 已包含接入改动，**不需要再克隆另一个后端或应用 patch**。

当前 LLM 仍是固定 Mock 脚本，本分支没有前端。Mock TTS 是音调，不是人声。
真实模型需实际验收，不能用 Mock/ASGI 通过代替。开发身份固定、尚无正式鉴权，
服务默认只监听 127.0.0.1；LAN 服务需明确配置保护，也不是调用端设备内推理。

只交付源码、配置示例、测试与文档；唯一音频素材是上游合成测试音 fixture。
不上传权重、真实 .env、数据库、参考录音、生成音频、环境或旧 Git 历史。
本机原目录和资产保留；本目录是独立待发布副本。

- [完整验证步骤](docs/verification.md)
- [TTS HTTP 契约](docs/tts-api.md)
- [模型准备](docs/model-setup.md)
- [本次验证记录](docs/validation.json)
- [来源与许可情况](docs/provenance.md)
