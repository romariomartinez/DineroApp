create table if not exists public.loans (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  borrower text not null,
  phone text,
  amount numeric not null default 0,
  interest_rate numeric not null default 0,
  interest_type text not null default 'unico' constraint loans_interest_type_check check (interest_type in ('mensual', 'unico')),
  term_days integer not null constraint loans_term_days_check check (term_days between 1 and 120),
  installments_count integer not null default 1,
  start_date date not null,
  payment_frequency text not null default 'Quincenal',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.installments (
  id text primary key,
  loan_id text not null references public.loans(id) on delete cascade,
  number integer not null,
  due_date date not null,
  amount numeric not null default 0,
  paid numeric not null default 0,
  paid_date date
);

create table if not exists public.payments (
  id text primary key,
  loan_id text not null references public.loans(id) on delete cascade,
  amount numeric not null default 0,
  date date not null,
  method text,
  note text
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  role text not null default 'user' check (role in ('superadmin', 'user')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.notification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  registration_id text not null,
  registration_type text not null default 'token' check (registration_type in ('token', 'fid')),
  device_label text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, registration_id)
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id text references public.loans(id) on delete set null,
  payment_id text,
  borrower text,
  borrower_phone text,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Migration para proyectos que ya tenian la tabla loans creada antes del login.
alter table public.loans
add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.loans
add column if not exists interest_type text not null default 'unico';

alter table public.loans
drop constraint if exists loans_term_days_check;

alter table public.loans
add constraint loans_term_days_check check (term_days between 1 and 120);

alter table public.loans
drop constraint if exists loans_interest_type_check;

alter table public.loans
add constraint loans_interest_type_check check (interest_type in ('mensual', 'unico'));

create index if not exists loans_user_id_idx on public.loans(user_id);
create index if not exists installments_loan_id_idx on public.installments(loan_id);
create index if not exists payments_loan_id_idx on public.payments(loan_id);
create index if not exists profiles_username_idx on public.profiles(username);
create index if not exists notification_tokens_user_id_idx on public.notification_tokens(user_id);
create index if not exists notification_events_user_status_idx on public.notification_events(user_id, status);

create or replace function public.is_superuser()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'superadmin'
      and active = true
  );
$$;

create or replace function public.has_profiles()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles);
$$;

alter table public.loans enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;
alter table public.profiles enable row level security;
alter table public.notification_tokens enable row level security;
alter table public.notification_events enable row level security;

drop policy if exists "prestapp_anon_loans_all" on public.loans;
drop policy if exists "prestapp_anon_installments_all" on public.installments;
drop policy if exists "prestapp_anon_payments_all" on public.payments;

drop policy if exists "prestapp_profiles_select" on public.profiles;
drop policy if exists "prestapp_profiles_insert" on public.profiles;
drop policy if exists "prestapp_profiles_update" on public.profiles;

drop policy if exists "prestapp_notification_tokens_select_own" on public.notification_tokens;
drop policy if exists "prestapp_notification_tokens_insert_own" on public.notification_tokens;
drop policy if exists "prestapp_notification_tokens_update_own" on public.notification_tokens;
drop policy if exists "prestapp_notification_tokens_delete_own" on public.notification_tokens;

drop policy if exists "prestapp_notification_events_select_own" on public.notification_events;
drop policy if exists "prestapp_notification_events_insert_own" on public.notification_events;
drop policy if exists "prestapp_notification_events_update_own" on public.notification_events;

drop policy if exists "prestapp_loans_select_own" on public.loans;
drop policy if exists "prestapp_loans_insert_own" on public.loans;
drop policy if exists "prestapp_loans_update_own" on public.loans;
drop policy if exists "prestapp_loans_delete_own" on public.loans;

drop policy if exists "prestapp_installments_select_own" on public.installments;
drop policy if exists "prestapp_installments_insert_own" on public.installments;
drop policy if exists "prestapp_installments_update_own" on public.installments;
drop policy if exists "prestapp_installments_delete_own" on public.installments;

drop policy if exists "prestapp_payments_select_own" on public.payments;
drop policy if exists "prestapp_payments_insert_own" on public.payments;
drop policy if exists "prestapp_payments_update_own" on public.payments;
drop policy if exists "prestapp_payments_delete_own" on public.payments;

create policy "prestapp_profiles_select"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_superuser());

create policy "prestapp_profiles_insert"
on public.profiles
for insert
to authenticated
with check (
  public.is_superuser()
  or (
    not public.has_profiles()
    and id = auth.uid()
    and role = 'superadmin'
    and active = true
  )
);

create policy "prestapp_profiles_update"
on public.profiles
for update
to authenticated
using (public.is_superuser())
with check (public.is_superuser());

create policy "prestapp_notification_tokens_select_own"
on public.notification_tokens
for select
to authenticated
using (auth.uid() = user_id or public.is_superuser());

create policy "prestapp_notification_tokens_insert_own"
on public.notification_tokens
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "prestapp_notification_tokens_update_own"
on public.notification_tokens
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "prestapp_notification_tokens_delete_own"
on public.notification_tokens
for delete
to authenticated
using (auth.uid() = user_id);

create policy "prestapp_notification_events_select_own"
on public.notification_events
for select
to authenticated
using (auth.uid() = user_id or public.is_superuser());

create policy "prestapp_notification_events_insert_own"
on public.notification_events
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "prestapp_notification_events_update_own"
on public.notification_events
for update
to authenticated
using (auth.uid() = user_id or public.is_superuser())
with check (auth.uid() = user_id or public.is_superuser());

create policy "prestapp_loans_select_own"
on public.loans
for select
to authenticated
using (auth.uid() = user_id);

create policy "prestapp_loans_insert_own"
on public.loans
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "prestapp_loans_update_own"
on public.loans
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "prestapp_loans_delete_own"
on public.loans
for delete
to authenticated
using (auth.uid() = user_id);

create policy "prestapp_installments_select_own"
on public.installments
for select
to authenticated
using (
  exists (
    select 1
    from public.loans
    where loans.id = installments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_installments_insert_own"
on public.installments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.loans
    where loans.id = installments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_installments_update_own"
on public.installments
for update
to authenticated
using (
  exists (
    select 1
    from public.loans
    where loans.id = installments.loan_id
      and loans.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.loans
    where loans.id = installments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_installments_delete_own"
on public.installments
for delete
to authenticated
using (
  exists (
    select 1
    from public.loans
    where loans.id = installments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_payments_select_own"
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.loans
    where loans.id = payments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_payments_insert_own"
on public.payments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.loans
    where loans.id = payments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_payments_update_own"
on public.payments
for update
to authenticated
using (
  exists (
    select 1
    from public.loans
    where loans.id = payments.loan_id
      and loans.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.loans
    where loans.id = payments.loan_id
      and loans.user_id = auth.uid()
  )
);

create policy "prestapp_payments_delete_own"
on public.payments
for delete
to authenticated
using (
  exists (
    select 1
    from public.loans
    where loans.id = payments.loan_id
      and loans.user_id = auth.uid()
  )
);

-- Si tienes datos reales creados antes del login, asignales un usuario desde Supabase:
-- update public.loans set user_id = 'ID_DEL_USUARIO' where user_id is null;
