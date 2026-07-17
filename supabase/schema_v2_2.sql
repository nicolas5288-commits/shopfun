-- 購物趣 V2.2：個人資料 profiles + 通知 notifications（在 Supabase SQL Editor 貼上整段執行）
create table profiles (
  user_id uuid primary key references auth.users(id),
  nickname text check (char_length(nickname) between 1 and 20),
  avatar_emoji text default '😀',
  avatar_bg text default '#F3E2D8',
  updated_at timestamptz default now()
);
alter table profiles enable row level security;
create policy prof_read on profiles for select using (true);
create policy prof_upsert on profiles for insert with check (auth.uid() = user_id);
create policy prof_update on profiles for update using (auth.uid() = user_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  type text not null check (type in ('promoted','removed')),
  product_name text,
  read boolean not null default false,
  created_at timestamptz default now()
);
alter table notifications enable row level security;
create policy n_read on notifications for select using (auth.uid() = user_id);
create policy n_update on notifications for update using (auth.uid() = user_id);
-- 不開放前端 insert，通知只由觸發器產生

-- 轉正/下架時通知投稿者（security definer 繞過 RLS insert）
create or replace function notify_status_change() returns trigger as $$
begin
  if new.submitted_by is not null then
    if old.status = 'new' and new.status = 'ranked' then
      insert into notifications (user_id, type, product_name)
      values (new.submitted_by, 'promoted', new.name_zh);
    elsif old.status <> 'removed' and new.status = 'removed' then
      insert into notifications (user_id, type, product_name)
      values (new.submitted_by, 'removed', new.name_zh);
    end if;
  end if;
  return new;
end; $$ language plpgsql security definer;
create trigger t_notify after update on products for each row execute function notify_status_change();
