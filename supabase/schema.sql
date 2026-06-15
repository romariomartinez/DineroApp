create table if not exists public.loans (
  id text primary key,
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

alter table public.loans enable row level security;
alter table public.installments enable row level security;
alter table public.payments enable row level security;

drop policy if exists "prestapp_anon_loans_all" on public.loans;
drop policy if exists "prestapp_anon_installments_all" on public.installments;
drop policy if exists "prestapp_anon_payments_all" on public.payments;

-- Para una primera version privada sin login, estas politicas permiten leer y escribir
-- con la anon key. Antes de publicar con datos reales, agrega autenticacion.
create policy "prestapp_anon_loans_all"
on public.loans
for all
to anon
using (true)
with check (true);

create policy "prestapp_anon_installments_all"
on public.installments
for all
to anon
using (true)
with check (true);

create policy "prestapp_anon_payments_all"
on public.payments
for all
to anon
using (true)
with check (true);
