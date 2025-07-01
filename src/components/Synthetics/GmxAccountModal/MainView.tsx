import { Trans, t } from "@lingui/macro";
import cx from "classnames";
import { useMemo, useState } from "react";
import { IoArrowDown } from "react-icons/io5";
import { TbLoader2 } from "react-icons/tb";
import Skeleton from "react-loading-skeleton";
import { useCopyToClipboard } from "react-use";
import { useAccount, useDisconnect } from "wagmi";

import { getExplorerUrl } from "config/chains";
import { CURRENT_PROVIDER_LOCALSTORAGE_KEY, SHOULD_EAGER_CONNECT_LOCALSTORAGE_KEY } from "config/localStorage";
import { isSettlementChain } from "config/multichain";
import { useGmxAccountModalOpen, useGmxAccountSelectedTransferGuid } from "context/GmxAccountContext/hooks";
import { useSettings } from "context/SettingsContext/SettingsContextProvider";
import { isMultichainFundingItemLoading } from "domain/multichain/isMultichainFundingItemLoading";
import type { MultichainFundingHistoryItem } from "domain/multichain/types";
import { useGmxAccountFundingHistory } from "domain/multichain/useGmxAccountFundingHistory";
import { useChainId } from "lib/chains";
import { formatRelativeDateWithComma } from "lib/dates";
import { helperToast } from "lib/helperToast";
import { useLocalizedMap } from "lib/i18n";
import { useENS } from "lib/legacy";
import { formatBalanceAmount, formatUsd } from "lib/numbers";
import { useNotifyModalState } from "lib/useNotifyModalState";
import { userAnalytics } from "lib/userAnalytics";
import { DisconnectWalletEvent } from "lib/userAnalytics/types";
import { shortenAddressOrEns } from "lib/wallets";
import { getToken } from "sdk/configs/tokens";
import { Token } from "sdk/types/tokens";

import { Avatar } from "components/Avatar/Avatar";
import Button from "components/Button/Button";
import ExternalLink from "components/ExternalLink/ExternalLink";
import { VerticalScrollFadeContainer } from "components/TableScrollFade/VerticalScrollFade";
import TokenIcon from "components/TokenIcon/TokenIcon";
import TooltipWithPortal from "components/Tooltip/TooltipWithPortal";

import BellIcon from "img/bell.svg?react";
import copy from "img/ic_copy_20.svg";
import InfoIconComponent from "img/ic_info.svg?react";
import externalLink from "img/ic_new_link_20.svg";
import SettingsIcon24 from "img/ic_settings_24.svg?react";
import disconnectIcon from "img/ic_sign_out_20.svg";

import { SyntheticsInfoRow } from "../SyntheticsInfoRow";
import {
  useAvailableToTradeAssetMultichain,
  useAvailableToTradeAssetSettlementChain,
  useAvailableToTradeAssetSymbolsMultichain,
  useAvailableToTradeAssetSymbolsSettlementChain,
} from "./hooks";
import { FUNDING_OPERATIONS_LABELS } from "./keys";

const TokenIcons = ({ tokens }: { tokens: string[] }) => {
  const displayTokens = tokens.slice(0, 3);
  const remainingCount = Math.max(0, tokens.length - 3);

  return (
    <div className="flex items-center">
      {displayTokens.map((token, index) => (
        <div
          key={token}
          className={cx(
            "flex size-20 items-center justify-center rounded-full border border-cold-blue-500",
            index > 0 && "-ml-8"
          )}
        >
          <TokenIcon symbol={token} displaySize={18} importSize={24} />
        </div>
      ))}
      {remainingCount > 0 && (
        <div className="-ml-8 flex size-20 items-center justify-center rounded-full border border-cold-blue-500 bg-white text-12 text-black">
          +{remainingCount}
        </div>
      )}
    </div>
  );
};

