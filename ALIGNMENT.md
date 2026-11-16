# NXT Brief Alignment Report
**Date:** 2026-11-16

## Design system
- Tokens aligned to brief: `#08090B` bg, surfaces `#101216` / `#15191F` / `#1B2028`, text white, muted `#A1A7B0`, borders `#252B34`, accent `#B6F23A`.
- Typography: Space Grotesk headings + Inter body (Google Fonts).
- Primary buttons use lime accent on dark UI.

## Navigation (public)
Home · Tournaments · Creators · Community · About · Shop · Login/Register

## Pages vs brief

| Brief page | Status |
|------------|--------|
| Homepage | Aligned hero + featured tournaments/creators + community + partnerships CTAs |
| Tournaments list | Live |
| Tournament details | `tournament.html?id=` |
| Creators directory | Live (static roster + apply flow) |
| Community | **New** `community.html` |
| About NXT | **New** `about.html` |
| Partnerships | `sponsors.html` (existing form) |
| Shop | Catalogue / coming soon preserved (non-transactional per brief) |
| Contact | **New** `contact.html` |
| Login / Register | `player-login.html` |
| Privacy / Terms | **New** |
| Player dashboard | Live + account-linked registrations |
| Creator apply + dashboard | Live |
| Admin payments + creator apps | Live |

## Working backend (preserve)
- Registrations + `user_id` link, EFT proofs, Paystack verify, admin approve
- Creator tournament create API
- Supabase Auth
- **No table drops; migrations are additive only**

## Intentionally later (Phase 3+)
- Full fixtures / brackets / standings engine
- Team registration
- Admin CMS for homepage announcements
- Shop checkout (explicitly deferred in brief)
- Email notifications beyond Resend inquiries

## Data safety
- Service role key stays server-side only
- Existing registrations and auth users not wiped by migrations


## Fixtures (Phase 3 start)
- Schema: `supabase/fixtures.sql`
- Public fixtures on tournament detail page
- Organiser create match + record result on creator dashboard
- Standings auto-bump on result (best effort)
