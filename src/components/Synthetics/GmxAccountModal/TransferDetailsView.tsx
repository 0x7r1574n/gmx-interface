import { Trans } from "@lingui/macro";
import { useEffect, useState } from "react";

import { getChainName, SourceChainId } from "config/chains";
import { CHAIN_ID_TO_NETWORK_ICON } from "config/icons";
import {
  useGmxAccountDepositViewChain,
  useGmxAccountDepositViewTokenAddress,
  useGmxAccountDepositViewTokenInputValue,
  useGmxAccountModalOpen,
  useGmxAccountSelectedTransferGuid,
  useGmxAccountWithdrawalViewChain,
  useGmxAccountWithdrawalViewTokenAddress,
  useGmxAccountWithdrawalViewTokenInputValue,
} from "context/GmxAccountContext/hooks";
import { useGmxAccountFundingHistoryItem } from "domain/multichain/useGmxAccountFundingHistory";
import { useChainId } from "lib/chains";
import { CHAIN_ID_TO_EXPLORER_NAME, CHAIN_ID_TO_TX_URL_BUILDER } from "lib/chains/blockExplorers";
import { formatAmountFree, formatBalanceAmount } from "lib/numbers";
import { shortenAddressOrEns } from "lib/wallets";
import { getToken } from "sdk/configs/tokens";

import { AlertInfoCard } from "components/AlertInfo/AlertInfoCard";
import Button from "components/Button/Button";
import ExternalLink from "components/ExternalLink/ExternalLink";

import externalLink from "img/ic_new_link_20.svg";

import { SyntheticsInfoRow } from "../SyntheticsInfoRow";
import { formatTradeActionTimestamp } from "../TradeHistory/TradeHistoryRow/utils/shared";

