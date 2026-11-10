# 本地 Qwen LLM 服务

独立进程，HTTP 8002，按需加载本地 Qwen2.5-0.5B-Instruct。
业务适配器在 `backend/app/integrations/local_llm.py`，实现 `ScriptGenerator`。

本机使用独立 Conda 环境 `podcast-llm`，模型位于 `llm/models/Qwen2.5-0.5B-Instruct/`。
环境和权重均不提交源码。环境从已有 `podcast-tts` 离线克隆，原环境和 CUDA/PyTorch 不变。

在本目录启动：

```bash
LLM_DEVICE=cuda:0 conda run --no-capture-output -n podcast-llm python -m uvicorn llm_service.app:app --host 127.0.0.1 --port 8002 --workers 1
```

完整配置、模型下载、自然语言输入与后端联调见 [接入指南](../docs/local-llm.md)。

Linux/WSL 本机统一启动（从仓库根运行；用户级 systemd 托管）：

```bash
conda run --no-capture-output -n podcast-backend python scripts/local_services.py start
```

同一命令的 `status` / `stop` 用于检查和停止服务。本机已配置真实 Qwen TTS，
完整语音验证见 [真实 Qwen 指南](../docs/local-qwen.md)。
