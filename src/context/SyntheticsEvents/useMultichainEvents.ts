import keyBy from "lodash/keyBy";
import pickBy from "lodash/pickBy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { getChainName, SourceChainId } from "config/chains";
import { getContract } from "config/contracts";
import { CHAIN_ID_TO_TOKEN_ID_MAP, getMappedTokenId, isSettlementChain, MultichainTokenId } from "config/multichain";
import { ENDPOINT_ID_TO_CHAIN_ID } from "config/multichain";
import { useGmxAccountSelectedTransferGuid } from "context/GmxAccountContext/hooks";
import {
  subscribeToComposeDeliveredEvents,
  subscribeToMultichainApprovalEvents,
  subscribeToOftReceivedEvents,
  subscribeToOftSentEvents,
} from "context/WebsocketContext/subscribeToEvents";
import { useWebsocketProvider, useWsAdditionalSourceChains } from "context/WebsocketContext/WebsocketContextProvider";
import { CodecUiHelper } from "domain/multichain/codecs/CodecUiHelper";
import { MultichainFundingHistoryItem } from "domain/multichain/types";
import { isStepGreater } from "domain/multichain/useGmxAccountFundingHistory";
import { useChainId } from "lib/chains";
import {
  getMultichainDepositMetricId,
  getMultichainWithdrawalMetricId,
  metrics,
  MultichainDepositMetricData,
  MultichainWithdrawalMetricData,
  sendOrderExecutedMetric,
} from "lib/metrics";
import { EMPTY_OBJECT } from "lib/objects";
import { sendMultichainDepositSuccessEvent, sendMultichainWithdrawalSuccessEvent } from "lib/userAnalytics/utils";
import { getToken } from "sdk/configs/tokens";
import { LRUCache } from "sdk/utils/LruCache";
import { nowInSeconds } from "sdk/utils/time";

import { useSyntheticsEvents } from "./SyntheticsEventsProvider";
import type {
  ApprovalStatuses,
  PendingMultichainFunding,
  SubmittedMultichainDeposit,
  SubmittedMultichainWithdrawal,
} from "./types";

export type MultichainEventsState = {
  multichainSourceChainApprovalStatuses: ApprovalStatuses;
  setMultichainSourceChainApprovalsActiveListener: (chainId: SourceChainId, name: string) => void;
  removeMultichainSourceChainApprovalsActiveListener: (chainId: SourceChainId, name: string) => void;

  pendingMultichainFunding: PendingMultichainFunding;
  setMultichainSubmittedDeposit: (submittedDeposit: SubmittedMultichainDeposit) => string | undefined;
  setMultichainSubmittedWithdrawal: (submittedWithdrawal: SubmittedMultichainWithdrawal) => string | undefined;
  setMultichainWithdrawalSentTxnHash: (mockId: string, txnHash: string) => void;
  setMultichainWithdrawalSentError: (mockId: string) => void;
  updatePendingMultichainFunding: (items: MultichainFundingHistoryItem[]) => void;

  multichainFundingPendingIds: Record<
    // Stub id for persistence
    string,
    // Stub id or real guid
    string
  >;

  removeMultichainFundingPendingIds: (id: string | string[]) => void;
};

const DEFAULT_MULTICHAIN_FUNDING_STATE: PendingMultichainFunding = {
  deposits: {
    // TODO MLTCH: make object
    submitted: [],
    sent: {},
    received: {},
    executed: {},
  },
  withdrawals: {
    submitted: {},
    sent: {},
    received: {},
  },
};

const UNCERTAIN_WITHDRAWALS_CACHE = new LRUCache<string>(1000);

const FINISHED_FUNDING_ITEM_CLEARING_DELAY_MS = 5000;
const SUBSCRIPTION_MAX_TTL_MS = 5 * 60 * 1000;
const SOURCE_CHAIN_APPROVAL_LISTENER_CLEANUP_DELAY_MS = 1 * 60 * 1000;
const DEBUG_MULTICHAIN_EVENTS_LOGGING = false;

const debugLog = (...args: any[]) => {
  if (DEBUG_MULTICHAIN_EVENTS_LOGGING) {
    // eslint-disable-next-line no-console
    console.log("[multichain]", ...args);
  }
};

