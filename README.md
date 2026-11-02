# £xodus.wallet — internal ledger frontend

This frontend connects to the existing Supabase project and its `profiles`, `wallet_balances`, and `wallet_transactions` tables.

## Product disclosure
BTC, ETH and USDT balances are internal platform-maintained ledger units denominated in those assets. They are not on-chain cryptocurrency, are not held in external blockchain wallets, and cannot be deposited from or withdrawn to external wallets. Internal transfers update the platform ledger only.

## Deployment
The current Cloudflare Worker deployment is configured to serve static assets from the repository root. Replace `index.html`, `app.js`, and `styles.css` in the GitHub repository, commit to `main`, and Cloudflare should redeploy from the connected repository. Keep `wrangler.jsonc` and other Cloudflare-generated files.

## Supabase
The browser uses the public publishable key. Database access is protected by RLS and server-side RPC validation. Do not add a Supabase service-role key to frontend code.

The app expects:
- `profiles(id, username, role, created_at)`
- `wallet_balances(user_id, asset, balance)`
- `wallet_transactions(sender_id, receiver_id, asset, amount, transaction_type, description, created_at)`
- RPC `transfer_balance(recipient_username, asset_code, transfer_amount)`
- RPC `admin_adjust_balance(target_user, asset_code, adjustment, reason)`
- RPC `admin_find_user(search_username)` (admin-only; migration added to the connected Supabase project)

New signups create profiles and zero balances through the existing auth trigger. The initial administrator must be promoted manually in Supabase after registering; never allow users to set their own role.
