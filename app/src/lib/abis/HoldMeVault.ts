export const holdMeVaultAbi = [
  // ── View: constants ───────────────────────────────────────────────────────
  {
    name: "MIN_AMOUNT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "MAX_AMOUNT",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "FEE_BPS",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "feeRecipient",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  // ── Write ─────────────────────────────────────────────────────────────────
  {
    name: "createHold",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "holdSeconds", type: "uint256" },
    ],
    outputs: [{ name: "holdId", type: "uint256" }],
  },
  {
    name: "bringBack",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "holdId", type: "uint256" }],
    outputs: [],
  },
  // ── View: queries ─────────────────────────────────────────────────────────
  {
    name: "getHoldsForOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    name: "getHold",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "holdId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "grossAmount", type: "uint256" },
          { name: "feeAmount", type: "uint256" },
          { name: "returnAmount", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "returnAt", type: "uint256" },
          { name: "returned", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getHoldCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    name: "HoldCreated",
    type: "event",
    inputs: [
      { name: "holdId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "grossAmount", type: "uint256", indexed: false },
      { name: "feeAmount", type: "uint256", indexed: false },
      { name: "returnAmount", type: "uint256", indexed: false },
      { name: "createdAt", type: "uint256", indexed: false },
      { name: "returnAt", type: "uint256", indexed: false },
    ],
  },
  {
    name: "HoldReturned",
    type: "event",
    inputs: [
      { name: "holdId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "returnedAt", type: "uint256", indexed: false },
    ],
  },
] as const;

// Solidity struct type inferred from ABI
export type HoldStruct = {
  owner: `0x${string}`;
  grossAmount: bigint;
  feeAmount: bigint;
  returnAmount: bigint;
  createdAt: bigint;
  returnAt: bigint;
  returned: boolean;
};
