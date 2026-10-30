# Deploy Recast independently of the laptop

## Render deployment

The root `render.yaml` defines one Docker web service and a persistent disk. Create a Blueprint from the GitHub repository, review Render's paid service/disk price, and add a **secret file** named `recast.env` containing `COMFY_API_KEY=...`. Render mounts it at `/etc/secrets/recast.env`; the API key remains server-side and the file overrides shell values. Never add this file to Git. Recast derives its HTTPS app/media URL from Render's `RENDER_EXTERNAL_URL`.

After the service starts, run `npm run invite` in its private shell to create the first account. A fresh host has a fresh database; importing a demo requires a separate private transfer of the approved data, never a Git commit. The opening demo video is bundled publicly, but account data and identity reference files are not.

The app needs Node 24, one continuously running server, a persistent disk, and HTTPS. Static GitHub Pages cannot run it. The supplied Dockerfile supports a Linux Docker host. Run only one application instance with this SQLite setup.

1. Copy application source (not `.env`, `data`, `node_modules`, or private media) to the host. Keep a private backup of the original data.
2. Create `deploy/recast.env` on the host containing `COMFY_API_KEY=` with the real key. Never commit it. The mounted file wins over shell variables. Keep permissions readable only by the service account; the image uses UID 1000.
3. Put a reverse proxy such as Caddy in front of localhost:3000 with your domain and HTTPS. Set `APP_ORIGIN=https://your-domain` when running `docker compose up -d --build`. The public media base uses that same HTTPS domain and expiring signed media routes. Do not expose port 3001.
4. For existing data, stop the old server, copy the complete private data directory (database, media and signing-secret) to the persistent `/data` volume, and run `node --experimental-strip-types scripts/relocate-media.ts` inside the container before starting. It resolves each stored filename inside `/data/media` and fails if anything is missing. Do not put this backup in GitHub. Delete old tunnel metadata from the migrated copy only; the configured permanent HTTPS media URL takes precedence.
5. Check `/health`, sign in, play an original and completed video, upload a small clip, then generate one result and download it. Keep disk backups. The container and hosted generation have not been verified on a remote server yet.

`data/demo.json` enables the demo entry with `{"sourceUser":"OWNER_USER_ID"}`. Each visitor receives a separate session, copies of identity/media references and completed non-archived public examples, and licenses to public clips. Private messages, teams, passwords and account email are not copied. A visitor may submit two attempts; the installation permits 20 demo attempts total and 100 demo sessions. Configure and review these limits in `server/demo.ts` before a larger event. Removing `demo.json` prevents new demo sessions; existing sessions retain access.

The current machine remains the only running deployment until a host/domain is configured and these checks pass. No hosting account or domain credentials were supplied in this session.