function FundingHistoryItemLabel({
  step,
  operation,
  isExecutionError,
}: Pick<MultichainFundingHistoryItem, "step" | "operation" | "isExecutionError">) {
  const labels = useLocalizedMap(FUNDING_OPERATIONS_LABELS);

  const isLoading = isMultichainFundingItemLoading({ operation, step, isExecutionError });

  const key = `${operation}${isExecutionError ? "-failed" : ""}`;
  let text = labels[key] ?? `${operation} ${isExecutionError ? " failed" : ""}`;

  if (isLoading) {
    return (
      <div className="text-body-small flex items-center gap-4 text-slate-100">
        <TbLoader2 className="size-16 animate-spin" />
        {text}
      </div>
    );
  } else if (isExecutionError) {
    return <div className="text-body-small text-red-500">{text}</div>;
  }

  return <div className="text-body-small text-slate-100">{text}</div>;
}

const Toolbar = ({ account }: { account: string }) => {
  const { disconnect } = useDisconnect();
  const [, setIsVisible] = useGmxAccountModalOpen();
  const { chainId: settlementChainId, srcChainId } = useChainId();

  const chainId = srcChainId ?? settlementChainId;

  const { openNotifyModal } = useNotifyModalState();
  const { setIsSettingsVisible } = useSettings();
  const { ensName } = useENS(account);
  const [, copyToClipboard] = useCopyToClipboard();

  const handleCopyAddress = () => {
    if (account) {
      copyToClipboard(account);
      helperToast.success(t`Address copied to your clipboard`);
    }
  };

  const accountUrl = useMemo(() => {
    if (!account || !chainId) return "";
    return `${getExplorerUrl(chainId)}address/${account}`;
  }, [account, chainId]);

  const handleDisconnect = () => {
    userAnalytics.pushEvent<DisconnectWalletEvent>({
      event: "ConnectWalletAction",
      data: {
        action: "Disconnect",
      },
    });
    disconnect();
    localStorage.removeItem(SHOULD_EAGER_CONNECT_LOCALSTORAGE_KEY);
    localStorage.removeItem(CURRENT_PROVIDER_LOCALSTORAGE_KEY);
    setIsVisible(false);
  };

  const handleNotificationsClick = () => {
    openNotifyModal();
    setTimeout(() => {
      setIsVisible(false);
    }, 200);
  };

  const handleSettingsClick = () => {
    setIsSettingsVisible(true);
    setTimeout(() => {
      setIsVisible(false);
    }, 200);
  };

  return (
    <div className="flex items-stretch justify-between gap-8">
      <button
        className="text-body-medium inline-flex items-center justify-center rounded-4 border border-stroke-primary px-11 py-7 text-white hover:bg-slate-700 active:bg-[#808aff14]"
        onClick={handleCopyAddress}
      >
        <div className="flex items-center gap-8">
          <div className="max-[410px]:hidden">
            <Avatar size={20} ensName={ensName} address={account} />
          </div>
          <span className="mx-8 max-[410px]:mx-0">{shortenAddressOrEns(ensName || account, 13)}</span>
          <img src={copy} alt="Copy" />
        </div>
      </button>
      <div className="flex items-center gap-8">
        <TooltipWithPortal
          shouldPreventDefault={false}
          content={t`View in Explorer`}
          position="bottom"
          tooltipClassName="!min-w-max"
        >
          <ExternalLink
            href={accountUrl}
            className="flex size-36 items-center justify-center rounded-4 border border-stroke-primary hover:bg-slate-700"
          >
            <img src={externalLink} alt="External Link" />
          </ExternalLink>
        </TooltipWithPortal>
        <TooltipWithPortal content={t`Notifications`} position="bottom" tooltipClassName="!min-w-max">
          <button
            className="flex size-36 items-center justify-center rounded-4 border border-stroke-primary hover:bg-slate-700"
            onClick={handleNotificationsClick}
          >
            <BellIcon className="text-slate-100" />
          </button>
        </TooltipWithPortal>
        <TooltipWithPortal content={t`Settings`} position="bottom" tooltipClassName="!min-w-max">
          <button
            className="flex size-36 items-center justify-center rounded-4 border border-stroke-primary hover:bg-slate-700"
            onClick={handleSettingsClick}
          >
            <SettingsIcon24 width={20} height={20} className="text-slate-100" />
          </button>
        </TooltipWithPortal>
        <TooltipWithPortal content={t`Disconnect`} position="bottom" tooltipClassName="!min-w-max">
          <button
            className="flex size-36 items-center justify-center rounded-4 border border-stroke-primary hover:bg-slate-700"
            onClick={handleDisconnect}
          >
            <img src={disconnectIcon} alt="Disconnect" className="rotate-180" />
          </button>
        </TooltipWithPortal>
      </div>
    </div>
  );
};

