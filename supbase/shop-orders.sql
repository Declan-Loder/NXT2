-- NXT Supply (merch) shop orders — EFT flow
-- Run in Supabase SQL editor after schema.sql

CREATE TABLE IF NOT EXISTS public.shop_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text NOT NULL UNIQUE,           -- e.g. NXT-O-A1B2C3
  payment_reference   text NOT NULL UNIQUE,           -- same as order_number for bank ref
  customer_name       text NOT NULL,
  email               text NOT NULL,
  phone               text NOT NULL,
  address             text NOT NULL,
  notes               text,
  items               jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{id,name,price,qty}]
  total_amount        numeric(10,2) NOT NULL DEFAULT 0,
  currency            text NOT NULL DEFAULT 'ZAR',
  payment_method      text NOT NULL DEFAULT 'eft'
                      CHECK (payment_method IN ('eft')),
  payment_status      text NOT NULL DEFAULT 'awaiting_payment'
                      CHECK (payment_status IN (
                        'awaiting_payment',
                        'pending_verification',
                        'paid',
                        'payment_rejected',
                        'cancelled'
                      )),
  proof_storage_path  text,
  proof_file_name     text,
  proof_content_type  text,
  proof_uploaded_at   timestamptz,
  reviewed_at         timestamptz,
  reviewed_by         text,
  admin_note          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_status
  ON public.shop_orders (payment_status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_created
  ON public.shop_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_orders_email
  ON public.shop_orders (email);

DROP TRIGGER IF EXISTS trg_shop_orders_updated ON public.shop_orders;
CREATE TRIGGER trg_shop_orders_updated
  BEFORE UPDATE ON public.shop_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
-- No public policies: all access via service role from /api/shop-orders*

-- Optional: reuse payment-proofs bucket with path prefix shop/{order_id}/...
-- Bucket already created in schema.sql as payment-proofs
