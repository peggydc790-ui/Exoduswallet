-- Exodus V9 performance indexes. Safe, additive indexes only.
-- Applied to the connected Supabase production database.
create index if not exists idx_wallet_admin_audit_actor_id on public.wallet_admin_audit(actor_id);
create index if not exists idx_wallet_admin_audit_target_user on public.wallet_admin_audit(target_user);
create index if not exists idx_wallet_balances_asset on public.wallet_balances(asset);
create index if not exists idx_wallet_fee_collections_payer_id on public.wallet_fee_collections(payer_id);
create index if not exists idx_wallet_fee_collections_transfer_id on public.wallet_fee_collections(transfer_id);
create index if not exists idx_wallet_login_events_user_id on public.wallet_login_events(user_id);
create index if not exists idx_external_withdrawal_controls_updated_by on public.external_withdrawal_controls(updated_by);
