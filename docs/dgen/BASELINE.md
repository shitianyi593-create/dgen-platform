# DGen Migration Baseline

Date: 2026-08-14

Repository:

- Local path: `/Users/bytedance/Documents/trae_projects/dgen-platform`
- Remote: `https://github.com/shitianyi593-create/dgen-platform.git`
- Baseline commit before this document: `5032a40 chore: import sanitized DGen baseline`

Related DGen documents:

- `docs/dgen/PROGRESS_2026-08-17.md` - latest implementation progress and verification notes.
- `docs/dgen/PERSONAL_WORKBENCH_ROADMAP.md` - personal workbench and multi-provider product roadmap.

## Environment

- OS: macOS 26.4.1 arm64
- Node: `v24.19.0`
- npm: `11.17.0`
- Node binary used: `/Users/bytedance/.local/node-runtime/bin/node`

Note: the PRD/spec asks for Node 20.19+ or 22.12+. The local runtime found by this environment is Node 24.19.0. The project README says tests have passed on Node 20-25, so the baseline commands were run with Node 24.19.0 and this is recorded as an environment fact.

## Dependency Install

Command:

```bash
PATH=/Users/bytedance/.local/node-runtime/bin:$PATH npm ci
```

Result: passed.

Observed baseline warnings:

- `npm audit` reports 19 vulnerabilities: 3 low, 1 moderate, 13 high, 2 critical.
- npm reports pending install-script approval for:
  - `esbuild@0.27.7`
  - `fsevents@2.3.3`
  - `tos-crc64-js@0.0.1`

These were not changed in Task 1.

## Automated Checks

### Test

Command:

```bash
PATH=/Users/bytedance/.local/node-runtime/bin:$PATH npm test
```

Result: passed.

Summary:

- Test files: 106 passed
- Tests: 1129 passed
- Duration: 101.32s

Observed baseline warnings:

- React `act(...)` warning in `src/__tests__/videoParams.test.tsx` for `VideoParams`.
- React `act(...)` warning in `src/__tests__/mediaUploader.test.tsx` for `MediaUploader`.

These warnings did not fail the test run and were not changed in Task 1.

### Build

Command:

```bash
PATH=/Users/bytedance/.local/node-runtime/bin:$PATH npm run build
```

Result: passed.

Output summary:

- Vite: `v8.0.10`
- Modules transformed: 189
- Output:
  - `dist/index.html` 0.47 kB
  - `dist/assets/index-BmCgXVd9.css` 20.33 kB
  - `dist/assets/index-BkD3CXxi.js` 637.63 kB

Observed baseline warning:

- Vite reports a chunk larger than 500 kB after minification.

This was not changed in Task 1.

### Lint

Command:

```bash
PATH=/Users/bytedance/.local/node-runtime/bin:$PATH npm run lint
```

Result: passed.

## Local Dev Server

Command:

```bash
PATH=/Users/bytedance/.local/node-runtime/bin:$PATH npm run dev
```

Result: passed.

Server endpoints:

- Vite frontend: `http://127.0.0.1:5173/`
- Express API server: `http://127.0.0.1:3000`

Routes opened for baseline screenshots:

- `/video`
- `/video-25`
- `/image`
- `/chat`
- `/assets`

## Baseline Screenshots

Screenshots are stored under `docs/dgen/baseline-screenshots/`:

- `01-video.png`
- `02-video-25.png`
- `03-image.png`
- `04-chat.png`
- `05-assets.png`
- `06-credentials-drawer.png`

Screenshot dimensions captured by the available browser tool:

- `1306 x 1352`

The implementation spec asks for 1440 x 900 screenshots. The available browser automation tool in this environment did not expose viewport control, so Task 1 records the captured viewport size explicitly. If strict 1440 x 900 evidence is required, retake these screenshots in a Playwright or browser environment with explicit viewport control.

## Scope Guard

Task 1 intentionally did not change:

- Application source code.
- API request/response types.
- `server/` proxy/signing/CORS/origin guard behavior.
- Zustand store field names or persisted storage keys.
- ZIP import/export schema.
- Existing dependency versions.
