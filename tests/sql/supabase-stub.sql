-- Just enough of Supabase (roles, auth.uid(), auth.jwt(), the realtime publication) to load the migrations into plain Postgres.
do $$ begin create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth; create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('is_anonymous', coalesce(current_setting('test.anon', true), 'false')::boolean) $$;
create publication supabase_realtime;
grant usage on schema public, auth, extensions to anon, authenticated;
