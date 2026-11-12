#!/usr/bin/env bash
# Start the 0dayfiles upload helper web UI.
# Usage: PORT=21345 ROOT_DIR=$HOME ./start.sh
set -euo pipefail

cd "$(dirname "$0")"

export PORT="${PORT:-21345}"
export ROOT_DIR="${ROOT_DIR:-$HOME}"

echo "Starting 0dayfiles upload helper on port $PORT (browse root: $ROOT_DIR)..."
exec node web.js