# Kernel and content-core API (quick reference)

What already exists, so you can call it without opening the files. `Ctx` is `{ db, actor, now, requestId, ip? }`. Many functions accept a narrower `Pick<Ctx, …>`. Open the file for exact types.

## Request and authorisation
- `@/server/context`: `getCtx()`, `requireSession()`, `requireLearner()`, `requireParent()`, `requireStaff()`, `systemCtx(job)`. Staff need a verified second factor (off only in tests).
- `@/server/authz`: `can(actor, action, resource?)`, `assertCan(...)`, `hasRole(actor, ...roles)`. Actions are listed in `src/server/authz/actions.ts`; add new ones there. Resource is `{ learnerId?, familyId? }`.
- `@/server/action`: `runAction(async () => …)` for Server Actions → `{ ok, data } | { ok: false, error }`. `@/server/http`: `handle(async (req, ctx) => …)` for Route Handlers.
- `@/server/errors`: `new AppError(code, teenFriendlyMessage, { status?, detail?, fieldErrors? })`.
- `@/server/audit`: `audit(ctx, { action, targetType?, targetId?, reason?, meta? }, tx?)`.
- `@/server/auth/accounts`: `createAccount(db, …)`, `setAccountPassword`, `revokeAllSessions`. Better Auth's public sign-up routes are disabled: accounts are created only through `createAccount` inside your transaction. `@/server/auth/learner-email`: `userEmail(user)` (learners have a hidden placeholder address). `@/lib/auth-client` for browser sign-in (`signIn.email`, `signIn.username`, `signIn.magicLink`, `twoFactor.verifyTotp`, `signOut`).
- `@/server/services/age`: `ageFromBirth`, `safetyBandForAge`, `pathwayForAge`, `isUnder13`.

## Settings, flags, limits
- `@/server/settings`: `getSetting(ctx, key)`, `getSettings(ctx, keys)`, `setSetting(ctx, key, value, reason?)`, `listSettings(ctx)`. Keys and defaults: `src/server/settings/registry.ts`.
- `@/server/settings/launch-readiness`: `getLaunchReadiness`, `computeLaunchReadiness`, `confirmLaunchItem`, `clearLaunchItem`, `isSignupOpen(ctx)`, `markLaunchReadyForDev(ctx)`.
- `@/server/flags`: `isEnabled(ctx, key, target?)`, `listFlags`, `setFlag`.
- `@/server/ratelimit`: `rateLimit(ctx, name, { limit, windowSec, key? })` (throws `rate_limited`), `checkRateLimit`, `acquireConcurrency`, `withConcurrency`.
- `@/server/metrics`: `incrementCounter(ctx, key)` — keys in `METRIC_KEYS` only, never personal data.
- `@/server/processors`: `isProcessorApproved`, `assertProcessorEnabled`, `approveProcessor`, `setProcessorEnabled`, `listProcessors`.

## Messaging
- `@/server/notifications`: `notify(ctx, { userId, type, title, body, href?, channels?, emailTemplate?, emailData?, urgent?, dedupeKey? })`, `notifyParentsOfLearner(ctx, learnerId, input)`, `notifyStaffWithRole(ctx, role, input)`, `listNotifications`, `unreadCount`, `markRead`. Learners get in-app only and nothing during quiet hours; parents' safety notices are immediate.
- `@/server/email`: `sendEmail(ctx, { to, template, data?, userId? })` (refuses under-18 learners), `registerEmailTemplate(key, def)` for your own templates, `renderEmail`, `getSentEmails()` / `clearSentEmails()` in tests.
- `@/server/copy`: `t(ctx, key, vars?)`, `tMany`, `tDefault(key, vars?)`; defaults in `src/content/copy/en-GB.ts` (add keys there).

## Files and jobs
- `@/server/storage`: `getStorage("private" | "public")` → `put`, `get`, `stat`, `delete`, `exists`, `signedDownloadUrl(key, { expiresInSec?, downloadName? })`, `signedUploadUrl(key, { contentType, maxBytes })`; `verifyUpload(key, { maxBytes })`. Keys look like `segment/segment` with letters, digits and `. _ -`.
- `@/server/jobs`: `defineJob({ name, schedule?, event?, run })`, `enqueue(event, payload, { idempotencyKey? })`, `runJob`, `flushJobs()` in tests. Add your job to `src/server/jobs/registry.ts` on its own line.
- `@/server/net/safe-fetch`: `checkPublicUrl`, `assertPublicUrl`, `safeFetchText` — every outbound URL from a learner or a crawler goes through these.
- `@/server/crypto`: `encrypt`/`decrypt(text, "safeguarding" | "content")`, `newToken()`, `newCode()`, `hashToken()`, `sha256()`.

