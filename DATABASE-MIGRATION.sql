-- Already applied to the connected Supabase project for this release.
-- Keep this file as the schema change record for the wallet-address feature.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wallet_address text;

UPDATE public.profiles
SET wallet_address = 'EXO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
WHERE wallet_address IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN wallet_address SET DEFAULT (
    'EXO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
  ),
  ALTER COLUMN wallet_address SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_wallet_address_uidx
  ON public.profiles (wallet_address);

DROP FUNCTION IF EXISTS public.transfer_balance(text, text, numeric);

CREATE FUNCTION public.transfer_balance(
  recipient_wallet_address text,
  asset_code text,
  transfer_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    sender uuid := auth.uid();
    recipient uuid;
    transaction_id uuid;
BEGIN
    IF sender IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
    IF recipient_wallet_address IS NULL OR btrim(recipient_wallet_address) = '' THEN
      RAISE EXCEPTION 'Recipient wallet address is required';
    END IF;
    IF transfer_amount IS NULL OR transfer_amount <= 0 OR transfer_amount = 'NaN'::numeric THEN
      RAISE EXCEPTION 'Invalid amount';
    END IF;
    IF asset_code IS NULL OR asset_code NOT IN ('BTC', 'ETH', 'USDT') THEN
      RAISE EXCEPTION 'Unsupported asset';
    END IF;
    SELECT id INTO recipient FROM public.profiles
      WHERE upper(wallet_address) = upper(btrim(recipient_wallet_address));
    IF recipient IS NULL OR recipient = sender THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
    UPDATE public.wallet_balances SET balance = balance - transfer_amount, updated_at = now()
      WHERE user_id = sender AND asset = asset_code AND balance >= transfer_amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient balance or wallet asset unavailable'; END IF;
    UPDATE public.wallet_balances SET balance = balance + transfer_amount, updated_at = now()
      WHERE user_id = recipient AND asset = asset_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recipient wallet asset unavailable; transfer cancelled'; END IF;
    INSERT INTO public.wallet_transactions (sender_id, receiver_id, asset, amount, transaction_type)
      VALUES (sender, recipient, asset_code, transfer_amount, 'transfer') RETURNING id INTO transaction_id;
    RETURN transaction_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.transfer_balance(text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_balance(text, text, numeric) TO authenticated;

-- Transfer-fee configuration and collection (already applied to Supabase).
CREATE TABLE IF NOT EXISTS public.wallet_fee_settings (
  transfer_asset text PRIMARY KEY CHECK (transfer_asset IN ('BTC','ETH','USDT')),
  fee_asset text NOT NULL CHECK (fee_asset IN ('BTC','ETH')),
  fee_amount numeric NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.wallet_fee_settings (transfer_asset, fee_asset, fee_amount)
VALUES ('BTC','BTC',0), ('ETH','ETH',0), ('USDT','ETH',0)
ON CONFLICT (transfer_asset) DO NOTHING;
ALTER TABLE public.wallet_fee_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read fee settings" ON public.wallet_fee_settings;
CREATE POLICY "Authenticated users can read fee settings" ON public.wallet_fee_settings
FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.wallet_fee_settings FROM anon, authenticated;
GRANT SELECT ON public.wallet_fee_settings TO authenticated;
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS fee_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_asset text;
CREATE TABLE IF NOT EXISTS public.wallet_fee_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_id uuid NOT NULL REFERENCES public.profiles(id),
  transfer_id uuid NOT NULL REFERENCES public.wallet_transactions(id),
  transfer_asset text NOT NULL CHECK (transfer_asset IN ('BTC','ETH','USDT')),
  fee_asset text NOT NULL CHECK (fee_asset IN ('BTC','ETH')),
  fee_amount numeric NOT NULL CHECK (fee_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_fee_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_fee_collections FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_fee(transfer_asset text, fee_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=caller AND role='admin') THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;
  IF transfer_asset NOT IN ('BTC','ETH','USDT') OR fee_amount IS NULL OR fee_amount < 0 OR fee_amount='NaN'::numeric THEN
    RAISE EXCEPTION 'Invalid fee setting';
  END IF;
  UPDATE public.wallet_fee_settings SET fee_amount=admin_update_fee.fee_amount, updated_at=now()
  WHERE wallet_fee_settings.transfer_asset=admin_update_fee.transfer_asset;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fee setting not found'; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_update_fee(text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_fee(text,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.transfer_balance(
  recipient_wallet_address text, asset_code text, transfer_amount numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
  sender uuid := auth.uid(); recipient uuid; transaction_id uuid; charge numeric; charge_asset text;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  IF recipient_wallet_address IS NULL OR btrim(recipient_wallet_address)='' THEN RAISE EXCEPTION 'Recipient wallet address is required'; END IF;
  IF transfer_amount IS NULL OR transfer_amount<=0 OR transfer_amount='NaN'::numeric THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF asset_code IS NULL OR asset_code NOT IN ('BTC','ETH','USDT') THEN RAISE EXCEPTION 'Unsupported asset'; END IF;
  SELECT id INTO recipient FROM public.profiles WHERE upper(wallet_address)=upper(btrim(recipient_wallet_address));
  IF recipient IS NULL OR recipient=sender THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  SELECT fee_amount,fee_asset INTO charge,charge_asset FROM public.wallet_fee_settings WHERE transfer_asset=asset_code FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer fee is not configured'; END IF;
  UPDATE public.wallet_balances SET balance=balance-transfer_amount,updated_at=now()
    WHERE user_id=sender AND asset=asset_code AND balance>=transfer_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient transfer balance'; END IF;
  IF charge>0 THEN
    UPDATE public.wallet_balances SET balance=balance-charge,updated_at=now()
      WHERE user_id=sender AND asset=charge_asset AND balance>=charge;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient balance for transfer fee'; END IF;
  END IF;
  UPDATE public.wallet_balances SET balance=balance+transfer_amount,updated_at=now()
    WHERE user_id=recipient AND asset=asset_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient wallet asset unavailable; transfer cancelled'; END IF;
  INSERT INTO public.wallet_transactions(sender_id,receiver_id,asset,amount,transaction_type,description,fee_amount,fee_asset)
    VALUES(sender,recipient,asset_code,transfer_amount,'transfer',
      CASE WHEN charge>0 THEN 'Transfer fee: '||charge::text||' '||charge_asset ELSE 'Transfer' END,
      charge,charge_asset) RETURNING id INTO transaction_id;
  IF charge>0 THEN
    INSERT INTO public.wallet_fee_collections(payer_id,transfer_id,transfer_asset,fee_asset,fee_amount)
      VALUES(sender,transaction_id,asset_code,charge_asset,charge);
  END IF;
  RETURN transaction_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.transfer_balance(text,text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_balance(text,text,numeric) TO authenticated;


-- V7 transaction receipt market-price snapshot.
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS market_price_usd numeric,
  ADD COLUMN IF NOT EXISTS usd_value numeric;

CREATE OR REPLACE FUNCTION public.transfer_balance_with_price(
  recipient_wallet_address text,
  asset_code text,
  transfer_amount numeric,
  market_price_usd numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  sender uuid := auth.uid();
  recipient uuid;
  transaction_id uuid;
  charge numeric;
  charge_asset text;
BEGIN
  IF sender IS NULL THEN RAISE EXCEPTION 'Login required'; END IF;
  IF recipient_wallet_address IS NULL OR btrim(recipient_wallet_address) = '' THEN RAISE EXCEPTION 'Recipient wallet address is required'; END IF;
  IF transfer_amount IS NULL OR transfer_amount <= 0 OR transfer_amount = 'NaN'::numeric THEN RAISE EXCEPTION 'Invalid amount'; END IF;
  IF asset_code IS NULL OR asset_code NOT IN ('BTC','ETH','USDT') THEN RAISE EXCEPTION 'Unsupported asset'; END IF;
  IF market_price_usd IS NULL OR market_price_usd <= 0 OR market_price_usd = 'NaN'::numeric THEN RAISE EXCEPTION 'A valid live market price is required'; END IF;
  SELECT id INTO recipient FROM public.profiles WHERE upper(wallet_address) = upper(btrim(recipient_wallet_address));
  IF recipient IS NULL OR recipient = sender THEN RAISE EXCEPTION 'Invalid recipient'; END IF;
  SELECT fee_amount, fee_asset INTO charge, charge_asset FROM public.wallet_fee_settings WHERE transfer_asset = asset_code FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer fee is not configured'; END IF;
  UPDATE public.wallet_balances SET balance = balance - transfer_amount, updated_at = now()
    WHERE user_id = sender AND asset = asset_code AND balance >= transfer_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient transfer balance'; END IF;
  IF charge > 0 THEN
    UPDATE public.wallet_balances SET balance = balance - charge, updated_at = now()
      WHERE user_id = sender AND asset = charge_asset AND balance >= charge;
    IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient balance for transfer fee'; END IF;
  END IF;
  UPDATE public.wallet_balances SET balance = balance + transfer_amount, updated_at = now()
    WHERE user_id = recipient AND asset = asset_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recipient wallet asset unavailable; transfer cancelled'; END IF;
  INSERT INTO public.wallet_transactions
    (sender_id, receiver_id, asset, amount, transaction_type, description, fee_amount, fee_asset, market_price_usd, usd_value)
  VALUES
    (sender, recipient, asset_code, transfer_amount, 'transfer',
     CASE WHEN charge > 0 THEN 'Transfer fee: ' || charge::text || ' ' || charge_asset ELSE 'Transfer' END,
     charge, charge_asset, market_price_usd, transfer_amount * market_price_usd)
  RETURNING id INTO transaction_id;
  IF charge > 0 THEN
    INSERT INTO public.wallet_fee_collections (payer_id, transfer_id, transfer_asset, fee_asset, fee_amount)
    VALUES (sender, transaction_id, asset_code, charge_asset, charge);
  END IF;
  RETURN transaction_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.transfer_balance_with_price(text,text,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_balance_with_price(text,text,numeric,numeric) TO authenticated;
