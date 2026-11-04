# £xodus.wallet — V9

V8 introduces the MASTERPIECE portfolio card, a dynamic CoinGecko-powered crypto catalogue, per-user coin holdings, USD portfolio valuation, expanded administrator tools, unlimited balances for the one designated master administrator, account status controls, admin audit records, configurable transfer limits, password reset, optional TOTP MFA, sign-out of other sessions, and recent sign-in history.

## Files
- `public/index.html`, `public/styles.css`, `public/app.js` — deployed frontend assets (Cloudflare Wrangler serves `public/`).
- Root `index.html`, `styles.css`, `app.js` are kept synchronized as working copies.
- `worker.js` and `wrangler.jsonc` — Cloudflare Worker entrypoint and static-assets configuration.
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
The deployed Worker is `exoduswallet`. Cloudflare Workers Builds is connected to this GitHub repository with automatic production builds enabled on `main`; the production deploy command is `npx wrangler deploy`. Preview builds run `node --check public/app.js && node --check worker.js` and use `npx wrangler preview`. The Worker serves the `public/` directory through the `ASSETS` binding. Confirm the Cloudflare build and deployment status after merging before user testing.


## V9 interface upgrades
- Receive-address QR code.
- Device-local saved recipient address book.
- Seven-day USD market chart for BTC, ETH and USDT.
- Transaction search/filter and CSV export.
- Printable transaction receipts (browser print dialog can save as PDF).
- Optional browser alerts for incoming internal transfers while the app remains open.
- No new database tables or balance mutations are required for these interface upgrades.
- Added seven foreign-key indexes and combined the owner/admin withdrawal SELECT policies without changing their effective access rules.
- Browser alerts are foreground polling notifications, not server push; they require the wallet to remain open in a supported browser.
