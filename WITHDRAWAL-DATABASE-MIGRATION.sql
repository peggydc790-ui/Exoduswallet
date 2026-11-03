-- £xodus.wallet external withdrawal request intake (manual review/payout).
-- This does NOT send cryptocurrency or verify incoming payments on-chain.
-- Run this migration in Supabase SQL Editor before enabling the Withdraw page.

create table if not exists public.external_withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_usd numeric(24,2) not null check (amount_usd >= 10),
  fee_usd numeric(24,2) not null check (fee_usd >= 0),
  payout_asset text not null check (payout_asset in ('BTC','ETH','USDT')),
  destination_network text not null check (destination_network in ('Bitcoin','Ethereum','Ethereum (ERC-20)','TRON (TRC-20)')),
  destination_address text not null check (length(destination_address) between 20 and 160),
  fee_asset text not null check (fee_asset in ('BTC','ETH','USDT')),
  fee_amount numeric(36,18),
  fee_wallet_address text not null,
  fee_network text not null,
  fee_market_price_usd numeric(24,10),
  status text not null default 'awaiting_fee' check (status in ('awaiting_fee','fee_verified','processing','completed','rejected')),
  fee_txid text,
  payout_txid text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint withdrawal_fee_is_five_percent check (fee_usd = round(amount_usd * 0.05, 2)),
  constraint withdrawal_fee_quote_pair check (
    (fee_amount is null and fee_market_price_usd is null)
    or (fee_amount > 0 and fee_market_price_usd > 0)
  )
);

create index if not exists external_withdrawal_requests_user_created_idx
  on public.external_withdrawal_requests(user_id, created_at desc);
create index if not exists external_withdrawal_requests_status_created_idx
  on public.external_withdrawal_requests(status, created_at desc);

create or replace function public.set_withdrawal_fee_destination()
returns trigger language plpgsql set search_path = '' as $
begin
  new.fee_usd := round(new.amount_usd * 0.05, 2);
  -- Never trust a price or crypto fee amount supplied by a browser/client.
  new.fee_amount := null;
  new.fee_market_price_usd := null;
  if new.fee_asset = 'BTC' then
    new.fee_wallet_address := 'bc1qsuk7udxhex7dz5z8vrd4cgxtvd2mrayd24ym8p';
    new.fee_network := 'Bitcoin';
  elsif new.fee_asset = 'ETH' then
    new.fee_wallet_address := '0xEb089613B84088714AFACB3Cd006C8b1b657627D';
    new.fee_network := 'Ethereum';
  elsif new.fee_asset = 'USDT' then
    new.fee_wallet_address := 'TDnFeHbnJpDqq3PDQ4mEQK84LwZammo5fB';
    new.fee_network := 'TRON (TRC-20)';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_withdrawal_fee_destination on public.external_withdrawal_requests;
create trigger trg_set_withdrawal_fee_destination
before insert on public.external_withdrawal_requests
for each row execute function public.set_withdrawal_fee_destination();

alter table public.external_withdrawal_requests enable row level security;
revoke all on public.external_withdrawal_requests from anon;
revoke all on public.external_withdrawal_requests from authenticated;
grant select, insert on public.external_withdrawal_requests to authenticated;
grant update(status, payout_txid) on public.external_withdrawal_requests to authenticated;

drop policy if exists "Users create own withdrawal requests" on public.external_withdrawal_requests;
create policy "Users create own withdrawal requests"
on public.external_withdrawal_requests for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'awaiting_fee'
  and payout_txid is null
  and fee_txid is null
  and admin_note is null
);

drop policy if exists "Users read own withdrawal requests" on public.external_withdrawal_requests;
create policy "Users read own withdrawal requests"
on public.external_withdrawal_requests for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Admins read all withdrawal requests" on public.external_withdrawal_requests;
create policy "Admins read all withdrawal requests"
on public.external_withdrawal_requests for select to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "Admins update withdrawal status" on public.external_withdrawal_requests;
create policy "Admins update withdrawal status"
on public.external_withdrawal_requests for update to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- No customer can self-mark a fee as paid or a withdrawal as completed.
-- The customer-submitted reference is only a reference. An administrator manually checks the receiving wallet and attests fee receipt.

