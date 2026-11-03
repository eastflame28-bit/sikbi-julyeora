-- 「식비를 줄여라」 Supabase 데이터베이스 설계
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 내용을 통째로 붙여 넣고 Run 하면 됩니다.
-- 여러 번 실행해도 안전하게 만들었습니다.
--
-- 개인 데이터 (주인만 읽고 씀): user_data, my_recipes, cooks
-- 공용 레시피 창고 (모두 읽기, 구글 로그인한 사람만 추가): recipes
-- 레시피 반응 (만들었어요·즐겨찾기 수, 누가 했는지는 숨김): recipe_marks + recipe_stats()

-- ───────── 개인 데이터 ─────────

create table if not exists public.user_data (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  pantry jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.my_recipes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.cooks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.user_data enable row level security;
alter table public.my_recipes enable row level security;
alter table public.cooks enable row level security;

drop policy if exists "own user_data" on public.user_data;
create policy "own user_data" on public.user_data
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own my_recipes" on public.my_recipes;
create policy "own my_recipes" on public.my_recipes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own cooks" on public.cooks;
create policy "own cooks" on public.cooks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────── 공용 레시피 창고 ─────────
-- 누가 만들었는지는 저장하지 않는다.

create table if not exists public.recipes (
  id text primary key,
  fingerprint text not null unique,          -- 같은 요리가 두 번 쌓이지 않게 (이름 + 주재료)
  title text not null check (char_length(title) between 1 and 60),
  emoji text,
  category text,
  summary text,
  servings int,
  total_minutes int,
  difficulty text,
  equipment jsonb not null default '[]'::jsonb,
  ingredients jsonb not null,
  steps jsonb not null,
  ingredient_names text[] not null,          -- 재료로 찾기용 (공백 없앤 이름)
  source text not null default 'ai' check (source in ('ai')),
  created_at timestamptz not null default now()
);

create index if not exists recipes_ingredient_names_idx on public.recipes using gin (ingredient_names);

alter table public.recipes enable row level security;

drop policy if exists "anyone reads recipes" on public.recipes;
create policy "anyone reads recipes" on public.recipes
  for select to anon, authenticated using (true);

-- 구글 등으로 로그인한 사람만 추가할 수 있고, 고치거나 지울 수는 없다.
drop policy if exists "signed-in adds recipes" on public.recipes;
create policy "signed-in adds recipes" on public.recipes
  for insert to authenticated
  with check (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) between 1 and 30
    and jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 15
    and cardinality(ingredient_names) between 1 and 30
    and octet_length(steps::text) < 20000
  );

-- ───────── 레시피 반응 (만들었어요 / 즐겨찾기) ─────────

create table if not exists public.recipe_marks (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  recipe_id text not null,
  kind text not null check (kind in ('cook', 'fav')),
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id, kind)
);

alter table public.recipe_marks enable row level security;

drop policy if exists "own marks" on public.recipe_marks;
create policy "own marks" on public.recipe_marks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 여러 레시피의 반응 수를 한 번에. 누가 눌렀는지는 돌려주지 않는다.
create or replace function public.recipe_stats(ids text[])
returns table (recipe_id text, cooks bigint, favs bigint)
language sql stable security definer set search_path = public
as $$
  select m.recipe_id,
         count(*) filter (where m.kind = 'cook') as cooks,
         count(*) filter (where m.kind = 'fav') as favs
  from public.recipe_marks m
  where m.recipe_id = any(ids)
  group by m.recipe_id
$$;

grant execute on function public.recipe_stats(text[]) to anon, authenticated;