## Courses and tools
- `@/content/schema`: `Course` and friends, `toLearnerCourse(course)` (strips answers, feedback, coachContext and internal fields — always use it before sending a course to a learner), `parseStepConfig`, `CATEGORY_SLUGS`, labels. `@/content/course-utils`: `flattenSteps`, `findStep`, `nextStep`, `previousStep`, `applyPatch`. `@/content/validate`: `validateCourse`, `QA_CHECKLIST`.
- `@/server/services/course-store`: `getPublishedCourseBySlug(ctx, slug)` → `{ course, version, content, needsReview } | null` (live statuses: `LIVE_COURSE_STATUSES` = published and needs_review); `loadVersionContent(ctx, versionId)`; `createCourse`, `saveRevision`, `restoreRevision`, `listRevisions`, `getRevision`, `getWorkingVersion`, `revalidateVersion`, `materialiseVersion`.
- `@/server/services/publish`: `submitForReview`, `recordDecision`, `getApprovalState`, `publishVersion`, `scheduleVersion`, `cancelSchedule`, `takeDownCourse`, `restoreCourse`, `unpublishCourse`, `retireCourse`, `disableStep`, `enableStep`, `markNeedsReview`, `clearNeedsReview`, `evaluateApproval`, `SAFETY_CHECKLIST_KEYS`.
- `@/server/services/tools`: `getToolBySlug`, `getToolsBySlugs`, `listTools`, `updateToolFields`, `approveTool`, `blockTool`, `createCandidateTool`, `addSubstitute`, `coursesUsingTool`, `toolViewForLearners(row, { guideHref })`, `isUrlAllowedForTool(tool, url)`.
- `@/server/services/assets`: `upsertAssetsFromManifest`, `getAssetsByKeys`, `listAssets`.
- Scripts: `importContent(ctx, { publishAsSeed? })` in `scripts/import-courses.ts`; `importIdeas(ctx)` in `scripts/import-ideas.ts`.

## Site pages (marketing, help, legal)
- `@/server/services/pages`: `getSitePage(ctx, "marketing" | "help", slug)`, `listHelpArticles(ctx)`, `getLegalPage(ctx, slug)` → `{ state: "published", page, draft } | { state: "unpublished" } | null`, `listReviewedLegalSlugs(ctx)`, `upsertPagesFromFiles(ctx, files, { publishDrafts? })`. A `page` row wins; marketing and help fall back to `content/pages/**` when there is no row; legal never does. `page_version.body` may start with a front-matter block holding `summary` and `topic` (`@/lib/marketing/page-file`).
- `@/server/services/marketing`: `getPricingView(ctx)` (no plans at all for a learner under 18), `getHomeCourses(ctx)`, `listPublicCourseEntries(ctx)`.
- `@/lib/marketing/site`: `LEGAL_PAGES` (D16 slugs), `PUBLIC_ROUTES`, `PRIVATE_SEGMENTS`, `isPrivatePath`, `isIndexablePath`, `homeLinkFor(actor)`, `isUnder18Learner(actor)`. `@/lib/marketing/metadata`: `publicPageMetadata({ title, description, path, index? })` for any public page.
- `@/lib/marketing/service-worker-client`: `clearServiceWorkerCaches()` — call it from anything that signs a person out.
- Script: `importPages(ctx, { publishDrafts? })` in `scripts/import-pages.ts` (legal pages stay drafts unless `publishDrafts`, which is local and test only).

## Contracts between slices
Files in `src/server/services` whose first line says `CONTRACT` are fixed signatures: the owning slice fills in the body; everyone else may call them. Component contracts: `src/components/course/{types,Editable,ToolsYouNeed}.tsx`, `src/components/coach/CoachPanel.tsx`, `src/components/submissions/EvidenceSteps.tsx`, `src/components/safety/ReportControl.tsx`.

## UI
`@/components/ui` (kit) and `@/components/layout` (shells). Tailwind's stock palette is off: use token utilities only (`bg-paper`, `bg-surface`, `text-ink`, `text-ink-muted`, `border-ink`, `border-line`, `bg-primary`, `bg-accent`, `rounded-card`, `rounded-control`, `shadow-raised`, `max-w-measure`, `rail:` breakpoint). `Button` is `type="button"` by default; use `SubmitButton` in forms and `useActionForm` for action state. See docs/DESIGN.md.

## Tests
`tests/helpers/db.ts` (`testCtx`, `resetDb`), `tests/helpers/factories.ts` (`createParent`, `createFamily`, `createLearner`, `createStaff`, …), `tests/integration/content/helpers.ts` (course fixtures). Run with your own database: `TEST_DB_NAME=platform_test_<yours> pnpm vitest run <paths>`.
