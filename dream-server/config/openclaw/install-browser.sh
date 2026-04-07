#!/bin/sh
# Install system deps, skill CLIs, and Playwright Chromium for OpenClaw
# Runs at container startup; skips if marker exists

MARKER="/tmp/.browser-deps-installed"
CHROME_DIR="$HOME/.cache/ms-playwright"

if [ ! -f "$MARKER" ]; then
  echo "[startup] installing system packages..."
  if command -v apt-get > /dev/null 2>&1; then
    apt-get update -qq 2>/dev/null
    # Chromium deps + jq + tmux
    apt-get install -y -qq \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
      libwayland-client0 jq tmux 2>/dev/null
  fi

  # ripgrep (for session-logs skill)
  if ! command -v rg > /dev/null 2>&1; then
    echo "[startup] installing ripgrep..."
    curl -sL https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep_14.1.1-1_amd64.deb -o /tmp/rg.deb
    dpkg -i /tmp/rg.deb 2>/dev/null && rm /tmp/rg.deb
  fi

  # GitHub CLI (for github skill)
  if ! command -v gh > /dev/null 2>&1; then
    echo "[startup] installing gh CLI..."
    curl -sL https://github.com/cli/cli/releases/download/v2.67.0/gh_2.67.0_linux_amd64.deb -o /tmp/gh.deb
    dpkg -i /tmp/gh.deb 2>/dev/null && rm /tmp/gh.deb
  fi

  # gog CLI (for Google Workspace skill)
  if ! command -v gog > /dev/null 2>&1; then
    echo "[startup] installing gog CLI..."
    curl -sL https://github.com/steipete/gogcli/releases/download/v0.12.0/gogcli_0.12.0_linux_amd64.tar.gz | tar xz -C /tmp
    cp /tmp/gog /usr/local/bin/gog && chmod +x /usr/local/bin/gog
  fi

  # npm packages: mcporter, clawhub, claude-code, gemini, obsidian-cli, summarize
  echo "[startup] installing npm skill CLIs..."
  npm install -g mcporter clawhub @anthropic-ai/claude-code @google/gemini-cli obsidian-cli @steipete/summarize 2>/dev/null

  # obsidian-cli installs as 'obsidian' — skill expects 'obsidian-cli'
  [ -f /usr/local/bin/obsidian ] && [ ! -f /usr/local/bin/obsidian-cli ] && \
    ln -sf /usr/local/bin/obsidian /usr/local/bin/obsidian-cli

  touch "$MARKER"
  echo "[startup] system deps + skill CLIs installed"
fi

# Install Playwright Chromium if not present
if [ ! -d "$CHROME_DIR/chromium-"* ] 2>/dev/null; then
  echo "[startup] installing Playwright Chromium..."
  npx playwright-core install chromium 2>/dev/null
fi

echo "[startup] done"
