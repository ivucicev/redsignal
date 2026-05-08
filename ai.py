from __future__ import annotations

import os


def run_ai_prompt(prompt: str, credential: dict, max_tokens: int = 300) -> str:
    ctype = credential.get("type", "anthropic")

    if ctype == "anthropic":
        import anthropic  # type: ignore
        model  = credential.get("model") or "claude-haiku-4-5-20251001"
        client = anthropic.Anthropic(api_key=credential["api_key"])
        msg    = client.messages.create(model=model, max_tokens=max_tokens,
                                        messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text.strip()

    if ctype in ("openai", "ollama"):
        from openai import OpenAI  # type: ignore
        if ctype == "ollama":
            base   = (credential.get("base_url") or "http://localhost:11434").rstrip("/")
            client = OpenAI(api_key="ollama", base_url=f"{base}/v1/")
            model  = credential.get("model") or "llama3.2"
        else:
            client = OpenAI(api_key=credential["api_key"])
            model  = credential.get("model") or "gpt-4o-mini"
        resp = client.chat.completions.create(model=model, max_tokens=max_tokens,
                                              messages=[{"role": "user", "content": prompt}])
        return resp.choices[0].message.content.strip()

    raise ValueError(f"Unknown credential type: {ctype}")


def resolve_ai_cred(cfg: dict, credential_id: str | None) -> dict | None:
    if credential_id:
        return next((c for c in cfg.get("credentials", []) if c.get("id") == credential_id), None)
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if key:
        return {"type": "anthropic", "api_key": key}
    return None
