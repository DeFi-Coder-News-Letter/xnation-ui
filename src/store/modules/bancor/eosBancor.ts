import { VuexModule, action, Module, mutation } from "vuex-class-component";
import {
  ProposedTransaction,
  ProposedConvertTransaction,
  TokenPrice,
  TradingModule,
  LiquidityModule,
  TokenPriceExtended,
  ViewToken,
  ConvertReturn,
  LiquidityParams,
  OpposingLiquidParams,
  OpposingLiquid,
  EosMultiRelay,
  AgnosticToken,
  CreatePoolModule,
  ModalChoice,
  NetworkChoice
} from "@/types/bancor";
import { bancorApi } from "@/api/bancor";
import {
  getTokenBalances,
  fetchRelays,
  getBalance,
  fetchTokenStats
} from "@/api/helpers";
import { Symbol, Asset, asset_to_number, number_to_asset } from "eos-common";
import { tableApi } from "@/api/TableWrapper";
import { multiContract } from "@/api/multiContractTx";
import { multiContractAction } from "@/contracts/multi";
import { vxm } from "@/store";
import axios, { AxiosResponse } from "axios";
import { rpc } from "@/api/rpc";

const getEosioTokenPrecision = async (
  symbol: string,
  contract: string
): Promise<number> => {
  const res = await rpc.get_table_rows({
    code: contract,
    table: "stat",
    scope: symbol
  });
  if (res.rows.length == 0) throw new Error("Failed to find token");
  return res.rows[0].supply.split(" ")[0].split(".")[1].length;
};

const chopSecondSymbol = (one: string, two: string, maxLength = 8) => {
  return one + two.slice(0, maxLength - one.length);
};

const chopSecondLastChar = (text: string, backUp: number) => {
  const secondLastIndex = text.length - backUp - 1;
  return text
    .split("")
    .filter((value, index) => index !== secondLastIndex)
    .join("");
};

const tokenStrategies: Array<(one: string, two: string) => string> = [
  chopSecondSymbol,
  (one, two) => chopSecondSymbol(one, chopSecondLastChar(two, 1)),
  (one, two) => chopSecondSymbol(one, chopSecondLastChar(two, 2)),
  (one, two) => chopSecondSymbol(one, chopSecondLastChar(two, 3))
];

const generateSmartTokenSymbol = async (
  symbolOne: string,
  symbolTwo: string,
  multiTokenContract: string
) => {
  for (const strat in tokenStrategies) {
    let draftedToken = tokenStrategies[strat](symbolOne, symbolTwo);
    try {
      await getEosioTokenPrecision(draftedToken, multiTokenContract);
    } catch (e) {
      return draftedToken;
    }
  }
  throw new Error("Failed to find a new SmartTokenSymbol!");
};

const tokenMetaDataEndpoint =
  "https://raw.githubusercontent.com/eoscafe/eos-airdrops/master/tokens.json";

interface TokenMeta {
  name: string;
  logo: string;
  logo_lg: string;
  symbol: string;
  account: string;
  chain: string;
}

const getTokenMeta = async (): Promise<TokenMeta[]> => {
  const res: AxiosResponse<{
    name: string;
    logo: string;
    logo_lg: string;
    symbol: string;
    account: string;
    chain: string;
  }[]> = await axios.get(tokenMetaDataEndpoint);
  return res.data.filter(
    token => token.chain.toLowerCase() == "eos" && token.symbol !== "KARMA"
  );
};

