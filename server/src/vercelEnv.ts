// Defaults for the Vercel deployment, applied before anything reads the
// environment. A variable set in the Vercel project always wins.
// The connection settings (SUPABASE_URL, SUPABASE_KEY, KKS_SECRET) are never
// defaulted: they belong in the project's environment variables.

const defaults: Record<string, string> = {
  DATA_DIR: '/tmp/kks', // the only writable place in a function
  COOKIE_SECURE: 'true', // Vercel serves everything over HTTPS
  MAX_UPLOAD_MB: '4', // Vercel's request body limit is 4.5 MB
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
