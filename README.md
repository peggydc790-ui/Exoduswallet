# £xodus.wallet — V9

V8 introduces the MASTERPIECE portfolio card, a dynamic CoinGecko-powered crypto catalogue, per-user coin holdings, USD portfolio valuation, expanded administrator tools, unlimited balances for the one designated master administrator, account status controls, admin audit records, configurable transfer limits, password reset, optional TOTP MFA, sign-out of other sessions, and recent sign-in history.

## Files
- `index.html`, `styles.css`, `app.js` — V8 frontend.
- `V8-DATABASE-MIGRATION.sql` — primary database changes.
- `V8-ADDITIONAL-DB-PATCH.sql` — follow-on database objects and function notes.
- `V9-ADDITIONAL-DB-PATCH.sql` — additive performance indexes.
- `DATABASE-MIGRATION.sql` — original V7 migration, retained for reference.

## Important behaviour
- The master admin account is `member_0ef824a0` (`EXO-0D0ABD73D6FD4F3D`). Its balance is represented by a server-side unlimited entitlement and displayed as `∞`; PostgreSQL does not store an infinite numeric balance. Sending from this account credits the recipient with the exact requested amount without debiting an infinite source balance.
- The catalogue searches CoinGecko's listed assets (thousands are discoverable; the market API is not a guarantee of every token ever created). Newly added symbols are registered in the app's shared asset catalogue.
- Internal transfers are wallet-app ledger transfers, not blockchain withdrawals.
- Transfer limits default to a minimum of zero and no maximum until the administrator configures them.
- Existing receipt UI is preserved; advanced receipt work remains deferred.

## Deployment
Upload the contents of this folder to the existing GitHub repository's `main` branch. Cloudflare Workers is already connected to that repository. Wait for the new deployment to complete before testing the live site.


## V9 interface upgrades
- Receive-address QR code.
- Device-local saved recipient address book.
- Seven-day USD market chart for BTC, ETH and USDT.
- Transaction search/filter and CSV export.
- Printable transaction receipts (browser print dialog can save as PDF).
- Optional browser alerts for incoming internal transfers while the app remains open.
- No new database tables or balance mutations are required for these interface upgrades.
