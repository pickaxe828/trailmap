/** Editable defaults. Host entries match the host itself and any subdomain, never DNS results. */
export const DENIED_HOSTS = [
  // Mail and calendars
  'gmail.com', 'outlook.com', 'outlook.office.com', 'outlook.office365.com', 'proton.me', 'protonmail.com',
  'fastmail.com', 'hey.com', 'calendar.google.com', 'calendar.icloud.com', 'mail.icloud.com',
  // Banking and payment providers
  'bankofamerica.com', 'capitalone.com', 'chase.com', 'citibank.com', 'citi.com', 'wellsfargo.com',
  'hsbc.com', 'schwab.com', 'fidelity.com', 'paypal.com', 'cash.app', 'venmo.com', 'checkout.stripe.com',
  // Chat and social feeds
  'discord.com', 'discordapp.com', 'slack.com', 'teams.microsoft.com', 'web.whatsapp.com', 'messenger.com',
  'telegram.org', 'chat.google.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com',
  'facebook.com', 'instagram.com', 'threads.net', 'threads.com', 'x.com', 'twitter.com', 'tiktok.com',
  'linkedin.com', 'reddit.com', 'bsky.app', 'snapchat.com', 'mastodon.social',
  // Local and authentication endpoints. Loopback IPs are also blocked by the network rule.
  'localhost', 'home.arpa', 'auth.openai.com',
];

export const DENIED_SERVICE_LABELS = ['mail', 'webmail', 'calendar', 'chat', 'banking', 'onlinebanking', 'checkout'];
export const LOCAL_SUFFIXES = ['local', 'lan', 'internal', 'intranet', 'home', 'corp'];
export const DENIED_PATH_SEGMENTS = ['checkout', 'check-out', 'payment', 'payments'];
