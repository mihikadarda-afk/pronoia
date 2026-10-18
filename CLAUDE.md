# Working on Pronoia

- When work is finished and pushed, merge it into the default branch (`claude/new-session-63ho2j`), so Vercel deploys it. Open a PR from the working branch and merge it; no need to ask first.
- Never commit API keys. `GEMINI_API_KEY`, the Supabase secret key and the VAPID private key live only in Vercel env vars, never in a `VITE_` variable.
- Checks before pushing: `npm run build`, `npm test`, `npm run test:sql`.