export const TransferDetailsView = () => {
  const { chainId } = useChainId();

  const [, setGmxAccountModalOpen] = useGmxAccountModalOpen();
  const [, setGmxAccountDepositViewChain] = useGmxAccountDepositViewChain();
  const [, setGmxAccountWithdrawalViewChain] = useGmxAccountWithdrawalViewChain();
  const [, setGmxAccountDepositViewTokenAddress] = useGmxAccountDepositViewTokenAddress();
  const [, setGmxAccountDepositViewTokenInputValue] = useGmxAccountDepositViewTokenInputValue();
  const [, setGmxAccountWithdrawalViewTokenAddress] = useGmxAccountWithdrawalViewTokenAddress();
  const [, setGmxAccountWithdrawalViewTokenInputValue] = useGmxAccountWithdrawalViewTokenInputValue();

  const [selectedTransferGuid] = useGmxAccountSelectedTransferGuid();

  const [isTransferPending, setIsTransferPending] = useState(false);

  const selectedTransfer = useGmxAccountFundingHistoryItem(selectedTransferGuid, {
    refetch: isTransferPending,
  });

  useEffect(() => {
    if (!selectedTransfer) {
      return;
    }

    if (selectedTransfer.operation === "deposit" && selectedTransfer.step !== "received") {
      setIsTransferPending(true);
      return;
    }

    if (selectedTransfer.operation === "withdrawal" && selectedTransfer.step !== "executed") {
      setIsTransferPending(true);
      return;
    }
  }, [selectedTransfer]);

  const sourceChainName = selectedTransfer ? getChainName(selectedTransfer.sourceChainId) : undefined;

  const token = selectedTransfer ? getToken(chainId, selectedTransfer.token) : undefined;

  const handleRepeatTransaction = () => {
    if (!selectedTransfer || !token) {
      return;
    }

    if (selectedTransfer.operation === "deposit") {
      setGmxAccountDepositViewChain(selectedTransfer.sourceChainId as SourceChainId);
      setGmxAccountDepositViewTokenAddress(selectedTransfer.token);
      setGmxAccountDepositViewTokenInputValue(formatAmountFree(selectedTransfer.sentAmount, token.decimals));
      setGmxAccountModalOpen("deposit");
      return;
    }

    if (selectedTransfer.operation === "withdrawal") {
      setGmxAccountWithdrawalViewChain(selectedTransfer.sourceChainId as SourceChainId);
      setGmxAccountWithdrawalViewTokenAddress(selectedTransfer.token);
      setGmxAccountWithdrawalViewTokenInputValue(formatAmountFree(selectedTransfer.sentAmount, token.decimals));
      setGmxAccountModalOpen("withdraw");
    }
  };

  return (
    <div className="text-body-medium flex grow flex-col gap-8 p-16">
      {selectedTransfer?.isExecutionError ? (
        <AlertInfoCard type="error">
          <Trans>Your deposit of from {sourceChainName} was not executed due to an error</Trans>
        </AlertInfoCard>
      ) : null}
      <SyntheticsInfoRow
        label={<Trans>Date</Trans>}
        value={selectedTransfer ? formatTradeActionTimestamp(selectedTransfer.sentTimestamp) : undefined}
      />
      <SyntheticsInfoRow
        label={<Trans>Type</Trans>}
        value={
          selectedTransfer ? (
            selectedTransfer.operation === "deposit" ? (
              <Trans>Deposit</Trans>
            ) : (
              <Trans>Withdrawal</Trans>
            )
          ) : undefined
        }
      />
      <SyntheticsInfoRow
        label={<Trans>Wallet</Trans>}
        value={
          selectedTransfer ? (
            selectedTransfer.operation === "deposit" ? (
              <Trans>GMX Balance</Trans>
            ) : (
              shortenAddressOrEns(selectedTransfer.account, 13)
            )
          ) : undefined
        }
      />
      <SyntheticsInfoRow
        label={<Trans>Amount</Trans>}
        value={
          selectedTransfer && token
            ? formatBalanceAmount(selectedTransfer.sentAmount, token.decimals, token.symbol, {
                isStable: token.isStable,
              })
            : undefined
        }
      />
      {selectedTransfer?.receivedAmount !== undefined && (
        <>
          <SyntheticsInfoRow
            label={<Trans>Fee</Trans>}
            value={
              selectedTransfer && token
                ? formatBalanceAmount(
                    selectedTransfer.sentAmount - selectedTransfer.receivedAmount,
                    token.decimals,
                    token.symbol,
                    {
                      isStable: token.isStable,
                    }
                  )
                : undefined
            }
          />
        </>
      )}
      <SyntheticsInfoRow
        label={
          selectedTransfer ? (
            selectedTransfer.operation === "deposit" ? (
              <Trans>From Network</Trans>
            ) : (
              <Trans>To Network</Trans>
            )
          ) : undefined
        }
        className="!items-center"
        valueClassName="-my-5"
        value={
          selectedTransfer && (
            <div className="flex items-center gap-8">
              <img
                src={CHAIN_ID_TO_NETWORK_ICON[selectedTransfer.sourceChainId]}
                width={20}
                height={20}
                className="size-20 rounded-full"
              />
              {getChainName(selectedTransfer.sourceChainId)}
            </div>
          )
        }
      />
      <SyntheticsInfoRow
        label={
          selectedTransfer ? (
            selectedTransfer.operation === "deposit" ? (
              <Trans>From Wallet</Trans>
            ) : (
              <Trans>To Wallet</Trans>
            )
          ) : undefined
        }
        value={selectedTransfer ? shortenAddressOrEns(selectedTransfer.account, 13) : undefined}
      />
      {selectedTransfer?.sentTxn && (
        <SyntheticsInfoRow
          label={
            CHAIN_ID_TO_EXPLORER_NAME[
              selectedTransfer.operation === "deposit"
                ? selectedTransfer.sourceChainId
                : selectedTransfer.settlementChainId
            ]
          }
          value={
            <ExternalLink
              href={
                selectedTransfer.operation === "deposit"
                  ? CHAIN_ID_TO_TX_URL_BUILDER[selectedTransfer.sourceChainId](selectedTransfer.sentTxn)
                  : CHAIN_ID_TO_TX_URL_BUILDER[selectedTransfer.settlementChainId](selectedTransfer.sentTxn)
              }
            >
              <div className="flex items-center gap-4">
                {shortenAddressOrEns(selectedTransfer.sentTxn, 13)}
                <img src={externalLink} alt="External Link" className="size-20" />
              </div>
            </ExternalLink>
          }
        />
      )}
      <div className="grow" />
      <Button variant="secondary" onClick={handleRepeatTransaction}>
        <Trans>Repeat Transaction</Trans>
      </Button>
    </div>
  );
};
