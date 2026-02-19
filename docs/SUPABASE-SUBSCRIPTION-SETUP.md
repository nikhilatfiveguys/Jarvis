# Supabase subscription setup

The app reads subscription status from a Supabase `subscriptions` table. If subscription checks always return "free" or fail, check the following.

## 1. Table: `subscriptions`

In Supabase SQL Editor, create the table if it doesn't exist:

```sql
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'active',
  polar_subscription_id text,
  polar_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_subscriptions_email on public.subscriptions(email);
create index if not exists idx_subscriptions_status on public.subscriptions(status);
```

## 2. Row Level Security (RLS)

The app uses the **anon** key to read subscriptions. If RLS is enabled on `subscriptions`, the anon key must be allowed to read rows.

**Option A – allow anon to read all rows (simplest for a small app):**

```sql
alter table public.subscriptions enable row level security;

create policy "Allow anon read subscriptions"
  on public.subscriptions for select
  to anon
  using (true);
```

**Option B – allow anon to insert/update (needed if webhooks or app write with anon):**

If the Polar webhook Edge Function uses the **service role** key (recommended), it does not need a policy. If anything uses anon to insert/update, add:

```sql
create policy "Allow anon insert subscriptions"
  on public.subscriptions for insert to anon with check (true);

create policy "Allow anon update subscriptions"
  on public.subscriptions for update to anon using (true);
```

## 3. Email matching

- The app looks up subscriptions by the **signed-in email** (stored in `jarvis_user.json`). The app tries **lowercase** first, then the raw email, so case differences usually do not matter.
- Ensure the `subscriptions` table has a row whose `email` matches the account email (e.g. from the Polar webhook or a manual insert). If the user pays with "User@Email.com" and the webhook inserts that exact string, the app will find it; if the webhook inserts "user@email.com", the app will also find it.

## 4. Environment

- **SUPABASE_URL** and **SUPABASE_ANON_KEY** must be set (e.g. in `.env` or production config) so the app can connect.
- If the app shows "Subscription service not available", the Supabase client failed to init (missing config or init error); check the console and config.
- If sign-in says "Permission denied" or "row-level security", add the anon SELECT policy in step 2.

## 5. Polar webhook

- Deploy the Edge Function `polar-webhook` and set the webhook URL in the Polar dashboard.
- Set `POLAR_ACCESS_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` in the Edge Function secrets so the webhook can write to `subscriptions`.
