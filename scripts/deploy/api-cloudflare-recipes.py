"""Apply Atlas's locked source identities to pinned upstream Pyodide recipes."""

import argparse
import tomllib
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def pin_recipe(recipe_dir: Path, package: str) -> None:
    """Retain upstream static-library build steps with Atlas's exact package source."""
    name, version = package.split("==", 1)
    if name not in {"cryptography", "lxml"}:
        raise ValueError("Only reviewed native-library recipes are supported.")
    lock = tomllib.loads((ROOT / "api/uv.lock").read_text())
    locked = next(item for item in lock["package"] if item["name"] == name)
    if locked["version"] != version:
        raise ValueError("The requested native package differs from Atlas's lock.")
    source = locked["sdist"]
    path = recipe_dir / name / "meta.yaml"
    recipe = yaml.safe_load(path.read_text())
    if recipe["package"]["name"] != name:
        raise ValueError("The upstream recipe has an unexpected package identity.")
    recipe["package"]["version"] = version
    recipe["source"] = {
        "url": source["url"],
        "sha256": source["hash"].removeprefix("sha256:"),
    }
    path.write_text(yaml.safe_dump(recipe, sort_keys=False))
    if name == "lxml":
        # Autoconf must not try to execute Wasm as a host binary. This keeps
        # the source-linked filing XML parser available without native Node.
        iconv_path = recipe_dir / "libiconv" / "meta.yaml"
        iconv = yaml.safe_load(iconv_path.read_text())
        script = iconv["build"]["script"]
        configure = "emconfigure ./configure"
        if configure not in script:
            raise ValueError("The reviewed libiconv configure step changed.")
        iconv["build"]["script"] = script.replace(
            configure, configure + " --host=wasm32-unknown-emscripten", 1
        )
        iconv_path.write_text(yaml.safe_dump(iconv, sort_keys=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe-dir", type=Path, required=True)
    parser.add_argument("--package", required=True)
    args = parser.parse_args()
    pin_recipe(args.recipe_dir, args.package)
