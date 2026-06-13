# HoldMe

A mobile-first crypto app that lets you set aside Base USDC and bring it back after a chosen return period.

Connect your wallet, choose an amount and a number of days, confirm the transaction, and come back later to bring your funds back. No early returns. No admin access. Only your wallet can bring it back.

---

## Key rules

| Rule | Detail |
|---|---|
| Supported asset | USDC on Base only |
| Minimum hold | 10 USDC |
| Maximum hold | 500 USDC **per hold** (no per-wallet cap — create multiple holds) |
| Duration | 1–30 days |
| Fee | 1% of amount, capped at 100 USDC, taken upfront |
| Approval | Exact amount per hold — no broad allowance |
| Return | Manual: you click "Bring it back" after the return time |
| Who can bring back | Only the wallet that created the hold |
| Early return | Not possible — enforced by the contract |
| Auto-return | Does not exist — you must initiate |
| Validation wallet | One designated wallet may create 1–60 minute holds for end-to-end testing |

---

## Wallet roles

Three distinct wallets are involved. Keep them separate.

| Role | Wallet | Private key needed? |
|---|---|---|
| **Deployer** | Fresh burner wallet, created only for deployment. Holds a small amount of Base ETH for gas. Can be discarded after the contract is deployed and verified. | Yes — in `.env` locally, never shared, never committed |
| **Fee recipient** | Your Phantom wallet (`0xB8166521a602bF4Dd4748D76864Dc06336EB5729`). Receives 1% upfront fees. Never used for deployment. | No |
| **Validation wallet** | Same address as fee recipient in this setup. Permitted by the contract to create minute-range holds for testing. | No — only used to connect to the UI |

The deployer wallet's private key goes in `.env` as `PRIVATE_KEY`. It has no relationship to the fee recipient or validation wallet.

---

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity ^0.8.24, Foundry |
| Contract libraries | OpenZeppelin (SafeERC20, ReentrancyGuard) |
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4 |
| Wallet / chain | viem, wagmi v3, WalletConnect |
| Target chain | Base mainnet · Base Sepolia testnet · Anvil local |
| Asset | USDC (6-decimal ERC-20) |

---

## Contract

### Constructor

```solidity
constructor(address _usdc, address _feeRecipient, address _validationWallet)
```

| Argument | Description |
|---|---|
| `_usdc` | USDC token contract address on the target chain |
| `_feeRecipient` | Wallet that receives the 1% upfront fee |
| `_validationWallet` | Wallet permitted to create minute-range holds for testing |

All three arguments must be non-zero. No addresses are hardcoded in the contract.

### Behavior summary

- `createHold(uint256 amount, uint256 holdSeconds)` — transfers `amount` USDC from the caller. 1% fee sent to `feeRecipient` immediately. Remainder held until `block.timestamp + holdSeconds`.
- `bringBack(uint256 holdId)` — returns the hold amount to the original caller. Reverts if the return time has not passed, if already returned, or if the caller is not the hold owner.
- `getHoldsForOwner(address owner)` — returns all hold IDs owned by `owner`.

---

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) — `forge`, `cast`, `anvil`
- Node.js 18+
- A browser wallet (MetaMask, Coinbase Wallet, or similar)

After installing Foundry, add it to your PATH:

```bash
source ~/.bashrc   # or source ~/.zshrc
```

Verify:

```bash
forge --version
anvil --version
```

---

## Setup

```bash
git clone <repo-url>
cd holdme

# Install contract dependencies
cd contracts && forge install && cd ..

# Install frontend dependencies
cd app && npm install && cd ..

# Copy env file
cp .env.example .env
```

---

## Running locally with Anvil

### Step 1 — Start Anvil

```bash
make anvil
# or: anvil
```

Anvil starts on `http://127.0.0.1:8545`. It prints 10 test accounts with private keys. Copy one private key to use for deployment.

### Step 2 — Set env vars in `.env`

```
PRIVATE_KEY=<one of the private keys Anvil printed>
FEE_RECIPIENT_ADDRESS=0xB8166521a602bF4Dd4748D76864Dc06336EB5729
VALIDATION_WALLET_ADDRESS=0xB8166521a602bF4Dd4748D76864Dc06336EB5729
MINT_TO=<the wallet address you want to test with>
```

`MINT_TO` defaults to `FEE_RECIPIENT_ADDRESS` if omitted. Set it to whichever wallet you plan to connect in the browser.

### Step 3 — Deploy MockUSDC + HoldMeVault

