# What is outstanding

**Everything not yet done on the CRM template, as of 15 November 2026. The work that is built is in [PLAN.md](PLAN.md); the full comparison with HubSpot is in [EQUIVALENCE.md](EQUIVALENCE.md).**

The list is in the order it should be worked. "Not started" was checked against the code; "partly" says what exists and what is missing.

## 1. Blocking a first customer

Nothing below can be worked around. A customer cannot be given an instance until these are done.

| Item | State | Waiting on |
|---|---|---|
| Ensemble sign-in | Only `dev` and `jwt` providers exist | Ensemble's sign-in protocol |
| Ensemble email, sending and receiving | Only the development provider exists | Three answers about the service: does it retry inbound deliveries, can it replay what arrived since a point in time, does it accept an idempotency key on send |
| Sending domain set up per instance (DKIM, SPF, DMARC) | Not started | Ensemble's email service |
| A real model | Never tried. The assistant, the email designer, model-filled fields and streaming have only run on stand-in models | A key entered in Settings, and ten minutes of use |
| Mariachi installed, not linked | Every `@mariachi/*` package is linked from a checkout beside this repo, so nobody else can install it. The CRM now needs Mariachi's `main`, which is ahead of the last release (0.1.0) | A Mariachi release with the streaming flag, and `@mariachi/design` published; then point `package.json` at the published versions |
| Migrations that are kept | The schema is one initial migration, regenerated on every change | Stop regenerating at the first deployment; every change after that is its own migration |
| Organization name | "Northwind" is written into the workspace and the email rules | A setting, filled in when the instance is created |
| Licence and README | Neither exists | A decision on the licence |

## 2. The HubSpot importer

Not started. Only CSV import exists. This is the reason the template exists, so it comes before any other feature.

- Records, properties, pipelines and stages, associations, owners.
- Activity history: emails, calls, meetings, notes, tasks.
- Unsubscribe status and consent. This is a legal requirement and the importer must treat a failure here as blocking.
- Lists (as segments), saved views, email templates, sequences, forms and their submissions.
- Workflows, translated where they can be and listed where they cannot.
- Attachments and files.
- The pre-migration report: what will not come across cleanly, every page with a HubSpot form embed, every workflow and sequence that is mid-run, every report and dashboard to rebuild, every booking link and tracked address to redirect.
- Needs a HubSpot test account or a real export to be trusted. It can be started from the public API documentation.
- Needs a decision: what the importer promises (see Open decisions).

## 3. First-release features not started

**Email**

- Gmail and Outlook two-way sync, and connected mailboxes.
- Gmail and Outlook add-ins (log, track, saved emails, the assistant in the sidebar).
- Open and click tracking.
- One-off sends of a designed email to a segment, with results. Today a designed email goes out only through a sequence or a workflow.
- Snippets (short saved text, beside saved emails).
- Subscription types, a preferences page, double opt-in, and holding back people who never open.

**Forms**

- Multi-step forms.
- Conditional fields, and skipping what a returning visitor has already answered.
- Catching submissions from forms already on a site (a script, or a post to the API).
- Blocked domains and model screening of submissions.
- Consent per purpose, and a cookie banner.
- Source on every contact from UTM parameters.

**Records and data**

- Multi-currency amounts with exchange rates.
- Several pipelines on one object.
- Tags set by rules.
- Record page layout per object.
- Nested teams.
- Search by meaning across emails, notes and calls.
- Continuous duplicate detection. Today duplicates are found when asked for and on import.

**AI**

- Meeting recordings written up as notes, next steps and suggested field changes.
- Enrichment of records by the assistant.
- The assistant suggesting who plays which part on a deal, from the emails.
- A forecast from the assistant, with its reasons.
- Each sequence email personalized by the assistant.
- Brand voice and colours stored once and used by the assistant and the email designer.
- The assistant proposing data clean-ups as plans.
- The record summary generated when a deal is won, as a handover.

**Platform**

- Notifications by email, and a daily digest. Today they show only inside the app.
- Slack: notifications and scheduled reports. Planned as a plugin; the plugin folder and its first plugin do not exist yet.
- Zapier and Make connections.
- Outgoing webhooks when records change. (A workflow can already call a web address, and a web address can set a workflow off.)
- Goals on any number that can be reported on. Today there is one goal: a person's quarterly sales.
- Reps submitting their own forecast.
- Choosing the region an instance runs in. This belongs to Ensemble hosting.

## 4. Built, with gaps

| Feature | What is missing |
|---|---|
| Email designer | Pictures are added by web address, not uploaded. Attachments cannot be added to a designed email. Dragging blocks was not tried in a browser. |
| Attachments | On replies only. No preview: a file is saved, then opened. |
| Files for the assistant | Text files are read. PDFs and pictures are not. |
| Fields the model fills in | Asked one record at a time in the app. The operation takes 25, but the record list has no button for it. Never asked on its own, by design. |
| Scores from rules | Rules read the record's own fields only: no counts of activity, no "in the last 30 days". |
| Assistant on a model | No way to stop a turn part-way. Mariachi 0.1.0 can cancel a call; the CRM does not use it yet. |
| Schedules (workflows, reports) | Times are UTC. There is no time zone per person or per workspace. |
| Booking pages | No calendar sync, so free times ignore real calendars and no invitation is sent. That comes with Gmail and Outlook sync. |
| Delivery reports | The route and the reports are built and tested, but no real email service has called them. |
| Segments | A field with bulk add and remove. No page for a segment, and not on companies or deals. |
| Deleted records | Restored one object at a time. Nothing is ever removed for good except through a privacy erase. |
| Privacy erase | Leaves audit log entries, by design, and cannot reach copies the email service keeps. |
| Form spam traps | Dropped submissions are logged, not counted anywhere a person can see. |
| Repeating tasks | One finished late is dated from today, not from when it was due. |
| Task queue | Holds 100 tasks. |
| Field settings | "Ask for it", "Required" and "Unique" still show for a field that is worked out. |
| Record page | The middle column is cramped at narrow widths. |
| Demo data | The generator makes 831 sets of contacts with the same email address, which makes the duplicates screen noisy. |

## 5. Open decisions

These are yours to make. Each one holds up something above.

- **Who pays for AI tokens:** Ensemble credits, or the customer's own key. The email designer and model-filled fields make this more pressing, because both spend tokens outside the assistant.
- **What the importer promises:** the list of things that do not migrate cleanly, and how the pre-migration report says so.
- **How strong the update promise is** for instances whose core code a customer has changed.
- **The licence** for the public repository.
- **When Mariachi is released** with what the CRM now depends on.

## 6. Later, after the first release

These are marked "Later" in EQUIVALENCE.md and are not planned in detail.

- A native mobile app.
- Marketing: landing pages, traffic and attribution reports, bulk sending reputation tools, A/B tests.
- Service: tickets, a knowledge base, the assistant drafting ticket replies.
- Quotes a buyer can accept, and e-signature through a provider.
- Bulk research on prospects by the assistant.
- Native two-way syncs with other tools.
- Single sign-on and SCIM.
- Other templates on the same contract: help desk, invoicing, booking, applicant tracking, client portal.
