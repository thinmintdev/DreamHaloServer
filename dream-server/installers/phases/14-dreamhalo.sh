#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 14: DreamHalo Configuration
# ============================================================================
# Part of: installers/phases/
# Purpose: Configure DreamHalo-specific services (CLIProxyAPI, model-manager,
#          unsloth-studio) and set DREAM_MODE=dreamhalo when proxy is enabled
#
# Expects: DRY_RUN, INSTALL_DIR, INTERACTIVE, ENABLE_OPENCLAW,
#          GPU_BACKEND, log(), success(), warn()
# Provides: DREAM_MODE (may be updated to dreamhalo)
#
# Modder notes:
#   This phase runs after the standard DreamServer phases. It enables
#   DreamHalo-specific extensions and configures LiteLLM for Claude access.
# ============================================================================

log "Checking DreamHalo extensions..."

ENABLE_CLIPROXYAPI="${ENABLE_CLIPROXYAPI:-false}"
ENABLE_MODEL_MANAGER="${ENABLE_MODEL_MANAGER:-false}"
ENABLE_UNSLOTH="${ENABLE_UNSLOTH:-false}"

if $INTERACTIVE; then
    echo ""
    log "=== DreamHalo Extensions ==="
    echo ""

    read -rp "Enable CLI Proxy API (Claude/Gemini proxy via OAuth)? [y/N] " REPLY
    [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_CLIPROXYAPI=true

    read -rp "Enable Model Manager (browse/load/download models)? [Y/n] " REPLY
    [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_MODEL_MANAGER=true

    read -rp "Enable Unsloth Studio (fine-tuning)? [y/N] " REPLY
    [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_UNSLOTH=true
fi

# --- CLI Proxy API ---
if [[ "$ENABLE_CLIPROXYAPI" == "true" ]]; then
    log "Enabling CLI Proxy API extension..."
    CLIPROXYAPI_COMPOSE="$INSTALL_DIR/extensions/services/cliproxyapi/compose.yaml"
    if [[ -f "${CLIPROXYAPI_COMPOSE}.disabled" ]]; then
        $DRY_RUN || mv "${CLIPROXYAPI_COMPOSE}.disabled" "$CLIPROXYAPI_COMPOSE"
    fi

    # Create data directories for persistent auth/config
    $DRY_RUN || mkdir -p "$INSTALL_DIR/data/cliproxyapi/auths" \
                         "$INSTALL_DIR/data/cliproxyapi/logs"
    # Create default config if missing
    if [[ ! -f "$INSTALL_DIR/data/cliproxyapi/config.yaml" ]]; then
        $DRY_RUN || cat > "$INSTALL_DIR/data/cliproxyapi/config.yaml" << 'CFGEOF'
# CLI Proxy API config — see https://github.com/router-for-me/CLIProxyAPI
CFGEOF
    fi

    # Switch LiteLLM to dreamhalo config
    $DRY_RUN || sed -i 's/^DREAM_MODE=.*/DREAM_MODE=dreamhalo/' "$INSTALL_DIR/.env" 2>/dev/null \
        || echo "DREAM_MODE=dreamhalo" >> "$INSTALL_DIR/.env"
    success "CLI Proxy API enabled — LiteLLM set to dreamhalo mode"
    log "After starting, authenticate with: docker exec -it dream-cliproxyapi /CLIProxyAPI/CLIProxyAPI -no-browser --claude-login"

    # Switch OpenClaw to dreamhalo config if openclaw is enabled
    if [[ "$ENABLE_OPENCLAW" == "true" ]]; then
        $DRY_RUN || sed -i 's|OPENCLAW_CONFIG=.*|OPENCLAW_CONFIG=/config/openclaw-dreamhalo.json|' \
            "$INSTALL_DIR/extensions/services/openclaw/compose.yaml" 2>/dev/null \
            || warn "Could not update OpenClaw config path — update manually"
        success "OpenClaw set to dreamhalo agent config"
    fi
else
    log "CLI Proxy API not enabled — keeping default DREAM_MODE"
fi

# --- Model Manager ---
if [[ "$ENABLE_MODEL_MANAGER" == "true" ]]; then
    log "Enabling Model Manager extension..."
    MM_COMPOSE="$INSTALL_DIR/extensions/services/model-manager/compose.yaml"
    if [[ -f "${MM_COMPOSE}.disabled" ]]; then
        $DRY_RUN || mv "${MM_COMPOSE}.disabled" "$MM_COMPOSE"
    fi
    success "Model Manager enabled on port ${MODEL_MANAGER_PORT:-3010}"
fi

# --- Unsloth Studio ---
if [[ "$ENABLE_UNSLOTH" == "true" ]]; then
    log "Enabling Unsloth Studio extension..."
    US_COMPOSE="$INSTALL_DIR/extensions/services/unsloth-studio/compose.yaml"
    if [[ -f "${US_COMPOSE}.disabled" ]]; then
        $DRY_RUN || mv "${US_COMPOSE}.disabled" "$US_COMPOSE"
    fi
    success "Unsloth Studio enabled on port ${UNSLOTH_PORT:-7680}"
fi

log "DreamHalo configuration complete"