```bash
make deploy-local
```

The script deploys MockUSDC, deploys HoldMeVault, and mints 10,000 test USDC to `MINT_TO`. It prints the deployed addresses at the end, for example:

```
MockUSDC deployed   : 0x5FbDB2315678afecb367f032d93F642f64180aa3
HoldMeVault deployed: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
```

### Step 4 — Create `app/.env.local`

```
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_USDC_ADDRESS=<MockUSDC address from step 3>
NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS=<HoldMeVault address from step 3>
```

No WalletConnect project ID is needed for local testing with an injected wallet.

### Step 5 — Start the frontend

```bash
make dev
# or: cd app && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect your browser wallet to the Anvil network (`http://127.0.0.1:8545`, chain ID 31337). Import one of the Anvil test private keys into MetaMask if needed.

### Step 6 — Test a hold

1. Connect the wallet you minted USDC to.
2. Enter an amount (10–500).
3. If your connected wallet is the validation wallet, minute-range options appear.
4. Select a duration.
5. Click "Approve this amount" — approve the exact hold amount.
6. Click "Hold it for me" — confirm the transaction.
7. Go to `/holds` to see your hold.
8. Wait for the return time, then click "Bring it back."

---

## Deploying to Base Sepolia

### Step 1 — Get Base Sepolia ETH

