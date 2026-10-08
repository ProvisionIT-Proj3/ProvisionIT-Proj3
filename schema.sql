-- rebuild order matters: oauth_credentials first, connections before its children
-- based on the Supabase export, plus the unique constraints and ON DELETE rules it leaves out

CREATE TABLE public.oauth_credentials (
  credential_id uuid NOT NULL DEFAULT gen_random_uuid(),
  platform character varying NOT NULL,
  access_token text,
  refresh_token text,
  token_expires_at timestamp without time zone,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT oauth_credentials_pkey PRIMARY KEY (credential_id)
);

CREATE TABLE public.connections (
  connection_id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_name character varying NOT NULL,
  platform character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'active'::character varying,
  date_connected timestamp without time zone NOT NULL DEFAULT now(),
  last_synced_at timestamp without time zone,
  external_account_id character varying,
  credential_id uuid,
  CONSTRAINT connections_pkey PRIMARY KEY (connection_id),
  CONSTRAINT connections_credential_id_fkey FOREIGN KEY (credential_id) REFERENCES public.oauth_credentials(credential_id)
);

CREATE TABLE public.customers (
  customer_id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  source_id character varying NOT NULL,
  name character varying NOT NULL,
  email character varying,
  phone character varying,
  status character varying DEFAULT 'active'::character varying,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (customer_id),
  CONSTRAINT customers_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  CONSTRAINT unique_customer_source UNIQUE (connection_id, source_id)
);

CREATE TABLE public.invoices (
  invoice_id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  source_id character varying NOT NULL,
  amount numeric NOT NULL,
  status character varying NOT NULL,
  issue_date date NOT NULL,
  due_date date,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  type character varying DEFAULT 'sales_invoice'::character varying,
  CONSTRAINT invoices_pkey PRIMARY KEY (invoice_id),
  CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(customer_id) ON DELETE CASCADE,
  CONSTRAINT unique_invoice_source UNIQUE (customer_id, source_id)
);

CREATE TABLE public.payments (
  payment_id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL,
  source_id character varying NOT NULL,
  amount numeric NOT NULL,
  payment_date date NOT NULL,
  method character varying,
  status character varying NOT NULL DEFAULT 'completed'::character varying,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (payment_id),
  CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(invoice_id) ON DELETE CASCADE,
  CONSTRAINT unique_payment_source UNIQUE (invoice_id, source_id)
);

-- keeps the audit rows when a connection is deleted
CREATE TABLE public.activity_log (
  log_id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid,
  action character varying NOT NULL,
  details text,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT activity_log_pkey PRIMARY KEY (log_id),
  CONSTRAINT activity_log_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(connection_id) ON DELETE SET NULL
);

-- accounts: unique key and delete rule copied from the live db
CREATE TABLE public.accounts (
  account_id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  source_id character varying NOT NULL,
  code character varying,
  name character varying NOT NULL,
  type character varying,
  dr_cr character varying CHECK (dr_cr::text = ANY (ARRAY['Dr'::character varying, 'Cr'::character varying]::text[])),
  is_header boolean NOT NULL,
  level integer NOT NULL,
  value numeric,
  tax_code character varying,
  sort_order integer NOT NULL,
  report_date date,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  updated_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT accounts_pkey PRIMARY KEY (account_id),
  CONSTRAINT accounts_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  CONSTRAINT accounts_connection_id_source_id_key UNIQUE (connection_id, source_id)
);

CREATE TABLE public.user_profiles (
  user_id uuid NOT NULL,
  role character varying NOT NULL DEFAULT 'user'::character varying,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- tokens table, not meant to be readable through the public API
ALTER TABLE public.oauth_credentials ENABLE ROW LEVEL SECURITY;
