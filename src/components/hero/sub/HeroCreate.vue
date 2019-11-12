<template>
  <hero-wrapper>
    <div>
      <div v-if="step == 1">
        <b-row>
          <b-col md="12">
            <h1 class="text-white">List a Token</h1>
          </b-col>
        </b-row>
        <b-row>
          <b-col md="4">
            <transition name="slide-fade-down" mode="out-in">
              <div>
                <h3 class="text-white">Token Contract</h3>
                <b-form-input id="input-1" v-model="token1Contract" placeholder="eosio.token" trim></b-form-input>
              </div>
            </transition>
          </b-col>
          <b-col md="4" class="justify-content-center align-items-center" style="min-height: 230px">
            <transition name="fade" mode="out-in">
              <span>
                <h3 class="invisible">TECHDEBT</h3>
                <font-awesome-icon
                  class="fa-2x text-white cursor"
                  v-if="loading"
                  icon="circle-notch"
                  spin
                />
                <font-awesome-icon
                  class="fa-2x text-white cursor align-self-center"
                  v-else
                  icon="question"
                />
                <div class="text-white" v-if="failedToFindToken">Failed to find token</div>
              </span>
            </transition>
          </b-col>
          <b-col md="4">
            <transition name="slide-fade-up" mode="out-in">
              <div>
                <h3 class="text-white">Token Symbol</h3>
                <b-form-input id="input-1" v-model="token1SymbolName" placeholder="EOS" trim></b-form-input>
              </div>
            </transition>
          </b-col>
        </b-row>
      </div>
      <div v-else>
        <b-row>
          <b-col md="4">
            <transition name="slide-fade-down" mode="out-in">
              <token-amount-input
                :amount.sync="token1Amount"
                :symbol="token1SymbolName"
                :balance="token1UserBalance"
                :img="token1Img"
                :loadingBalance="balancesLoading"
              />
            </transition>
          </b-col>
          <b-col
            md="4"
            class="d-flex justify-content-center align-items-end"
            style="min-height: 230px"
          >
            <div>
              <transition name="fade" mode="out-in">
                <font-awesome-icon
                  icon="exchange-alt"
                  class="fa-2x text-white cursor"
                  @click="swapTokens"
                />
              </transition>
              <div class="mb-3 mt-3">
                <div class="text-white font-size-sm">
                  1 {{ token1SymbolName }} =
                  <span v-if="!rateLoading && !loadingTokens">{{ rate }}</span>
                  <span v-else>
                    <font-awesome-icon icon="circle-notch" spin />
                  </span>
                  {{ token2SymbolName }}
                </div>
              </div>
              <div class="d-flex justify-content-center">
                <b-btn @click="createRelay" variant="success" v-ripple class="px-4 py-2 d-block">
                  <font-awesome-icon
                    :icon="loadingTokens ? 'circle-notch' : 'plus'"
                    :spin="loadingTokens"
                    fixed-width
                    class="mr-2"
                  />
                  <span class="font-w700">Create Relay</span>
                </b-btn>
              </div>
            </div>
          </b-col>
          <b-col md="4">
            <transition name="slide-fade-up" mode="out-in">
              <token-amount-input
                :amount.sync="token2Amount"
                :symbol="token2SymbolName"
                :balance="token2UserBalance"
                :img="token2Img"
                :loadingBalance="balancesLoading"
              />
            </transition>
          </b-col>
        </b-row>
      </div>
    </div>
  </hero-wrapper>
</template>

<script lang="ts">
import { Watch, Component, Vue } from "vue-property-decorator";
import { vxm } from "@/store";
import { fetchTokenMeta, fetchTokenStats } from "@/api/helpers";
import HeroWrapper from "@/components/hero/HeroWrapper.vue";
import TokenAmountInput from "@/components/convert/TokenAmountInput.vue";
import { getBalance } from "@/api/helpers";

const debounce = require("lodash.debounce");

@Component({
  components: {
    HeroWrapper,
    TokenAmountInput
  }
})
export default class HeroConvert extends Vue {
  public debouncedCheckToken: any;

  token1Amount = "";
  token1SymbolName = "";
  token1SymbolPrecision = "";
  token1UserBalance = 0;
  token1Img = "";
  token1Contract = "";

  token2Amount = "";
  token2SymbolName = "BNT";
  token2SymbolPrecision = "10";
  token2UserBalance = 0;
  token2Img = "";
  token2Contract = "bntbntbntbnt";

  failedToFindToken = false;
  loading = false;
  balancesLoading = true
  step = 1;

  rateLoading = false;
  loadingTokens = false;

