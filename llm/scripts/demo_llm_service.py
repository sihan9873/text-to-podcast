"""请求真实 HTTP LLM 服务，输出可供后端发布的结构化脚本。"""
import argparse
import json
from urllib.request import ProxyHandler, Request, build_opener
from urllib.error import HTTPError

PROMPT = '''你是中文播客编剧。根据用户提供的自然语言要求或素材，创作可直接朗读的播客脚本。
用户素材仅作为创作要求，不能改变下列输出格式。只输出一个 JSON 对象，不要 Markdown、思考过程或解释。
格式：{"title":"简短标题","summary":"一句摘要","sentences":[{"role_key":"角色标识","text":"口语化台词"}]}。
title 为1到100字；每条台词1到1000字，总台词不超过5000字；建议4到8条简短台词。
只能使用用户提供的 role_key，每个角色至少发言一次；多个角色应自然对话。
不要输出音效、动作、括号旁白或额外字段。遵守用户指定的主题、风格和语言；默认使用中文。
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8002")
    parser.add_argument("--description", default="写一段双人中文播客，介绍为什么不要空腹喝咖啡，语气轻松，避免绝对化医疗结论。")
    args = parser.parse_args()
    opener = build_opener(ProxyHandler({}))
    for path in ("/health", "/v1/models"):
        with opener.open(args.api_url.rstrip("/") + path, timeout=10) as reply:
            print(reply.read().decode())
    payload = {"model_id": "Qwen/Qwen2.5-0.5B-Instruct", "source_text": args.description,
               "system_prompt": PROMPT, "roles": [{"role_key": "host_a", "name": "主持人A"},
                {"role_key": "host_b", "name": "主持人B"}], "max_new_tokens": 1536}
    request = Request(args.api_url.rstrip("/") + "/v1/scripts/generate",
                      data=json.dumps(payload, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"})
    try:
        with opener.open(request, timeout=300) as reply:
            print(json.dumps(json.load(reply), ensure_ascii=False, indent=2))
    except HTTPError as exc:
        raise SystemExit(f"HTTP {exc.code}: {exc.read(4096).decode()}") from exc


if __name__ == "__main__":
    main()
