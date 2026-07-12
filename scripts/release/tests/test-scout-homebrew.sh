#!/usr/bin/env sh
set -eu

fail() {
  echo "test-scout-homebrew: $*" >&2
  exit 1
}

assert_contains() {
  file=$1
  text=$2
  grep -Fq "$text" "$file" || fail "expected $file to contain: $text"
}

assert_not_contains() {
  file=$1
  text=$2
  if grep -Fq "$text" "$file"; then
    fail "expected $file not to contain: $text"
  fi
}

root=$(git rev-parse --show-toplevel)
cd "$root"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

if scripts/release/scout-homebrew.sh --tag v1.2.3 --output-dir "$tmp_dir/bad" >/dev/null 2>&1; then
  fail "invalid tag unexpectedly passed"
fi

scripts/release/scout-homebrew.sh \
  --tag atlas-scout-v0.1.0 \
  --output-dir "$tmp_dir/out" \
  >"$tmp_dir/stdout"

archive="$tmp_dir/out/atlas-scout-0.1.0.tar.gz"
checksum="$archive.sha256"
formula="$tmp_dir/out/Formula/atlas-scout.rb"

[ -f "$archive" ] || fail "archive was not created"
[ -f "$checksum" ] || fail "checksum was not created"
[ -f "$formula" ] || fail "formula was not created"

actual_sha=$(shasum -a 256 "$archive" | awk '{ print $1 }')
expected_sha=$(cat "$checksum")
[ "$actual_sha" = "$expected_sha" ] || fail "checksum file does not match archive"

assert_contains "$formula" "class AtlasScout < Formula"
assert_contains "$formula" "include Language::Python::Virtualenv"
assert_contains "$formula" 'depends_on "python@3.12"'
assert_contains "$formula" 'resource "click" do'
assert_contains "$formula" 'resource "playwright" do'
assert_contains "$formula" "venv.pip_install resources"
assert_contains "$formula" 'venv.pip_install buildpath/"libs/shared"'
assert_contains "$formula" 'venv.pip_install buildpath/"libs/discovery-engine"'
assert_contains "$formula" 'venv.pip_install buildpath/"scout"'
assert_contains "$formula" 'bin.install_symlink libexec/"bin/scout" => "scout"'
assert_not_contains "$formula" "scout-dev"

tar -tzf "$archive" >"$tmp_dir/archive-files.txt"
grep -qx "atlas-scout-0.1.0/LICENSE" "$tmp_dir/archive-files.txt" ||
  fail "archive is missing LICENSE"
grep -qx "atlas-scout-0.1.0/libs/shared/pyproject.toml" "$tmp_dir/archive-files.txt" ||
  fail "archive is missing libs/shared"
grep -qx "atlas-scout-0.1.0/libs/discovery-engine/pyproject.toml" "$tmp_dir/archive-files.txt" ||
  fail "archive is missing libs/discovery-engine"
grep -qx "atlas-scout-0.1.0/scout/pyproject.toml" "$tmp_dir/archive-files.txt" ||
  fail "archive is missing scout"

if grep -E '(node_modules|__pycache__|/\.venv/)' "$tmp_dir/archive-files.txt" >/dev/null; then
  fail "archive contains generated or dependency files"
fi

echo "Scout Homebrew release script checks passed."
