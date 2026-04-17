#!/usr/bin/env sh
set -eu

if command -v docker >/dev/null 2>&1; then
  exec docker "$@"
fi

docker_desktop_bin="/Applications/Docker.app/Contents/Resources/bin"

if [ -x "${docker_desktop_bin}/docker" ]; then
  export PATH="${docker_desktop_bin}:$PATH"
  exec "${docker_desktop_bin}/docker" "$@"
fi

echo "docker CLI not found on PATH." >&2

if [ -d "/Applications/Docker.app" ]; then
  echo "Docker Desktop appears installed at /Applications/Docker.app, but its CLI tools are not available in this shell." >&2
  echo "Enable Docker Desktop's CLI symlinks or add /Applications/Docker.app/Contents/Resources/bin to PATH." >&2
fi

exit 127
