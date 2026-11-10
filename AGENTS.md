# 工作约定

- backend/ 和 tts/ 独立安装依赖，通过 HTTP 通信；业务代码不导入模型 SDK。
- Conda：业务 podcast-backend，轻量 TTS/跨模块测试 podcast-tts-service，真实 TTS 模型 podcast-tts，LLM 模型 podcast-llm。
- 不修改已有 CUDA/PyTorch、全局 Python 或用户资产；重型操作先取得授权。
- 模型在首次 synthesize 才加载；health/列表不能加载权重或隐式联网。
- 默认绑定 127.0.0.1。LAN 部署显式配置访问控制，如实说明推理所在机器。
- 不提交 .env、密钥、用户音频、录音、数据库、权重和环境。
  唯一源代码音频例外为上游合成测试音 backend/fixtures/test_audio.mp3。
- 复用数据库 Worker、租约和幂等机制，不另建 Redis/Celery 队列。
- 如实报告能力和错误；失败不能返回 Mock 冒充真实合成。
- 从 backend/ 执行 app 模块，从 tts/ 执行 tts_service 模块，从 llm/ 执行 llm_service 模块。
- Mock、ASGI、数据库、真实 TCP 和真实推理分别验证，测试命令见 docs/verification.md。
- 保留来源/许可记录，未经团队决定不添加统一开源许可证。
