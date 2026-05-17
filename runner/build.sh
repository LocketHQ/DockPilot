#!/usr/bin/env bash
# Cross-compile the DockPilot Runner for Linux x86_64 and ARM64.
# Output: ../app/src-tauri/binaries/lockethq-runner-{x86_64,aarch64}
#
# Uses Docker buildx if available; falls back to instructions otherwise.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/src-tauri/binaries"
mkdir -p "$OUT"

if ! command -v docker >/dev/null 2>&1; then
  echo "× Docker not found. Install Docker Desktop (or OrbStack) and re-run."
  echo "  Alternatively, build manually on a Linux host:"
  echo "    cargo build -p lockethq-runner --release --target x86_64-unknown-linux-musl"
  echo "    cargo build -p lockethq-runner --release --target aarch64-unknown-linux-musl"
  echo "  and copy the binaries to $OUT/lockethq-runner-{x86_64,aarch64}."
  exit 1
fi

build_arch() {
  local arch=$1
  echo "→ building lockethq-runner for $arch"
  docker buildx build \
    --build-arg ARCH=$arch \
    --target export \
    --output "type=local,dest=$OUT/_tmp-$arch" \
    -f "$ROOT/runner/Dockerfile.build" \
    "$ROOT"
  mv "$OUT/_tmp-$arch/lockethq-runner" "$OUT/lockethq-runner-$arch"
  rm -rf "$OUT/_tmp-$arch"
  echo "✓ $OUT/lockethq-runner-$arch"
}

build_arch x86_64
build_arch aarch64

echo
echo "All binaries built:"
ls -la "$OUT"
