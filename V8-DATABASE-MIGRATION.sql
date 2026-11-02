-- £xodus.wallet V8: dynamic assets, unlimited administrator entitlement, audit + account controls
begin;

alter table public.profiles add column if not exists account_status text not null default 'active';
alter table public.profiles drop constraint if exists profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check (account_status in ('active','suspended'));

create table if not exists public.crypto_assets (
  symbol text primary key check (symbol = upper(symbol) and length(symbol) between 2 and 15),
  name text not null,
  coingecko_id text unique,
  image_url text,
  market_cap_rank integer,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.crypto_assets(symbol,name,coingecko_id,is_active) values
 ('BTC','Bitcoin','bitcoin',true),('ETH','Ethereum','ethereum',true),('USDT','Tether','tether',true)
on conflict(symbol) do update set name=excluded.name,coingecko_id=excluded.coingecko_id,is_active=true;

create table if not exists public.wallet_unlimited_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
-- This is the one confirmed master administrator account. The table has no client write policies.
insert into public.wallet_unlimited_accounts(user_id,enabled)
select id,true from public.profiles where username='member_0ef824a0' and role='admin'
on conflict(user_id) do update set enabled=true;


create table if not exists public.wallet_login_events(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 user_agent text,created_at timestamptz not null default now()
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

create table if not exists public.wallet_admin_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
 action text not null, target_user uuid references auth.users(id), details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

alter table public.crypto_assets enable row level security;
alter table public.wallet_unlimited_accounts enable row level security;
alter table public.wallet_admin_audit enable row level security;
drop policy if exists "active assets visible to authenticated" on public.crypto_assets;
create policy "active assets visible to authenticated" on public.crypto_assets for select to authenticated using (is_active);
drop policy if exists "admins read audit log" on public.wallet_admin_audit;
create policy "admins read audit log" on public.wallet_admin_audit for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'));
grant select on public.crypto_assets to authenticated;
grant select on public.wallet_admin_audit to authenticated;
revoke all on public.wallet_unlimited_accounts from anon, authenticated;

-- Dynamic asset adjustment; users cannot invoke it unless their profile is an administrator.
create or replace function public.admin_adjust_balance(target_user uuid, asset_code text, adjustment numeric, reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare admin_id uuid := auth.uid(); txid uuid; sym text := upper(btrim(asset_code));
begin
 if admin_id is null or not exists(select 1 from public.profiles where id=admin_id and role='admin') then raise exception 'Administrator access required'; end if;
 if target_user is null or not exists(select 1 from public.profiles where id=target_user) then raise exception 'Target member not found'; end if;
 if sym !~ '^[A-Z0-9]{2,15}$' or adjustment is null or adjustment=0 or adjustment='NaN'::numeric then raise exception 'Invalid asset or adjustment'; end if;
 insert into public.crypto_assets(symbol,name,is_active) values(sym,sym,true) on conflict(symbol) do nothing;
 insert into public.wallet_balances(user_id,asset,balance) values(target_user,sym,0) on conflict(user_id,asset) do nothing;
 update public.wallet_balances set balance=balance+adjustment,updated_at=now() where user_id=target_user and asset=sym and balance+adjustment>=0;
 if not found then raise exception 'Debit exceeds available balance'; end if;
 insert into public.wallet_transactions(sender_id,receiver_id,asset,amount,transaction_type,description)
 values(case when adjustment<0 then target_user else admin_id end,case when adjustment>0 then target_user else admin_id end,sym,abs(adjustment),case when adjustment>0 then 'admin_credit' else 'admin_debit' end,nullif(btrim(reason),'')) returning id into txid;
 insert into public.wallet_admin_audit(actor_id,action,target_user,details) values(admin_id,'balance_adjustment',target_user,jsonb_build_object('asset',sym,'adjustment',adjustment,'reason',reason));
 return txid;
end $$;
revoke all on function public.admin_adjust_balance(uuid,text,numeric,text) from public;
grant execute on function public.admin_adjust_balance(uuid,text,numeric,text) to authenticated;

-- Dynamic internal transfer. Admin entitlement is infinite without storing numeric Infinity.
create or replace function public.transfer_balance_with_price(recipient_wallet_address text, asset_code text, transfer_amount numeric, market_price_usd numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sender uuid := auth.uid(); recipient uuid; txid uuid; sym text := upper(btrim(asset_code)); charge numeric := 0; charge_asset text := null; unlimited boolean := false;
begin
 if sender is null then raise exception 'Login required'; end if;
 if not exists(select 1 from public.profiles where id=sender and account_status='active') then raise exception 'This account is suspended'; end if;
 if recipient_wallet_address is null or btrim(recipient_wallet_address)='' then raise exception 'Recipient wallet address is required'; end if;
 if transfer_amount is null or transfer_amount<=0 or transfer_amount='NaN'::numeric or transfer_amount='Infinity'::numeric then raise exception 'Invalid amount'; end if;
 if sym !~ '^[A-Z0-9]{2,15}$' then raise exception 'Invalid asset symbol'; end if;
 if market_price_usd is null or market_price_usd<=0 or market_price_usd='NaN'::numeric then raise exception 'A valid market price is required'; end if;
 select id into recipient from public.profiles where upper(wallet_address)=upper(btrim(recipient_wallet_address)) and account_status='active';
 if recipient is null or recipient=sender then raise exception 'Invalid or unavailable recipient'; end if;
 if not exists(select 1 from public.crypto_assets where symbol=sym and is_active) then raise exception 'Asset is not currently supported'; end if;
 select enabled into unlimited from public.wallet_unlimited_accounts where user_id=sender;
 unlimited := coalesce(unlimited,false) and exists(select 1 from public.profiles where id=sender and role='admin');
 select fee_amount,fee_asset into charge,charge_asset from public.wallet_fee_settings where transfer_asset=sym;
 charge := coalesce(charge,0);
 if not unlimited then
   update public.wallet_balances set balance=balance-transfer_amount,updated_at=now() where user_id=sender and asset=sym and balance>=transfer_amount;
   if not found then raise exception 'Insufficient transfer balance'; end if;
   if charge>0 then
     update public.wallet_balances set balance=balance-charge,updated_at=now() where user_id=sender and asset=charge_asset and balance>=charge;
     if not found then raise exception 'Insufficient balance for transfer fee'; end if;
   end if;
 end if;
 insert into public.wallet_balances(user_id,asset,balance) values(recipient,sym,transfer_amount) on conflict(user_id,asset) do update set balance=public.wallet_balances.balance+excluded.balance,updated_at=now();
 insert into public.wallet_transactions(sender_id,receiver_id,asset,amount,transaction_type,description,fee_amount,fee_asset,market_price_usd,usd_value)
 values(sender,recipient,sym,transfer_amount,'transfer',case when unlimited then 'Master administrator transfer' when charge>0 then 'Transfer fee: '||charge::text||' '||charge_asset else 'Transfer' end,charge,charge_asset,market_price_usd,transfer_amount*market_price_usd) returning id into txid;
 if charge>0 and not unlimited then insert into public.wallet_fee_collections(payer_id,transfer_id,transfer_asset,fee_asset,fee_amount) values(sender,txid,sym,charge_asset,charge); end if;
 return txid;
end $$;
revoke all on function public.transfer_balance_with_price(text,text,numeric,numeric) from public;
grant execute on function public.transfer_balance_with_price(text,text,numeric,numeric) to authenticated;

drop function if exists public.admin_find_user(text);
create function public.admin_find_user(search_username text)
returns table(user_id uuid, username text, email text, wallet_address text, account_status text)
language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Administrator access required'; end if;
 if search_username is null or length(trim(search_username))<2 then raise exception 'Enter at least 2 characters'; end if;
 return query select p.id,p.username,u.email,p.wallet_address,p.account_status from public.profiles p join auth.users u on u.id=p.id
 where p.username ilike '%'||trim(search_username)||'%' or p.wallet_address ilike '%'||trim(search_username)||'%' or u.email ilike '%'||trim(search_username)||'%'
 order by p.username limit 30;
end $$;
revoke all on function public.admin_find_user(text) from public;
grant execute on function public.admin_find_user(text) to authenticated;

create or replace function public.admin_set_account_status(target_user uuid,new_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare admin_id uuid := auth.uid();
begin
 if admin_id is null or not exists(select 1 from public.profiles where id=admin_id and role='admin') then raise exception 'Administrator access required'; end if;
 if new_status not in ('active','suspended') or target_user=admin_id then raise exception 'Invalid account status change'; end if;
 update public.profiles set account_status=new_status where id=target_user;
 if not found then raise exception 'Member not found'; end if;
 insert into public.wallet_admin_audit(actor_id,action,target_user,details) values(admin_id,'account_status_changed',target_user,jsonb_build_object('status',new_status));
end $$;
revoke all on function public.admin_set_account_status(uuid,text) from public;
grant execute on function public.admin_set_account_status(uuid,text) to authenticated;

create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='admin') then raise exception 'Administrator access required'; end if;
 select jsonb_build_object('members',(select count(*) from public.profiles),'active_members',(select count(*) from public.profiles where account_status='active'),'suspended_members',(select count(*) from public.profiles where account_status='suspended'),'transactions',(select count(*) from public.wallet_transactions),'fees_collected',(select coalesce(sum(fee_amount),0) from public.wallet_fee_collections)) into result;
 return result;
end $$;
revoke all on function public.admin_dashboard_stats() from public;
grant execute on function public.admin_dashboard_stats() to authenticated;

-- Seed unlimited admin wallet's visible coin rows for the initial catalogue.
insert into public.wallet_balances(user_id,asset,balance)
select p.id,a.symbol,0 from public.profiles p cross join public.crypto_assets a where p.username='member_0ef824a0' and a.is_active
on conflict(user_id,asset) do nothing;
commit;