Use the [Base Sepolia faucet](https://docs.base.org/tools/network-faucets) to fund your deployer wallet.

### Step 2 — Choose a testnet USDC

**Option A — Deploy MockUSDC to Base Sepolia (simplest)**

You can deploy MockUSDC to Base Sepolia using `LocalDeploy.s.sol` with `--rpc-url $BASE_SEPOLIA_RPC_URL`. MockUSDC is a fully functional ERC-20 with a public `mint()` function, identical to what the tests use.

**Option B — Circle testnet USDC**

Circle provides a USDC testnet faucet at [faucet.circle.com](https://faucet.circle.com). Select the Base Sepolia network to receive testnet USDC. Copy the USDC contract address from the faucet UI — it changes periodically.

### Step 3 — Set env vars in `.env`

```
PRIVATE_KEY=<deployer private key>
BASE_SEPOLIA_RPC_URL=<your Base Sepolia RPC URL>
USDC_ADDRESS=<testnet USDC address from step 2>
FEE_RECIPIENT_ADDRESS=0xB8166521a602bF4Dd4748D76864Dc06336EB5729
VALIDATION_WALLET_ADDRESS=0xB8166521a602bF4Dd4748D76864Dc06336EB5729
```

RPC URLs: [Alchemy](https://www.alchemy.com), [Infura](https://www.infura.io), [QuickNode](https://www.quicknode.com), or the public endpoint `https://sepolia.base.org`.

### Step 4 — Deploy HoldMeVault

```bash
make deploy-sepolia
```

The script prints the deployed contract address. Copy it.

### Step 5 — Create `app/.env.local`

```
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS=<deployed contract address>
NEXT_PUBLIC_USDC_ADDRESS=<testnet USDC address>
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<optional — from cloud.walletconnect.com>
```

### Step 6 — Start the frontend and test

```bash
make dev
```

Connect your wallet to Base Sepolia. The header shows "Switch to Base Sepolia" if your wallet is on the wrong network.

---

## Testing the validation wallet flow

The validation wallet (`0xB8166521a602bF4Dd4748D76864Dc06336EB5729`) can create holds as short as 1 minute. This is enforced on-chain.

**To test a 1-minute hold:**

1. Connect the validation wallet to the app.
2. A section labeled "Validation options" appears in the form with 1–60 minute durations.
3. Enter an amount and select "1 min."
4. Approve and create the hold.
5. Wait one minute, then go to `/holds`.
6. Click "Bring it back."

**To confirm non-validation wallets cannot use minute holds:**

Any other wallet that tries to call `createHold` with `holdSeconds < 86400` will receive a `DurationBelowMinimum` revert from the contract. The UI simply does not show the minute options for non-validation wallets.

**To test a normal 1-day hold from a different wallet:**

1. Use a separate wallet (not the validation wallet).
2. The minute-range options are not shown.
3. Select "1 day" and complete the flow.
4. The hold matures after 1 day.

---

## Deploying to production (Vercel + holdme.dev)

This section covers hosting the frontend on Vercel and pointing holdme.dev at it. Deploy the contract to Base mainnet first (see mainnet checklist below), then follow these steps.

### Step 1 — Push to GitHub

Make sure your repo is on GitHub and the `main` branch is up to date.

### Step 2 — Create a Vercel project

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New → Project**.
3. Import your GitHub repo.
4. Set **Root Directory** to `app` (the Next.js app lives there, not the project root).
5. Framework will be detected as Next.js automatically.
6. Do not deploy yet — set env vars first (step 4).

### Step 3 — Add holdme.dev to Vercel

1. In your Vercel project, go to **Settings → Domains**.
2. Add `holdme.dev`.
3. Add `www.holdme.dev` as well (Vercel will redirect it to the apex or vice versa — choose your preference).
4. Vercel will display the exact DNS records it needs. **Use those records — do not guess.**

The records are typically:

| Type | Name | Value |
|---|---|---|
| A | `@` (apex) | `76.76.21.21` |
| CNAME | `www` | `cname.vercel-dns.com` |

> **Important:** Vercel's required records can change. Always use the exact records shown in your Vercel dashboard, not the values above.

### Step 4 — Configure DNS at your registrar

1. Log in to wherever you registered holdme.dev.
2. Go to DNS settings for holdme.dev.
3. Add the A record and CNAME exactly as Vercel showed them.
4. Save. DNS propagation typically takes a few minutes to a few hours.
5. Back in Vercel → Settings → Domains, the status will change to "Valid" once propagation is complete.

### Step 5 — Set production environment variables in Vercel

In your Vercel project, go to **Settings → Environment Variables**. Add the following for the **Production** environment:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `8453` |
| `NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS` | Your deployed HoldMeVault address on Base mainnet |
| `NEXT_PUBLIC_USDC_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Your WalletConnect Cloud project ID (if used) |

Do not set `PRIVATE_KEY` or any deployment secrets in Vercel — they are not needed at runtime.

### Step 6 — Deploy

Trigger a deployment from the Vercel dashboard (or push a commit to `main`). Vercel builds from the `app/` directory. The build runs `next build` — same as `make build-app`.

Once deployed, visit holdme.dev. The app should load, connect to Base mainnet, and show the live contract.

---

## Environment variables

Copy `.env.example` to `.env`. Never commit `.env`.

### Frontend (`NEXT_PUBLIC_` prefix — included in the browser bundle)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | `31337` = Anvil, `84532` = Base Sepolia, `8453` = Base mainnet |
| `NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS` | Deployed `HoldMeVault` address |
| `NEXT_PUBLIC_USDC_ADDRESS` | USDC token address on the target chain |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID (optional) |

### Deployment (server-side / shell only — not exposed to the browser)

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Deployer private key — never commit |
| `BASE_RPC_URL` | Base mainnet RPC endpoint |
| `BASE_SEPOLIA_RPC_URL` | Base Sepolia RPC endpoint |
| `FEE_RECIPIENT_ADDRESS` | Wallet that receives upfront fees |
| `VALIDATION_WALLET_ADDRESS` | Wallet permitted to create minute-range holds |
| `USDC_ADDRESS` | USDC address for `Deploy.s.sol` (testnet/mainnet) |
| `MINT_TO` | Address to receive minted USDC in `LocalDeploy.s.sol` (optional) |

---

## Commands

### Make targets (from project root)

```bash
make build          # Compile contracts
make test           # Run all 63 contract tests
make test-v         # Verbose test output
make test-gas       # Gas report
make anvil          # Start local Anvil node
make deploy-local   # Deploy MockUSDC + HoldMeVault to Anvil
make deploy-sepolia # Deploy HoldMeVault to Base Sepolia
make dev            # Start Next.js dev server
make build-app      # Production frontend build
make lint           # Run ESLint
```

### Direct contract commands (from `contracts/`)

```bash
forge build
forge test
forge test -vvv
forge test --match-test <pattern>
forge test --gas-report
forge coverage

# Deploy to Anvil
forge script script/LocalDeploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key $PRIVATE_KEY \
  --broadcast

# Deploy to Base Sepolia
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### Direct frontend commands (from `app/`)

```bash
npm run dev
npm run build
npm run lint
```

---

## Live deployment procedure

Follow these steps in order when you are ready to deploy to Base mainnet.

### Phase A — Prepare

- [ ] All 63 contract tests pass locally: `make test`
- [ ] Frontend builds clean: `make build-app`
- [ ] Full end-to-end flow tested on Base Sepolia — hold creation, wait, bring-back
- [ ] Validation wallet flow tested on Base Sepolia — 1-minute hold created and returned
- [ ] Contract reviewed or audited by a trusted third party

### Phase B — Burner deployer wallet

- [ ] Create a **fresh wallet** using MetaMask, cast, or any wallet tool — this is your burner deployer
- [ ] **Do not use your Phantom wallet or any wallet that holds real funds as the deployer**
- [ ] Fund the burner deployer with a small amount of Base ETH (0.005 ETH is sufficient for a single deploy)
- [ ] Write down the burner deployer address for your records
- [ ] Add only the burner deployer's private key to your local `.env` as `PRIVATE_KEY`
- [ ] Confirm `.env` is in `.gitignore` and will not be committed

### Phase C — Set deployment env vars in `.env`

```
PRIVATE_KEY=<burner deployer private key>
BASE_RPC_URL=<your Base mainnet RPC URL>
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
FEE_RECIPIENT_ADDRESS=0xB8166521a602bF4Dd4748D76864Dc06336EB5729
VALIDATION_WALLET_ADDRESS=0xB8166521a602bF4Dd4748D76864Dc06336EB5729
```

- [ ] `FEE_RECIPIENT_ADDRESS` is your Phantom wallet — confirmed you control it
- [ ] `VALIDATION_WALLET_ADDRESS` is the same — confirmed
- [ ] `USDC_ADDRESS` is native Base USDC — double-checked against [basescan.org](https://basescan.org)

### Phase D — Deploy to Base mainnet

Add a `deploy-mainnet` target to Makefile or run directly:

```bash
cd contracts && forge script script/Deploy.s.sol \
  --rpc-url $BASE_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

- [ ] Review the printed constructor arguments before confirming broadcast
- [ ] Copy the deployed `HoldMeVault` address from the output
- [ ] Verify the contract on BaseScan: `forge verify-contract <address> src/HoldMeVault.sol:HoldMeVault --chain 8453`
- [ ] Confirm on BaseScan that `feeRecipient` and `validationWallet` are the correct addresses
- [ ] Burner deployer wallet can now be discarded — it has no further role

### Phase E — Vercel production env vars

In Vercel → Settings → Environment Variables (Production):

- [ ] `NEXT_PUBLIC_CHAIN_ID` = `8453`
- [ ] `NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS` = deployed contract address from Phase D
- [ ] `NEXT_PUBLIC_USDC_ADDRESS` = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- [ ] `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` = your WalletConnect project ID (if used)

### Phase F — Deploy frontend and verify

- [ ] Trigger a Vercel deployment (push to `main` or redeploy from dashboard)
- [ ] Visit holdme.dev — confirm it loads
- [ ] Connect the validation wallet to holdme.dev
- [ ] Confirm the chain shown is Base (not Base Sepolia)
- [ ] Create a real hold with a small amount (10 USDC) using a 1-day duration
- [ ] Verify the transaction on BaseScan
- [ ] Verify the hold appears on `/holds`

---

## Security assumptions

1. Only the wallet that created a hold can bring it back. Enforced on-chain.
2. Funds cannot be returned before the hold's `returnAt` timestamp. Enforced on-chain.
3. A hold can only be returned once. The `returned` flag is set before the transfer (CEI pattern).
4. There is no admin function to access user funds. The contract has no such method.
5. The fee recipient receives only the upfront fee at hold creation. It has no further access.
6. The contract is not upgradeable. There is no proxy, no owner role, and no `selfdestruct`.
7. The contract uses `SafeERC20` for all token transfers.
8. The contract uses `ReentrancyGuard` on all state-changing external functions.
9. USDC approval is exact per hold — the user approves only the amount they intend to hold.
10. All rules (amount limits, duration limits, ownership, timing) are enforced in the contract. The frontend is not trusted for enforcement.

---

## Known limitations

- USDC on Base only. No other tokens, no other chains.
- No early return under any circumstances. Enforced by the contract.
- No auto-return. You must come back to the app and click "Bring it back."
- Only the creating wallet can bring back a hold. If you lose wallet access before the hold matures, funds become inaccessible.
- 500 USDC maximum per individual hold. No per-wallet cap — you may create multiple holds.
- 10 USDC minimum per hold.
- Hold periods are 1–30 days for all wallets. The validation wallet may also use 1–60 minute holds.
- HoldMe is not a bank, financial product, or licensed service.
- HoldMe does not provide financial, legal, medical, or investment advice.
