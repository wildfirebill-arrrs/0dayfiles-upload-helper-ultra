#!/bin/bash
# Reference: install Node.js on Ultra.cc per
# https://docs.ultra.cc/unofficial-language-installers/install-nodejs
#
# Run this on your Ultra slot via SSH, then:
#   git clone <your-fork> 0dayfiles-upload-helper-ultra
#   cd 0dayfiles-upload-helper-ultra && npm install
#   cp config.toml.example config.toml   # edit announce URL + ImageBB key
#
set -euo pipefail

echo "Installing Node.js (NVM + Node + npm) via Ultra.cc unofficial installer..."
bash <(wget -qO- https://scripts.ultra.cc/util-v2/LanguageInstaller/Node-Installer/main.sh) <<< "1"

echo ""
echo "Next steps (run these manually after the installer finishes):"
echo "  cd ~"
echo "  git clone <your-fork> 0dayfiles-upload-helper-ultra"
echo "  cd 0dayfiles-upload-helper-ultra"
echo "  npm install"
echo "  cp config.toml.example config.toml"
echo "  # edit config.toml: announce URL, ImageBB key"
echo ""
echo "Also ensure mediainfo + ffmpeg are available on PATH (static binaries in ~ if needed)."
