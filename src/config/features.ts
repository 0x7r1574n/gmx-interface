import { ARBITRUM, ARBITRUM_SEPOLIA, AVALANCHE, BOTANIX } from "./chains";

export function getIsV1Supported(chainId: number) {
  return [AVALANCHE, ARBITRUM].includes(chainId);
}

export function getIsExpressSupported(chainId: number) {
  return [AVALANCHE, ARBITRUM, BOTANIX, ARBITRUM_SEPOLIA].includes(chainId);
}
