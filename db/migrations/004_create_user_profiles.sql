-- Backend authorization reads this table with a trusted database connection.
-- RLS prevents browser clients from assigning or changing their own role.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin', 'user')),
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now()
);

-- Earlier environments may already have the minimal user_id/role table.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass
      AND conname = 'user_profiles_role_check'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('admin', 'user'));
  END IF;
END
$$;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
