# Processor register

Every company that would process personal data for `[Platform Name]`. **None is in use today**:
the product runs on local stand-ins and nothing is deployed. No account has been created with any
of them. Each needs the owner's approval, a signed data processing agreement (DPA), and, for those
the app can check, an approved and enabled row in Studio → AI → Providers before the code will use
it (`src/server/processors.ts`; the launch-readiness gate checks AI, moderation, email and storage
providers).

"Choice open" means the specification allows more than one supplier and the owner has not chosen.

| Processor | What for | Personal data it would see | Region wanted | Status | DPA | Transfer safeguard |
|---|---|---|---|---|---|---|
| Vercel | Hosting, functions, logs | Everything in transit; logs (no learner free text is logged) | London (`lhr1`) for functions | Not approved | `[ref]` | ⚖️ TO CONFIRM (US company) |
| Neon **or** Supabase (choice open) | Postgres database | Everything stored | London | Not approved | `[ref]` | ⚖️ TO CONFIRM |
| AWS S3 **or** Cloudflare R2 **or** Supabase Storage (choice open) | File storage | Learner uploads, data exports, course media | UK or EU | Not approved; processor key `storage.s3` | `[ref]` | ⚖️ TO CONFIRM |
| Resend **or** Postmark (choice open) | Email to parents, adult learners and staff | Email addresses; message content (a child's nickname may appear; never a child's own address, because they have none) | EU where offered | Not approved; `email.resend` / `email.postmark` | `[ref]` | ⚖️ TO CONFIRM |
| Inngest | Scheduling and retrying background jobs | Job names and payloads (ids and counts by design; a job payload must never carry learner free text) | ⚖️ TO CONFIRM | Not approved | `[ref]` | ⚖️ TO CONFIRM |
| Vercel AI Gateway | Routing Coach and drafting requests to a model | Coach messages (redacted of obvious personal details first) and step context; staff drafting prompts | ⚖️ TO CONFIRM | Not approved; `vercel-ai-gateway` | `[ref]` | ⚖️ TO CONFIRM |
| A model provider (choice open) | Coach replies; course drafts | As above. Requests ask for zero data retention and no training: **confirm the provider honours that** | UK or EU wanted (spec question 16) | Not approved; none chosen | `[ref]` | ⚖️ TO CONFIRM |
| A moderation model (optional) | A stronger crisis and safety classifier than the local rules | Learner messages | ⚖️ | Not approved; the local `rules` classifier is the default | `[ref]` | ⚖️ |
| Stripe | Payments; the £0 card check | **The paying adult only**: email, card details (typed on Stripe's pages), billing address if Stripe asks. A family id in metadata. Never a child's data | UK/EU entity ⚖️ | Not approved; `stripe`. The real driver has never run | `[ref]` | ⚖️ TO CONFIRM |
| Sentry (optional) | Error tracking | Error details, request ids; must be set to scrub bodies; no session replay | EU | Not approved | `[ref]` | ⚖️ |
| PostHog (optional) | Analytics on parent and marketing pages only, with opt-in | Pseudonymous events. **Never in learner areas** | EU | Not approved; not installed | `[ref]` | ⚖️ |
| Cloudflare Turnstile (optional) | Bot check on sign-up | IP address, browser signals | ⚖️ | Not approved; not installed | `[ref]` | ⚖️ |
| An SMS provider (optional) | Urgent alerts to the DSL | The DSL's phone number; an alert with no child's words | ⚖️ | Not approved; none chosen | `[ref]` | ⚖️ |
| A CSAM hash-matching provider | Screening images and video before uploads showing people could ever be allowed | Image hashes or images ⚖️ | ⚖️ | Not approved; none chosen (spec question 11). Until then a person checks every image and video | `[ref]` | ⚖️ |
| Product Hunt, GitHub (optional Radar sources) | Finding new tools | **No personal data of ours** is sent; listed because a token is needed | — | Not approved | — | — |

## Not processors

- **Have I Been Pwned** (optional, off): the breached-password check would send the first five
  characters of a password's SHA-1 hash and nothing else. A bundled list is used instead by
  default (decision D10). ⚖️ TO CONFIRM that this is not personal data in context.
- **Outside tools in courses** (Replit, Base44, Canva, CapCut, ChatGPT and candidates): they are
  independent controllers. We send them nothing; a learner or parent signs up with the tool
  directly. What we hold about a tool is its own published terms, in the Tool Register, checked by
  a person before any course using it is published ⚖️ (spec question 4).
- **GitHub (source code and CI)**: holds code and test data only. CI uses throw-away secrets and
  made-up accounts.

## Before any row can say "in use"

1. The owner approves the supplier and the cost.
2. A DPA is signed; its reference is recorded here and in Studio.
3. The region and the transfer safeguard are confirmed ⚖️.
4. The DPIA is updated.
5. The privacy notices name the supplier (or the category) ⚖️.
6. It is approved and enabled in Studio, and the environment variable is set.
