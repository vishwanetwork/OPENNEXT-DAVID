"""Verify model discovery, generated tokens and SSE through the customer HTTPS gateway."""

import argparse
import json
import os
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Customer HTTPS Base URL ending in /v1")
    parser.add_argument("--model", default="deepseek-r1-distill-7b")
    parser.add_argument("--api-key-env", default="INFERENCE_API_KEY")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.base_url)
    if (
        url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path != "/v1"
    ):
        parser.error("Use the customer HTTPS /v1 Base URL without credentials or query parameters")
    key = os.environ.get(args.api_key_env)
    if not key:
        parser.error("Set the API key in the selected environment variable")

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            return None

    opener = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))

    def call(path, payload=None):
        request = urllib.request.Request(
            args.base_url + path,
            data=json.dumps(payload).encode() if payload else None,
            headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        )
        return opener.open(request, timeout=args.timeout)

    with call("/models") as response:
        assert args.model in {m["id"] for m in json.load(response)["data"]}, "model_not_listed"
    payload = dict(
        model=args.model,
        messages=[dict(role="user", content="Reply with a short greeting.")],
        max_tokens=64,
        temperature=0.6,
    )
    with call("/chat/completions", payload) as response:
        result = json.load(response)
    tokens = int(result.get("usage", {}).get("completion_tokens", 0))
    assert tokens > 0 and result.get("choices"), "no_generated_tokens"
    chunks, done = 0, False
    with call("/chat/completions", dict(payload, stream=True)) as response:
        for line in response:
            if not line.startswith(b"data:"):
                continue
            data = line[5:].strip()
            if data == b"[DONE]":
                done = True
                break
            for choice in json.loads(data).get("choices", []):
                delta = choice.get("delta") or {}
                if any(delta.get(field) for field in ["content", "reasoning_content", "reasoning"]):
                    chunks += 1
    assert done and chunks > 0, "incomplete_stream"
    print(
        json.dumps(
            dict(
                event="inference_verified",
                model=args.model,
                completion_tokens=tokens,
                stream_chunks=chunks,
            )
        )
    )


if __name__ == "__main__":
    main()