  get rate() {
    const reward = Number(this.token2Amount) / Number(this.token1Amount)
    return reward ? reward.toFixed(4) : '?'
  }


  @Watch("token1SymbolName")
  @Watch("token1Contract")
  onContractChange() {
    if (this.token1SymbolName && this.token1Contract) {
      this.debouncedCheckToken();
    }
  }

  createSmartTokenSymbol(ticker1: string, ticker2: string) {
    const maxSymbolLength = 7;
    if (ticker1.length + ticker2.length <= maxSymbolLength) {
      return ticker1 + ticker2;
    } else {
      return ticker1 + ticker2[0] + ticker2[2] + ticker2[3];
    }
  }

  swapTokens() {}

  async toggleRelay() {}

  async createRelay() {
    console.log("I should now be creating the relay");
  }

  async fetchPrecision(
    tokenContract: string,
    tokenSymbolName: string
  ): Promise<number> {
    const { max_supply } = await fetchTokenStats(
      tokenContract,
      tokenSymbolName
    );
    return max_supply.symbol.precision;
  }

  async fetchImage(imageUrl: string) {
    return new Promise((resolve, reject) => {
      let img = new Image();
      img.onload = () => {
        resolve();
      };
      img.src = imageUrl;
    });
  }

  async tokenIsValid() {
    // ToDo
    // Check a reserve doesn't already exist with the network token

    // Preload token images
    const [token1Meta, token2Meta] = await Promise.all([
      fetchTokenMeta(this.token1Contract, this.token1SymbolName),
      fetchTokenMeta(this.token2Contract, this.token2SymbolName)
    ]);

    await Promise.all([
      this.fetchImage(token1Meta.logo),
      this.fetchImage(token2Meta.logo)
    ]);

    this.token1Img = token1Meta.logo;
    this.token2Img = token2Meta.logo;

    this.step = 2;
    this.loading = false;

    this.fetchUserBalances();
  }

  async fetchUserBalances() {
    this.balancesLoading = true
    const [token1Balance, token2Balance] = await Promise.all([
      getBalance(this.token1Contract, this.token1SymbolName),
      getBalance(this.token2Contract, this.token2SymbolName)
    ]);

    this.token1UserBalance = Number(token1Balance.split(' ')[0]);
    this.token2UserBalance = Number(token2Balance.split(' ')[0]);
    this.balancesLoading = false
  }

  async checkTokenIsValid() {
    const contractName = this.token1Contract;
    const symbol = this.token1SymbolName;
    this.loading = true;

    try {
      const precision = await this.fetchPrecision(contractName, symbol);
      this.failedToFindToken = false;
      this.token1SymbolPrecision = String(precision);
      this.tokenIsValid();

      const smartTokenSymbol = this.createSmartTokenSymbol("BNT", symbol);

      // vxm.relay.draftNewRelay({
      //   smartTokenSymbol,
      //   precision: String(precision),
      //   symbolName: symbol,
      //   tokenContract: contractName
      // });

      // vxm.general.setHeroAction("relay");
      // this.$router.push({
      //   name: "Relay",
      //   params: { account: smartTokenSymbol, isDraft: "yes" }
      // });
    } catch (e) {
      this.failedToFindToken = true;
      this.loading = false;
    }
  }

  async created() {
    this.debouncedCheckToken = debounce(() => {
      this.checkTokenIsValid();
    }, 500);
  }
}
</script>

<style scoped lang="scss">
.slide-fade-up-enter-active {
  transition: all 0.3s ease;
}

.slide-fade-up-leave-active {
  transition: all 0.3s cubic-bezier(1, 0.5, 0.8, 1);
}

.slide-fade-up-enter
/* .slide-fade-leave-active below version 2.1.8 */

 {
  transform: translateY(75px);
  opacity: 0;
}

.slide-fade-up-leave-to
/* .slide-fade-leave-active below version 2.1.8 */

 {
  transform: translateY(-75px);
  opacity: 0;
}

.slide-fade-down-enter-active {
  transition: all 0.3s ease;
}

.slide-fade-down-leave-active {
  transition: all 0.3s cubic-bezier(1, 0.5, 0.8, 1);
}

.slide-fade-down-enter
/* .slide-fade-leave-active below version 2.1.8 */

 {
  transform: translateY(-75px);
  opacity: 0;
}

.slide-fade-down-leave-to
/* .slide-fade-leave-active below version 2.1.8 */

 {
  transform: translateY(75px);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s;
}

.fade-enter,
.fade-leave-to
/* .fade-leave-active below version 2.1.8 */

 {
  opacity: 0;
}
</style>