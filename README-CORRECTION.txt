£xodus.wallet V8 UI correction
- Removed the literal MASTERPIECE / total portfolio value card.
- Moved the user's individual coin balance cards to the top of the Overview, directly below the welcome heading.
- Kept the dynamic crypto catalogue and coin-add flow.
- Database correction has already been applied to the connected Supabase project: wallet_balances.asset is now constrained by a foreign key to crypto_assets.symbol, replacing the hard-coded BTC/ETH/USDT-only check. No further SQL migration is required for this fix.
Upload index.html, app.js, and styles.css to the root of the GitHub repository, replacing the existing files. README-CORRECTION.txt is informational.
