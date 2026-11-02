£xodus.wallet — Withdrawal and pricing fixes (V12)

This package updates the existing front-end without changing the overall dashboard layout.

CHANGES
1. Portfolio pricing now requests prices independently per asset. A failed price lookup for one token no longer blanks the entire portfolio.
2. BTC, ETH and USDT price lookup tries Coinbase's public spot-price endpoint first, then CoinGecko, then CoinMarketCap's keyless public endpoint.
3. Other listed assets try CoinGecko and then CoinMarketCap. An asset with no available market listing is shown as unpriced; zero balances remain $0.00.
4. Withdrawal fee conversion uses the same multi-provider price lookup, so a CoinGecko rate-limit or outage does not automatically stop the fee-payment step.
5. The withdrawal request insert no longer sends fee_amount or fee_market_price_usd from the browser. The existing Supabase trigger intentionally clears those client-supplied values and sets the correct receiving address/network from the selected fee asset.
6. Removed the “Network gas” row and the long blockchain-gas disclosure from the withdrawal quote.
7. Replaced the long disclosure with concise service-fee wording and a short payment/network instruction.
8. The initial withdrawal quote continues to update the 5% fee and requested/customer payout from the entered USD amount.

DEPLOYMENT
Replace the existing index.html, app.js and styles.css in the root of the existing GitHub repository with the files in this package. The stylesheet is included unchanged to preserve the current design. Commit to the branch connected to Cloudflare and allow the deployment to finish.

DATABASE
The existing withdrawal migration is included for reference only. If V9/V10 migration was already applied successfully, do NOT run it again.

IMPORTANT LIMITATIONS
- Market prices are estimates from public market-data APIs and can differ across providers/exchanges. Recheck the displayed quote before payment.
- The existing database trigger intentionally leaves fee_amount and fee_market_price_usd NULL. The displayed crypto fee is calculated in the browser from the current provider quote; it is not persisted as a trusted server-side quote. A production payment flow should move price retrieval and quote storage into a trusted server-side endpoint before accepting real payments.
- Submitting a transaction ID only records a reference. It does not independently verify blockchain payment. Do not treat a request as paid or release any payout until a trusted blockchain verification and actual payout-funds process are implemented.
- This custom app's displayed balances are database ledger balances, not proof of on-chain reserves or externally withdrawable cryptocurrency.
