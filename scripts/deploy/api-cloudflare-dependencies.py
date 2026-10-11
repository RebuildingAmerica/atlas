"""Install the locked Wasm packages for the read-only hosted runtime probe."""

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENVIRONMENT = ROOT / ".atlas/python-compatibility-dependencies"
INTERPRETER = "cpython-3.14.2-emscripten-wasm32-musl"
LOCK = ROOT / "services/api-cloudflare/compatibility/pylock.toml"

subprocess.run(
    ["uv", "venv", str(ENVIRONMENT), "--python", INTERPRETER, "--allow-existing"],
    check=True,
)
environment = {
    key: value
    for key, value in os.environ.items()
    if key not in {"VIRTUAL_ENV", "CONDA_PREFIX", "UV_PYTHON", "UV_PROJECT_ENVIRONMENT", "PYTHONHOME"}
}
environment["VIRTUAL_ENV"] = str(ENVIRONMENT)
subprocess.run(
    ["uv", "pip", "sync", str(LOCK), "--preview-features", "pylock", "--only-binary", ":all:"],
    env=environment,
    check=True,
)
vendor = ENVIRONMENT / "lib/python3.14/site-packages"
(vendor / "pyvenv.cfg").touch()
print(vendor)
