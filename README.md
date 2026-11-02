# £xodus.wallet

## Files
Upload `index.html`, `app.js`, and `styles.css` to the root of the connected Cloudflare Worker GitHub repository, replacing the existing files.

## Database
The wallet-address and transfer-fee database changes have already been applied to the connected Supabase project. `DATABASE-MIGRATION.sql` is included as a record of the database changes for this release.

## Transfer fees
The administrator can set the fee for each transfer in the Administration area:
- BTC transfers are charged in BTC.
- ETH transfers are charged in ETH.
- USDT transfers are charged in ETH.

Fee values are initially zero. Set the amounts in Administration before collecting fees. The fee is deducted atomically with the transfer and recorded in the fee collection table.

The browser uses the Supabase publishable key. Never place a Supabase secret or service-role key in frontend files.

Each successful transfer now opens a receipt showing the crypto amount, live USD unit price, USD equivalent, fee, recipient, date/time, status, and transaction reference. Market prices are retrieved from CoinGecko at transfer time and saved with the transaction.
