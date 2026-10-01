# AI.Token

**AI.Token** is being built around one simple idea: as AI continues to evolve, we should evolve with it.

Our goal is to explore new ways of combining AI, technology, and the crypto ecosystem to create useful tools, experiences, and opportunities for our community. Rather than building around a single trend, we want AI.Token to grow alongside the rapidly changing world of artificial intelligence.

We’re looking toward what comes next — experimenting with new ideas, developing AI-powered solutions, and finding practical ways this technology can help people.

**AI is moving fast. We plan to move with it.**

AI.Token — **Building for the AI-powered future.**

## Solana Market Terminal

The current app experience tracks up to 60 trending Solana pools, including meme and community tokens, with price changes, liquidity, trading volume, and buy/sell activity. Lightweight Charts provides candlesticks, interval selection, trend and horizontal drawing tools, and saved watchlists and chart drawings. Data is provided by GeckoTerminal and refreshes every 30 seconds.

The feed is a discovery list, not a complete registry of meme coins. Market data may be delayed or incomplete. The app does not execute market trades or provide financial advice.

The **Create coin** page prepares a Devnet coin request. Phantom shows a 0.65 SOL Mainnet transfer to the project wallet: 0.5 SOL for the request plus a 30% (0.15 SOL) security fee. An optional creator profile and social-links bundle costs an additional 0.1 SOL, making the transfer 0.75 SOL. The Solana network fee is separate. The server checks the selected amount, recipient, payer, and transaction before saving the request privately. Payment queues the request for creator-managed token creation; it is not an on-chain pool deposit and does not automatically mint or deliver tokens.

## Run

Install dependencies and start the market site and queue API together:

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal. The API prints a private owner token in development; use it at `/owner.html` to view and update requests. The token is not stored in browser storage.

The queue is stored in `data/coin-requests.json`. For deployment, set a strong `AI_TOKEN_OWNER_TOKEN` and a persistent `COIN_QUEUE_DATA_DIR` outside the static web root. Back up the queue file and run one API instance; this JSON store is for a small owner-managed queue, not multi-instance scaling. Point the `ai.token.com` DNS record at the deployed host and configure HTTPS there. Canonical metadata does not configure DNS or make the domain live by itself.
