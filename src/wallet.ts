/**
 * Browser wallet connection.
 *
 * Until now the live backend signed with a throwaway account created at page
 * load, which is fine for reading and useless for anything a visitor should be
 * able to do themselves. This connects a real wallet instead, so the person
 * looking at the book can fund a pool and bind a bond as themselves.
 *
 * Studio Next is chain 61997. A wallet pointed at any other chain will happily
 * sign transactions that go nowhere, so the chain is checked on connect and
 * added if the wallet has never seen it.
 */

export const STUDIO_NEXT = {
  chainIdDecimal: 61997,
  chainIdHex: "0xF22D", // 61997
  chainName: "GenLayer Studio Next",
  rpcUrls: ["https://studio-next.genlayer.com/api"],
  blockExplorerUrls: ["https://explorer-studio-dev.genlayer.com"],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
} as const;

export interface WalletState {
  address: string | null;
  chainOk: boolean;
  available: boolean;
}

type Listener = (state: WalletState) => void;

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

function provider(): Eip1193Provider | null {
  const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
  return injected ?? null;
}

export class Wallet {
  #listeners = new Set<Listener>();
  #state: WalletState = {
    address: null,
    chainOk: false,
    available: provider() !== null,
  };

  get state(): Readonly<WalletState> {
    return this.#state;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  #set(patch: Partial<WalletState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }

  /**
   * Reconnect silently if the wallet already has this site authorised, so a
   * reload doesn't make the visitor click again. Never prompts.
   */
  async restore(): Promise<void> {
    const eth = provider();
    if (!eth) return;
    try {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      if (accounts?.length) {
        this.#set({ address: accounts[0]!, chainOk: await this.#onStudioNext() });
      }
    } catch {
      // An unauthorised or locked wallet throws here. Not an error worth showing.
    }
    this.#watch();
  }

  /** Prompt to connect, then make sure the wallet is pointed at chain 61997. */
  async connect(): Promise<void> {
    const eth = provider();
    if (!eth) {
      throw new Error(
        "No browser wallet found. Install MetaMask, or explore the simulated market — it needs no wallet.",
      );
    }

    const accounts = (await eth.request({
      method: "eth_requestAccounts",
    })) as string[];
    if (!accounts?.length) throw new Error("No account was authorised.");

    this.#set({ address: accounts[0]!, chainOk: await this.#onStudioNext() });
    if (!this.#state.chainOk) await this.switchChain();
    this.#watch();
  }

  disconnect(): void {
    // EIP-1193 has no revoke, so this forgets the account locally. The wallet
    // still holds the authorisation; disconnecting there is the user's call.
    this.#set({ address: null, chainOk: false });
  }

  async #onStudioNext(): Promise<boolean> {
    const eth = provider();
    if (!eth) return false;
    try {
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      return Number.parseInt(id, 16) === STUDIO_NEXT.chainIdDecimal;
    } catch {
      return false;
    }
  }

  /** Ask the wallet to switch, adding the network if it isn't known yet. */
  async switchChain(): Promise<void> {
    const eth = provider();
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: STUDIO_NEXT.chainIdHex }],
      });
    } catch (error) {
      // 4902 means the wallet has never heard of this chain.
      const code = (error as { code?: number }).code;
      if (code !== 4902) throw error;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: STUDIO_NEXT.chainIdHex,
            chainName: STUDIO_NEXT.chainName,
            rpcUrls: [...STUDIO_NEXT.rpcUrls],
            blockExplorerUrls: [...STUDIO_NEXT.blockExplorerUrls],
            nativeCurrency: STUDIO_NEXT.nativeCurrency,
          },
        ],
      });
    }
    this.#set({ chainOk: await this.#onStudioNext() });
  }

  #watching = false;

  /** Account and chain can change in the wallet without touching this page. */
  #watch(): void {
    const eth = provider();
    if (!eth?.on || this.#watching) return;
    this.#watching = true;

    eth.on("accountsChanged", (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      this.#set({ address: accounts.length ? accounts[0]! : null });
    });

    eth.on("chainChanged", () => {
      // Re-read rather than trust the event payload's formatting.
      void this.#onStudioNext().then((chainOk) => this.#set({ chainOk }));
    });
  }
}
