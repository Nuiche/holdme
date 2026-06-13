import { createConfig, http } from "wagmi";
import { base, baseSepolia, foundry } from "wagmi/chains";
import { injected, walletConnect, coinbaseWallet } from "wagmi/connectors";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia, foundry],
  connectors: [
    injected(),
    coinbaseWallet({ appName: "HoldMe" }),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    [base.id]:       http(),
    [baseSepolia.id]: http(),
    [foundry.id]:    http("http://127.0.0.1:8545"),
  },
  ssr: true,
});
