create table if not exists public.loans (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  borrower text not null,
  phone text,
  amount numeric not null default 0,
  interest_rate numeric not null default 0,
  term_days integer not null check (term_days in (30, 45, 60)),
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

-- Migration para proyectos que ya tenian la tabla loans creada antes del login.
alter table public.loans
add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists loans_user_id_idx on public.loans(user_id);
create index if not exists installments_loan_id_idx on public.installments(loan_id);
create index if not exists payments_loan_id_idx on public.payments(loan_id);
create index if not exists profiles_username_idx on public.profiles(username);

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

drop policy if exists "prestapp_anon_loans_all" on public.loans;
drop policy if exists "prestapp_anon_installments_all" on public.installments;
drop policy if exists "prestapp_anon_payments_all" on public.payments;

drop policy if exists "prestapp_profiles_select" on public.profiles;
drop policy if exists "prestapp_profiles_insert" on public.profiles;
drop policy if exists "prestapp_profiles_update" on public.profiles;

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
