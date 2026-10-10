# Softspace

A small software sharing website with a responsive catalog, search and category filters, software uploads, and direct downloads.

## Run locally

Requires Node.js 18 or newer. No package installation is needed.

```sh
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Set the `PORT` environment variable to use another port.

Uploads are limited to 500 MB and common software installer/archive formats. Files and the catalog are saved under `data/` beside the server, so they persist across restarts. Back up that directory to preserve the library.

This is a starter app for a trusted community. Before making it a public upload service, add account authentication, moderation, malware scanning, rate limits, and a storage/database service suited to your deployment.

## Prepare a Render deployment

The root `render.yaml` configures a Node web service and mounts a 1 GB persistent disk at `/var/data`. The app uses `DATA_DIR` for the catalog and uploads, so uploaded software persists across deploys. Render requires a paid web service to attach a persistent disk; check current pricing before creating the service. The `data/` directory is excluded from Git so existing local uploads are not published by accident.

To launch, place this project in a Git repository, push it to a Git provider connected to your Render account, and create a Render Blueprint from that repository. Review the selected compute and disk charges before confirming service creation. Render supplies a public `onrender.com` address after deployment.
