#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting Wax Wishlist..."
echo

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js first, then try again."
  echo "Press Enter to close."
  read
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Dependencies are missing, so I am installing them first..."
  npm install
  echo
fi

echo "Opening the local app in your browser..."
echo "Keep this window open while the app is running."
echo

npm run dev -- --open