export function useMultichainEvents({ hasPageLostFocus }: { hasPageLostFocus: boolean }) {
  const [pendingMultichainFunding, setPendingMultichainFunding] = useState<PendingMultichainFunding>(
    DEFAULT_MULTICHAIN_FUNDING_STATE
  );
  const { chainId, srcChainId } = useChainId();

  const { address: currentAccount } = useAccount();

  const { wsProvider, wsSourceChainProviders } = useWebsocketProvider();
  const wsSourceChainProvider = srcChainId ? wsSourceChainProviders[srcChainId] : undefined;

  const [, setSelectedTransferGuid] = useGmxAccountSelectedTransferGuid();
  const [multichainFundingPendingIds, setMultichainFundingPendingIds] = useState<Record<string, string>>(EMPTY_OBJECT);

  const scheduleMultichainFundingItemClearing = useCallback(
    (executedGuids: string[]) => {
      setTimeout(() => {
        setMultichainFundingPendingIds((prev) => {
          return pickBy(prev, (value) => !executedGuids.includes(value));
        });
      }, FINISHED_FUNDING_ITEM_CLEARING_DELAY_MS);
    },
    [setMultichainFundingPendingIds]
  );

  const pendingReceiveDepositGuidsRef = useRef<string[]>([]);
  const pendingExecuteDepositGuidsRef = useRef<string[]>([]);
  const pendingReceiveWithdrawalGuidsRef = useRef<string[]>([]);

  const pendingReceiveDepositGuidsKey = useMemo(() => {
    const guids = Object.keys(pendingMultichainFunding.deposits.sent);
    pendingReceiveDepositGuidsRef.current = guids;
    return guids.join(",");
  }, [pendingMultichainFunding.deposits.sent]);

  const pendingExecuteDepositGuidsKey = useMemo(() => {
    const receivedGuids = Object.keys(pendingMultichainFunding.deposits.received);
    const sentGuids = Object.keys(pendingMultichainFunding.deposits.sent);
    const allGuids = [...receivedGuids, ...sentGuids];
    pendingExecuteDepositGuidsRef.current = allGuids;
    return allGuids.join(",");
  }, [pendingMultichainFunding.deposits.received, pendingMultichainFunding.deposits.sent]);

  const pendingReceiveWithdrawalGuidsKey = useMemo(() => {
    const guids = Object.keys(pendingMultichainFunding.withdrawals.sent);
    pendingReceiveWithdrawalGuidsRef.current = guids;
    return guids.join(",");
  }, [pendingMultichainFunding.withdrawals.sent]);

  //#region Deposits

  // TODO MLTCH: make send events listening regardless of srcChainId
  useEffect(
    function subscribeSourceChainOftSentEvents() {
      if (
        srcChainId === undefined ||
        hasPageLostFocus ||
        !currentAccount ||
        !wsSourceChainProvider ||
        !isSettlementChain(chainId)
      ) {
        return;
      }

      const tokenIdMap = CHAIN_ID_TO_TOKEN_ID_MAP[srcChainId];
      const sourceChainStargates = Object.values(tokenIdMap).map((tokenId) => tokenId.stargate);
      const tokenIdByStargate = keyBy(Object.values(tokenIdMap), (tokenId: MultichainTokenId) => tokenId.stargate);

      debugLog("subscribing to OFTSent events for", srcChainId);

      const unsubscribeFromOftSentEvents = subscribeToOftSentEvents(
        wsSourceChainProvider,
        currentAccount,
        sourceChainStargates,
        (info) => {
          const settlementChainId = ENDPOINT_ID_TO_CHAIN_ID[info.dstEid];

          if (settlementChainId !== chainId) {
            return;
          }

          const stargatePoolAddress = info.sender;
          const tokenId = tokenIdByStargate[stargatePoolAddress];

          const settlementChainTokenId = getMappedTokenId(tokenId.chainId, tokenId.address, chainId);
          const tokenAddress = settlementChainTokenId?.address;

          if (!tokenAddress) {
            throw new Error("No settlement chain token address for OFTSent event");
          }

          debugLog("got OFTSent event for", srcChainId, tokenAddress, info.txnHash);

          setPendingMultichainFunding((prev) => {
            const newPendingMultichainFunding: PendingMultichainFunding = structuredClone(prev);

            const currentSubmittingDepositIndex = newPendingMultichainFunding.deposits.submitted.findIndex(
              (deposit) => deposit.sentTxn === info.txnHash
            );

            if (currentSubmittingDepositIndex === -1) {
              // If there were no submitted order from UI we can not be sure if this sent event is related to GMX without parsing the whole transaction for events
              // If its really necessary we could fetch the tx to get PacketSent withing the same transaction event and parse the contents

              // eslint-disable-next-line no-console
              console.warn("Got OFTSent event but no deposits were submitted from UI");
              return prev;
            }

            const currentSubmittingDeposit =
              newPendingMultichainFunding.deposits.submitted[currentSubmittingDepositIndex];
            newPendingMultichainFunding.deposits.submitted.splice(currentSubmittingDepositIndex, 1);

            setSelectedTransferGuid((prev) => {
              if (!prev || prev !== currentSubmittingDeposit.id) {
                return prev;
              }

              return info.guid;
            });

            setMultichainFundingPendingIds((prev) => {
              if (currentSubmittingDeposit.id in prev) {
                return { ...prev, [currentSubmittingDeposit.id]: info.guid };
              }

              return prev;
            });

            newPendingMultichainFunding.deposits.sent[info.guid] = {
              account: currentAccount,
              sentAmount: info.amountSentLD,
              id: info.guid,
              sentTxn: info.txnHash,
              operation: "deposit",
              step: "sent",
              token: tokenAddress,
              sourceChainId: srcChainId,
              settlementChainId: chainId,
              sentTimestamp: currentSubmittingDeposit.sentTimestamp,

              executedTimestamp: undefined,
              executedTxn: undefined,
              isExecutionError: undefined,
              receivedAmount: undefined,
              receivedTimestamp: undefined,
              receivedTxn: undefined,

              isFromWs: true,
            };

            return newPendingMultichainFunding;
          });
        }
      );

      return function cleanup() {
        debugLog("unsubscribing from OFTSent events for", srcChainId);
        unsubscribeFromOftSentEvents();
      };
    },
    [chainId, currentAccount, hasPageLostFocus, setSelectedTransferGuid, srcChainId, wsSourceChainProvider]
  );

  useEffect(
    function subscribeOftReceivedEvents() {
      if (
        hasPageLostFocus ||
        !wsProvider ||
        !isSettlementChain(chainId) ||
        pendingReceiveDepositGuidsRef.current.length === 0
      ) {
        return;
      }

      const tokenIdMap = CHAIN_ID_TO_TOKEN_ID_MAP[chainId];
      const settlementChainStargates = Object.values(tokenIdMap).map((tokenId) => tokenId.stargate);

      const unsubscribeFromOftReceivedEvents = subscribeToOftReceivedEvents(
        wsProvider,
        settlementChainStargates,
        pendingReceiveDepositGuidsRef.current,
        (info) => {
          setPendingMultichainFunding((prev) => {
            const newPendingMultichainFunding = structuredClone(prev);

            const pendingSentDeposit = newPendingMultichainFunding.deposits.sent[info.guid];

            if (!pendingSentDeposit) {
              // eslint-disable-next-line no-console
              console.warn("Got OFTReceive event but no pending deposits were sent from UI");

              return newPendingMultichainFunding;
            }

            debugLog("got OFTReceive event for", chainId, pendingSentDeposit.token, info.txnHash);

            delete newPendingMultichainFunding.deposits.sent[info.guid];
            newPendingMultichainFunding.deposits.received[info.guid] = pendingSentDeposit;

            pendingSentDeposit.step = "received";
            pendingSentDeposit.receivedAmount = info.amountReceivedLD;
            pendingSentDeposit.receivedTimestamp = nowInSeconds();
            pendingSentDeposit.receivedTxn = info.txnHash;

            return newPendingMultichainFunding;
          });
        }
      );

      const timeoutId = setTimeout(() => {
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          for (const guid of pendingReceiveDepositGuidsRef.current) {
            if (guid in newPendingMultichainFunding.deposits.sent) {
              delete newPendingMultichainFunding.deposits.sent[guid];
            }
          }
          return newPendingMultichainFunding;
        });
      }, SUBSCRIPTION_MAX_TTL_MS);

      return function cleanup() {
        unsubscribeFromOftReceivedEvents?.();
        clearTimeout(timeoutId);
      };
    },
    [chainId, hasPageLostFocus, pendingReceiveDepositGuidsKey, wsProvider]
  );

  useEffect(
    function subscribeComposeDeliveredEvents() {
      if (
        hasPageLostFocus ||
        !wsProvider ||
        !isSettlementChain(chainId) ||
        pendingExecuteDepositGuidsRef.current.length === 0
      ) {
        return;
      }

      const lzEndpoint = CodecUiHelper.getLzEndpoint(chainId);

      const unsubscribeFromComposeDeliveredEvents = subscribeToComposeDeliveredEvents(
        wsProvider,
        lzEndpoint,
        pendingExecuteDepositGuidsRef.current,
        (info) => {
          scheduleMultichainFundingItemClearing([info.guid]);

          setPendingMultichainFunding((prev) => {
            const newPendingMultichainFunding = structuredClone(prev);

            const pendingExecuteDeposit = newPendingMultichainFunding.deposits.received[info.guid];

            if (!pendingExecuteDeposit) {
              // eslint-disable-next-line no-console
              console.warn("[multichain] Got ComposeDelivered event but no pending deposits were received from UI");
              return newPendingMultichainFunding;
            }

            debugLog("got ComposeDelivered event for", chainId, pendingExecuteDeposit.token, info.txnHash);

            delete newPendingMultichainFunding.deposits.received[info.guid];
            newPendingMultichainFunding.deposits.executed[info.guid] = pendingExecuteDeposit;

            pendingExecuteDeposit.step = "executed";
            pendingExecuteDeposit.executedTimestamp = nowInSeconds();
            pendingExecuteDeposit.executedTxn = info.txnHash;
            pendingExecuteDeposit.isExecutionError = false;

            queueSendDepositExecutedMetric(pendingExecuteDeposit);

            return newPendingMultichainFunding;
          });
        }
      );

      const timeoutId = setTimeout(() => {
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          for (const guid of pendingExecuteDepositGuidsRef.current) {
            if (guid in newPendingMultichainFunding.deposits.received) {
              delete newPendingMultichainFunding.deposits.received[guid];
            }
          }
          return newPendingMultichainFunding;
        });
      }, SUBSCRIPTION_MAX_TTL_MS);

      return function cleanup() {
        unsubscribeFromComposeDeliveredEvents?.();
        clearTimeout(timeoutId);
      };
    },
    [chainId, hasPageLostFocus, pendingExecuteDepositGuidsKey, scheduleMultichainFundingItemClearing, wsProvider]
  );

  //#endregion Deposits

  //#region Withdrawals

  useEffect(
    function subscribeSettlementChainOftSentEvents() {
      if (
        hasPageLostFocus ||
        !currentAccount ||
        !wsProvider ||
        !isSettlementChain(chainId) ||
        srcChainId === undefined
      ) {
        return;
      }

      const tokenIdMap = CHAIN_ID_TO_TOKEN_ID_MAP[chainId];
      const settlementChainStargates = Object.values(tokenIdMap).map((tokenId) => tokenId.stargate);
      const tokenIdByStargate = keyBy(Object.values(tokenIdMap), (tokenId: MultichainTokenId) => tokenId.stargate);

      const unsubscribeFromOftSentEvents = subscribeToOftSentEvents(
        wsProvider,
        getContract(chainId, "LayerZeroProvider"),
        settlementChainStargates,
        (info) => {
          const sourceChainId = ENDPOINT_ID_TO_CHAIN_ID[info.dstEid];

          if (sourceChainId !== srcChainId) {
            return;
          }

          const stargatePoolAddress = info.sender;
          const tokenId = tokenIdByStargate[stargatePoolAddress];

          const tokenAddress = tokenId.address;

          setPendingMultichainFunding((prev) => {
            const newPendingMultichainFunding: PendingMultichainFunding = structuredClone(prev);

            const currentSubmittingWithdrawal = Object.values(newPendingMultichainFunding.withdrawals.submitted).find(
              (withdrawal) => withdrawal.sentTxn === info.txnHash
            );

            if (currentSubmittingWithdrawal === undefined) {
              // If there were no submitted order from UI we can not be sure if this sent event is related to GMX without parsing the whole transaction for events
              // If its really necessary we could fetch the tx to get PacketSent withing the same transaction event and parse the contents

              // eslint-disable-next-line no-console
              console.warn("[multichain] Got OFTSent event but no withdrawals were submitted from UI");
              UNCERTAIN_WITHDRAWALS_CACHE.set(info.txnHash, info.guid);
              return prev;
            }

            delete newPendingMultichainFunding.withdrawals.submitted[currentSubmittingWithdrawal.id];

            setSelectedTransferGuid((prev) => {
              if (!prev || prev !== currentSubmittingWithdrawal.id) {
                return prev;
              }

              return info.guid;
            });

            setMultichainFundingPendingIds((prev) => {
              if (currentSubmittingWithdrawal.id in prev) {
                return { ...prev, [currentSubmittingWithdrawal.id]: info.guid };
              }

              return prev;
            });

            newPendingMultichainFunding.withdrawals.sent[info.guid] = {
              account: currentAccount,
              sentAmount: info.amountSentLD,
              id: info.guid,
              sentTxn: info.txnHash,
              operation: "withdrawal",
              step: "sent",
              token: tokenAddress,
              sourceChainId: sourceChainId,
              settlementChainId: chainId,
              sentTimestamp: currentSubmittingWithdrawal.sentTimestamp,

              executedTimestamp: undefined,
              executedTxn: undefined,
              isExecutionError: undefined,
              receivedAmount: undefined,
              receivedTimestamp: undefined,
              receivedTxn: undefined,

              isFromWs: true,
            };

            return newPendingMultichainFunding;
          });
        }
      );

      return function cleanup() {
        unsubscribeFromOftSentEvents();
      };
    },
    [chainId, currentAccount, hasPageLostFocus, setSelectedTransferGuid, srcChainId, wsProvider]
  );

  useEffect(
    function subscribeSourceChainOftReceivedEvents() {
      if (
        hasPageLostFocus ||
        !wsSourceChainProvider ||
        !isSettlementChain(chainId) ||
        srcChainId === undefined ||
        pendingReceiveWithdrawalGuidsRef.current.length === 0
      ) {
        return;
      }

      const tokenIdMap = CHAIN_ID_TO_TOKEN_ID_MAP[srcChainId];
      const sourceChainStargates = Object.values(tokenIdMap).map((tokenId) => tokenId.stargate);

      const unsubscribeFromOftReceivedEvents = subscribeToOftReceivedEvents(
        wsSourceChainProvider,
        sourceChainStargates,
        pendingReceiveWithdrawalGuidsRef.current,
        (info) => {
          scheduleMultichainFundingItemClearing([info.guid]);

          setPendingMultichainFunding((prev) => {
            const newPendingMultichainFunding = structuredClone(prev);

            const pendingSentWithdrawal = newPendingMultichainFunding.withdrawals.sent[info.guid];

            if (!pendingSentWithdrawal) {
              // eslint-disable-next-line no-console
              console.warn("[multichain] Got OFTReceive event but no pending withdrawals were sent from UI");

              return newPendingMultichainFunding;
            }

            delete newPendingMultichainFunding.withdrawals.sent[info.guid];
            newPendingMultichainFunding.withdrawals.received[info.guid] = pendingSentWithdrawal;

            pendingSentWithdrawal.step = "received";
            pendingSentWithdrawal.receivedAmount = info.amountReceivedLD;
            pendingSentWithdrawal.receivedTimestamp = nowInSeconds();
            pendingSentWithdrawal.receivedTxn = info.txnHash;

            return newPendingMultichainFunding;
          });
        }
      );

      // in 5 minutes clean up pending withdrawals that are not received
      const timeoutId = setTimeout(() => {
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          for (const guid of pendingReceiveWithdrawalGuidsRef.current) {
            if (guid in newPendingMultichainFunding.withdrawals.sent) {
              delete newPendingMultichainFunding.withdrawals.sent[guid];
            }
          }
          return newPendingMultichainFunding;
        });
      }, SUBSCRIPTION_MAX_TTL_MS);

      return function cleanup() {
        unsubscribeFromOftReceivedEvents?.();
        clearTimeout(timeoutId);
      };
    },
    [
      chainId,
      hasPageLostFocus,
      pendingReceiveWithdrawalGuidsKey,
      scheduleMultichainFundingItemClearing,
      srcChainId,
      wsSourceChainProvider,
    ]
  );

  //#endregion Withdrawals

  //#region Approval statuses

  const [sourceChainApprovalActiveListeners, setSourceChainApprovalActiveListeners] =
    useState<Partial<Record<SourceChainId, string[]>>>(EMPTY_OBJECT);
  const [sourceChainApprovalStatuses, setSourceChainApprovalStatuses] = useState<ApprovalStatuses>(EMPTY_OBJECT);

  const sourceChainApprovalUnsubscribersRef = useRef<Partial<Record<SourceChainId, () => void>>>({});
  const sourceChainApprovalCleanupTimersRef = useRef<Partial<Record<SourceChainId, number>>>({});

  useEffect(
    function subscribeMultichainApprovals() {
      if (!currentAccount) {
        return;
      }

      const newUnsubscribers: Partial<Record<SourceChainId, () => void>> = {};

      for (const chainIdString of Object.keys(sourceChainApprovalActiveListeners)) {
        if (
          !sourceChainApprovalActiveListeners[chainIdString] ||
          sourceChainApprovalActiveListeners[chainIdString].length === 0
        ) {
          continue;
        }

        const someSourceChainId = parseInt(chainIdString) as SourceChainId;

        if (sourceChainApprovalCleanupTimersRef.current[someSourceChainId]) {
          debugLog("clearing timeout for source chain approval listener", someSourceChainId);

          clearTimeout(sourceChainApprovalCleanupTimersRef.current[someSourceChainId]);
          delete sourceChainApprovalCleanupTimersRef.current[someSourceChainId];
        }

        if (sourceChainApprovalUnsubscribersRef.current[someSourceChainId]) {
          debugLog("skipping source chain approval listener creation as it already exists", someSourceChainId);
          continue;
        }

        const wsSomeSourceChainProvider = wsSourceChainProviders[someSourceChainId];
        if (!wsSomeSourceChainProvider) {
          debugLog("no ws source chain provider for source chain approval listener", someSourceChainId);
          continue;
        }

        const tokenIdMap = CHAIN_ID_TO_TOKEN_ID_MAP[someSourceChainId];
        const tokenAddresses = Object.values(tokenIdMap)
          .filter((tokenId) => tokenId.address !== zeroAddress)
          .map((tokenId) => tokenId.address);
        const stargates = Object.values(tokenIdMap)
          .filter((tokenId) => tokenId.address !== zeroAddress)
          .map((tokenId) => tokenId.stargate);

        debugLog("subscribing to source chain approval events for", someSourceChainId);
        const unsubscribeApproval = subscribeToMultichainApprovalEvents(
          wsSomeSourceChainProvider,
          currentAccount,
          tokenAddresses,
          stargates,
          (tokenAddress, spender, value) => {
            debugLog("got approval event for", someSourceChainId, tokenAddress, spender, value);

            setSourceChainApprovalStatuses((old) => ({
              ...old,
              [tokenAddress]: {
                ...old[tokenAddress],
                [spender]: { value, createdAt: Date.now() },
              },
            }));
          }
        );

        newUnsubscribers[someSourceChainId] = unsubscribeApproval;
      }

      sourceChainApprovalUnsubscribersRef.current = {
        ...sourceChainApprovalUnsubscribersRef.current,
        ...newUnsubscribers,
      };

      return function cleanup() {
        for (const chainIdString of Object.keys(newUnsubscribers)) {
          const someSourceChainId = parseInt(chainIdString) as SourceChainId;

          debugLog("scheduling timeout for source chain approval listener", someSourceChainId);

          const timerId = window.setTimeout(() => {
            debugLog("clearing source chain approval listener", someSourceChainId);
            newUnsubscribers[someSourceChainId]?.();
            delete sourceChainApprovalUnsubscribersRef.current[someSourceChainId];
            // eslint-disable-next-line react-hooks/exhaustive-deps
            delete sourceChainApprovalCleanupTimersRef.current[someSourceChainId];
          }, SOURCE_CHAIN_APPROVAL_LISTENER_CLEANUP_DELAY_MS);

          // eslint-disable-next-line react-hooks/exhaustive-deps
          sourceChainApprovalCleanupTimersRef.current[someSourceChainId] = timerId;
        }
      };
    },
    [currentAccount, sourceChainApprovalActiveListeners, wsSourceChainProviders]
  );

  const multichainEventsState = useMemo(
    (): MultichainEventsState => ({
      pendingMultichainFunding,
      multichainFundingPendingIds,
      setMultichainSubmittedDeposit: (submittedEvent) => {
        if (!currentAccount) {
          return;
        }

        const stubId = `<stub-${Date.now()}>`;
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          newPendingMultichainFunding.deposits.submitted.push({
            account: currentAccount,
            id: stubId,
            operation: "deposit",
            step: "submitted",
            settlementChainId: chainId,
            sourceChainId: submittedEvent.sourceChainId,
            token: submittedEvent.tokenAddress,
            sentAmount: submittedEvent.amount,
            sentTxn: submittedEvent.sentTxn,
            sentTimestamp: nowInSeconds(),

            receivedAmount: undefined,
            receivedTxn: undefined,
            receivedTimestamp: undefined,
            isExecutionError: undefined,
            executedTxn: undefined,
            executedTimestamp: undefined,

            isFromWs: true,
          });
          return newPendingMultichainFunding;
        });

        setMultichainFundingPendingIds((prev) => ({ ...prev, [stubId]: stubId }));

        return stubId;
      },
      setMultichainSubmittedWithdrawal: (submittedEvent) => {
        if (!currentAccount) {
          return;
        }

        const stubId = `<stub-${Date.now()}>`;
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          newPendingMultichainFunding.withdrawals.submitted[stubId] = {
            account: currentAccount,
            id: stubId,
            operation: "withdrawal",
            step: "submitted",
            settlementChainId: chainId,
            sourceChainId: submittedEvent.sourceChainId,
            token: submittedEvent.tokenAddress,
            sentAmount: submittedEvent.amount,
            sentTimestamp: nowInSeconds(),

            sentTxn: undefined,
            receivedAmount: undefined,
            receivedTxn: undefined,
            receivedTimestamp: undefined,
            isExecutionError: undefined,
            executedTxn: undefined,
            executedTimestamp: undefined,

            isFromWs: true,
          };
          return newPendingMultichainFunding;
        });

        setMultichainFundingPendingIds((prev) => ({ ...prev, [stubId]: stubId }));

        return stubId;
      },
      setMultichainWithdrawalSentTxnHash: (mockId, txnHash) => {
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          if (mockId in newPendingMultichainFunding.withdrawals.submitted) {
            const submittedWithdrawal = newPendingMultichainFunding.withdrawals.submitted[mockId];
            submittedWithdrawal.sentTxn = txnHash;
            submittedWithdrawal.sentTimestamp = nowInSeconds();

            if (UNCERTAIN_WITHDRAWALS_CACHE.has(txnHash)) {
              const guid = UNCERTAIN_WITHDRAWALS_CACHE.get(txnHash)!;
              delete newPendingMultichainFunding.withdrawals.submitted[mockId];
              newPendingMultichainFunding.withdrawals.sent[guid] = submittedWithdrawal;
              submittedWithdrawal.step = "sent";
              submittedWithdrawal.id = guid;

              setSelectedTransferGuid((prev) => {
                if (!prev || prev !== mockId) {
                  return prev;
                }

                return guid;
              });

              setMultichainFundingPendingIds((prev) => {
                if (mockId in prev) {
                  return { ...prev, [mockId]: guid };
                }

                return prev;
              });

              UNCERTAIN_WITHDRAWALS_CACHE.delete(txnHash);
            }
          }
          return newPendingMultichainFunding;
        });
      },
      setMultichainWithdrawalSentError: (mockId) => {
        setPendingMultichainFunding((prev) => {
          const newPendingMultichainFunding = structuredClone(prev);
          delete newPendingMultichainFunding.withdrawals.submitted[mockId];
          return newPendingMultichainFunding;
        });

        setMultichainFundingPendingIds((prev) => {
          const newPendingIds = { ...prev };
          delete newPendingIds[mockId];
          return newPendingIds;
        });

        setSelectedTransferGuid((prev) => {
          if (!prev || prev !== mockId) {
            return prev;
          }

          return undefined;
        });
      },
      multichainSourceChainApprovalStatuses: sourceChainApprovalStatuses,
      setMultichainSourceChainApprovalsActiveListener: (chainId: SourceChainId, name: string) => {
        setSourceChainApprovalActiveListeners((old) => {
          const newListeners = structuredClone(old);
          newListeners[chainId] = [...(newListeners[chainId] || []), name];
          return newListeners;
        });
      },
      removeMultichainSourceChainApprovalsActiveListener: (chainId: SourceChainId, name: string) => {
        setSourceChainApprovalActiveListeners((old) => {
          const newListeners = structuredClone(old);
          newListeners[chainId] = newListeners[chainId]?.filter((listener) => listener !== name) || [];
          return newListeners;
        });
      },
      updatePendingMultichainFunding: (items) => {
        const intermediateStepGuids = getIntermediateStepGuids(pendingMultichainFunding);

        const updatedPendingItems: Record<string, MultichainFundingHistoryItem> = {};
        let hasUpdatedPendingUpdates = false;

        for (const item of items) {
          if (intermediateStepGuids.has(item.id)) {
            updatedPendingItems[item.id] = item;
            hasUpdatedPendingUpdates = true;
          }
        }

        if (hasUpdatedPendingUpdates) {
          setPendingMultichainFunding((prev) => {
            const newPendingMultichainFunding = structuredClone(prev);

            const executedGuids = progressMultichainFundingItems({
              pendingMultichainFunding: newPendingMultichainFunding,
              updatedPendingItems,
            });

            scheduleMultichainFundingItemClearing(executedGuids);

            return newPendingMultichainFunding;
          });
        }
      },
      removeMultichainFundingPendingIds: (ids: string | string[]) => {
        ids = typeof ids === "string" ? [ids] : ids;
        setMultichainFundingPendingIds((prev) => {
          const newIds = { ...prev };
          for (const id of ids) {
            delete newIds[id];
          }
          return newIds;
        });
      },
    }),
    [
      pendingMultichainFunding,
      multichainFundingPendingIds,
      sourceChainApprovalStatuses,
      currentAccount,
      chainId,
      setSelectedTransferGuid,
      scheduleMultichainFundingItemClearing,
    ]
  );

  //#endregion Approval statuses

  useEffect(
    function resetOnAccountChange() {
      setPendingMultichainFunding(DEFAULT_MULTICHAIN_FUNDING_STATE);
      setMultichainFundingPendingIds(EMPTY_OBJECT);
      setSourceChainApprovalStatuses(EMPTY_OBJECT);
    },
    [currentAccount]
  );

  return multichainEventsState;
}

