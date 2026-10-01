// Defaults for the Vercel deployment, applied before anything reads the
// environment. A variable set in the Vercel project always wins.
// No credentials here: storage trusts the identity token Vercel issues to the
// function (see supabase/functions/kks-store).

const defaults: Record<string, string> = {
  DATA_DIR: '/tmp/kks', // the only writable place in a function
  COOKIE_SECURE: 'true', // Vercel serves everything over HTTPS
  MAX_UPLOAD_MB: '4', // Vercel's request body limit is 4.5 MB
  KKS_STORE_URL: 'https://xltbzueovxlxqcvcanmb.supabase.co/functions/v1/kks-store',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
