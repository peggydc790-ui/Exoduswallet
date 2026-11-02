£xodus.wallet — External Withdrawal Request UI

Included:
- External withdrawal requests limited to BTC, ETH and USDT.
- BTC payout network: Bitcoin.
- ETH payout network: Ethereum.
- USDT payout networks: Ethereum ERC-20 or TRON TRC-20.
- Two-step flow: Continue opens a dedicated fee-payment page; the customer then chooses BTC, ETH or USDT (TRC-20) before the request is created.
- Platform service fee is calculated as 5% of the requested USD payout; the payout amount is not reduced.
- Fee equivalent is calculated using a live market-price lookup at request time.
- Receiving wallet details and network labels are displayed; the database trigger also sets the canonical fee destination.
- Customer request history and a basic admin status queue.

IMPORTANT DEPLOYMENT ORDER
1. Run WITHDRAWAL-DATABASE-MIGRATION.sql in the Supabase SQL Editor for project wbdydlyrcoinqmoejqhd.
2. Upload index.html, app.js and styles.css to the root of the connected GitHub repository main branch.
3. Wait for Cloudflare Worker deployment, then test with an existing account.

Operational limitations:
- This build creates withdrawal requests only. It does not monitor blockchains, verify incoming fee payments, custody assets, sign transactions, or broadcast payouts.
- Admin must independently verify a fee payment on the correct chain before processing.
- Admin must only mark a request completed after the full payout is confirmed on-chain and must enter the real payout transaction hash.
- The 5% charge is explicitly a platform service fee, not gas. Actual network costs must be disclosed separately where applicable.
- Do not promise or approve a payout unless real, available funds exist. The app's existing ledger balances are not blockchain reserves.
- The fee conversion uses a market-price API quote at request time; the customer must review the exact displayed coin amount before sending. Quote expiry and automatic on-chain verification are not included in this version.

Receiving wallets configured:
BTC / Bitcoin: bc1qsuk7udxhex7dz5z8vrd4cgxtvd2mrayd24ym8p
ETH / Ethereum: 0xEb089613B84088714AFACB3Cd006C8b1b657627D
USDT / TRON TRC-20: TDnFeHbnJpDqq3PDQ4mEQK84LwZammo5fB

V10 UI FLOW
- The first withdrawal page collects payout asset, USD amount, destination address and payout network only.
- Continue opens a separate Fee Payment page; no withdrawal request is created yet.
- Customer chooses BTC, ETH or USDT (TRC-20), sees the 5% fee and live crypto equivalent, then creates payment instructions.
- The instructions page shows the request reference, exact fee amount, selected receiving network/address and QR code.
- The request is created only after the customer selects a fee asset and continues.
