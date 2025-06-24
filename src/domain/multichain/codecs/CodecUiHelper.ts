import { addressToBytes32 } from "@layerzerolabs/lz-v2-utilities";
import { Address, concatHex, encodeAbiParameters, Hex, isHex, toHex } from "viem";

import { MultichainRelayParamsPayload } from "domain/synthetics/express";
import type { ContractsChainId, SettlementChainId } from "sdk/configs/chains";
import { getContract } from "sdk/configs/contracts";

export enum MultichainActionType {
  None = 0,
  Deposit = 1,
  GlvDeposit = 2,
  BridgeOut = 3,
  SetTraderReferralCode = 4,
}

type CommonActionData = {
  relayParams: MultichainRelayParamsPayload;
  signature: string;
};

type SetTraderReferralCodeActionData = CommonActionData & {
  referralCode: string;
};

type SetTraderReferralCodeAction = {
  actionType: MultichainActionType.SetTraderReferralCode;
  actionData: SetTraderReferralCodeActionData;
};

const RELAY_PARAMS_TYPE = {
  type: "tuple",
  name: "",
  components: [
    {
      type: "tuple",
      name: "oracleParams",
      components: [
        { type: "address[]", name: "tokens" },
        { type: "address[]", name: "providers" },
        { type: "bytes[]", name: "data" },
      ],
    },
    {
      type: "tuple",
      name: "externalCalls",
      components: [
        { type: "address[]", name: "sendTokens" },
        { type: "uint256[]", name: "sendAmounts" },
        { type: "address[]", name: "externalCallTargets" },
        { type: "bytes[]", name: "externalCallDataList" },
        { type: "address[]", name: "refundTokens" },
        { type: "address[]", name: "refundReceivers" },
      ],
    },
    {
      type: "tuple[]",
      name: "tokenPermits",
      components: [
        { type: "address", name: "owner" },
        { type: "address", name: "spender" },
        { type: "uint256", name: "value" },
        { type: "uint256", name: "deadline" },
        { type: "address", name: "token" },
      ],
    },
    {
      type: "tuple",
      name: "fee",
      components: [
        { type: "address", name: "feeToken" },
        { type: "uint256", name: "feeAmount" },
        { type: "address[]", name: "feeSwapPath" },
      ],
    },
    { type: "uint256", name: "userNonce" },
    { type: "uint256", name: "deadline" },
    { type: "bytes", name: "signature" },
    { type: "uint256", name: "desChainId" },
  ],
} as const;

export type MultichainAction = SetTraderReferralCodeAction;

export class CodecUiHelper {
  public static encodeDepositMessage(account: string, data?: string): string {
    return encodeAbiParameters([{ type: "address" }, { type: "bytes" }], [account as Address, (data as Hex) ?? "0x"]);
  }

  public static encodeComposeMsg(composeFromAddress: string, msg: string) {
    if (!isHex(msg)) {
      throw new Error("msg must start with 0x");
    }

    const composeFrom = toHex(addressToBytes32(composeFromAddress));

    const composeFromWithMsg = concatHex([composeFrom, msg]);

    return composeFromWithMsg;
  }

  public static composeDepositMessage(dstChainId: SettlementChainId, account: string, data?: string) {
    const msg = CodecUiHelper.encodeDepositMessage(account, data);
    return CodecUiHelper.encodeComposeMsg(CodecUiHelper.getLzEndpoint(dstChainId), msg);
  }

  public static getLzEndpoint(chainId: ContractsChainId): Address {
    const layerZeroEndpoint = getContract(chainId, "LayerZeroEndpoint");

    return layerZeroEndpoint;
  }

  public static encodeMultichainActionData(action: MultichainAction): string {
    if (action.actionType === MultichainActionType.SetTraderReferralCode) {
      const actionData = encodeAbiParameters(
        [RELAY_PARAMS_TYPE, { type: "bytes32" }],
        [
          { ...(action.actionData.relayParams as any), signature: action.actionData.signature as Hex },
          action.actionData.referralCode as Hex,
        ]
      );

      const data = encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [action.actionType, actionData]);

      return data;
    }

    throw new Error("Unsupported multichain action type");
  }
}
