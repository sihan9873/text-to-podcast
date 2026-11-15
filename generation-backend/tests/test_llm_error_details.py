import io
import json
from urllib.error import HTTPError

import pytest

from app.core.common import BusinessError
from app.integrations.local_llm import LocalLLMClient


class FailingOpener:
    def __init__(self, error):
        self.error = error

    def open(self, *_args, **_kwargs):
        raise HTTPError('http://127.0.0.1:8003/v1/scripts/generate', 502, 'Bad Gateway', {},
                        io.BytesIO(json.dumps(self.error).encode()))


@pytest.mark.parametrize('payload,code,message', [
    ({'error': {'code': 'invalid_response', 'message': '模型输出的台词缺少 text 正文字段，请重新生成。'}},
     'LLM_INVALID_RESPONSE', '模型输出的台词缺少 text 正文字段，请重新生成。'),
    ({'error': {'code': 'output_truncated', 'message': '脚本输出达到 token 上限。'}},
     'LLM_OUTPUT_TRUNCATED', '脚本输出达到 token 上限。'),
    ({'error': []}, 'LLM_HTTP_ERROR', 'LLM 服务返回 HTTP 502，请检查模型和输入'),
])
def test_llm_error_details_reach_task_failure(payload, code, message):
    client = LocalLLMClient({'base_url': 'http://127.0.0.1:8003', 'model_id': 'test',
        'timeout_seconds': 10, 'max_new_tokens': 256}, opener=FailingOpener(payload))
    with pytest.raises(BusinessError) as caught:
        client.generate('原文', '提示', [{'role_key': 'host', 'name': '主持人'}])
    assert caught.value.code == code
    assert caught.value.message == message
