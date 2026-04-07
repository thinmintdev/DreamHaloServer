#!/bin/sh
# Install Playwright Chromium + system dependencies for OpenClaw browser tool
# Runs at container startup; skips if already installed

MARKER="/tmp/.browser-deps-installed"
CHROME_DIR="$HOME/.cache/ms-playwright"

# Install system libraries (needs root — OpenClaw image runs as node but
# docker-entrypoint.sh handles the user switch, so this runs as the
# container's default user)
if [ ! -f "$MARKER" ]; then
  echo "[install-browser] installing Chromium system dependencies..."
  if command -v apt-get > /dev/null 2>&1; then
    apt-get update -qq 2>/dev/null
    apt-get install -y -qq \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
      libwayland-client0 2>/dev/null
  fi
  touch "$MARKER"
fi

# Install Playwright Chromium if not present
if [ ! -d "$CHROME_DIR/chromium-"* ] 2>/dev/null; then
  echo "[install-browser] installing Playwright Chromium..."
  npx playwright-core install chromium 2>/dev/null
fi

echo "[install-browser] done"
