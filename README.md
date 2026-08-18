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

## Credential Groups

DGen separates credentials by responsibility so personal workflows can stay local-first without mixing unrelated permissions.

### Model Service

The model-service credentials are used to call text, image, and video models.

- **API key**: authenticates model requests.
- **Video endpoint**: identifies the deployed video generation model.
- **Video 2.5 endpoint**: optionally identifies the Seedance 2.5 workflow. When omitted, the app can use the default model-id path supported by the current implementation.
- **Image endpoint**: identifies the deployed image generation model.
- **Text endpoint**: identifies the text model used by chat and prompt optimization flows.

These credentials are required for generation. Text-only use usually needs only the API key and text endpoint. Image and video flows need their corresponding endpoints.

### Private Asset Library

The private asset-library credentials are used for provider-side asset management, not for ordinary model generation and not for object storage.

- **Access key ID**: authenticates private asset API requests.
- **Access key secret**: signs private asset API requests.
- **Project name**: scopes asset groups to a provider project. The default project name is usually `default`.

This section is needed for `/assets` and for workflows that register uploaded media as provider-side asset IDs such as `asset://...`.

### Object Storage

Object storage stores local reference media in a cloud-readable location before a remote model can fetch it.

- **Access key ID**: authenticates object-storage operations.
- **Access key secret**: signs object-storage operations.
- **Region**: the bucket's data-center region.
- **Bucket**: the cloud storage container.
- **Endpoint**: derived from the region for BytePlus TOS in normal use.
- **Key prefix**: an optional folder-like prefix such as `dgen/` that keeps DGen files grouped inside the bucket.

The current implementation supports BytePlus TOS directly. The intended product direction is to keep this user experience as "connect my cloud space" while adding a `StorageProvider` abstraction for S3-compatible targets such as Cloudflare R2, AWS S3, and MinIO.

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
- `docs/dgen/PROGRESS_2026-08-17.md`: latest implementation progress and validation notes
- `docs/dgen/PERSONAL_WORKBENCH_ROADMAP.md`: personal workbench, credential, storage, and multi-provider roadmap
- `docs/deployment-guide.md`: self-hosted deployment guide

## Notes

- Keep route paths stable (`/video`, `/video-25`, `/image`, `/chat`, `/assets`).
- Keep provider payload and response shapes stable unless the API contract changes.
- Keep user-facing Chinese copy in Simplified Chinese.
- Do not commit credentials, generated secrets, or private user data.
