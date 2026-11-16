import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hardware
import local_tasks


class HardwareTests(unittest.TestCase):
    def test_gpu_csv_and_unavailable_driver(self):
        output = '0, NVIDIA GeForce RTX 5060 Ti, 596.49, 16311, 12000, 5\n'
        with patch.object(hardware.shutil, 'which', return_value='/bin/nvidia-smi'), patch.object(hardware.subprocess, 'run', return_value=SimpleNamespace(stdout=output)):
            gpu = hardware.gpu_info()
        self.assertTrue(gpu['available'])
        self.assertEqual(gpu['devices'][0]['free_mib'], 12000)
        with patch.object(hardware.shutil, 'which', return_value='/bin/nvidia-smi'), patch.object(hardware.subprocess, 'run', side_effect=OSError()):
            self.assertFalse(hardware.gpu_info()['available'])

    def test_detection_uses_selected_runtime_and_no_model_load(self):
        runtime = {'cuda_available': True, 'packages': {'faster-qwen3-tts': {'installed': True, 'version': '0.3.0'}}}
        with patch.object(hardware, 'gpu_info', return_value={'available': True, 'devices': []}), \
             patch.object(hardware.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(runtime))) as run:
            report = hardware.collect_hardware(Path(__file__).resolve().parents[2], '/selected/python', 'faster')
        self.assertEqual(run.call_args.args[0][0], '/selected/python')
        self.assertTrue(report['runtime']['cuda_available'])
        self.assertTrue(any('CUDA Graph' in hint for hint in report['recommendations']))
        self.assertEqual(run.call_args.kwargs['timeout'], 40)

    def test_model_and_backend_are_independent(self):
        small = local_tasks.tts_environment({'TTS_MODEL_SIZE': '0.6b', 'TTS_QWEN_BACKEND': 'faster'})
        large = local_tasks.tts_environment({'TTS_MODEL_SIZE': '1.7b', 'TTS_QWEN_BACKEND': 'standard'})
        self.assertIn('0.6B-CustomVoice', small['TTS_QWEN_MODEL_PATH'])
        self.assertIn('1.7B-CustomVoice', large['TTS_QWEN_MODEL_PATH'])
        self.assertIn('.venv-fast', local_tasks.tts_python({'TTS_QWEN_BACKEND': 'faster'}))
        for config in ({'TTS_MODEL_SIZE': '4b'}, {'TTS_QWEN_BACKEND': 'anything'}):
            with self.assertRaises(ValueError): local_tasks.tts_environment(config)


if __name__ == '__main__':
    unittest.main()
