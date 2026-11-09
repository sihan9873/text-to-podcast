import argparse
from datetime import datetime
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
REF_TEXT = '现在是6月13号, 晚上的8点36, 星期天'
DEFAULT_TEXTS = ['这是我的第一段克隆语音。', '夜幕降临，古宅里传来了一阵奇怪的声音。', '这究竟是怎么回事呢？让我们继续往下听。']

def positive(value):
    n = float(value)
    if not 0 < n < float('inf'):
        raise argparse.ArgumentTypeError('必须是有限正数')
    return n

def positive_int(value):
    n = int(value)
    if n <= 0:
        raise argparse.ArgumentTypeError('必须是正整数')
    return n

def parser(description):
    p = argparse.ArgumentParser(description=description)
    g = p.add_mutually_exclusive_group()
    g.add_argument('--text')
    g.add_argument('--text-file', type=Path, help='UTF-8 文件，每个非空行生成一个 WAV')
    p.add_argument('--output-dir', type=Path, help='输出父目录，每次运行创建独立子目录')
    return p

def texts(a):
    values = a.text_file.read_text(encoding='utf-8-sig').splitlines() if a.text_file else ([a.text] if a.text is not None else DEFAULT_TEXTS)
    values = [v.strip() for v in values if v.strip()]
    if not values:
        raise ValueError('输入文本不能为空')
    return values

def file(path):
    path = Path(path).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f'文件不存在：{path}')
    return path

def destination(a, model):
    path = (a.output_dir or ROOT / 'outputs' / model).expanduser().resolve() / datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    path.mkdir(parents=True, exist_ok=False)
    return path

def report(path, elapsed, duration):
    rtf = elapsed / duration if duration > 0 else float('inf')
    print(f'生成成功：{path}\n生成耗时：{elapsed:.2f} 秒\n音频时长：{duration:.2f} 秒\nRTF：{rtf:.3f}', flush=True)

def run(main):
    try:
        main()
    except (OSError, ValueError, RuntimeError, ImportError, KeyError) as exc:
        raise SystemExit(f'测试失败：{exc}') from exc
