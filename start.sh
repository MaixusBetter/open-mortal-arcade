#!/bin/sh
# Mortal Arcade launcher for macOS and Linux:  ./start.sh   (on a Mac, double-click "Start Arcade.command")
# Uses Node.js 20+ if the computer has it, otherwise fetches a private copy into .runtime/node.
# Then tools/setup.mjs gets the Windows file system, starts the arcade and opens the browser.
# Set MA_NODE_MIRROR to use another mirror of https://nodejs.org/dist (same folder layout).
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
NODE=""

if [ -x "$ROOT/.runtime/node/bin/node" ]; then
  NODE="$ROOT/.runtime/node/bin/node"
elif command -v node >/dev/null 2>&1 && node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" 2>/dev/null; then
  NODE="node"
fi

if [ -z "$NODE" ]; then
  echo ""
  echo "  Mortal Arcade needs Node.js 20 or newer. Fetching a private copy into this folder."
  echo "  This happens once, about 50 MB. Nothing is installed on the computer."
  echo ""
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) echo "  ! Unsupported system. Install Node.js 20 or newer from https://nodejs.org/ and run this again."; exit 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) echo "  ! Unsupported processor. Install Node.js 20 or newer from https://nodejs.org/ and run this again."; exit 1 ;;
  esac
  mirror="${MA_NODE_MIRROR:-https://nodejs.org/dist}"
  entry=""
  for channel in latest-v24.x latest-v22.x; do
    sums="$(curl -fsSL "$mirror/$channel/SHASUMS256.txt" 2>/dev/null)" || continue
    entry="$(printf '%s\n' "$sums" | grep -E "  node-v[0-9.]+-$os-$arch\.tar\.gz\$" | head -n 1)"
    [ -n "$entry" ] && break
  done
  if [ -z "$entry" ]; then
    echo "  ! Could not reach $mirror. Install Node.js 20 or newer from https://nodejs.org/ and run this again."
    exit 1
  fi
  hash="${entry%% *}"
  file="${entry##* }"
  mkdir -p "$ROOT/.runtime"
  echo "  Downloading $file ..."
  curl -fL --progress-bar -o "$ROOT/.runtime/$file" "$mirror/$channel/$file"
  if command -v shasum >/dev/null 2>&1; then got="$(shasum -a 256 "$ROOT/.runtime/$file")"; else got="$(sha256sum "$ROOT/.runtime/$file")"; fi
  if [ "${got%% *}" != "$hash" ]; then
    rm -f "$ROOT/.runtime/$file"
    echo "  ! The Node.js download did not match its published checksum. Run this again."
    exit 1
  fi
  echo "  Checked against the published checksum. Unpacking..."
  rm -rf "$ROOT/.runtime/node" "$ROOT/.runtime/${file%.tar.gz}"
  tar -xzf "$ROOT/.runtime/$file" -C "$ROOT/.runtime"
  mv "$ROOT/.runtime/${file%.tar.gz}" "$ROOT/.runtime/node"
  rm -f "$ROOT/.runtime/$file"
  NODE="$ROOT/.runtime/node/bin/node"
  echo "  Node.js is ready in .runtime/node."
fi

exec "$NODE" "$ROOT/tools/setup.mjs" "$@"
