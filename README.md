# £xodus.wallet — starter project

This is the first frontend foundation for the public landing page and authentication entry point.

## Important product boundary
This project is a **demo wallet simulator**. Balances and transfers must be clearly labelled simulated. It does not custody cryptocurrency, create real blockchain balances, or process real withdrawals. Do not ask users to send crypto to unlock demo balances or withdrawals.

## Files
- `index.html` — responsive public landing page and login/register modal
- `styles.css` — visual system and responsive layout
- `app.js` — Supabase Auth connection (requires your project credentials)
- `supabase/schema.sql` — starter database schema for demo accounts and wallets

## 1. Create the Supabase project
1. Open https://supabase.com and create a new project.
2. In Project Settings → API, copy the Project URL and anon/public key.
3. Open `app.js` and replace `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_ANON_KEY`.
4. In Supabase SQL Editor, run `supabase/schema.sql`.

The anon key is designed for browser use. Never place a Supabase service-role key or database password in frontend files.

## 2. Publish on Cloudflare Pages
1. Create a GitHub repository named `exodus-wallet`.
2. Upload the contents of this ZIP to the repository root (not the ZIP file itself).
3. In Cloudflare, open Workers & Pages → Create → Pages → Connect to Git.
4. Select the `exodus-wallet` repository.
5. Framework preset: None. Build command: leave blank. Build output directory: `/` (or `.` if the dashboard requires it).
6. Deploy. Cloudflare Pages will publish `index.html`.

## 3. Before enabling public registration
- Configure Supabase email confirmation and allowed redirect URLs for your deployed domain.
- Add rate limits / abuse protection.
- Build the authenticated dashboard and server-side transfer function before storing or changing balances.
- Use database constraints and atomic transactions for all transfers. Never allow users to update balances directly from the browser.
- Add clear demo labels throughout the product.

## Current status
Stage 1: landing page and authentication interface.
Next: connect Supabase, test registration/login, then build the protected dashboard and secure demo transfer engine.
