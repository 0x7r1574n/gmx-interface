import { t } from "@lingui/macro";
import React, { createContext, useCallback, useContext, useMemo } from "react";
import { toast } from "react-toastify";

import { getSubaccountApprovalKey, getSubaccountConfigKey } from "config/localStorage";
import { generateSubaccount } from "domain/synthetics/subaccount/generateSubaccount";
import { removeSubaccountTxn } from "domain/synthetics/subaccount/removeSubaccount";
import { SignedSubbacountApproval, Subaccount, SubaccountSerializedConfig } from "domain/synthetics/subaccount/types";
import { useSubaccountOnchainData } from "domain/synthetics/subaccount/useSubaccountOnchainData";
import {
  getActualApproval,
  getInitialSubaccountApproval,
  getSubaccountSigner,
  signUpdatedSubaccountSettings,
} from "domain/synthetics/subaccount/utils";
import { useChainId } from "lib/chains";
import { helperToast } from "lib/helperToast";
import { useLocalStorageSerializeKey } from "lib/localStorage";
import { metrics } from "lib/metrics";
import { sleep } from "lib/sleep";
import useWallet from "lib/wallets/useWallet";

import { StatusNotification } from "components/Synthetics/StatusNotification/StatusNotification";
import { TransactionStatus } from "components/TransactionStatus/TransactionStatus";

export type SubaccountState = {
  subaccountConfig: SubaccountSerializedConfig | undefined;
  subaccount: Subaccount | undefined;
  updateSubaccountSettings: (params: { nextRemainigActions?: bigint; nextRemainingSeconds?: bigint }) => Promise<void>;
  resetSubaccountApproval: () => void;
  tryEnableSubaccount: () => Promise<boolean>;
  tryDisableSubaccount: () => Promise<boolean>;
  refreshSubaccountData: () => void;
};

const SubaccountContext = createContext<SubaccountState | undefined>(undefined);

export function useSubaccountContext() {
  const context = useContext(SubaccountContext);
  if (!context) {
    throw new Error("useSubaccount must be used within SubaccountContextProvider");
  }
  return context;
}