function getIntermediateStepGuids(pendingMultichainFunding: PendingMultichainFunding): Set<string> {
  const intermediateStepGuids = new Set<string>();

  for (const step of ["received", "sent"] as const) {
    for (const pendingGuid in pendingMultichainFunding.deposits[step]) {
      intermediateStepGuids.add(pendingGuid);
    }
  }

  for (const step of ["sent"] as const) {
    for (const pendingGuid in pendingMultichainFunding.withdrawals[step]) {
      intermediateStepGuids.add(pendingGuid);
    }
  }

  return intermediateStepGuids;
}

function progressMultichainFundingItems({
  pendingMultichainFunding,
  updatedPendingItems,
}: {
  pendingMultichainFunding: PendingMultichainFunding;
  updatedPendingItems: Record<string, MultichainFundingHistoryItem>;
}) {
  const executedGuids: string[] = [];

  for (const intermediateDepositStep of ["received", "sent"] as const) {
    for (const pendingGuid in pendingMultichainFunding.deposits[intermediateDepositStep]) {
      const freshItem = updatedPendingItems[pendingGuid];

      if (isStepGreater(freshItem.step, intermediateDepositStep)) {
        delete pendingMultichainFunding.deposits[intermediateDepositStep][pendingGuid];
        pendingMultichainFunding.deposits[freshItem.step][pendingGuid] = freshItem;

        if (freshItem.step === "executed") {
          executedGuids.push(pendingGuid);
          queueSendDepositExecutedMetric(freshItem);
        }
      }
    }
  }

  for (const intermediateWithdrawalStep of ["sent"] as const) {
    for (const pendingGuid in pendingMultichainFunding.withdrawals[intermediateWithdrawalStep]) {
      const freshItem = updatedPendingItems[pendingGuid];

      if (isStepGreater(freshItem.step, intermediateWithdrawalStep)) {
        delete pendingMultichainFunding.withdrawals[intermediateWithdrawalStep][pendingGuid];
        pendingMultichainFunding.withdrawals[freshItem.step][pendingGuid] = freshItem;
        if (freshItem.step === "received") {
          executedGuids.push(pendingGuid);
          queueSendWithdrawalReceivedMetric(freshItem);
        }
      }
    }
  }

  return executedGuids;
}