function SettlementChainBalance() {
  const { totalUsd, gmxAccountUsd, walletUsd } = useAvailableToTradeAssetSettlementChain();
  const availableToTradeAssetSymbols = useAvailableToTradeAssetSymbolsSettlementChain();

  return (
    <div className="flex flex-col gap-8 rounded-4 bg-cold-blue-900 p-12">
      <div className="text-body-small text-slate-100">
        <Trans>Available to Trade</Trans>
      </div>
      <Balance usd={totalUsd} availableToTradeAssetSymbols={availableToTradeAssetSymbols} />
      <div className="my-4 h-1 bg-stroke-primary" />
      <SyntheticsInfoRow
        label="Wallet"
        className="h-23 !items-start"
        valueClassName="leading-[21px]"
        value={
          walletUsd !== undefined ? (
            formatUsd(walletUsd)
          ) : (
            <Skeleton
              baseColor="#B4BBFF1A"
              highlightColor="#B4BBFF1A"
              width={54}
              height={21}
              className="!block"
              inline={true}
            />
          )
        }
      />
      <SyntheticsInfoRow
        label={<Trans>GMX Account Balance</Trans>}
        className="h-23 !items-start"
        valueClassName="leading-[21px]"
        value={
          gmxAccountUsd !== undefined ? (
            formatUsd(gmxAccountUsd)
          ) : (
            <Skeleton
              baseColor="#B4BBFF1A"
              highlightColor="#B4BBFF1A"
              width={54}
              height={21}
              className="!block"
              inline={true}
            />
          )
        }
      />
    </div>
  );
}

function MultichainBalance() {
  const { gmxAccountUsd } = useAvailableToTradeAssetMultichain();
  const availableToTradeAssetSymbols = useAvailableToTradeAssetSymbolsMultichain();

  return (
    <div className="flex flex-col gap-8 rounded-4 bg-cold-blue-900 p-12">
      <div className="text-body-small text-slate-100">
        <Trans>Balance</Trans>
      </div>
      <Balance usd={gmxAccountUsd} availableToTradeAssetSymbols={availableToTradeAssetSymbols} />
    </div>
  );
}

function Balance({
  usd,
  availableToTradeAssetSymbols,
}: {
  usd: bigint | undefined;
  availableToTradeAssetSymbols: string[];
}) {
  const [, setIsVisibleOrView] = useGmxAccountModalOpen();

  const handleAvailableToTradeClick = () => {
    setIsVisibleOrView("availableToTradeAssets");
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-8">
      {usd !== undefined ? (
        <div className="text-24 leading-[28px]">{formatUsd(usd)}</div>
      ) : (
        <Skeleton
          baseColor="#B4BBFF1A"
          highlightColor="#B4BBFF1A"
          width={100}
          height={28}
          className="!block"
          inline={true}
        />
      )}
      <button
        className="flex items-center gap-4 rounded-4 bg-cold-blue-700 py-4 pl-8 pr-4 gmx-hover:bg-cold-blue-500"
        onClick={handleAvailableToTradeClick}
      >
        <Trans>All assets</Trans>
        <TokenIcons tokens={availableToTradeAssetSymbols} />
        <IoArrowDown className="block size-16 -rotate-90 text-slate-100" />
      </button>
    </div>
  );
}

const BalanceSection = () => {
  const { chainId } = useAccount();

  return isSettlementChain(chainId!) ? <SettlementChainBalance /> : <MultichainBalance />;
};

const ActionButtons = () => {
  const [, setIsVisibleOrView] = useGmxAccountModalOpen();

  const handleDepositClick = () => {
    setIsVisibleOrView("deposit");
  };

  const handleWithdrawClick = () => {
    setIsVisibleOrView("withdraw");
  };

  return (
    <div className="flex gap-8">
      <Button variant="secondary" className="flex-1" onClick={handleDepositClick}>
        <Trans>Deposit</Trans>
      </Button>
      <Button variant="secondary" className="flex-1" onClick={handleWithdrawClick}>
        <Trans>Withdraw</Trans>
      </Button>
    </div>
  );
};

