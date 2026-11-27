/* Public, non-secret front-end configuration. */
window.NXT_CONFIG = {
  /**
   * OAuth providers to offer on the login page. LEAVE EMPTY until each provider
   * is enabled and configured in Supabase → Authentication → Providers
   * (client id/secret + redirect URL). Supabase supports: 'google', 'discord', 'twitch'.
   * Xbox, PlayStation and Steam have no native Supabase provider; they need a
   * custom OIDC/OpenID bridge and are intentionally NOT offered here.
   */
  oauthProviders: [],
};
