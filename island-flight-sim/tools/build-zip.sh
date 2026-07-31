#!/usr/bin/env bash
# Builds the source ZIP that the start screen's "Download source ZIP" button
# links to. Not committed — see .gitignore.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p download
rm -f download/island-flight-sim-source.zip
zip -qr download/island-flight-sim-source.zip . \
  -x "download/*" ".git/*" "*/.DS_Store" ".DS_Store"
echo "built download/island-flight-sim-source.zip ($(du -h download/island-flight-sim-source.zip | cut -f1))"
