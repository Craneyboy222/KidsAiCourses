# Compliance documents

Working documents for a UK service used by children aged 13 to 17 and by 18-year-olds. They are
**templates filled in from what the product really does**, as built on 16 November 2026. They are
not legal advice and none of them has been reviewed by a lawyer or a safeguarding professional.

**How to read them**

- A plain statement describes the product as it is in the code, with the file or table that does it.
- **⚖️ TO CONFIRM** marks a legal or specialist judgement. Nothing marked this way is a conclusion:
  it is a question, a placeholder or a default taken on the cautious side, waiting for a UK
  data-protection or online-safety lawyer, or for the Designated Safeguarding Lead (DSL).
- **NOT BUILT YET** marks something the specification requires that the code does not do yet.
- `[Controller]`, `[Platform Name]` and other square-bracket items are for the owner to fill in.

| Document | What it is | Who must sign it off |
|---|---|---|
| `DPIA_TEMPLATE.md` | Data protection impact assessment, part-filled | Owner, with a lawyer ⚖️ |
| `RECORD_OF_PROCESSING.md` | Record of processing activities (UK GDPR Article 30) | Owner ⚖️ |
| `RETENTION_SCHEDULE.md` | What is kept, for how long, and what deletes it | Owner, lawyer, DSL ⚖️ |
| `CHILDRENS_CODE_MAPPING.md` | The 15 standards of the ICO Children's code, one by one | Owner, lawyer ⚖️ |
| `ONLINE_SAFETY_ACT_NOTES.md` | Notes towards the scope decision and the risk assessments | Lawyer ⚖️ |
| `PROCESSOR_REGISTER.md` | Every company that would process personal data, and its status | Owner |
| `INCIDENT_AND_BREACH_PROCEDURE.md` | What to do when something goes wrong | Owner ⚖️ |
| `SAFEGUARDING_POLICY.md` | Outline of the safeguarding policy and procedure | DSL ⚖️ |

Keep them true. When the product changes what data it holds, who it goes to or how long it is
kept, change the document in the same piece of work. The periods in `RETENTION_SCHEDULE.md` are
generated from `RETENTION_DEFAULTS` in `src/server/services/retention.ts`: change them there.
