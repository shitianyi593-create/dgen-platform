# DGen Platform

DGen Platform is a neutral AI creation workspace for video, image, text, and private asset workflows. It keeps provider credentials in the browser session only and routes local helper calls through the bundled Express server.

## Features

- **Video generation** (`/video`): Seedance 2.0 workflows with first-frame, first-last-frame, and multimodal references.
- **Video generation 2.5** (`/video-25`): Seedance 2.5 workflows with multimodal references, adaptive task settings, and optional prompt optimization.
- **Image generation** (`/image`): Seedream image generation, image-to-image references, sequential image generation, export, import, and history replay.
- **Text generation** (`/chat`): Chat and Responses API debugging UI with request, response, token, latency, and cache diagnostics.
- **Private asset library** (`/assets`): Asset group management, upload, search, polling, preview, and batch deletion.

## Security Model

DGen uses a BYO credential model:

- Credentials are entered through the in-app credential drawer.
- Credentials are stored only in `sessionStorage` for the current browser tab.
- The server does not persist API keys, access keys, or secret keys.
- Exported debug bundles do not include credentials.
- Local helper APIs are protected by an origin guard and default to loopback binding.

Use separate access keys for object storage and private asset operations when your provider supports scoped keys. Avoid admin-level keys for routine demos.

## Requirements

- Node.js 22
- npm 10

In this workspace, use the local Node runtime explicitly if the shell does not resolve `npm` correctly:

```bash
PATH="$HOME/.local/node-v22.18.0-darwin-arm64/bin:/usr/bin:/bin:/usr/sbin:/sbin" npm --version
```

## Setup

```bash
git clone <repo-url> dgen-platform
cd dgen-platform
npm install
```

Runtime credentials are entered in the UI. `.env.local` is optional and mainly useful for local development settings and manual verification scripts.

## Development

Start the frontend and local API server:

```bash
npm run dev
```

Default local endpoints:

- Frontend: `http://127.0.0.1:5173`
- API server: `http://127.0.0.1:3000`

Run frontend only when the API server is already running:

```bash
npm run dev:vite-only
```

## Validation

Run the full verification chain before committing:

```bash
npm test
npm run lint
npm run build
```

Manual provider verification scripts may consume real quota and should not be used in CI:

```bash
npm run verify:frame-roles
npm run verify:seedream
npm run verify:chat
npm run verify:cache
```

## Project Structure

```text
dgen-platform/
  server/                  Local Express API server and provider proxy helpers
  scripts/                 Manual verification and setup scripts
  src/
    api/                   Browser-side API clients
    components/
      assets/              Private asset library UI
      chat/                Text generation UI
      common/              Shared UI primitives
      credentials/         Credential drawer and .env import helpers
      image/               Image generation UI
      layout/              App shell and navigation
      video/               Video generation 2.0 UI
      video25/             Video generation 2.5 UI
    hooks/                 Generation, upload, and polling workflows
    i18n/                  Simplified Chinese and English dictionaries
    stores/                Zustand session stores
    types/                 Shared TypeScript contracts
    utils/                 Validation, export, statistics, and model helpers
```

## Documentation

- `docs/dgen/BASELINE.md`: migration baseline and screenshot notes
- `docs/deployment-guide.md`: self-hosted deployment guide

## Notes

- Keep route paths stable (`/video`, `/video-25`, `/image`, `/chat`, `/assets`).
- Keep provider payload and response shapes stable unless the API contract changes.
- Keep user-facing Chinese copy in Simplified Chinese.
- Do not commit credentials, generated secrets, or private user data.
