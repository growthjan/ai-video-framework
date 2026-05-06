-- AI Video Framework — Supabase Schema
-- Run this in the Supabase SQL Editor

create table if not exists brands (
  id          text primary key,
  name        text not null,
  color       text default '#7F77DD',
  foundation  jsonb default '{"visualBible":"","styleTokens":"","assetNotes":""}',
  created_at  timestamptz default now()
);

create table if not exists projects (
  id           text primary key,
  brand_id     text not null references brands(id) on delete cascade,
  name         text default 'Ohne Titel',
  content_type text default 'product',
  step         text default 'product',
  steps_done   integer default 0,
  data         jsonb default '{}',
  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);

create index if not exists projects_brand_id_idx  on projects(brand_id);
create index if not exists projects_updated_at_idx on projects(updated_at desc);

-- Disable RLS for internal team tool (no login required)
alter table brands   disable row level security;
alter table projects disable row level security;
