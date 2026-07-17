-- 購物趣 V2 資料表（在 Supabase SQL Editor 貼上整段執行）
create table products (
  id uuid primary key default gen_random_uuid(),
  country text not null check (country in ('jp','kr','th')),
  name_zh text not null,
  name_local text,
  category text not null check (category in ('snacks','beauty','daily','health','souvenir')),
  emoji text default '🛍️',
  price_local text,
  price_twd text,
  save_stars int check (save_stars between 1 and 5),
  reason text not null check (char_length(reason) >= 15),
  "where" text[] default '{}',
  maps_query text not null,
  editor_rank int,
  source text not null default 'user' check (source in ('seed','user')),
  status text not null default 'new' check (status in ('ranked','new','removed')),
  submitted_by uuid references auth.users(id),
  report_count int not null default 0,
  created_at timestamptz default now()
);

create table likes (
  user_id uuid references auth.users(id) not null,
  product_id uuid references products(id) not null,
  created_at timestamptz default now(),
  primary key (user_id, product_id)
);

create table wishlist (
  user_id uuid references auth.users(id) not null,
  product_id uuid references products(id) not null,
  bought boolean not null default false,
  created_at timestamptz default now(),
  primary key (user_id, product_id)
);

create table reports (
  user_id uuid references auth.users(id) not null,
  product_id uuid references products(id) not null,
  created_at timestamptz default now(),
  primary key (user_id, product_id)
);

-- 注意：此 view 用 select p.* ；若之後對 products 加欄位（如 image_url），
-- view 不會自動長出新欄位，要 drop view + 重建才會重新展開 p.*。
create view product_stats
  with (security_invoker = off) as
  select p.*, coalesce(l.cnt,0) as like_count
  from products p
  left join (select product_id, count(*) cnt from likes group by product_id) l
    on l.product_id = p.id
  where p.status <> 'removed';

create or replace function promote_product() returns trigger as $$
begin
  update products set status='ranked'
  where id = new.product_id and status='new'
    and (select count(*) from likes where product_id=new.product_id) >= 10;
  return new;
end; $$ language plpgsql security definer;
create trigger t_promote after insert on likes for each row execute function promote_product();

create or replace function auto_remove() returns trigger as $$
begin
  update products set report_count = report_count + 1 where id = new.product_id;
  update products set status='removed' where id = new.product_id and report_count >= 3;
  return new;
end; $$ language plpgsql security definer;
create trigger t_report after insert on reports for each row execute function auto_remove();

create or replace function limit_submissions() returns trigger as $$
begin
  if (select count(*) from products where submitted_by = auth.uid()
      and created_at > now() - interval '1 day') >= 2 then
    raise exception '每天最多投稿 2 樣，明天再來！';
  end if;
  return new;
end; $$ language plpgsql;
create trigger t_limit before insert on products for each row execute function limit_submissions();

alter table products enable row level security;
alter table likes enable row level security;
alter table wishlist enable row level security;
alter table reports enable row level security;
create policy p_read on products for select using (true);
create policy p_insert on products for insert with check (auth.uid() = submitted_by and source='user' and status='new');
create policy p_admin on products for update using (auth.jwt()->>'email' = 'chiwen5288@gmail.com');
create policy l_read on likes for select using (true);
create policy l_ins on likes for insert with check (auth.uid() = user_id);
create policy l_del on likes for delete using (auth.uid() = user_id);
create policy w_all on wishlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy r_ins on reports for insert with check (auth.uid() = user_id);
