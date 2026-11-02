-- Additional V8 objects applied after V8-DATABASE-MIGRATION.sql.
-- Included for reproducibility; the live Supabase project has already received these changes.

create table if not exists public.wallet_login_events(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 user_agent text, created_at timestamptz not null default now()
);
alter table public.wallet_login_events enable row level security;
drop policy if exists "members read own login history" on public.wallet_login_events;
create policy "members read own login history" on public.wallet_login_events for select to authenticated using(user_id=(select auth.uid()));
grant select on public.wallet_login_events to authenticated;
create or replace function public.record_wallet_login(client_user_agent text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 insert into public.wallet_login_events(user_id,user_agent) values(auth.uid(),left(coalesce(client_user_agent,''),240));
end $$;
revoke all on function public.record_wallet_login(text) from public;
grant execute on function public.record_wallet_login(text) to authenticated;

create or replace function public.register_crypto_asset(asset_symbol text,asset_name text,market_id text,asset_image text)
returns void language plpgsql security definer set search_path='' as $$
declare sym text:=upper(btrim(asset_symbol)); existing_id text;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if sym !~ '^[A-Z0-9]{2,15}$' or asset_name is null or length(trim(asset_name)) not between 2 and 80 or market_id is null or market_id !~ '^[a-z0-9-]{1,100}$' then raise exception 'Invalid asset details'; end if;
 select coingecko_id into existing_id from public.crypto_assets where symbol=sym;
 if existing_id is not null and existing_id<>market_id then raise exception 'This ticker is already assigned to another asset. Select the existing listing instead.'; end if;
 if exists(select 1 from public.crypto_assets where coingecko_id=market_id and symbol<>sym) then raise exception 'This market listing is already registered under a different ticker.'; end if;
 insert into public.crypto_assets(symbol,name,coingecko_id,image_url,is_active) values(sym,trim(asset_name),market_id,asset_image,true)
 on conflict(symbol) do update set name=excluded.name,coingecko_id=excluded.coingecko_id,image_url=excluded.image_url,is_active=true;
 insert into public.wallet_balances(user_id,asset,balance) values(auth.uid(),sym,0) on conflict(user_id,asset) do nothing;
end $$;
revoke all on function public.register_crypto_asset(text,text,text,text) from public;
grant execute on function public.register_crypto_asset(text,text,text,text) to authenticated;

create table if not exists public.wallet_transfer_limits(
 asset text primary key,min_amount numeric not null default 0,max_amount numeric,updated_at timestamptz not null default now(),
 check(min_amount>=0),check(max_amount is null or max_amount>=min_amount)
);
alter table public.wallet_transfer_limits enable row level security;
drop policy if exists "authenticated read transfer limits" on public.wallet_transfer_limits;
create policy "authenticated read transfer limits" on public.wallet_transfer_limits for select to authenticated using(true);
grant select on public.wallet_transfer_limits to authenticated;
create or replace function public.admin_set_transfer_limit(asset_code text,min_value numeric,max_value numeric)
returns void language plpgsql security definer set search_path='' as $$
declare sym text:=upper(btrim(asset_code));
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Administrator access required'; end if;
 if sym !~ '^[A-Z0-9]{2,15}$' or min_value is null or min_value<0 or min_value='NaN'::numeric or (max_value is not null and (max_value<min_value or max_value='NaN'::numeric)) then raise exception 'Invalid transfer limits'; end if;
 insert into public.wallet_transfer_limits(asset,min_amount,max_amount) values(sym,min_value,max_value)
 on conflict(asset) do update set min_amount=excluded.min_amount,max_amount=excluded.max_amount,updated_at=now();
 insert into public.wallet_admin_audit(actor_id,action,details) values(auth.uid(),'transfer_limit_changed',jsonb_build_object('asset',sym,'minimum',min_value,'maximum',max_value));
end $$;
revoke all on function public.admin_set_transfer_limit(text,numeric,numeric) from public;
grant execute on function public.admin_set_transfer_limit(text,numeric,numeric) to authenticated;

-- transfer_balance_with_price is replaced in the live DB with a version that:
-- * accepts active registry assets, not only BTC/ETH/USDT;
-- * checks profiles.account_status and configurable wallet_transfer_limits;
-- * skips debiting the sole entitled master admin account;
-- * credits recipients and logs the transfer transaction atomically.
-- The legacy transfer_balance(text,text,numeric) RPC is revoked from all client roles.
