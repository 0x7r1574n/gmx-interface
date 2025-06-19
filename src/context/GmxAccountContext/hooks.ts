import { Context, useContextSelector } from "use-context-selector";

import { GmxAccountContext, context } from "./GmxAccountContext";
import {
  selectGmxAccountDepositViewChain,
  selectGmxAccountDepositViewTokenAddress,
  selectGmxAccountDepositViewTokenInputValue,
  selectGmxAccountModalOpen,
  selectGmxAccountSelectedTransferGuid,
  selectGmxAccountSetDepositViewChain,
  selectGmxAccountSetDepositViewTokenAddress,
  selectGmxAccountSetDepositViewTokenInputValue,
  selectGmxAccountSetModalOpen,
  selectGmxAccountSetSelectedTransferGuid,
  selectGmxAccountSetSettlementChainId,
  selectGmxAccountSetWithdrawViewChainId,
  selectGmxAccountSetWithdrawViewTokenAddress,
  selectGmxAccountSetWithdrawViewTokenInputValue,
  selectGmxAccountSettlementChainId,
  selectGmxAccountWithdrawViewChainId,
  selectGmxAccountWithdrawViewTokenAddress,
  selectGmxAccountWithdrawViewTokenInputValue,
} from "./selectors";

export function useGmxAccountSelector<Selected>(selector: (s: GmxAccountContext) => Selected) {
  return useContextSelector(context as Context<GmxAccountContext>, selector) as Selected;
}

export function useGmxAccountModalOpen() {
  return [
    useGmxAccountSelector(selectGmxAccountModalOpen),
    useGmxAccountSelector(selectGmxAccountSetModalOpen),
  ] as const;
}

/**
 * If you just need the settlement chain id and not updating it, use `useChainId` instead
 */
export function useGmxAccountSettlementChainId() {
  return [
    useGmxAccountSelector(selectGmxAccountSettlementChainId),
    useGmxAccountSelector(selectGmxAccountSetSettlementChainId),
  ] as const;
}

export function useGmxAccountDepositViewChain() {
  return [
    useGmxAccountSelector(selectGmxAccountDepositViewChain),
    useGmxAccountSelector(selectGmxAccountSetDepositViewChain),
  ] as const;
}

export function useGmxAccountDepositViewTokenAddress() {
  return [
    useGmxAccountSelector(selectGmxAccountDepositViewTokenAddress),
    useGmxAccountSelector(selectGmxAccountSetDepositViewTokenAddress),
  ] as const;
}

export function useGmxAccountDepositViewTokenInputValue() {
  return [
    useGmxAccountSelector(selectGmxAccountDepositViewTokenInputValue),
    useGmxAccountSelector(selectGmxAccountSetDepositViewTokenInputValue),
  ] as const;
}

export function useGmxAccountWithdrawViewChainId() {
  return [
    useGmxAccountSelector(selectGmxAccountWithdrawViewChainId),
    useGmxAccountSelector(selectGmxAccountSetWithdrawViewChainId),
  ] as const;
}

export function useGmxAccountWithdrawViewTokenAddress() {
  return [
    useGmxAccountSelector(selectGmxAccountWithdrawViewTokenAddress),
    useGmxAccountSelector(selectGmxAccountSetWithdrawViewTokenAddress),
  ] as const;
}

export function useGmxAccountWithdrawViewTokenInputValue() {
  return [
    useGmxAccountSelector(selectGmxAccountWithdrawViewTokenInputValue),
    useGmxAccountSelector(selectGmxAccountSetWithdrawViewTokenInputValue),
  ] as const;
}

export function useGmxAccountSelectedTransferGuid() {
  return [
    useGmxAccountSelector(selectGmxAccountSelectedTransferGuid),
    useGmxAccountSelector(selectGmxAccountSetSelectedTransferGuid),
  ] as const;
}
