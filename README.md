# Softspace

A small software sharing website with a responsive catalog, search and category filters, software uploads, and direct downloads.

## Run locally

Requires Node.js 18 or newer. No package installation is needed.

```sh
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Set the `PORT` environment variable to use another port.

Uploads are limited to 500 MB and common software installer/archive formats. Files and the catalog are saved under `data/` beside the server, so they persist across restarts. Back up that directory to preserve the library.

Production uploads enter a review queue and are not downloadable until an admin approves them. Set a strong `ADMIN_TOKEN` in the hosting dashboard and open `/review` to sign in and review submissions. Rejected uploads stay in storage but are not shown in the public catalog or available to download. In local development, uploads are approved immediately unless `NODE_ENV=production` is set.

## Prepare a Render deployment

The root `render.yaml` configures a Node web service and mounts a 1 GB persistent disk at `/var/data`. The app uses `DATA_DIR` for the catalog and uploads, so uploaded software persists across deploys. Render requires a paid web service to attach a persistent disk; check current pricing before creating the service. The `data/` directory is excluded from Git so existing local uploads are not published by accident. During service creation, Render prompts for `ADMIN_TOKEN`; use a long, unique secret and keep it private.

To launch, place this project in a Git repository, push it to a Git provider connected to your Render account, and create a Render Blueprint from that repository. Review the selected compute and disk charges before confirming service creation. Render supplies a public `onrender.com` address after deployment. Set `ADMIN_TOKEN` before deployment; the server refuses to start in production if it is missing.