@Module({ namespacedPath: "eosBancor/" })
export class EosBancorModule extends VuexModule
  implements TradingModule, LiquidityModule, CreatePoolModule {
  tokensList: TokenPrice[] | TokenPriceExtended[] = [];
  relaysList: EosMultiRelay[] = [];
  usdPrice = 0;
  usdPriceOfBnt = 0;
  tokenMeta: TokenMeta[] = [];

  get wallet() {
    return "eos";
  }

  get newPoolTokenChoices() {
    return (networkToken: string): ModalChoice[] => {
      return this.tokenMeta
        .map(tokenMeta => ({
          symbol: tokenMeta.symbol,
          balance: "0",
          img: tokenMeta.logo
        }))
        .filter(
          (value, index, array) =>
            array.findIndex(token => value.symbol == token.symbol) == index
        )
        .filter(
          tokenMeta =>
            !this.relaysList.find(relay =>
              relay.reserves.every(
                reserve =>
                  reserve.symbol == tokenMeta.symbol ||
                  reserve.symbol == networkToken
              )
            )
        );
    };
  }

  get newNetworkTokenChoices(): NetworkChoice[] {
    return [
      {
        symbol: "BNT",
        balance: "0",
        img: this.tokenMetaObj("BNT").logo,
        usdValue: this.usdPriceOfBnt
      },
      {
        symbol: "USDB",
        balance: "0",
        img: this.tokenMetaObj("USDB").logo,
        usdValue: 1
      }
    ];
  }

  @action async createPool(poolParams: any): Promise<void> {
    console.log({ poolParams });
    const [
      [token1Symbol, token1Amount],
      [token2Symbol, token2Amount]
    ] = poolParams.reserves;
    const smartTokenSymbol = await generateSmartTokenSymbol(
      token1Symbol,
      token2Symbol,
      process.env.VUE_APP_SMARTTOKENCONTRACT!
    );
    console.log(smartTokenSymbol, "was smart token symbol");

    const token1Data = this.tokenMetaObj(token1Symbol);
    const token2Data = this.tokenMetaObj(token2Symbol);

    const token1Asset = number_to_asset(
      Number(token1Amount),
      new Symbol(
        token1Data.symbol,
        await getEosioTokenPrecision(token1Data.symbol, token1Data.account)
      )
    );
    const token2Asset = number_to_asset(
      Number(token2Amount),
      new Symbol(
        token2Data.symbol,
        await getEosioTokenPrecision(token2Data.symbol, token2Data.account)
      )
    );

    console.log("hitting kickStartRelay");
    const kickStartRelayActions = await multiContract.kickStartRelay(
      smartTokenSymbol,
      [
        {
          contract: token1Data.account,
          amount: token1Asset
        },
        {
          contract: token2Data.account,
          amount: token2Asset
        }
      ],
      100000000,
      poolParams.fee
    );
    console.log(kickStartRelayActions, "was TX actions!");

    // for (const action in kickStartRelayActions) {
    //   await this.triggerTx([kickStartRelayActions[action]])
    //   console.log("Success!")
    // }
    // kickStartRelayActions.forEach(action => this.triggerTx([action]))
    this.triggerTx(kickStartRelayActions);
  }

  get networkTokenUsdValue() {
    return (symbolName: string) =>
      symbolName == "BNT" ? this.usdPriceOfBnt : 1;
  }

  get bancorApiTokens(): ViewToken[] {
    // @ts-ignore
    return this.tokensList.map((token: TokenPrice | TokenPriceExtended) => ({
      symbol: token.code,
      name: token.name,
      price: token.price,
      liqDepth: token.liquidityDepth * this.usdPrice,
      logo: token.primaryCommunityImageName,
      change24h: token.change24h,
      volume24h: token.volume24h.USD,
      // @ts-ignore
      balance: token.balance || "0",
      source: "api"
    }));
  }

  get tokenMetaObj() {
    return (symbolName: string) => {
      const tokenMetaObj = this.tokenMeta.find(
        token => token.symbol == symbolName
      );
      if (!tokenMetaObj)
        throw new Error(`Failed to find token meta for ${symbolName}`);
      return tokenMetaObj;
    };
  }

  get relayTokens(): ViewToken[] {
    return this.relaysList
      .filter(relay =>
        relay.reserves.some(
          reserve => reserve.symbol == "BNT" || reserve.symbol == "USDB"
        )
      )
      .map(relay => {
        const networkTokenIndex = relay.reserves.findIndex(
          reserve => reserve.symbol == "BNT" || reserve.symbol == "USDB"
        )!;
        const tokenIndex = networkTokenIndex == 0 ? 1 : 0;
        const networkTokenIsBnt =
          relay.reserves[networkTokenIndex].symbol == "BNT";
        const symbol = relay.reserves[tokenIndex].symbol;
        const tokenMeta = this.tokenMeta.find(token => token.symbol == symbol);

        const liqDepth =
          relay.reserves[networkTokenIndex].amount *
          (networkTokenIsBnt ? this.usdPriceOfBnt : 1);

        return {
          symbol,
          name: symbol,
          price: 0,
          liqDepth,
          logo: (tokenMeta && tokenMeta.logo) || "",
          change24h: 0,
          volume24h: 0,
          balance: "0",
          source: "multi"
        };
      });
  }

  get tokens(): ViewToken[] {
    return this.bancorApiTokens
      .concat(this.relayTokens)
      .sort((a, b) => b.liqDepth - a.liqDepth)
      .filter(
        (token, index, array) =>
          array.findIndex(tokenX => tokenX.symbol == token.symbol) == index
      );
  }

  get token(): (arg0: string) => ViewToken {
    // @ts-ignore
    return (symbolName: string) => {
      const token = this.tokens.find(token => token.symbol == symbolName);
      if (!token) throw new Error("Failed to find token");
      if (token && !token.logo) {
        token["logo"] = "https://via.placeholder.com/50";
      }
      return token;
    };
  }

  get backgroundToken(): (arg0: string) => TokenPrice | TokenPriceExtended {
    return (symbolName: string) => {
      const res = this.tokensList.find(token => token.code == symbolName);
      if (!res)
        throw new Error(`Failed to find ${symbolName} on this.tokensList`);
      return res;
    };
  }

  get relay() {
    return (symbolName: string) => {
      const relay = this.relays.find(
        (relay: any) => relay.smartTokenSymbol == symbolName
      );
      if (!relay)
        throw new Error(`Failed to find relay with ID of ${symbolName}`);
      return relay;
    };
  }

  get relays() {
    return this.relaysList
      .map(relay => ({
        ...relay,
        symbol: relay.reserves.find(reserve => reserve.symbol !== "BNT")!
          .symbol,
        smartTokenSymbol: relay.smartToken.symbol,
        liqDepth: relay.reserves.find(reserve => reserve.symbol == "BNT")
          ? relay.reserves.find(reserve => reserve.symbol == "BNT")!.amount *
            this.usdPriceOfBnt
          : relay.reserves.find(reserve => reserve.symbol == "USDB")
          ? relay.reserves.find(reserve => reserve.symbol == "USDB")!.amount
          : 0,
        reserves: relay.reserves
          .map((reserve: AgnosticToken) => ({
            ...reserve,
            logo: [this.token(reserve.symbol).logo]
          }))
          .sort(reserve => (reserve.symbol == "USDB" ? -1 : 1))
          .sort(reserve => (reserve.symbol == "BNT" ? -1 : 1))
      }))
      .sort((a, b) => b.liqDepth - a.liqDepth);
  }

  @action async fetchUsdPrice() {
    this.setUsdPrice(Number(await bancorApi.getRate("BNT", "USD")));
  }

  @action async init() {
    const [
      usdValueOfEth,
      tokens,
      relays,
      usdPriceOfBnt,
      tokenMeta
    ] = await Promise.all([
      bancorApi.getTokenTicker("ETH"),
      bancorApi.getTokens(),
      fetchRelays(),
      bancorApi.getRate("BNT", "USD"),
      getTokenMeta()
    ]);
    this.setUsdPrice(Number(usdValueOfEth.price));
    this.setBntPrice(Number(usdPriceOfBnt));
    this.refreshBalances();
    console.log(relays, "are relays");
    this.setRelays(relays);
    this.setTokens(tokens);
    this.setTokenMeta(tokenMeta);
  }

  @action async refreshBalances(symbols: string[] = []) {
    // @ts-ignore
    const isAuthenticated = this.$store.rootGetters[
      "eosWallet/isAuthenticated"
    ];
    if (!isAuthenticated) return;
    const balances = await getTokenBalances(isAuthenticated);

    this.setTokens(
      // @ts-ignore
      this.tokensList.map((token: any) => {
        const existingToken = balances.tokens.find(
          balanceObj => balanceObj.symbol == token.code
        );
        return {
          ...token,
          balance: (existingToken && String(existingToken.amount)) || "0",
          ...(existingToken && { contract: existingToken.contract })
        };
      })
    );
  }

  @action async addLiquidity({
    fundAmount,
    smartTokenSymbol,
    token1Amount,
    token1Symbol,
    token2Amount,
    token2Symbol
  }: LiquidityParams) {
    const relay = this.relay(smartTokenSymbol);
    const deposits = [
      { symbol: token1Symbol, amount: token1Amount },
      { symbol: token2Symbol, amount: token2Amount }
    ];
    const tokenAmounts = deposits.map(deposit => {
      const { precision, contract, symbol } = relay.reserves.find(
        reserve => reserve.symbol == deposit.symbol
      )!;
      return {
        contract,
        amount: number_to_asset(
          Number(deposit.amount),
          new Symbol(symbol, precision)
        )
      };
    });

    const addLiquidityActions = multiContract.addLiquidityActions(
      smartTokenSymbol,
      // @ts-ignore
      tokenAmounts
    );
    const fundAction = multiContractAction.fund(
      vxm.wallet.isAuthenticated,
      number_to_asset(
        Number(fundAmount),
        new Symbol(smartTokenSymbol, 4)
      ).to_string()
    );

    const actions = [...addLiquidityActions, fundAction];
    return this.triggerTx(actions);
  }

  @action async removeLiquidity({
    fundAmount,
    smartTokenSymbol
  }: LiquidityParams) {}

  @action async getUserBalances(symbolName: string) {
    const relay = this.relay(symbolName);
    const [
      token1Balance,
      token2Balance,
      smartTokenBalance,
      [token1, token2],
      supply
    ] = await Promise.all([
      getBalance(relay.reserves[0].contract, relay.reserves[0].symbol),
      getBalance(relay.reserves[1].contract, relay.reserves[1].symbol),
      getBalance(relay.smartToken.contract, relay.smartToken.symbol),
      tableApi.getReservesMulti(symbolName),
      fetchTokenStats(relay.smartToken.contract, symbolName)
    ]);

    const smartSupply = asset_to_number(supply.supply);
    const token1ReserveBalance = asset_to_number(token1.balance);
    const token2ReserveBalance = asset_to_number(token2.balance);

    const percent = asset_to_number(new Asset(smartTokenBalance)) / smartSupply;
    const token1MaxWithdraw = percent * token1ReserveBalance;
    const token2MaxWithdraw = percent * token2ReserveBalance;

    return {
      token1MaxWithdraw: `${token1MaxWithdraw}`,
      token2MaxWithdraw: `${token2MaxWithdraw}`,
      token1Balance: token1Balance.split(" ")[0],
      token2Balance: token2Balance.split(" ")[0],
      smartTokenBalance
    };
  }

  @action async calculateOpposingDeposit(
    suggestedDeposit: OpposingLiquidParams
  ): Promise<OpposingLiquid> {
    const relay = this.relay(suggestedDeposit.smartTokenSymbol);
    const [tokenReserves, supply] = await Promise.all([
      tableApi.getReservesMulti(suggestedDeposit.smartTokenSymbol),
      fetchTokenStats(
        relay.smartToken.contract,
        suggestedDeposit.smartTokenSymbol
      )
    ]);

    const smartSupply = asset_to_number(supply.supply);

    const sameReserve = tokenReserves.find(
      reserve =>
        reserve.balance.symbol.code().to_string() ==
        suggestedDeposit.tokenSymbol
    )!;
    const opposingReserve = tokenReserves.find(
      reserve =>
        reserve.balance.symbol.code().to_string() !==
        suggestedDeposit.tokenSymbol
    )!;

    const reserveBalance = asset_to_number(sameReserve.balance);
    const percent = Number(suggestedDeposit.tokenAmount) / reserveBalance;

    return {
      opposingAmount: String(
        percent * asset_to_number(opposingReserve.balance)
      ),
      smartTokenAmount: String(percent * smartSupply)
    };
  }

  @action async calculateOpposingWithdraw(
    suggestWithdraw: OpposingLiquidParams
  ): Promise<OpposingLiquid> {
    const relay = this.relay(suggestWithdraw.smartTokenSymbol);
    const [tokenReserves, supply, smartUserBalanceString] = await Promise.all([
      tableApi.getReservesMulti(suggestWithdraw.smartTokenSymbol),
      fetchTokenStats(
        relay.smartToken.contract,
        suggestWithdraw.smartTokenSymbol
      ),
      getBalance(relay.smartToken.contract, relay.smartToken.symbol) as Promise<
        string
      >
    ]);
    const smartUserBalance = new Asset(smartUserBalanceString);
    const smartSupply = asset_to_number(supply.supply);
    const sameReserve = tokenReserves.find(
      reserve =>
        reserve.balance.symbol.code().to_string() == suggestWithdraw.tokenSymbol
    )!;
    const opposingReserve = tokenReserves.find(
      reserve =>
        reserve.balance.symbol.code().to_string() !==
        suggestWithdraw.tokenSymbol
    )!;

    const reserveBalance = asset_to_number(sameReserve.balance);
    const percent = Number(suggestWithdraw.tokenAmount) / reserveBalance;

    const smartTokenAmount = percent * smartSupply;

    return {
      opposingAmount: String(
        percent * asset_to_number(opposingReserve.balance)
      ),
      smartTokenAmount:
        smartTokenAmount / asset_to_number(smartUserBalance) > 0.99
          ? String(asset_to_number(smartUserBalance))
          : String(smartTokenAmount)
    };
  }

  // Focus Symbol is called when the UI focuses on a Symbol
  // Should have token balances
  // Could be an oppurtunity to get precision
  @action async focusSymbol(symbolName: string) {}

  @action async convert({
    fromAmount,
    fromSymbol,
    toAmount,
    toSymbol
  }: ProposedConvertTransaction) {
    // @ts-ignore
    const accountName = this.$store.rootState.eosWallet.walletState.auth
      .accountName;
    const [fromObj, toObj] = await Promise.all([
      this.getEosTokenWithDecimals(fromSymbol),
      this.getEosTokenWithDecimals(toSymbol)
    ]);

    const res = await bancorApi.convert({
      fromCurrencyId: fromObj.id,
      toCurrencyId: toObj.id,
      amount: String((fromAmount * Math.pow(10, fromObj.decimals)).toFixed(0)),
      minimumReturn: String(
        (toAmount * 0.98 * Math.pow(10, toObj.decimals)).toFixed(0)
      ),
      ownerAddress: accountName
    });

    const { actions } = res.data[0];
    const txRes = await this.triggerTx(actions);
    return txRes.transaction_id;
  }

  @action async getEosTokenWithDecimals(symbolName: string): Promise<any> {
    const token = this.backgroundToken(symbolName);
    // @ts-ignore
    if (token.decimals) {
      return token;
    } else {
      const detailApiInstance = await bancorApi.getTokenTicker(symbolName);
      this.setTokens(
        // @ts-ignore
        this.tokensList.map(
          (existingToken: TokenPrice | TokenPriceExtended) => ({
            ...existingToken,
            ...(existingToken.code == symbolName && {
              decimals: detailApiInstance.decimals
            })
          })
        )
      );
      return this.getEosTokenWithDecimals(symbolName);
    }
  }

  @action async getReturn({
    fromSymbol,
    toSymbol,
    amount
  }: ProposedTransaction): Promise<ConvertReturn> {
    const [fromToken, toToken] = await Promise.all([
      this.getEosTokenWithDecimals(fromSymbol),
      this.getEosTokenWithDecimals(toSymbol)
    ]);

    const reward = await bancorApi.calculateReturn(
      fromToken.id,
      toToken.id,
      String(amount * Math.pow(10, fromToken.decimals))
    );
    return { amount: String(Number(reward) / Math.pow(10, toToken.decimals)) };
  }

  @action async getCost({
    fromSymbol,
    toSymbol,
    amount
  }: ProposedTransaction): Promise<ConvertReturn> {
    const [fromToken, toToken] = await Promise.all([
      this.getEosTokenWithDecimals(fromSymbol),
      this.getEosTokenWithDecimals(toSymbol)
    ]);
    const result = await bancorApi.calculateCost(
      fromToken.id,
      toToken.id,
      String(amount * Math.pow(10, toToken.decimals))
    );
    return {
      amount: String(Number(result) / Math.pow(10, fromToken.decimals))
    };
  }

  @action async triggerTx(actions: any[]) {
    // @ts-ignore
    return this.$store.dispatch("eosWallet/tx", actions, { root: true });
  }

  @mutation setRelays(relays: EosMultiRelay[]) {
    this.relaysList = relays;
  }

  @mutation setTokens(tokens: any[]) {
    this.tokensList = tokens.map((token: any) => {
      if (token.code == "BNT") {
        return { ...token, decimals: 10 };
      } else {
        return token;
      }
    });
  }

  @mutation setBntPrice(price: number) {
    this.usdPriceOfBnt = price;
  }

  @mutation setTokenMeta(tokens: TokenMeta[]) {
    this.tokenMeta = tokens;
  }

  @mutation setUsdPrice(price: number) {
    this.usdPrice = price;
  }
}

export const eosBancor = EosBancorModule.ExtractVuexModule(EosBancorModule);
