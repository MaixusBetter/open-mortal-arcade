#!/bin/sh
# Mortal Arcade launcher for macOS: double-click to start (the first time, right-click > Open).
exec /bin/sh "$(dirname "$0")/start.sh" "$@"