type DisplayFundingHistoryItem = Omit<MultichainFundingHistoryItem, "token"> & {
  token: Token;
};

const FundingHistorySection = () => {
  const [, setIsVisibleOrView] = useGmxAccountModalOpen();
  const [searchQuery, setSearchQuery] = useState("");
  const [, setSelectedTransferGuid] = useGmxAccountSelectedTransferGuid();

  const { fundingHistory, isLoading } = useGmxAccountFundingHistory();

  const filteredFundingHistory: DisplayFundingHistoryItem[] | undefined = fundingHistory
    ?.map((transfer): DisplayFundingHistoryItem | undefined => {
      const token = getToken(transfer.settlementChainId, transfer.token);

      if (!token) {
        return undefined;
      }

      return { ...transfer, token };
    })
    .filter((transfer): transfer is DisplayFundingHistoryItem => {
      if (!transfer) {
        return false;
      }

      const matchesSearch = transfer.token.symbol.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });

  const handleTransferClick = (transfer: DisplayFundingHistoryItem) => {
    setSelectedTransferGuid(transfer.id);
    setIsVisibleOrView("transferDetails");
  };

  return (
    <div className="flex grow flex-col gap-8 overflow-y-hidden">
      <div className="flex items-center justify-between px-16">
        <div className="text-body-large">
          <Trans>Funding Activity</Trans>
        </div>
      </div>
      <div className="px-16">
        <input
          type="text"
          placeholder="Search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-4 bg-slate-700 px-12 py-8 text-white placeholder:text-slate-100"
        />
      </div>
      <VerticalScrollFadeContainer className="flex grow flex-col">
        {filteredFundingHistory?.map((transfer) => (
          <div
            role="button"
            tabIndex={0}
            key={transfer.id}
            className="flex w-full cursor-pointer items-center justify-between px-16 py-8 text-left -outline-offset-4 gmx-hover:bg-slate-700"
            onClick={() => handleTransferClick(transfer)}
          >
            <div className="flex items-center gap-8">
              <TokenIcon symbol={transfer.token.symbol} displaySize={40} importSize={40} />
              <div>
                <div>{transfer.token.symbol}</div>
                <FundingHistoryItemLabel
                  step={transfer.step}
                  operation={transfer.operation}
                  isExecutionError={transfer.isExecutionError}
                />
              </div>
            </div>
            <div className="text-right">
              <div>
                {formatBalanceAmount(transfer.sentAmount, transfer.token.decimals, transfer.token.symbol, {
                  isStable: transfer.token.isStable,
                })}
              </div>
              <div className="text-body-small text-slate-100">
                {formatRelativeDateWithComma(transfer.sentTimestamp)}
              </div>
            </div>
          </div>
        ))}

        {!isLoading && fundingHistory && fundingHistory.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-8 p-16 text-slate-100">
            <InfoIconComponent className="size-24" />
            <Trans>No funding activity</Trans>
          </div>
        )}
        {!isLoading && filteredFundingHistory?.length === 0 && fundingHistory && fundingHistory.length > 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-8 p-16 text-slate-100">
            <InfoIconComponent className="size-24" />
            <Trans>No funding activity matching your search</Trans>
          </div>
        )}
        {isLoading && (
          <div className="flex grow items-center justify-center p-16 text-slate-100">
            <TbLoader2 className="size-24 animate-spin" />
          </div>
        )}
      </VerticalScrollFadeContainer>
    </div>
  );
};

export const MainView = ({ account }: { account: string }) => {
  return (
    <div className="text-body-medium flex grow flex-col gap-8 overflow-y-hidden">
      <div className="flex flex-col gap-8 px-16 pb-20 pt-16">
        <Toolbar account={account} />
        <BalanceSection />
        <ActionButtons />
      </div>
      <FundingHistorySection />
    </div>
  );
};
