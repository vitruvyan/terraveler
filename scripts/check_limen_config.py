"""Validate resolved deployment inputs without ever printing secrets."""
import json
from pathlib import Path
import sys


def check(config, root):
    gateway = config["services"]["terraveler_limen"]
    mounts = gateway.get("volumes", [])
    model_mount = next(v for v in mounts if v.get("target") == "/app/limen/docker/litellm_config.yaml")
    model_config = Path(model_mount["source"]).resolve()
    if model_mount.get("type") != "bind" or not model_mount.get("read_only"):
        raise ValueError("Model config must be a read-only bind mount.")
    if model_config.is_relative_to(root.resolve()):
        raise ValueError("Keep live model config and secrets outside the repository.")
    if not model_config.is_file():
        raise ValueError("The live litellm_config.yaml must exist as a regular file.")
    if "REPLACE_ME" in model_config.read_text().upper():
        raise ValueError("Choose provider models before enabling Limen; model placeholders remain.")
    env = gateway.get("environment", {})
    for name in ("DATABASE_URL", "LITELLM_MASTER_KEY", "LIMEN_ADMIN_TOKEN", "LIMEN_READ_TOKEN"):
        value = env.get(name)
        if not isinstance(value, str) or not value.strip() or "REPLACE_ME" in value.upper():
            raise ValueError("Required gateway credentials are missing or still placeholders.")


def main():
    try:
        check(json.load(sys.stdin), Path(__file__).resolve().parent.parent)
    except (ValueError, KeyError, TypeError, StopIteration, OSError):
        # Invalid inputs can include credentials; never echo raw JSON, paths,
        # exceptions or secret values from the resolved compose document.
        print("Limen preflight failed: provide an external model config with chosen models and real gateway credentials.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
