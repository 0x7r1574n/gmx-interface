import { arbitrum, avalanche, avalancheFuji, Chain } from "viem/chains";

export const AVALANCHE = 43114;
export const AVALANCHE_FUJI = 43113;
export const ARBITRUM = 42161;
export const BSС_MAINNET = 56;
export const BSС_TESTNET = 97;
export const ETH_MAINNET = 1;

export const SUPPORTED_CHAIN_IDS = [ARBITRUM, AVALANCHE];
export const SUPPORTED_CHAIN_IDS_DEV = [...SUPPORTED_CHAIN_IDS, AVALANCHE_FUJI];

export const CHAIN_NAMES_MAP = {
  [BSС_MAINNET]: "BSC",
  [BSС_TESTNET]: "BSC Testnet",
  [ARBITRUM]: "Arbitrum",
  [AVALANCHE]: "Avalanche",
  [AVALANCHE_FUJI]: "Avalanche Fuji",
};

export const HIGH_EXECUTION_FEES_MAP: Record<number, number> = {
  [ARBITRUM]: 5, // 5 USD
  [AVALANCHE]: 5, // 5 USD
  [AVALANCHE_FUJI]: 5, // 5 USD
};

// added to maxPriorityFeePerGas
// applied to EIP-1559 transactions only
// is not applied to execution fee calculation
export const MAX_FEE_PER_GAS_MAP: Record<number, bigint> = {
  [AVALANCHE]: 200000000000n, // 200 gwei
};

// added to maxPriorityFeePerGas
// applied to EIP-1559 transactions only
// is also applied to the execution fee calculation
export const GAS_PRICE_PREMIUM_MAP: Record<number, bigint> = {
  [ARBITRUM]: 0n,
  [AVALANCHE]: 6000000000n, // 6 gwei
};

/*
  that was a constant value in ethers v5, after ethers v6 migration we use it as a minimum for maxPriorityFeePerGas
*/
export const MAX_PRIORITY_FEE_PER_GAS_MAP: Record<number, bigint | undefined> = {
  [ARBITRUM]: 1500000000n,
  [AVALANCHE]: 1500000000n,
  [AVALANCHE_FUJI]: 1500000000n,
};

export const EXCESSIVE_EXECUTION_FEES_MAP: Record<number, number> = {
  [ARBITRUM]: 10, // 10 USD
  [AVALANCHE]: 10, // 10 USD
  [AVALANCHE_FUJI]: 10, // 10 USD
};

// added to gasPrice
// applied to *non* EIP-1559 transactions only
//
// it is *not* applied to the execution fee calculation, and in theory it could cause issues
// if gas price used in the execution fee calculation is lower
// than the gas price used in the transaction (e.g. create order transaction)
// then the transaction will fail with InsufficientExecutionFee error.
// it is not an issue on Arbitrum though because the passed gas price does not affect the paid gas price.
// for example if current gas price is 0.1 gwei and UI passes 0.5 gwei the transaction
// Arbitrum will still charge 0.1 gwei per gas
//
// it doesn't make much sense to set this buffer higher than the execution fee buffer
// because if the paid gas price is higher than the gas price used in the execution fee calculation
// and the transaction will still fail with InsufficientExecutionFee
//
// this buffer could also cause issues on a blockchain that uses passed gas price
// especially if execution fee buffer and lower than gas price buffer defined bellow
export const GAS_PRICE_BUFFER_MAP: Record<number, bigint> = {
  [ARBITRUM]: 2000n, // 20%
};

const VIEM_CHAIN_BY_CHAIN_ID: Record<number, Chain> = {
  [AVALANCHE_FUJI]: avalancheFuji,
  [ARBITRUM]: arbitrum,
  [AVALANCHE]: avalanche,
};

export function getChainName(chainId: number) {
  return CHAIN_NAMES_MAP[chainId];
}

export const getViemChain = (chainId: number): Chain => {
  return VIEM_CHAIN_BY_CHAIN_ID[chainId];
};

export function getHighExecutionFee(chainId: number) {
  return HIGH_EXECUTION_FEES_MAP[chainId] ?? 5;
}

export function getExcessiveExecutionFee(chainId: number) {
  return EXCESSIVE_EXECUTION_FEES_MAP[chainId] ?? 10;
}

export function isSupportedChain(chainId: number, dev = false) {
  return (dev ? SUPPORTED_CHAIN_IDS_DEV : SUPPORTED_CHAIN_IDS).includes(chainId);
}

export const EXECUTION_FEE_CONFIG_V2: {
  [chainId: number]: {
    shouldUseMaxPriorityFeePerGas: boolean;
    defaultBufferBps?: number;
  };
} = {
  [AVALANCHE]: {
    shouldUseMaxPriorityFeePerGas: true,
    defaultBufferBps: 1000, // 10%
  },
  [AVALANCHE_FUJI]: {
    shouldUseMaxPriorityFeePerGas: true,
    defaultBufferBps: 1000, // 10%
  },
  [ARBITRUM]: {
    shouldUseMaxPriorityFeePerGas: false,
    defaultBufferBps: 3000, // 30%
  },
};

export const GAS_LIMITS_STATIC_CONFIG = {
  [ARBITRUM]: {
    createOrderGasLimit: 1_000_000n,
    updateOrderGasLimit: 800_000n,
    cancelOrderGasLimit: 700_000n,
    tokenPermitGasLimit: 90_000n,
  },
  [AVALANCHE]: {
    createOrderGasLimit: 1_000_000n,
    updateOrderGasLimit: 800_000n,
    cancelOrderGasLimit: 700_000n,
    tokenPermitGasLimit: 90_000n,
  },
  [AVALANCHE_FUJI]: {
    createOrderGasLimit: 1_000_000n,
    updateOrderGasLimit: 800_000n,
    cancelOrderGasLimit: 700_000n,
    tokenPermitGasLimit: 90_000n,
  },
};
