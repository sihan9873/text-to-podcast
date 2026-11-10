# TTS HTTP 契约

业务 API 使用 8000，TTS 使用 8001。长任务/角色/幂等/音频存储属于 backend，
模型加载、音色解析和短句推理属于 tts；业务后端不导入 Qwen/PyTorch。

| TTS 接口 | 作用 |
| --- | --- |
| GET /health | 进程存活，不证明模型/GPU 就绪 |
| GET /v1/engines | engine_id、installed、loaded、device、能力和 max_text_length |
| GET /v1/voices?engine_id=... | 具体 voices 和 aliases；资源不可用返回 503 |
| POST /v1/synthesize | 成功 audio/wav；失败 application/json |

```json
{"text":"欢迎收听。","engine_id":"qwen3-customvoice","voice_id":"host_a","speed":1.0,"output_type":"wav"}
```

text/engine_id/voice_id 必填，禁止未知字段；文本非空白、全局最多 1000 字符，
Qwen 默认另限 120。当前适配器仅支持 speed=1.0/WAV；不开放风格、克隆、segments
或客户端设备路径。Qwen 固定 Chinese，host_a/host_b 默认映射 vivian/uncle_fu。

错误形如 `{"error":{"code":"engine_busy","message":"…"}}`：404 未注册，
422 字段/音色/能力错误，503 资源/设备/加载/内存/忙碌，500 推理或输出无效。
错误 JSON 不能当音频保存。实际字段以各服务 /openapi.json 为准。

backend 按 sequence 排序、校验所有角色与台词，再按引擎上限保留原文分块，
串行合成和校验 WAV、重采样，角色切换插入静音，最后 FFmpeg 编码并解码验证 MP3。
发布器才负责数据库与文件保存；出错抛 BusinessError，不回退固定素材。

配置在提交任务时冻结；外部模型/别名尚未实现不可变版本管理，需部署者记录。
进度沿用 Worker 领取/完成状态，不是逐块精确百分比。超时/断线不取消上游推理，
不能无限重试 POST；先检查已有任务，再按需用新幂等键提交。
