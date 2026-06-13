# HoldMe — common dev commands
# Requires: forge in PATH (run `source ~/.bashrc` after Foundry install)
#           Node.js 18+, npm
#
# Env vars are loaded from .env if it exists.
ifneq (,$(wildcard .env))
    include .env
    export
endif

.PHONY: build test test-v test-gas anvil deploy-local deploy-sepolia deploy-mainnet dev build-app lint help

# ── Contracts ─────────────────────────────────────────────────────────────────

build:
	cd contracts && forge build

test:
	cd contracts && forge test

test-v:
	cd contracts && forge test -vvv

test-gas:
	cd contracts && forge test --gas-report

anvil:
	anvil

deploy-local:
	@test -n "$(PRIVATE_KEY)"             || (echo "Error: PRIVATE_KEY not set" && exit 1)
	@test -n "$(FEE_RECIPIENT_ADDRESS)"   || (echo "Error: FEE_RECIPIENT_ADDRESS not set" && exit 1)
	@test -n "$(VALIDATION_WALLET_ADDRESS)" || (echo "Error: VALIDATION_WALLET_ADDRESS not set" && exit 1)
	cd contracts && forge script script/LocalDeploy.s.sol \
	  --rpc-url http://127.0.0.1:8545 \
	  --private-key $(PRIVATE_KEY) \
	  --broadcast

deploy-sepolia:
	@test -n "$(PRIVATE_KEY)"             || (echo "Error: PRIVATE_KEY not set" && exit 1)
	@test -n "$(BASE_SEPOLIA_RPC_URL)"    || (echo "Error: BASE_SEPOLIA_RPC_URL not set" && exit 1)
	@test -n "$(USDC_ADDRESS)"            || (echo "Error: USDC_ADDRESS not set" && exit 1)
	@test -n "$(FEE_RECIPIENT_ADDRESS)"   || (echo "Error: FEE_RECIPIENT_ADDRESS not set" && exit 1)
	@test -n "$(VALIDATION_WALLET_ADDRESS)" || (echo "Error: VALIDATION_WALLET_ADDRESS not set" && exit 1)
	cd contracts && forge script script/Deploy.s.sol \
	  --rpc-url $(BASE_SEPOLIA_RPC_URL) \
	  --private-key $(PRIVATE_KEY) \
	  --broadcast

deploy-mainnet:
	@test -n "$(PRIVATE_KEY)"             || (echo "Error: PRIVATE_KEY not set — use your burner deployer key" && exit 1)
	@test -n "$(BASE_RPC_URL)"            || (echo "Error: BASE_RPC_URL not set" && exit 1)
	@test -n "$(USDC_ADDRESS)"            || (echo "Error: USDC_ADDRESS not set" && exit 1)
	@test -n "$(FEE_RECIPIENT_ADDRESS)"   || (echo "Error: FEE_RECIPIENT_ADDRESS not set" && exit 1)
	@test -n "$(VALIDATION_WALLET_ADDRESS)" || (echo "Error: VALIDATION_WALLET_ADDRESS not set" && exit 1)
	cd contracts && forge script script/Deploy.s.sol \
	  --rpc-url $(BASE_RPC_URL) \
	  --private-key $(PRIVATE_KEY) \
	  --broadcast

# ── Frontend ──────────────────────────────────────────────────────────────────

dev:
	cd app && npm run dev

build-app:
	cd app && npm run build

lint:
	cd app && npm run lint

# ── Help ──────────────────────────────────────────────────────────────────────

help:
	@echo "Contract commands:"
	@echo "  make build          - Compile contracts"
	@echo "  make test           - Run all contract tests"
	@echo "  make test-v         - Run tests with verbose output"
	@echo "  make test-gas       - Run tests with gas report"
	@echo "  make anvil          - Start local Anvil node"
	@echo "  make deploy-local   - Deploy MockUSDC + HoldMeVault to local Anvil"
	@echo "  make deploy-sepolia - Deploy HoldMeVault to Base Sepolia"
	@echo "  make deploy-mainnet - Deploy HoldMeVault to Base mainnet (burner key required)"
	@echo ""
	@echo "Frontend commands:"
	@echo "  make dev            - Start Next.js dev server"
	@echo "  make build-app      - Production build"
	@echo "  make lint           - Run ESLint"
