# Glow Store Supabase setup

This project is isolated from Strivio and targets Supabase project `hebbeanicxtkxsifsfxh`.

## Apply the backend

1. In the Glow Store Supabase dashboard, open **SQL Editor** and run `migrations/202610290001_glow_store_backend.sql`.
2. Run `seed.sql` to load the 69 wilayas and 1,541 communes used by checkout. The records are rechecked against these tables when an order is submitted.
3. In **Authentication → Settings**, turn off **Allow new users to sign up**. Email/password sign-in stays enabled for invited administrators only.
4. Create the first administrator in **Authentication → Users** with an email you control. Use Supabase's invite flow so you set the password yourself.
5. In SQL Editor, add only that invited user to the allowlist:

```sql
insert into public.glow_admins(user_id)
select id from auth.users where email = 'YOUR-ADMIN-EMAIL';
```

The insert returns no row if that address is not an existing Auth user. This allowlist has no browser insert/update/delete policy; adding another admin requires the project owner.

6. Visit `/glow-store/admin/`, sign in with that invited account, and enroll an authenticator app. Order reads and every admin mutation require Supabase MFA assurance `aal2` inside PostgreSQL policies and RPCs.

## Application configuration

The browser uses only the project URL and publishable key (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`). A publishable key is intentionally public; it cannot read private order rows or edit admin data. Do not put the database password, secret key, service-role key, or admin password in the app, Git, or browser build.

The public checkout calls `submit_glow_order`. PostgreSQL validates names, Algerian mobile number, shade availability and commune/wilaya pairing, calculates the saved price and delivery charge from `glow_store_settings`, rejects repeat submissions for the same phone for one minute, and never grants the caller order-read access. The frontend's total is only a preview; the saved database total is authoritative.

The base flat delivery values start at 600 DZD home / 400 DZD pickup, matching the values recorded in the existing Strivio repository. Edit the figures in the admin Settings page if the courier's current rate card differs. Verify the carrier's rates before marketing those values.

## Local development

Copy `.env.example` to `.env.local`, fill in the Glow Store project URL and publishable key, then run `npm run dev`. `.env.local` is ignored by Git. Local Supabase CLI migrations are not required for the published app; dashboard SQL Editor can apply the files above.
