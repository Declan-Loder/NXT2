# NXT — Production deployment checklist

Follow this order. Do not skip steps.

## 1. Supabase (SQL Editor — run in order)

1. `supabase/schema.sql` — tournaments, registrations, payments, proofs, audit  
2. `supabase/platform-v2.sql` — profiles, roles, games, creator apps, user_id on registrations  
3. `supabase/fixtures.sql` — matches, standings  
4. `supabase/hardening.sql` — **security fixes to the tables above (run before going live)**  
5. `supabase/platform-v3.sql` — follows, communities, teams, ranked matches, leaderboards, XP/achievements, messaging, moderation, search, media bucket  
6. Optional: `supabase/seed-demo.sql` — sample open tournament for testing  

> The SQL files are idempotent and additive. Run them in a **staging** Supabase project first; they were
> written without access to a live database and have not been executed by the author (see UPGRADE_REPORT.md).

**Auth settings**

- Authentication → Providers → Email enabled  
- URL configuration: Site URL = your Vercel domain  
- Redirect URLs: `https://YOUR-DOMAIN/**` and `http://localhost:3000/**`  

**Storage**

- Bucket `payment-proofs` is created by schema.sql (private)  

**Promote yourself admin / creator** (after first signup):

```sql
-- Replace with your auth user UUID from Authentication → Users
INSERT INTO public.user_roles (user_id, role) VALUES
  ('YOUR-UUID', 'admin'),
  ('YOUR-UUID', 'creator')
ON CONFLICT DO NOTHING;
```

## 2. Vercel environment variables

| Variable | Required |
|----------|----------|
| `SUPABASE_URL` | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (server only) |
| `PAYSTACK_SECRET_KEY` | For card payments |
| `NXT_BANK_NAME` | EFT display |
| `NXT_BANK_ACCOUNT_NAME` | EFT display |
| `NXT_BANK_ACCOUNT_NUMBER` | EFT display |
| `NXT_BANK_BRANCH_CODE` | EFT display |
| `RESEND_API_KEY` | Collab / contact / sponsor emails |

Redeploy after setting variables.

## 3. Frontend keys

In `app.js`, confirm:

- `SUPABASE_URL` matches your project  
- `SUPABASE_ANON_KEY` is the **anon/public** key (not service role)  

**Optional — Social login.** Enable Google / Discord / Twitch in Supabase → Authentication → Providers, then list them in
`js/config.js` (`oauthProviders: ['google']`). Buttons only appear for providers you list. Xbox, PlayStation and Steam
have no native Supabase provider and are not offered.

**Auth settings to turn on:** Confirm email (email verification), and set Site URL + Redirect URLs to include
`https://YOUR-DOMAIN/reset-password.html` (password recovery).

## 4. Smoke test (in order)

1. Open homepage — featured tournaments load or empty state  
2. Register player account → email verify if required → login  
3. Open tournament → Register (must be signed in) → complete form  
4. Free event → status paid on dashboard  
5. Paid EFT → bank reference shown → upload proof → admin approves  
6. Paid card → Paystack (test key) → return → paid  
7. Creator apply → admin approve → creator dashboard → create tournament → open  
8. Add fixture → record result → appears on tournament detail  
9. Two accounts: follow, message request → accept, challenge → accept → submit result → confirm → leaderboard updates  
10. Create community and team; invite by username; report content; resolve it in `/admin`  
11. Automated UI smoke test (needs Python + Playwright): `python tests/smoke.py`  

## 5. Security reminders

- Never put service role key in HTML/JS  
- Never commit `.env` with secrets  
- Admin access is role-based (`user_roles`), not a shared key. `NXT_ADMIN_KEY` is no longer used and can be deleted from Vercel.  
- Rotate the Supabase service-role key if it was ever shared or committed  

## 6. Git / Vercel

Push the contents of the `NXT/` folder as the repository root (so `index.html` is at root).  
Vercel project: Framework Preset **Other**, output the root.
'''
