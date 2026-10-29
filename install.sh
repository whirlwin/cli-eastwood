#!/bin/sh
# Install clewd: curl -fsSL https://raw.githubusercontent.com/whirlwin/cli-eastwood/main/install.sh | sh
# Env: CLEWD_VERSION (tag, default latest), CLEWD_INSTALL_DIR (default ~/.local/bin).
set -eu

repo="whirlwin/cli-eastwood"
dir="${CLEWD_INSTALL_DIR:-$HOME/.local/bin}"

die() { echo "error: $*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported OS: $(uname -s)" ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

asset="clewd-$os-$arch"
if [ -n "${CLEWD_VERSION:-}" ]; then
  case "$CLEWD_VERSION" in v*) tag="$CLEWD_VERSION" ;; *) tag="v$CLEWD_VERSION" ;; esac
  base="https://github.com/$repo/releases/download/$tag"
else
  base="https://github.com/$repo/releases/latest/download"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  die "need sha256sum or shasum to verify the download"
fi

mkdir -p "$dir"
# Same directory as the destination so the final mv is an atomic rename.
tmp="$(mktemp -d "$dir/.clewd-install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading $asset..."
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"

expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/checksums.txt")"
[ -n "$expected" ] || die "no checksum for $asset in checksums.txt"
[ "$(sha "$tmp/$asset")" = "$expected" ] || die "checksum mismatch for $asset, aborting"

chmod 755 "$tmp/$asset"
mv -f "$tmp/$asset" "$dir/clewd"
echo "Installed clewd to $dir/clewd"

case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "warning: $dir is not in your PATH. Add it, e.g.: export PATH=\"$dir:\$PATH\"" >&2 ;;
esac
