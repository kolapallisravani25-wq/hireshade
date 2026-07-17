create extension if not exists pgcrypto;
create extension if not exists vector;

create type public.application_status as enum (
  'discovered','verified','queued','in_progress','submitted','confirmed','assessment','interview','offer','rejected','blocked','failed'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  billing_currency text not null default 'INR' check (billing_currency in ('INR','USD','EUR')),
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  official_domain text,
  linkedin_url text,
  trust_score smallint check (trust_score between 0 and 100),
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id),
  title text not null,
  source_url text not null,
  description text,
  match_score smallint check (match_score between 0 and 100),
  trust_score smallint check (trust_score between 0 and 100),
  created_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id),
  status public.application_status not null default 'discovered',
  submitted_resume_path text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(candidate_id, job_id)
);

alter table public.profiles enable row level security;
alter table public.applications enable row level security;

create policy "profiles own row" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "applications owned by candidate" on public.applications for all using (auth.uid() = candidate_id) with check (auth.uid() = candidate_id);
