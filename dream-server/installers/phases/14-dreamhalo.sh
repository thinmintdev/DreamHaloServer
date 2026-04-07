#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 14: DreamHalo Configuration
# ============================================================================
# Part of: installers/phases/
# Purpose: Configure DreamHalo-specific services (9Router, model-manager,
#          unsloth-studio) and set DREAM_MODE=dreamhalo when 9Router is enabled
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

ENABLE_9ROUTER="${ENABLE_9ROUTER:-false}"
ENABLE_MODEL_MANAGER="${ENABLE_MODEL_MANAGER:-false}"
ENABLE_UNSLOTH="${ENABLE_UNSLOTH:-false}"

if $INTERACTIVE; then
    echo ""
    log "=== DreamHalo Extensions ==="
    echo ""

    read -rp "Enable 9Router (Claude API proxy via LiteLLM)? [y/N] " REPLY
    [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_9ROUTER=true

    read -rp "Enable Model Manager (browse/load/download models)? [Y/n] " REPLY
    [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_MODEL_MANAGER=true

    read -rp "Enable Unsloth Studio (fine-tuning)? [y/N] " REPLY
    [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_UNSLOTH=true
fi

# --- 9Router ---
if [[ "$ENABLE_9ROUTER" == "true" ]]; then
    log "Enabling 9Router extension..."
    NINEROUTER_COMPOSE="$INSTALL_DIR/extensions/services/9router/compose.yaml"
    if [[ -f "${NINEROUTER_COMPOSE}.disabled" ]]; then
        $DRY_RUN || mv "${NINEROUTER_COMPOSE}.disabled" "$NINEROUTER_COMPOSE"
    fi

    # Prompt for API key if not already set
    if $INTERACTIVE && [[ -z "${NINEROUTER_API_KEY:-}" ]]; then
        echo ""
        read -rp "Enter your 9Router/Anthropic API key (or press Enter to skip): " NINEROUTER_API_KEY
        if [[ -n "$NINEROUTER_API_KEY" ]]; then
            $DRY_RUN || echo "NINEROUTER_API_KEY=$NINEROUTER_API_KEY" >> "$INSTALL_DIR/.env"
            log "9Router API key saved to .env"
        else
            warn "No API key provided — set NINEROUTER_API_KEY in .env before starting 9Router"
        fi
    fi

    # Switch LiteLLM to dreamhalo config
    $DRY_RUN || sed -i 's/^DREAM_MODE=.*/DREAM_MODE=dreamhalo/' "$INSTALL_DIR/.env" 2>/dev/null \
        || echo "DREAM_MODE=dreamhalo" >> "$INSTALL_DIR/.env"
    success "9Router enabled — LiteLLM set to dreamhalo mode (Claude Sonnet 4.6 default)"

    # Switch OpenClaw to dreamhalo config if openclaw is enabled
    if [[ "$ENABLE_OPENCLAW" == "true" ]]; then
        $DRY_RUN || sed -i 's|OPENCLAW_CONFIG=.*|OPENCLAW_CONFIG=/config/openclaw-dreamhalo.json|' \
            "$INSTALL_DIR/extensions/services/openclaw/compose.yaml" 2>/dev/null \
            || warn "Could not update OpenClaw config path — update manually"
        success "OpenClaw set to dreamhalo agent config"
    fi
else
    log "9Router not enabled — keeping default DREAM_MODE"
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
