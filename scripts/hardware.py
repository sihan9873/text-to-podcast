"""Bounded, read-only hardware detection; no model loading or dependency installs."""
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess


def memory_info():
    try:
        values = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            key, value = line.split(':', 1)
            values[key] = int(value.split()[0]) * 1024
        return {"total_bytes": values['MemTotal'], "available_bytes": values['MemAvailable']}
    except (OSError, KeyError, ValueError):
        try:
            import ctypes
            class MemoryStatus(ctypes.Structure):
                _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in
                    ('total_phys', 'available_phys', 'total_page', 'available_page', 'total_virtual', 'available_virtual', 'extended')]
            status = MemoryStatus(); status.length = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return {"total_bytes": status.total_phys, "available_bytes": status.available_phys}
        except (AttributeError, OSError):
            pass
        return {"total_bytes": None, "available_bytes": None}


def gpu_info():
    binary = shutil.which('nvidia-smi')
    if not binary and Path('/usr/lib/wsl/lib/nvidia-smi').is_file():
        binary = '/usr/lib/wsl/lib/nvidia-smi'
    if not binary:
        return {"available": False, "devices": [], "reason": "未找到 nvidia-smi（可能没有 NVIDIA 显卡或驱动未安装）"}
    try:
        result = subprocess.run([binary, '--query-gpu=index,name,driver_version,memory.total,memory.free,utilization.gpu',
                                 '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=8, check=True)
        devices = []
        for row in csv.reader(result.stdout.splitlines()):
            index, name, driver, total, free, utilization = [item.strip() for item in row]
            def number(value):
                try: return float(value)
                except ValueError: return None
            devices.append({"index": index, "name": name, "driver_version": driver,
                            "total_mib": number(total), "free_mib": number(free), "utilization_percent": number(utilization)})
        return {"available": bool(devices), "devices": devices}
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return {"available": False, "devices": [], "reason": "显卡检测失败：" + type(exc).__name__}


def collect_hardware(root, python, backend='standard'):
    root = Path(root)
    cpu = platform.processor() or platform.machine()
    try:
        cpu = next(line.split(':', 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name'))
    except (OSError, StopIteration):
        pass
    disk = shutil.disk_usage(root)
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "os": platform.system(),
              "release": platform.release(), "cpu": {"name": cpu, "logical_cores": os.cpu_count()},
              "memory": memory_info(), "disk": {"total_bytes": disk.total, "free_bytes": disk.free},
              "gpu": gpu_info(), "tts_backend": backend, "tts_python": str(python)}
    try:
        result = subprocess.run([str(python), str(root / 'scripts/probe_tts_runtime.py')],
                                capture_output=True, text=True, timeout=40, check=True)
        report['runtime'] = json.loads(result.stdout.splitlines()[-1])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError) as exc:
        report['runtime'] = {"cuda_available": False, "error": type(exc).__name__}
    runtime = report['runtime']
    hints = []
    if not runtime.get('cuda_available'):
        hints.append('TTS 环境无法使用 CUDA；请检查显卡驱动与 PyTorch CUDA 版本，CPU 合成会很慢。')
    else:
        hints.append('CUDA 可用。速度优先选 0.6B，质量升级可选 1.7B；更大的模型不等于更快。')
        if runtime.get('packages', {}).get('faster-qwen3-tts', {}).get('installed'):
            hints.append('已安装 CUDA Graph 加速包，可选择 faster 后端；首次图捕获较慢，比较速度请看预热后的 RTF。')
        else:
            hints.append('当前检测的 TTS 环境未安装 faster 加速包；可安装或切换到独立加速环境，保留普通环境。')
    for device in runtime.get('devices', []):
        capability = device.get('capability', [])
        arch = 'sm_' + ''.join(map(str, capability))
        if capability and capability[0] >= 10 and arch not in runtime.get('cuda_architectures', []):
            hints.append('PyTorch 构建未列出此显卡架构；RTX 50 系请检查支持 Blackwell 的 CUDA 12.8+ 构建。')
    for device in report['gpu']['devices']:
        if device['free_mib'] is not None and device['free_mib'] < 6000:
            hints.append('当前空闲显存不足 6 GB，LLM/TTS 同时驻留可能影响较大语音模型；先检查占用。')
    if 'microsoft' in platform.release().lower():
        hints.append('运行于 WSL；显示的是当前 Linux/WSL 可用 CPU 和内存。')
    report['recommendations'] = hints
    return report
