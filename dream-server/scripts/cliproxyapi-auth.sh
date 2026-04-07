#!/bin/bash
# ============================================================================
# CLI Proxy API — Authentication Helper
# ============================================================================
# Guides the user through OAuth login for Claude (and other providers).
# Run from the dream-server install directory.
#
# Usage: bash scripts/cliproxyapi-auth.sh [--claude|--gemini|--codex]
# ============================================================================

set -euo pipefail

CONTAINER="dream-cliproxyapi"
PROVIDER="${1:---claude}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; }

# Map provider flag to login flag
case "$PROVIDER" in
    --claude)  LOGIN_FLAG="--claude-login";  PROVIDER_NAME="Claude" ;;
    --gemini)  LOGIN_FLAG="--gemini-login";  PROVIDER_NAME="Gemini" ;;
    --codex)   LOGIN_FLAG="--codex-login";   PROVIDER_NAME="Codex" ;;
    *)
        echo "Usage: $0 [--claude|--gemini|--codex]"
        echo "  Default: --claude"
        exit 1
        ;;
esac

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  CLI Proxy API — ${PROVIDER_NAME} Authentication                      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
    err "Container '${CONTAINER}' is not running."
    echo ""
    echo "Start it with:"
    echo "  docker compose up -d cliproxyapi"
    exit 1
fi

# Get the host IP for callback instructions
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
HOST_IP="${HOST_IP:-localhost}"

echo -e "${CYAN}How this works:${NC}"
echo ""
echo "  1. This script starts the OAuth login inside the container"
echo "  2. You'll get a URL to open in your browser"
echo "  3. Authorize the app in your browser"
echo "  4. Your browser will redirect to a callback URL"
echo "  5. If the callback fails (shows 'connection refused'):"
echo "     → Copy the full URL from your browser's address bar"
echo "     → Paste it back here when prompted"
echo ""
echo -e "${YELLOW}NOTE:${NC} The callback URL goes to localhost:54545. If your browser"
echo "  is on a different machine, it won't reach the container directly."
echo "  That's OK — just copy the URL and paste it when prompted."
echo ""
read -rp "Press Enter to start the ${PROVIDER_NAME} login... "

# Run the login — capture output to show the URL, and handle the callback
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

# Start login in background, tee output so user sees the URL
docker exec "${CONTAINER}" /CLIProxyAPI/CLIProxyAPI -no-browser "$LOGIN_FLAG" 2>&1 | tee "$TMPFILE" &
LOGIN_PID=$!

# Wait for the URL to appear
for i in $(seq 1 15); do
    if grep -q "oauth/authorize\|authentication" "$TMPFILE" 2>/dev/null; then
        break
    fi
    sleep 1
done

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}Open the URL above in your browser and authorize the app.${NC}"
echo ""
echo "After authorizing, your browser will redirect. Two things can happen:"
echo ""
echo -e "  ${GREEN}A)${NC} The page says 'Authentication Successful' → you're done!"
echo -e "  ${YELLOW}B)${NC} The page shows 'connection refused' → copy the full URL"
echo "     from your browser address bar and paste it below."
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Wait for either: login process to finish (callback worked), or user pastes URL
while kill -0 "$LOGIN_PID" 2>/dev/null; do
    if grep -q "Authentication successful\|successfully authenticated\|auth file changed" "$TMPFILE" 2>/dev/null; then
        break
    fi

    echo -e "${YELLOW}Waiting for authentication...${NC}"
    echo "If your browser showed 'connection refused', paste the callback URL here:"
    read -t 15 -rp "> " CALLBACK_URL || true

    if [[ -n "${CALLBACK_URL:-}" ]]; then
        # Extract code and state from callback URL
        if [[ "$CALLBACK_URL" == *"callback?"* ]]; then
            # Hit the callback endpoint inside the container
            PARAMS="${CALLBACK_URL#*callback?}"
            docker exec "${CONTAINER}" wget -qO- "http://127.0.0.1:54545/callback?${PARAMS}" > /dev/null 2>&1 \
                && log "Callback delivered to container" \
                || warn "Could not deliver callback — the login may have timed out, try again"
            sleep 2
        else
            warn "That doesn't look like a callback URL. Expected: http://...54545/callback?code=...&state=..."
        fi
    fi
done

# Wait for login to finish
wait "$LOGIN_PID" 2>/dev/null || true

echo ""

# Check if auth file was created
AUTH_COUNT=$(docker logs "${CONTAINER}" 2>&1 | grep -c "auth file changed" || true)
if [[ "$AUTH_COUNT" -gt 0 ]]; then
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║  ✓  ${PROVIDER_NAME} authentication successful!                       ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log "Auth files stored in: data/cliproxyapi/auths/"
    log "LiteLLM can now route requests through CLIProxyAPI → ${PROVIDER_NAME}"
    echo ""
    echo "Test it with:"
    echo "  curl http://localhost:8317/v1/models -H 'Authorization: Bearer dreamhalo'"
else
    warn "Could not confirm authentication. Check logs:"
    echo "  docker logs ${CONTAINER} | tail -20"
fi