function queueSendDepositExecutedMetric(deposit: MultichainFundingHistoryItem) {
  const token = getToken(deposit.settlementChainId, deposit.token);
  const metricId = getMultichainDepositMetricId({
    settlementChain: deposit.settlementChainId,
    sourceChain: deposit.sourceChainId,
    assetSymbol: token.symbol,
  });

  const cache = metrics.getCachedMetricData<MultichainDepositMetricData>(metricId);
  if (cache) {
    sendMultichainDepositSuccessEvent({
      settlementChain: getChainName(deposit.settlementChainId),
      sourceChain: getChainName(deposit.sourceChainId),
      asset: token.symbol,
      sizeInUsd: cache.sizeInUsd,
      isFirstTime: cache.isFirstDeposit,
    });
  }

  sendOrderExecutedMetric(metricId);
}

function queueSendWithdrawalReceivedMetric(withdrawal: MultichainFundingHistoryItem) {
  const token = getToken(withdrawal.settlementChainId, withdrawal.token);
  const metricId = getMultichainWithdrawalMetricId({
    settlementChain: withdrawal.settlementChainId,
    sourceChain: withdrawal.sourceChainId,
    assetSymbol: token.symbol,
  });

  const cache = metrics.getCachedMetricData<MultichainWithdrawalMetricData>(metricId);
  if (cache) {
    sendMultichainWithdrawalSuccessEvent({
      settlementChain: getChainName(withdrawal.settlementChainId),
      sourceChain: getChainName(withdrawal.sourceChainId),
      asset: token.symbol,
      sizeInUsd: cache.sizeInUsd,
      isFirstTime: cache.isFirstWithdrawal,
    });
  }

  sendOrderExecutedMetric(metricId);
}

export function useMultichainApprovalsActiveListener(chainId: SourceChainId | undefined, name: string) {
  const { setMultichainSourceChainApprovalsActiveListener, removeMultichainSourceChainApprovalsActiveListener } =
    useSyntheticsEvents();

  useWsAdditionalSourceChains(chainId, name);

  useEffect(() => {
    if (!chainId) {
      return;
    }

    setMultichainSourceChainApprovalsActiveListener(chainId, name);

    return () => {
      removeMultichainSourceChainApprovalsActiveListener(chainId, name);
    };
  }, [
    chainId,
    name,
    setMultichainSourceChainApprovalsActiveListener,
    removeMultichainSourceChainApprovalsActiveListener,
  ]);
}
