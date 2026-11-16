# TTS 模型与性能升级

## 模型选择

核对日期：2026-11-16。Qwen 官方公开的语音模型为 0.6B 与 1.7B，未在官方 TTS 发布列表发现 4B；Qwen3-4B-Instruct 是文本模型，不能代替 TTS。

- 官方列表：https://github.com/QwenLM/Qwen3-TTS
- 新增模型：https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice

本项目保留 0.6B 并添加 1.7B CustomVoice；两种规格沿用主持人 A/B 音色与业务 API，不改变 LLM 脚本功能。模型规格与后端可分别选择。更大模型用于质量升级，不保证更快。

## 调研与实现

| 方案 | 本次处理 | 原因 |
| --- | --- | --- |
| CUDA Graph | 接入 faster 可选后端并实测 | 减少自回归解码中的 Python 与 CUDA 小核启动开销 |
| SDPA / BF16 | 保留 | 现有 CUDA 环境已使用；无须安装编译扩展 |
| FlashAttention 2 | 新增显式配置，不强制安装 | 官方主要推荐其节省显存；性能和 RTX 50 系兼容性应单独验证，不能承诺必然提速 |
| Batch 批量合成 | 后续可研究 | 官方支持，但涉及不同长度的填充、显存预算和逐句进度，不直接用并发请求争抢同一个模型 |
| 流式输出 | 未纳入当前 MP3 流程 | 可改善首段可听延迟，不等于整篇合成吞吐提升 |
| GGML / 量化 | 本次不启用 | 需要额外原生运行时和专项音质验证 |

来源：

- 官方用法与 batch / FlashAttention 说明：https://github.com/QwenLM/Qwen3-TTS
- CUDA Graph 项目与原理：https://github.com/andimarafioti/faster-qwen3-tts
- 本次固定版本依赖：https://pypi.org/project/faster-qwen3-tts/0.3.0/

选择 0.3.0 是因为其兼容现有 `qwen-tts==0.1.1`、`transformers==4.57.3`、PyTorch 2.10 CUDA 12.8。新版本要求另一套 Transformers 5 依赖，不直接升级已跑通的环境。安装使用项目内、继承原 TTS site-packages 的独立 venv，并用 `--no-deps` 安装固定加速包。

## 复现

```bash
# 在项目根目录，使用已有 TTS Python 创建加速环境
/path/to/podcast-tts/python -m venv --system-site-packages tts/.venv-fast
tts/.venv-fast/bin/python -m pip install --no-deps -r tts/requirements/tts-fast.txt

# 下载官方更大语音模型
/path/to/podcast-tts/python scripts/download_tts_model.py customvoice --size 1.7b

# 双音色、相同文本的普通/加速基准，音频与 JSON 输出到 tts/outputs/benchmark
tts/.venv-fast/bin/python scripts/benchmark_tts.py --size 0.6b
```

高级环境变量：`TTS_QWEN_BACKEND=standard|faster`，`TTS_QWEN_ATTN=sdpa|eager|flash_attention_2`。默认保留标准后端；控制台选择 faster 时自动使用 `.venv-fast`。加速仅在 CustomVoice 路径验证启用，Base 克隆保留标准后端。

RTF = 合成耗时 / 产出音频时长，越小越快。预热耗时单列，不混入暖机后 RTF。不同解码内核与采样可能产出略有差异的音频时长，应按 RTF 比较，并通过试听判断音质。结构校验不能代替人工听感验收。

## 本机实测结果

硬件：Ryzen 7 5700X，RTX 5060 Ti 16GB，WSL2，PyTorch 2.10.0 + CUDA 12.8。结构化结果见 `docs/tts-benchmark-validation.json`，硬件快照见 `docs/hardware-validation.json`。

| 测试 | 普通后端 | CUDA Graph 后端 |
| --- | --- | --- |
| 0.6B 双音色短文，预热后 RTF | 2.1882 | 0.3504 |
| 1.7B 双音色短文，预热后 RTF | 本次未测 | 0.4147 |
| 1888 字 / 37 句整篇，含冷启动与编码 | 原任务 1004.322 秒 | 174.031 秒 |
| 整篇音频时长 | 450.648 秒 | 437.928 秒 |

短文按 RTF 约快 6.2 倍；整篇墙钟耗时约快 5.8 倍、降低约 83%。整篇对比使用此前真实任务作为普通后端基线，加速测试通过同一音频拼接适配器直接调用模型，不包含原任务的 HTTP 开销。它不是对所有文本或硬件的保证。

试听文件在 `tts/outputs/benchmark/`；整篇测试另存于 `tts/outputs/benchmark/document/audio.mp3`，未改原项目数据。

1.7B 模型固定下载版本为 `0c0e3051f131929182e2c023b9537f8b1c68adfe`，双音色加速测试通过；加载约 6.6 秒，单列预热约 8.5 秒。已在当前本地运行配置中选择 1.7B + faster，并保留原数据库、脚本、音频。切回 0.6B 可进一步优先速度。