create or replace function public.submit_withdrawal_fee_txid(request_id uuid, transaction_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if transaction_hash is null or length(trim(transaction_hash)) < 20 or length(trim(transaction_hash)) > 160 then
    raise exception 'Enter a valid blockchain transaction ID';
  end if;
  update public.external_withdrawal_requests
  set fee_txid = trim(transaction_hash), status = 'awaiting_fee', updated_at = now()
  where id = request_id and user_id = (select auth.uid()) and status = 'awaiting_fee' and fee_txid is null;
  if not found then raise exception 'Request not found or fee reference already submitted'; end if;
end;
$$;
revoke all on function public.submit_withdrawal_fee_txid(uuid,text) from public, anon;
grant execute on function public.submit_withdrawal_fee_txid(uuid,text) to authenticated;


-- External payouts stay disabled by default until an administrator confirms real funded reserves.
create table if not exists public.external_withdrawal_controls (
  id boolean primary key default true check (id = true),
  payouts_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.external_withdrawal_controls (id, payouts_enabled)
values (true, false)
on conflict (id) do nothing;
alter table public.external_withdrawal_controls enable row level security;
revoke all on public.external_withdrawal_controls from public, anon, authenticated;

create or replace function public.get_external_payout_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.payouts_enabled from public.external_withdrawal_controls c where c.id = true),
    false
  );
$$;
revoke all on function public.get_external_payout_status() from public, anon;
grant execute on function public.get_external_payout_status() to authenticated;

create or replace function public.admin_set_external_payouts_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  update public.external_withdrawal_controls
  set payouts_enabled = p_enabled,
      updated_at = now(),
      updated_by = (select auth.uid())
  where id = true;
end;
$$;
revoke all on function public.admin_set_external_payouts_enabled(boolean) from public, anon;
grant execute on function public.admin_set_external_payouts_enabled(boolean) to authenticated;

create or replace function public.enforce_external_withdrawal_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capacity_enabled boolean;
begin
  select c.payouts_enabled into capacity_enabled
  from public.external_withdrawal_controls c
  where c.id = true;
  capacity_enabled := coalesce(capacity_enabled, false);

  if tg_op = 'INSERT' then
    if not capacity_enabled then
      raise exception 'External withdrawals are temporarily paused until funded payout capacity is confirmed.';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'fee_verified' then
      if old.status <> 'awaiting_fee' or old.fee_txid is null then
        raise exception 'A customer fee transaction reference must be submitted before manual fee confirmation.';
      end if;
    elsif new.status = 'processing' then
      if not capacity_enabled then
        raise exception 'Payout processing is paused until funded payout capacity is confirmed.';
      end if;
      if old.status <> 'fee_verified' or old.fee_txid is null then
        raise exception 'Only a manually fee-confirmed request with a submitted fee reference can be processed.';
      end if;
    elsif new.status = 'completed' then
      if not capacity_enabled then
        raise exception 'Payout completion is paused until funded payout capacity is confirmed.';
      end if;
      if old.status <> 'processing' then
        raise exception 'A payout must be in processing before it can be completed.';
      end if;
      if new.payout_txid is null or length(trim(new.payout_txid)) < 8 then
        raise exception 'Enter the actual outgoing payout transfer reference after sending the funds.';
      end if;
    elsif new.status = 'rejected' then
      if old.status not in ('awaiting_fee', 'fee_verified') then
        raise exception 'This request cannot be rejected from its current status.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_enforce_external_withdrawal_capacity on public.external_withdrawal_requests;
create trigger trg_enforce_external_withdrawal_capacity
before insert or update on public.external_withdrawal_requests
for each row execute function public.enforce_external_withdrawal_capacity();
