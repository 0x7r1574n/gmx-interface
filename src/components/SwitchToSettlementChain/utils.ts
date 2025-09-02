import { SourceChainId } from "config/chains";
import { isSourceChain, isSettlementChain } from "config/multichain";

export function needSwitchToSettlementChain(walletChainId: number | undefined): walletChainId is SourceChainId {
  return Boolean(walletChainId && isSourceChain(walletChainId) && !isSettlementChain(walletChainId));
}
