# 播客业务后端

工作目录为 backend/，独立 Conda 环境为 podcast-backend。业务不导入模型 SDK，
Worker 通过 HTTP 调用相邻的 TTS 服务。完整步骤见 [统一验证](../docs/verification.md)。

```bash
# 已有环境跳过 create。
conda create -n podcast-backend python=3.12 pip
conda run --no-capture-output -n podcast-backend python -m pip install -r requirements-dev.txt
cp -n .env.example .env
conda run --no-capture-output -n podcast-backend python -m app.bootstrap
```

默认示例为 local_http + mock，TTS 地址 http://127.0.0.1:8001。
需要带 libmp3lame 的 FFmpeg，由部署者准备，不自动安装。
分别在两个终端启动 API 和 Worker：

```bash
conda run --no-capture-output -n podcast-backend python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```bash
conda run --no-capture-output -n podcast-backend python -m app.worker
```

业务前缀 /api/v1。生成请求携带 Idempotency-Key，使用实际角色 ID、脚本版本和
修订号。LLM 仍返回固定 Mock 脚本。若干配置接口为 501 预留，早期设计文档不能
替代运行时 /openapi.json。requirements.lock 是上游 Windows 历史记录。

测试：`conda run --no-capture-output -n podcast-backend python -m pytest -q`。
