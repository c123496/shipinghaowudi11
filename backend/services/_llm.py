"""DeepSeek?OpenAI ???????????"""
import os
from pathlib import Path

from openai import OpenAI

_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"


def _load_project_env() -> None:
    env_file = Path(__file__).resolve().parents[2] / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def chat(
    system: str,
    user: str,
    temperature: float = 0.7,
    max_tokens: int = 8000,
    json_mode: bool = False,
    model: str = DEFAULT_MODEL,
) -> str:
    _load_project_env()
    provider = os.environ.get("LLM_PROVIDER", "deepseek").strip().lower()
    if provider != "deepseek":
        raise EnvironmentError("??????? DeepSeek???? LLM_PROVIDER=deepseek")

    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        raise EnvironmentError("?? DEEPSEEK_API_KEY??? .env ?????")

    model = os.environ.get("DEEPSEEK_MODEL", model).strip() or model
    client = OpenAI(api_key=api_key, base_url=_BASE_URL)
    kwargs = {}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        **kwargs,
    )
    return resp.choices[0].message.content.strip()
