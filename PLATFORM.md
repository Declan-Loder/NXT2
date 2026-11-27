# NXT Platform — Audit, Architecture & Roadmap

**Date:** 2026-11-16  
**Stack (verified):** Static multi-page HTML/CSS/JS · Vercel serverless `/api/*` · Supabase (Auth + Postgres + Storage)  
**Not Next.js / React.**

---

## 1. Audit (current state)

### Works
- Public marketing pages (home, creators, collab, sponsors, shop coming-soon)
- Tournament standings UI (`data.js`) + live tournament cards from Supabase
- Tournament registration form with EA ID, Discord, platform, payment method
- Server-side registration create (`/api/registrations`) with unique IDs
- EFT proof upload (`/api/payments-eft`) → Storage + pending verification
- Paystack initialize + verify (card path)
- Admin payments API (list / approve / reject / note) + `admin.html` UI
- Creator login/dashboard shell (Supabase Auth)
- **New:** Player login + player dashboard (registrations linked by `user_id`)
- **New:** Platform identity schema (`profiles`, `user_roles`, `player_profiles`, `gaming_accounts`, `games`, `notifications`, …)

### Partial
- Creator profiles still partly hardcoded in `app.js` (`NXT_CREATORS`)
- Tournament engine is registration-focused; fixtures/brackets still static TEAZERS markup
- Shop cart exists; checkout not live
- Notifications table exists; no UI emitters yet for all events
- Guest registrations allowed without `user_id` (legacy-compatible)

### Missing / next phases
- Full multi-role RBAC UI (moderator, organiser assignment)
- Creator tournament creation wizard + approval workflow
- Team system, fixtures engine, results/standings automation
- Universal multi-game tournament detail pages
- In-app notification centre
- Homepage driven fully by DB featured content
- Social login, password-reset branded pages
- Claim-by-email for legacy guest registrations

### Security posture
- Service role + Paystack secret only on Vercel ✓
- Admin APIs gated by Supabase JWT + `user_roles` (admin / superadmin / moderator), checked server-side
- RLS enabled on identity tables; registration insert public for form UX, ownership via `user_id`
- Card data never stored ✓
- Players cannot flip payment status from the browser ✓

### Retain
- Existing static design system (dark, lime, blue)
- TEAZERS bracket presentation until fixture engine ships
- Resend inquiry forms
- Paystack integration surface

---

## 2. Database migrations (run in order)

1. `supabase/schema.sql` — registrations, payments, proofs, audit  
2. `supabase/platform-v2.sql` — profiles, roles, player/creator, games, user_id on registrations  

Preserve existing rows. `user_id` on registrations is nullable for legacy/guest.

**Promote an admin (SQL):**
```sql
INSERT INTO public.user_roles (user_id, role)
VALUES ('YOUR-AUTH-USER-UUID', 'admin')
ON CONFLICT DO NOTHING;
```

---

## 3. Environment variables (Vercel)

| Variable | Required for |
|----------|----------------|
| `SUPABASE_URL` | Server APIs |
| `SUPABASE_SERVICE_ROLE_KEY` | Server APIs |
| `PAYSTACK_SECRET_KEY` | Card payments |
| `NXT_BANK_*` | EFT display |
| `RESEND_API_KEY` | Collab/sponsor email |

Frontend anon key remains in `app.js` (publishable).

---

## 4. Implementation phases (status)

| Phase | Status |
|-------|--------|
| 1 Audit + backup guidance | Done (this doc) |
| 2 DB architecture | Done (SQL files) |
| 3 Auth + roles foundation | Done (profiles + roles + player login) |
| 4 Player dashboard | Done (v1: my registrations + profile) |
| 5 Registration ↔ user link | Done (JWT → `user_id`) |
| 6 Creator dashboard (full) | v1 live: create/list/open-close tournaments (`/api/tournaments`, creator-dashboard) |
| 7 Multi-game tournament engine | Detail page + create flow live; fixtures still planned |
| 8 Teams / fixtures / results | Planned |
| 9 Payments | Done (EFT + card + admin) |
| 10 Admin dashboard | Payments admin live; expand users/creators |
| 11 Notifications / community | Schema ready |
| 12 Design consistency | Ongoing on new pages |
| 13 Shop | Preserved, not broken |
| 14 Security / QA | Ongoing |
| 15 Production checklist | See below |

---

## 5. Production checklist (minimum)

- [ ] Run both SQL migrations in Supabase  
- [ ] Set all Vercel env vars + redeploy  
- [ ] Create Storage bucket policies if uploads fail  
- [ ] Create a player account → register while logged in → confirm row has `user_id`  
- [ ] Submit EFT proof → approve in `admin.html`  
- [ ] Card path: Paystack test key → verify → status `paid`  
- [ ] Confirm no service role key in any HTML/JS served to browser  

---

## 6. Product principle

One account, multiple roles.  
Registrations belong to authenticated players.  
Tournaments have organisers.  
Payments have verifiable status.  
Admin actions are audited.

This release delivers the **identity + registration + payment spine**. Creator tournament authoring, fixtures, and full admin CRM are the next build blocks on the same schema.


## Grant creator access (SQL)

```sql
-- After user signs up, find their id in auth.users / profiles, then:
INSERT INTO public.user_roles (user_id, role)
VALUES ('USER-UUID-HERE', 'creator')
ON CONFLICT DO NOTHING;

-- Optional creator public profile
INSERT INTO public.creator_profiles (user_id, display_name, slug, verification_status)
VALUES ('USER-UUID-HERE', 'Display Name', 'display-slug', 'approved')
ON CONFLICT (user_id) DO UPDATE SET verification_status = 'approved';
```


### New pages this build
- `tournament.html?id=` — public detail + register handoff
- `creator-apply.html` — creator application form
- Admin reviews applications on `admin.html`


## Fixtures migration
Run after platform-v2:
3. `supabase/fixtures.sql` — matches, match_results, tournament_standings

API: `POST /api/matches` (list public; create/result requires organiser auth)
