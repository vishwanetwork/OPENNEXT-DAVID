"""Resolve a preset's pinned checkpoint without starting or charging for a GPU."""

import argparse
import json
import re
import urllib.request

from spotbot.inference import PRESETS


def read(url, headers=None):
    request = urllib.request.Request(
        url, headers={"User-Agent": "SpotOrderBot-preset-config", **(headers or {})}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response), response.headers


def image_pin(image):
    if image and re.fullmatch(r"(?:docker\.io/)?vllm/vllm-openai@sha256:[a-f0-9]{64}", image):
        return image
    if not image:
        releases, _ = read("https://api.github.com/repos/vllm-project/vllm/releases?per_page=30")
        tags = [
            r["tag_name"]
            for r in releases
            if not r.get("prerelease")
            and not r.get("draft")
            and re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", r["tag_name"])
        ]
        if not tags:
            raise ValueError("No stable release found; pass --image with an immutable digest")
        tag = tags[0]
        image = "vllm/vllm-openai:" + tag
    if not re.fullmatch(r"vllm/vllm-openai:v[0-9]+\.[0-9]+\.[0-9]+(?:\.post[0-9]+)?", image):
        raise ValueError("Use an immutable vLLM digest or a numbered vLLM release tag")
    token, _ = read(
        "https://auth.docker.io/token?service=registry.docker.io&scope=repository:vllm/vllm-openai:pull"
    )
    _, headers = read(
        "https://registry-1.docker.io/v2/vllm/vllm-openai/manifests/" + image.split(":", 1)[1],
        {
            "Authorization": "Bearer " + token["token"],
            "Accept": "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
        },
    )
    digest = headers.get("Docker-Content-Digest", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise ValueError("registry_digest_unavailable")
    return "vllm/vllm-openai@" + digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image",
        help="Validated immutable vLLM image, or numbered release tag; omitted resolves current stable candidate",
    )
    parser.add_argument("--preset", choices=list(PRESETS), default="deepseek-r1-distill-7b")
    parser.add_argument("--validated-gpu-model", action="append", required=True)
    parser.add_argument(
        "--enable",
        action="store_true",
        help="Enable for an approved isolated GPU test; production requires a successful model acceptance run",
    )
    args = parser.parse_args()
    try:
        image = image_pin(args.image)
    except (ValueError, OSError, KeyError) as exc:
        parser.error(
            f"Image metadata lookup failed ({type(exc).__name__}); pass --image with a pinned digest or numbered release"
        )
    with urllib.request.urlopen(
        "https://huggingface.co/api/models/" + PRESETS[args.preset]["repo"], timeout=30
    ) as response:
        revision = json.load(response)["sha"]
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("invalid_repository_revision")
    pins = dict(
        enabled=args.enable,
        revision=revision,
        image=image,
        validated_gpu_models=args.validated_gpu_model,
    )
    print(
        "SPOTBOT_INFERENCE_PRESETS='"
        + json.dumps({args.preset: pins}, separators=(",", ":"))
        + "'"
    )


if __name__ == "__main__":
    main()
