# NXT — Creator Community

A static, multi-page community website for NXT: a South African creator network connecting creators, gaming communities, collaboration opportunities and brand partners.

## Pages
- `index.html` — home and community introduction
- `creators.html` and `creator.html?id=...` — creator roster and individual profile pages
- `creator-login.html` / `creator-dashboard.html` — Supabase email/password authentication and protected session landing
- `collab.html` — collaboration page
- `sponsors.html` — brand/sponsorship page
- `tournaments.html` — standings and Supabase tournament listings/registration
- `shop.html` / `checkout.html` — cart and checkout UI

## Deployment
Upload the contents of this folder to the GitHub repository connected to Vercel. Keep the root `index.html` at repository root. Vercel will serve this as a static site.

## Important integrations
1. **Supabase:** `app.js` contains the project's public anon key and URL. Confirm they are the correct project values. In Supabase Auth, configure the production Site URL and redirect URLs. Enable email/password sign-in. Tournament pages also expect `tournaments` and `registrations` tables with suitable Row Level Security policies.
2. **Creator data:** login/authentication is wired to Supabase Auth. A real editable profile system still requires a `creator_profiles` table and strict RLS policies; the dashboard intentionally does not pretend those features are already configured.
3. **PayFast:** the browser-side merchant-key/signature implementation was removed for safety. PayFast signatures and order verification must happen on a trusted server/serverless function. Until that endpoint is configured, the checkout UI will not claim to have accepted payment. Never put a PayFast merchant key or passphrase in `app.js`.
4. **Forms and notifications:** verify form destinations and configure an email provider/server endpoint before advertising automatic email delivery.

## Motion and accessibility
Scroll reveal animations use IntersectionObserver and respect `prefers-reduced-motion`.
