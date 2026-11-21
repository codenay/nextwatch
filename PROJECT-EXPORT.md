# NextWatch project export

This folder contains the complete editable NextWatch project and a fresh production build.

## Structure

- `app/` — pages, UI, styles, and API routes
- `lib/` — TMDB integration and recommendation logic
- `public/` — public images and brand assets
- `dist/client/` — compiled browser assets
- `dist/server/` — compiled server and API runtime
- `.openai/hosting.json` — Sites deployment configuration
- `package.json` and `package-lock.json` — dependencies and scripts

## Run locally

1. Use Node.js 22.13 or later.
2. Run `npm install`.
3. Provide `TMDB_READ_ACCESS_TOKEN` as an environment variable.
4. Run `npm run dev` for development.
5. Run `npm run build` to regenerate `dist/`.
6. Run `npm start` to serve the production build locally.

Secrets and machine-specific folders (`.git`, `node_modules`, caches, and local environment files) are intentionally excluded.
