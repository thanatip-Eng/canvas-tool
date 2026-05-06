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

`.env.local` must define all `NEXT_PUBLIC_FIREBASE_*` vars (see `.env.local.example`). Without them, Firebase init is skipped (`isFirebaseConfigured()` in `lib/firebase.ts`) and the login page shows a warning instead of crashing — this lazy init is intentional so static prerender works with missing env. The Canvas API key + Canvas base URL are NOT env vars — they are entered by the user at first login and persisted to Firestore at `users/{uid}`.

## Architecture

### Auth + Canvas credentials flow
Login is two-step (`app/page.tsx`):
1. Google sign-in via Firebase Auth → populates `user`.
2. User enters Canvas URL + Canvas API token → saved to `users/{uid}` doc and into `AuthContext` as `apiKey` + `canvasUrl`.

`app/(authenticated)/layout.tsx` redirects to `/` if any of the three (`user`, `apiKey`, `canvasUrl`) is missing. Every Canvas API caller passes `apiKey` + `canvasUrl` through to `/api/canvas/*` routes — the server never reads them from env.

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
Browser uploads/downloads to Firebase Storage are blocked by CORS on localhost, so all reads/writes go through Next API routes (`app/api/storage/upload/route.ts`, `app/api/storage/download/route.ts`) which forward to the Firebase Storage REST API using the user's Firebase ID token. `lib/firebase-storage.ts` is the client wrapper. Direct client SDK use is reserved for `deleteObject` (which tolerates CORS failure since the Firestore metadata cleanup is what matters).

### Canvas API proxy
All `app/api/canvas/*` routes follow a consistent shape: read `apiKey`, `canvasUrl`, and resource IDs from query string, fetch with `Authorization: Bearer ${apiKey}`, and **always paginate via the `Link` header `rel="next"`** (use the `parseLinkNext` helper pattern). The `/api/canvas/auto-grade` route is a batch endpoint that fans out submissions+rubrics+late-policy+quiz-questions in groups of 5 and normalizes Classic vs New Quiz schemas — preserve this shape when extending.

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
