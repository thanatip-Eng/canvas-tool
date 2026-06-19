# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start built app
npm run lint     # eslint (flat config in eslint.config.mjs)
```

No test runner is configured. Type checking is implicit via `next build` (TS strict mode in `tsconfig.json`).

Path alias: `@/*` resolves to the repo root (e.g. `@/lib/foo`, `@/types`).

## Required environment

`.env.local` must define:
- `NEXT_PUBLIC_FIREBASE_*` — client Firebase config (see `.env.local.example`). Without them, Firebase init is skipped (`isFirebaseConfigured()` in `lib/firebase.ts`) and the login page shows a warning instead of crashing — this lazy init is intentional so static prerender works with missing env.
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — server-only Admin SDK creds (`lib/firebase-admin.ts`). The private key may be stored with literal `\n` (Vercel-style); it is restored at init.
- `ALLOWED_EMAILS` *(optional)* — comma-separated allowlist used by `isEmailAllowed` in `lib/api-auth.ts`. Entries starting with `@` are domain matches (e.g. `@cmu.ac.th`). Unset = allow any authenticated user.
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` *(optional)* — enables per-uid sliding-window rate limit (100/min) in `lib/rate-limit.ts`. Unset = fail-open (warn in prod).

The Canvas API key + Canvas base URL are NOT env vars — user enters them at first login and they persist to Firestore at `users/{uid}`. Server reads them via `getCanvasCreds(uid)`; the client never sends them in request bodies anymore.

## Architecture

### Auth + Canvas credentials flow
Login is two-step (`app/page.tsx`):
1. Google sign-in via Firebase Auth → populates `user`.
2. User enters Canvas URL + Canvas API token → saved to `users/{uid}` doc and into `AuthContext` as `apiKey` + `canvasUrl`.

`app/(authenticated)/layout.tsx` redirects to `/` if any of the three (`user`, `apiKey`, `canvasUrl`) is missing. The client keeps `apiKey`/`canvasUrl` in `AuthContext` only for UI gating — it never sends them to the server. Server routes get them from Firestore via `getCanvasCreds(uid)` after `requireAuth` verifies the Firebase ID token.

### Two routing groups
- `app/(authenticated)/` — everything behind login. Top-level pages (`/courses`, `/dashboard`, `/grade-compare`, `/score-mapping`, `/status-check`, `/group-export`, `/response-export`) use the global `Navbar`.
- `app/(authenticated)/project/[projectId]/` — project-scoped feature pages. Layout swaps in `ProjectNavbar` and wraps children in `ProjectProvider` + `ErrorBoundary`. The parent authenticated layout detects `/project/` and skips its own `Navbar`/`<main>` so the project layout can own the chrome.

### Project model (Firestore + Storage)
Projects are 1:1 with Canvas courses. The deterministic ID `course_{canvasCourseId}` (`getProjectId` in `lib/project-service.ts`) means re-importing the same course updates the existing project rather than creating duplicates.

Firestore tree:
```
users/{uid}
users/{uid}/projects/{projectId}            # Project doc, includes edpuzzleConfigs map
users/{uid}/projects/{projectId}/files/{id} # ProjectFile metadata
users/{uid}/projects/{projectId}/outputs/{id} # OutputFile metadata
```

Storage tree (mirrors Firestore):
```
users/{uid}/projects/{projectId}/files/{group}/{fileId}_{filename}
users/{uid}/projects/{projectId}/outputs/{outputId}_{filename}
```

`FileGroup` is one of `canvas | registrar | score | edpuzzle | master` (see `types/index.ts`). The `master` group is special: it's a generated artifact (built by `MasterDataBuilder` from canvas+registrar files) cached as a project file because many features consume it. `ProjectContext.loadMasterData()` memoizes the most recent master file per session.

Edpuzzle configs are stored as a **map field** on the project doc (`edpuzzleConfigs`), not a subcollection — this avoids extra Firestore rules. Keys are either `clips_{n}` or `pl_{playlistName}`.

### Storage proxy (CORS workaround)
Browser uploads/downloads to Firebase Storage are blocked by CORS on localhost, so all reads/writes go through Next API routes (`app/api/storage/upload/route.ts`, `app/api/storage/download/route.ts`). Each route runs `requireAuth` then `assertOwnsStoragePath(uid, storagePath)` before forwarding to the Firebase Storage REST API. `lib/firebase-storage.ts` is the client wrapper (uses `apiPostForm`/`apiGet`). Direct client SDK use is reserved for `deleteObject` (which tolerates CORS failure since the Firestore metadata cleanup is what matters).

### API auth helpers (`lib/api-auth.ts` + `lib/api-client.ts`)
Every protected route starts the same way:
```ts
const { uid } = await requireAuth(request);
const { apiKey, canvasUrl } = await getCanvasCreds(uid); // canvas routes only
```
`requireAuth` verifies the `Authorization: Bearer <ID token>` header, checks `ALLOWED_EMAILS`, and runs the per-uid rate limit. It throws `ApiError(message, status)`; wrap the route body in `try/catch` and return `toErrorResponse(err)`. For storage routes also call `assertOwnsStoragePath(uid, path)` to block traversal.

On the client, never call `fetch` directly against `/api/*`. Use the wrappers in `lib/api-client.ts`:
- `apiGet<T>(path, params?)` — GET + parse JSON
- `apiPostJson<T>(path, body)` — POST JSON body
- `apiPostForm<T>(path, formData)` — POST multipart (file uploads)
- `apiFetch(path, init?)` — raw `Response` (streaming/blob)

All four attach the Firebase ID token automatically.

### Canvas API proxy
All `app/api/canvas/*` routes share this shape: `requireAuth` → `getCanvasCreds(uid)` → take only **resource IDs** from query string (never the API key) → fetch Canvas with `Authorization: Bearer ${apiKey}` → **paginate via the `Link` header `rel="next"`**. The `/api/canvas/auto-grade` route is a batch endpoint that fans out submissions+rubrics+late-policy+quiz-questions in groups of 5 and normalizes Classic vs New Quiz schemas — preserve this shape when extending. `/api/canvas/grade-upload` enforces a body size cap.

### Canvas data parsing conventions (`lib/constants.ts`)
- `CANVAS_FIXED_COLS = 6` — Canvas exports always start with 6 fixed identity columns; assignment columns begin at index 6.
- `MASTER_FIXED_COLS = 8` — Master Data adds two extra columns (`Reg Status`, `สถานะจับคู่`) before assignments.
- `ASSIGNMENT_ID_REGEX = /\((\d+)\)/` — Canvas embeds the assignment ID in the column header like `Homework 1 (12345)`.
- `EXCLUDE_PATTERNS` — keywords that mark non-assignment columns (current/final score/point, etc.). When detecting assignment columns, always use `extractAssignments()` rather than rolling your own filter.
- A "Points Possible" sentinel row may be the first data row; use `getPointsRowStart()` before iterating students.
- Registrar filenames encode `courseCode(6)+lecSection(3)+labSection(3)` — see `REGISTRAR_FILENAME_REGEX`.

### File parsing
`lib/csv-utils.ts:parseFile()` handles both CSV (custom quote-aware splitter) and XLSX (via `xlsx` lib) — both produce a `ParsedFile { headers, rows }`. CSVs are read as UTF-8; CSVs we **write** are prefixed with `﻿` BOM (`downloadCSV`, `uploadCsvToStorage`) so Excel renders Thai characters correctly. Don't drop the BOM.

### UI conventions
- The app is in **Thai**. Match existing tone in user-facing strings; keep code identifiers English.
- Styling: Tailwind v4 + custom CSS variables (`--color-accent`, `--color-text-muted`, etc.) defined in `app/globals.css`. The `glass-card` utility is used widely.
- Errors inside project pages are caught by `ErrorBoundary` in the project layout — don't add another wrapper inside individual pages.

## When adding a new feature page under a project
1. Create `app/(authenticated)/project/[projectId]/<feature>/page.tsx` (client component).
2. Pull data via `useProject()` — don't refetch files/outputs yourself.
3. If you save an output XLSX, call `saveOutput(featureType, label, buffer, stats)` so it appears in `OutputHistory`.
4. Add the route to `FEATURE_ITEMS` in `components/layout/ProjectNavbar.tsx`.
