import values from "lodash/values";

import type { SortDirection } from "context/SorterContext/types";
import { MarketTokensAPRData, MarketsInfoData, getMintableMarketTokens } from "domain/synthetics/markets";
import { convertToUsd, type TokensData } from "domain/synthetics/tokens";

import type { SortField } from "./GmList";
import { sortGmTokensDefault } from "./sortGmTokensDefault";

export function sortGmTokensByField({
  marketsInfo,
  marketTokensData,
  orderBy,
  direction,
  marketsTokensApyData,
  marketsTokensIncentiveAprData,
  marketsTokensLidoAprData,
}: {
  marketsInfo: MarketsInfoData;
  marketTokensData: TokensData;
  orderBy: SortField;
  direction: SortDirection;
  marketsTokensApyData: MarketTokensAPRData | undefined;
  marketsTokensIncentiveAprData: MarketTokensAPRData | undefined;
  marketsTokensLidoAprData: MarketTokensAPRData | undefined;
}) {
  const gmTokens = values(marketTokensData);

  const directionMultiplier = direction === "asc" ? 1 : -1;
  if (orderBy === "price") {
    return gmTokens.sort((a, b) => {
      return a.prices.minPrice > b.prices.minPrice ? directionMultiplier : -directionMultiplier;
    });
  }

  if (orderBy === "totalSupply") {
    return gmTokens.sort((a, b) => {
      return (a.totalSupply ?? 0n) > (b.totalSupply ?? 0n) ? directionMultiplier : -directionMultiplier;
    });
  }

  if (orderBy === "buyable") {
    return gmTokens.sort((a, b) => {
      const marketA = marketsInfo[a.address];
      const marketB = marketsInfo[b.address];

      const mintableA = getMintableMarketTokens(marketA, a);
      const mintableB = getMintableMarketTokens(marketB, b);

      return (mintableA?.mintableUsd ?? 0n) > (mintableB?.mintableUsd ?? 0n)
        ? directionMultiplier
        : -directionMultiplier;
    });
  }

  if (orderBy === "wallet") {
    return gmTokens.sort((a, b) => {
      const aUsd = convertToUsd(a.balance, a.decimals, a.prices.minPrice) ?? 0n;
      const bUsd = convertToUsd(b.balance, b.decimals, b.prices.minPrice) ?? 0n;

      return aUsd > bUsd ? directionMultiplier : -directionMultiplier;
    });
  }

  if (orderBy === "apy") {
    return gmTokens.sort((a, b) => {
      const bonusAprA = marketsTokensIncentiveAprData?.[a.address] ?? 0n;
      const lidoAprA = marketsTokensLidoAprData?.[a.address] ?? 0n;
      let aprA = bonusAprA + lidoAprA;

      aprA += marketsTokensApyData?.[a.address] ?? 0n;

      const bonusAprB = marketsTokensIncentiveAprData?.[b.address] ?? 0n;
      const lidoAprB = marketsTokensLidoAprData?.[b.address] ?? 0n;
      let aprB = bonusAprB + lidoAprB;

      aprB += marketsTokensApyData?.[b.address] ?? 0n;

      return aprA > aprB ? directionMultiplier : -directionMultiplier;
    });
  }

  return sortGmTokensDefault(marketsInfo, marketTokensData);
}
