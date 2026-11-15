# Lead decisions

Chris delegated the open spec items to the build lead on 15 November 2026. Each decision takes the reading that is safer for children. Items marked ⚖️ still need legal or specialist confirmation and are mirrored in `docs/OPEN_QUESTIONS.md`.

| # | Issue | Decision | Where enforced |
|---|---|---|---|
| D1 | Section 8 step 8 still referred to Tool Register fields for model providers | Model providers are processors, not Register tools. A provider cannot be enabled until it is approved and a DPA reference is recorded in AI settings. Spec text corrected. | `ai_processor` approval check in the gateway; Studio → AI |
| D2 | DSL "before launch" (3.10) versus "before scaling" (3.8, Q7) | A named, trained DSL before launch (the owner may hold the role). A deputy or outsourced cover before scaling. ⚖️ Public sign-up stays closed until the Studio launch-readiness checklist passes: DSL named, crisis scripts approved, processors with DPA, age-assurance mode confirmed, legal pages published. | `launch_readiness` service; `signup_open` cannot be set true while any item is open |
| D3 | Automatic rejection of media showing real people needs a classifier that is not in the approved stack | No new processor is added. Detection is a pluggable provider (`PEOPLE_DETECTION_PROVIDER`): `manual` (default), `fixture` (tests), or a provider Chris approves later. With `manual`, image and video **file** uploads are never auto-accepted: they wait in the human queue. Links, documents, audio and datasets can auto-accept. Rejected media is deleted from storage at once (hash and metadata kept). Media flagged as possibly illegal is quarantined, not deleted, and opens a critical safeguarding case; reporting duties are ⚖️. For link evidence the learner confirms the linked work shows no real people; we never fetch or host it. | `submission` service, `people-detection` adapter, moderation queue |
| D4 | Does the random sample hold the certificate? | Yes. A sampled submission waits for a human before it is accepted. | `submission` service |
| D5 | Ideas file lacks pathways, status and an exam-integrity flag | Import with status `idea` (the 15 launch ideas become `published` once their course is seeded), pathways empty, exam integrity derived from the watch note. Field mapping: `level` → `difficulty`, `description` → `summary`, category display name → slug. | `scripts/import-ideas`, tested |
| D6 | One flag per idea in the source; `safeguarding` also covers data and integrity notes | Any watch note mentioning 18+ tools also sets the 18+ flag (IDEA-141, IDEA-154). The idea-level `safeguarding` flag maps to a watch-out, **not** to `safeguardingSensitive`; that is set per course by the author or reviewer. | importer; course schema |
| D7 | Minimum age: file says 13 everywhere, spec says 15 for Portfolio and CV Studio | The course table wins. The importer applies an override for IDEA-157. | importer |
| D8 | Snapchat example could not produce its required evidence | The course now has a "Use sample image" deliverable and step, and a downloadable sample image asset. Spec example corrected. | `content/courses/build-your-own-snapchat-style-app.json` |
| D9 | Next.js 16.4 scaffolds with Cache Components on | Turned off. Every signed-in route renders per request, so learner data cannot be cached by mistake, and the code stays on the simpler, long-documented model. Revisit when Next makes it mandatory. | `next.config.ts` |
| D10 | Breached-password check (3.1) would call a third party | A bundled list of common passwords is the default. The Have I Been Pwned range API (sends only a five-character hash prefix, no personal data) is behind `PASSWORD_BREACH_CHECK=hibp`, off until the owner approves it. | `src/server/auth/password-policy.ts` |
| D11 | The Section 6.1 example tagline was 134 characters; the model's limit is 120 | The limit stands. Tagline shortened in the course and the spec example. | `content/courses/build-your-own-snapchat-style-app.json` |
| D12 | `order` quiz questions have no position field in the spec model | Authored option order is the correct order; the learner payload is shuffled server-side. | `src/content/schema.ts` (`toLearnerCourse`) |
| D13 | Age is known only by birth month and year | A birthday counts once the birth month has fully passed in UK time, so nobody is ever treated as older than they are. A child may be blocked or held in a stricter band for up to a month after their real birthday. | `src/server/services/age.ts` |
| D14 | Parallel build needs fixed seams | Cross-slice service and component contracts are fixed by the lead in `src/server/services/*` (files marked CONTRACT) and `src/components/{course,coach,submissions,safety}`. | `src/server/services/_contract.ts` |

## Enhancements added by the lead

- **Launch-readiness checklist** in Studio (see D2). It turns the ⚖️ list into a gate rather than a document.
- **Deletion on rejection** and a quarantine path for uploads (see D3).
- **Link declaration** on evidence links (see D3).

## Deviations from the Goal Engine skill method

- Revenue, market and competitor research were skipped: the brief already fixes positioning and prices are placeholders.
- The architecture was written by the lead rather than a separate architect agent, because the brief fixes the stack and data model.
- Deployment is prepared but not executed. Creating accounts, enabling paid tiers and publishing all need Chris's approval under the brief (Section 20, items 3 and 14).
