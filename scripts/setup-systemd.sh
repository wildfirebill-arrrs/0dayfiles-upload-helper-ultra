#!/bin/bash
# Set up a userland systemd service for the seedbox uploader.
# https://docs.ultra.cc/unofficial-application-installers/generic-software-installation#systemd-service

set -euo pipefail

REPO_DIR="$HOME/0dayfiles-upload-helper-ultra"
SERVICE_NAME="odfu-upload-helper"

mkdir -p "$HOME/.config/systemd/user"
mkdir -p "$REPO_DIR/logs"

cat > "$HOME/.config/systemd/user/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=0dayfiles upload helper (Ultra.cc seedbox edition)
After=network-online.target

[Service]
Type=simple
Restart=on-failure
WorkingDirectory=${REPO_DIR}
ExecStart=$(which node) ${REPO_DIR}/main.js --headless --input /path/to/releases --submit
StandardOutput=file:${REPO_DIR}/logs/service.log
StandardError=file:${REPO_DIR}/logs/service.log

[Install]
WantedBy=default.target
EOF

echo "Edit ${HOME}/.config/systemd/user/${SERVICE_NAME}.service to set the correct --input path."
echo "Then run:"
echo "  systemctl --user daemon-reload"
echo "  systemctl --user enable --now ${SERVICE_NAME}.service"
echo "  systemctl --user status ${SERVICE_NAME}.service"
