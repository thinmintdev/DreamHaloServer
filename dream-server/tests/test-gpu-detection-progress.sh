#!/bin/bash
# ============================================================================
# Dream Server GPU Detection Progress Indicator Test Suite
# ============================================================================
# Tests that GPU detection shows progress feedback
#
# Usage: ./tests/test-gpu-detection-progress.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   GPU Detection Progress Indicator Tests  ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

echo "1. Progress Indicator Implementation Tests"
echo "───────────────────────────────────────────"

# Test 1: Phase 02 has progress message for GPU detection
printf "  %-50s " "Phase 02 shows GPU scanning message..."
if grep -q "Scanning for GPU" "$ROOT_DIR/installers/phases/02-detection.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 2: Phase 02 has spinner for GPU detection
printf "  %-50s " "Phase 02 has spinner animation..."
if grep -A 5 "Scanning for GPU" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "_spin="; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 3: Phase 02 runs detect_gpu in background
printf "  %-50s " "detect_gpu runs in background..."
if grep -q "detect_gpu.*&" "$ROOT_DIR/installers/phases/02-detection.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 4: Phase 02 waits for GPU detection to complete
printf "  %-50s " "Phase 02 waits for GPU detection..."
if grep -A 10 "detect_gpu.*&" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "wait.*_gpu_pid"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 5: Phase 02 shows completion message
printf "  %-50s " "Phase 02 shows completion message..."
if grep -A 15 "Scanning for GPU" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "GPU scan complete"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo ""
echo "2. Spinner Animation Tests"
echo "──────────────────────────"

# Test 6: Spinner uses braille characters
printf "  %-50s " "Spinner uses braille characters..."
if grep -A 5 "Scanning for GPU" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 7: Spinner has sleep delay
printf "  %-50s " "Spinner has animation delay..."
if grep -A 10 "Scanning for GPU" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "sleep 0.2"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 8: Spinner updates in loop
printf "  %-50s " "Spinner updates in while loop..."
if grep -A 10 "Scanning for GPU" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "while kill -0.*_gpu_pid"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo ""
echo "3. Integration Tests"
echo "────────────────────"

# Test 9: GPU detection still happens
printf "  %-50s " "detect_gpu function still called..."
if grep -q "detect_gpu" "$ROOT_DIR/installers/phases/02-detection.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 10: GPU results still captured
printf "  %-50s " "GPU_BACKEND variable still set..."
if grep -A 20 "detect_gpu" "$ROOT_DIR/installers/phases/02-detection.sh" | grep -q "GPU_BACKEND"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo ""
echo "═══════════════════════════════════════════"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed${NC} ($PASSED/$((PASSED + FAILED)))"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC} ($PASSED passed, $FAILED failed)"
    echo ""
    exit 1
fi
