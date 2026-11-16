"""Read TTS interpreter capabilities without loading model weights."""
import importlib.metadata
import importlib.util
import json


def probe():
    result = {"packages": {}}
    for distribution, module in (("torch", "torch"), ("qwen-tts", "qwen_tts"), ("transformers", "transformers"),
                                 ("faster-qwen3-tts", "faster_qwen3_tts"), ("flash-attn", "flash_attn")):
        try:
            version = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            version = None
        result["packages"][distribution] = {"installed": importlib.util.find_spec(module) is not None, "version": version}
    try:
        import torch
        result.update(cuda_available=torch.cuda.is_available(), cuda_build=torch.version.cuda,
                      torch_version=torch.__version__, cuda_architectures=torch.cuda.get_arch_list() if torch.cuda.is_available() else [],
                      devices=[{"name": torch.cuda.get_device_name(i), "capability": list(torch.cuda.get_device_capability(i)),
                                "total_bytes": torch.cuda.get_device_properties(i).total_memory}
                               for i in range(torch.cuda.device_count())])
    except Exception as exc:
        result.update(cuda_available=False, error=type(exc).__name__)
    return result


if __name__ == '__main__':
    print(json.dumps(probe()))