export function SubaccountContextProvider({ children }: { children: React.ReactNode }) {
  const { chainId } = useChainId();
  const { signer } = useWallet();

  const {
    subaccountConfig,
    signedApproval,
    setSubaccountConfig,
    setSignedApproval,
    resetStoredApproval,
    resetStoredConfig,
  } = useStoredSubaccountData(chainId, signer?.address);

  const { subaccountData, refreshSubaccountData } = useSubaccountOnchainData(chainId, {
    account: signer?.address,
    subaccountAddress: subaccountConfig?.address,
  });

  const subaccount: Subaccount | undefined = useMemo(() => {
    if (!subaccountConfig?.isNew || !signer?.address || !subaccountData || !signer?.provider) {
      return undefined;
    }

    const subaccountSigner = getSubaccountSigner(subaccountConfig, signer?.address, signer?.provider);

    return {
      address: subaccountConfig.address,
      signer: subaccountSigner,
      onchainData: subaccountData,
      signedApproval: getActualApproval({
        address: subaccountConfig.address,
        onchainData: subaccountData,
        signedApproval,
      }),
    };
  }, [signedApproval, signer?.address, signer?.provider, subaccountConfig, subaccountData]);

  const updateSubaccountSettings = useCallback(
    async function updateSubaccountSettings({
      nextRemainigActions,
      nextRemainingSeconds,
    }: {
      nextRemainigActions?: bigint;
      nextRemainingSeconds?: bigint;
    }) {
      if (!signer || !subaccount?.address) {
        return;
      }

      helperToast.success(
        <StatusNotification key="updateSubaccountSettings" title={t`Update 1CT (One-Click Trading) settings`}>
          <TransactionStatus status="loading" text={t`Updating settings...`} />
        </StatusNotification>
      );

      try {
        const signedSubaccountApproval = await signUpdatedSubaccountSettings({
          chainId,
          signer,
          subaccount,
          nextRemainigActions,
          nextRemainingSeconds,
        });

        helperToast.success(
          <StatusNotification key="updateSubaccountSettingsSuccess" title={t`Update 1CT (One-Click Trading) settings`}>
            <TransactionStatus status="success" text={t`settings updated`} />
          </StatusNotification>
        );
        setSignedApproval(signedSubaccountApproval);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        metrics.pushError(error, "subaccount.updateSubaccountSettings");
        toast.dismiss();
        helperToast.error(
          <StatusNotification key="updateSubaccountSettingsError" title={t`Update 1CT (One-Click Trading) settings`}>
            <TransactionStatus status="error" text={t`Failed to update settings`} />
          </StatusNotification>
        );
      }
    },
    [signer, subaccount, chainId, setSignedApproval]
  );

  const resetSubaccountApproval = useCallback(() => {
    setSignedApproval(undefined);
    refreshSubaccountData();
  }, [refreshSubaccountData, setSignedApproval]);

  const tryEnableSubaccount = useCallback(async () => {
    if (!signer?.provider) {
      return false;
    }

    let config = subaccountConfig;

    if (!config?.address) {
      try {
        helperToast.success(
          <StatusNotification key="generateSubaccount" title={t`Generating 1CT (One-Click Trading) session`}>
            <TransactionStatus status="loading" text={t`Generating session...`} />
          </StatusNotification>
        );

        config = await generateSubaccount(signer);

        setSubaccountConfig(config);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);

        helperToast.error(
          <StatusNotification key="generateSubaccountError" title={t`Generate 1CT (One-Click Trading) session`}>
            <TransactionStatus status="error" text={t`Failed to generate session`} />
          </StatusNotification>
        );
        metrics.pushError(error, "subaccount.generateSubaccount");
        return false;
      }
    }

    if (!config.address) {
      const error = "Missed subaccount config";
      // eslint-disable-next-line no-console
      console.error(error);
      await sleep(1).then(() =>
        helperToast.error(
          <StatusNotification key="generateSubaccountError" title={t`Generate 1CT (One-Click Trading) session`}>
            <TransactionStatus status="error" text={t`Failed to generate session`} />
          </StatusNotification>
        )
      );

      metrics.pushError(error, "subaccount.missedSubaccountConfigAfterGeneration");
      resetStoredConfig();
      return false;
    }

    try {
      helperToast.success(
        <StatusNotification key="signDefaultApproval" title={t`Signing 1CT (One-Click Trading) approval`}>
          <TransactionStatus status="loading" text={t`Signing approval...`} />
        </StatusNotification>
      );

      const defaultSubaccountApproval = await getInitialSubaccountApproval({
        chainId,
        signer,
        provider: signer?.provider,
        subaccountAddress: config!.address,
      });

      helperToast.success(
        <StatusNotification key="signDefaultApprovalSuccess" title={t`Signing 1CT (One-Click Trading) approval`}>
          <TransactionStatus status="success" text={t`Approval signed`} />
        </StatusNotification>
      );

      setSignedApproval(defaultSubaccountApproval);

      if (!config.isNew) {
        setSubaccountConfig({ ...config, isNew: true });
      }

      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      // toast.dismiss(toastId);
      metrics.pushError(error, "subaccount.signDefaultApproval");
      helperToast.error(
        <StatusNotification key="signDefaultApprovalError" title={t`Signing 1CT (One-Click Trading) approval`}>
          <TransactionStatus status="error" text={t`Failed to sign approval`} />
        </StatusNotification>
      );
      return false;
    }
  }, [signer, subaccountConfig, setSubaccountConfig, resetStoredConfig, chainId, setSignedApproval]);

  const tryDisableSubaccount = useCallback(async () => {
    if (!signer || !subaccount?.address) {
      return false;
    }

    helperToast.success(
      <StatusNotification title={t`Deactivate 1CT (One-Click Trading)`}>
        <TransactionStatus status="loading" text={t`Deactivating...`} />
      </StatusNotification>
    );

    try {
      await removeSubaccountTxn(chainId, signer, subaccount.address);

      helperToast.success(
        <StatusNotification title={t`Deactivate 1CT (One-Click Trading)`}>
          <TransactionStatus status="success" text={t`Deactivated`} />
        </StatusNotification>
      );

      resetStoredApproval();
      resetStoredConfig();
      refreshSubaccountData();
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      metrics.pushError(error, "subaccount.tryDisableSubaccount");
      helperToast.error(
        <StatusNotification title={t`Deactivate 1CT (One-Click Trading)`}>
          <TransactionStatus status="error" text={t`Failed to deactivate`} />
        </StatusNotification>
      );
      return false;
    }
  }, [signer, subaccount, chainId, resetStoredApproval, resetStoredConfig, refreshSubaccountData]);

  const state: SubaccountState = useMemo(() => {
    return {
      subaccountConfig,
      subaccount,
      updateSubaccountSettings,
      resetSubaccountApproval,
      tryEnableSubaccount,
      tryDisableSubaccount,
      refreshSubaccountData,
    };
  }, [
    subaccount,
    subaccountConfig,
    updateSubaccountSettings,
    resetSubaccountApproval,
    tryEnableSubaccount,
    tryDisableSubaccount,
    refreshSubaccountData,
  ]);

  return <SubaccountContext.Provider value={state}>{children}</SubaccountContext.Provider>;
}

function useStoredSubaccountData(chainId: number, account: string | undefined) {
  const [subaccountConfig, setSubaccountConfig] = useLocalStorageSerializeKey<SubaccountSerializedConfig | undefined>(
    getSubaccountConfigKey(chainId, account),
    undefined,
    {
      raw: false,
      serializer: (val) => {
        if (!val) {
          return "";
        }

        return JSON.stringify(val);
      },
      deserializer: (stored) => {
        if (!stored) {
          return undefined;
        }

        try {
          const parsed = JSON.parse(stored);

          if (!parsed.address || !parsed.privateKey) {
            return undefined;
          }

          return parsed;
        } catch (e) {
          return undefined;
        }
      },
    }
  );

  const [signedApproval, setSignedApproval] = useLocalStorageSerializeKey<SignedSubbacountApproval | undefined>(
    getSubaccountApprovalKey(chainId, account),
    undefined,
    {
      raw: false,
      serializer: (val) => {
        if (!val) {
          return "";
        }

        return JSON.stringify(val);
      },
      deserializer: (stored) => {
        if (!stored) {
          return undefined;
        }

        try {
          const parsed = JSON.parse(stored);
          return {
            ...parsed,
            maxAllowedCount: BigInt(parsed.maxAllowedCount),
            expiresAt: BigInt(parsed.expiresAt),
            deadline: BigInt(parsed.deadline),
            nonce: BigInt(parsed.nonce),
          };
        } catch (e) {
          return undefined;
        }
      },
    }
  );

  return useMemo(() => {
    function resetStoredApproval() {
      setSignedApproval(null as any);
    }

    function resetStoredConfig() {
      setSubaccountConfig(null as any);
    }

    return {
      subaccountConfig,
      signedApproval,
      setSubaccountConfig,
      setSignedApproval,
      resetStoredApproval,
      resetStoredConfig,
    };
  }, [subaccountConfig, signedApproval, setSubaccountConfig, setSignedApproval]);
}
