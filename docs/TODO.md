# What is outstanding

**Everything not yet done on the CRM template, as of 15 November 2026. The work that is built is in [PLAN.md](PLAN.md); the full comparison with HubSpot is in [EQUIVALENCE.md](EQUIVALENCE.md).**

The list is in the order it should be worked. "Not started" was checked against the code; "partly" says what exists and what is missing.

## The order to ship in

Agreed on 16 November 2026. The sections below this one are the full inventory; this is the order.

### 1. V1: a small team can sign in, bring their HubSpot data, and work

1. **Every item in section 1.** None can be worked around. Three wait on Ensemble (sign-in, email, sending domain), two on Scott (licence, Mariachi release), and three can be done now (kept migrations, the organization name as a setting, the README).
2. **The importer proven on one real HubSpot account**, for what it already brings: people, fields, pipelines, companies, contacts, deals, tasks, history and unsubscribes. Add every contact on a deal and products with line items, because deals look wrong without them.
3. **The fixes that would trip up a first user:**
   - A time zone per workspace, so scheduled workflows and reports stop running in UTC.
   - Notifications by email.
   - A real model used for ten minutes, and whatever that shakes out fixed.
   - A way to stop an assistant turn part-way.

### 2. Straight after V1: email where people already work

- **Gmail and Outlook sync, with calendars.** The largest single piece of work, and the thing a first user will miss most: without it email only flows through the CRM's own inbox and booking pages cannot see real calendars. If the first customers live in their own mailboxes, this moves into V1 and V1 gets later. That call is Scott's.
- **Decided before sync is built, not after:** who sees synced mail (public to the workspace or private to its owner, per mailbox and per thread), and how much of an address book becomes contacts.
- The rest of the importer: lists, email templates, sequences, forms, workflows, files. Until then the pre-migration report says plainly that these do not come across.

### 3. The model doing the work

None of these needs email sync, so they can be built alongside step 2. In this order, because each one is used by the next:

1. **Reusable context for the model:** what we sell, who is a good fit, how our emails sound, written once and attached wherever a model is asked.
2. **A model step in workflows**, with a log of every run step by step.
3. **Model-filled fields that run on their own:** when a record is created or on a schedule, as a choice per field, with web search as something a field may be allowed.
4. **A queue of work the CRM has spotted**, on Today: follow-ups due, records gone stale, each opening with what the assistant proposes to do, cleared in one pass.
5. **Scheduled requests to the assistant:** "review open deals every weekday at 9".
6. **Other tools' MCP servers, used by the assistant**, with each tool sorted into reads, changes and deletes so approvals still apply.

### 4. What sync makes possible

Each of these depends on step 2.

- **Meeting prep**, written before a meeting with someone outside the company, without being asked.
- **A follow-up drafted when a meeting's transcript arrives**, with action items turned into tasks. Transcripts come from the notetakers people already use, as plugins; the CRM does not record meetings itself.
- **Labels the model applies** to incoming email and to meetings.
- **Inbox snooze**, and one email sent separately to many people from any selection.
- Open and click tracking, one-off sends to a segment, and subscription types (section 3, Email).

### 5. Filling in

Done when the area is next touched, not as a project of their own:

- Lists as their own thing, for any object, hand-built or dynamic.
- Several pipelines, with stage groups and a weight per stage for the forecast.
- Activity types a team defines, with their own fields.
- Sequences: drafts held for approval, a daily limit on starts, different follow-up for different replies, cloning.
- Reports: the records behind a bar, a goal line, comparison with the previous period.
- One-key shortcuts, a touchpoints chart and a sticky note on a record, changing a field's type.
- Everything else in section 3.

### 6. Plugins

Once the plugin folder and its first plugin exist. In this order:

1. **Slack:** notifications and scheduled reports (already planned), then a shared channel filed against its company or deal, then asking the assistant from Slack.
2. **Notetakers**, for step 4's follow-ups.
3. **What a customer pays and whether they use the product**, on the company record: billing, support tickets, product usage. Taking usage events over the CRM's own API needs no third party and can come first.
4. Zapier and Make, and outgoing webhooks.
5. LinkedIn and WhatsApp conversations, and finding new leads in an outside database.
6. Importers for Attio, Pipedrive and Affinity, and HubSpot two-way sync.

The items in steps 3 to 6 that are not in sections 2 to 4 are described in section 7.

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
| Licence | The README exists and says no licence has been chosen | A decision on the licence |

## 2. The HubSpot importer

Partly built. A move is a stored run of steps (see `server/src/services/migration`); each step keeps its progress, counts and issues, and steps can be added, skipped and retried. It has only run against a stand-in account built from HubSpot's API documentation.

**Built:** people, deal pipelines and stages, custom fields and their choices, companies, contacts, unsubscribe and bounce status (written with the contact, and the step cannot be skipped), deals, tasks, custom objects, and notes, calls, emails and meetings. Check mode, pause, resume, retry, re-run without duplicates.

**Built, on top of the fixed plan:** with a model connected, it surveys what else the account has and proposes steps to add, things to set up here, and features to build. A person accepts or dismisses each. Accepting a step creates the object it needs and adds the steps; accepting a set-up hands the request to the assistant; accepting a build records that it is wanted.

**Not built yet:**

- A run against a real HubSpot account. Needs a test account or a customer's key. Expect field names and paging details to need correcting.
- Anything acting on an accepted "build" proposal. It is kept as a written brief on the move; how an instance asks Ensemble to change its own code is not decided (see Open decisions).
- The survey's paths for workflows, forms, lists and marketing emails are from memory of HubSpot's documentation and are the likeliest part to be wrong against a real account. A path that fails is reported as unreadable, not as absent.
- The "last contacted" and "last activity" dates that history should set.
- Every contact on a deal with their role (only the first contact and company are linked today), and association labels.
- Products and line items, tickets as a planned step, quotes.
- Lists as segments, saved views, email templates, sequences, forms and their submissions.
- Subscription types and consent per purpose (today: unsubscribed from everything, or bounced).
- Workflows, translated where they can be and listed where they cannot.
- Attachments and files.
- Several pipelines as pipelines. Today the others arrive as stages named with their pipeline, plus a Pipeline field.
- The pre-migration report beyond counts: pages with a HubSpot form embed, workflows and sequences mid-run, reports and dashboards to rebuild, booking links and tracked addresses to redirect.
- Changes made in HubSpot after the move are brought by running it again; nothing runs on its own, and nothing deleted in HubSpot is removed here.
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
- **How a "build" proposal becomes built.** When the importer's model finds something the account relies on that the CRM lacks, it writes a brief. Something has to take that brief and change the instance's code: Ensemble's builder, presumably. The CRM needs to know where to send it.

## 7. More features worth having

Features this CRM does not have that would be useful, added on 16 November 2026. Each was checked against the code or this list before being called missing. Nothing here is in V1. Where each one falls is in "The order to ship in" at the top.

**Worth doing early, because they are what "AI does the data entry" means**

- **A queue of work the CRM has spotted, worked through in one pass.** The home page is a chat box above a set of recommendations (a follow-up that is due, a meeting to prepare for, a record gone stale, churn risk), with a focus mode that opens each one in a chat that already proposes what to do. Today here shows what is due and a briefing; it does not propose the action or let someone clear the queue by keyboard.
- **Reusable context for the model.** Named documents (what we sell, who is a good fit, how our emails sound, who we compete with) written once and attached to any model-filled field, workflow step or sequence. This is the "brand voice stored once" item in section 3, made general.
- **A model step in workflows.** A step that says "ask the model about this record and pass the answer on", with a log of every run step by step. Workflows here can notify, enrol, assign and call a web address; none of the steps thinks. A run log exists per workflow but not step by step.
- **Model-filled fields that run on their own.** They would run when a record is created and again on a schedule, may be allowed tools (web search, reading the record's emails and meetings), and show per cell whether they are queued, working or failed. Here they run only when asked, by design, and read the record and its history. Worth offering as a per-field choice now that the cost question is the team's to answer.
- **Scheduled requests to the assistant.** "Review open deals every weekday at 9" or "remind me about this tomorrow": the assistant proposes the schedule and it starts once approved. Scheduled workflows and reports exist here; scheduled assistant turns do not.
- **Other tools' MCP servers, used by the assistant.** This CRM offers itself over MCP but cannot use anyone else's. A workspace would connect any MCP server, with each tool sorted into reads, changes and deletes so approvals still apply. This is the cheapest way to reach tools there will never be a plugin for.

**Worth doing with email and calendar sync, because they depend on it**

- **Meeting prep, written before the meeting without being asked**, for meetings with someone outside the company: who is in the room, where the deal stands, what was said last time, with its sources listed.
- **A follow-up drafted when a meeting's transcript arrives**, pulling out what was promised. The CRM would not record the meeting itself: it would take notes and transcripts from the notetakers people already use (Granola, Fathom, Fireflies, Circleback and others) and turn action items into tasks. That is far less work than recording, and fits the plugin model. It replaces how section 3's "meeting recordings written up" would be built.
- **Who sees synced mail.** Each mailbox sets whether new threads are public to the workspace or private to their owner, per thread too, and how much of the address book becomes contacts ("smart", only people engaged with, or none). Both need deciding before sync is built, not after.
- **Labels the model applies to incoming email and to meetings**, from a sentence saying when each applies, with a backfill over the last days or months.
- **Inbox snooze**, and **one email to many people, each sent separately**, from any selection of contacts, with a preview per recipient.

**Worth doing when the area is next touched**

- **Lists as their own thing.** A hand-built list or a dynamic one that holds whatever matches its filters, for any object, with folders, and lists of other things (sequence participation, tasks, meetings). Segments here are a field on contacts, with no page of their own and none on companies or deals.
- **Activity types a team defines**, each with its own fields (a call outcome, a site visit's location) and a one-key shortcut to log it. Activity kinds here are fixed.
- **One-key shortcuts**: T for a task and C for a comment from anywhere. Search on Cmd/Ctrl+K exists; single keys do not.
- **A record's touchpoints as a small chart over time**, and a sticky note shown at the top of the record.
- **Stage groups and weights.** Stages grouped as lead, in progress, won and lost, with a weight per stage for the forecast, per pipeline. Several pipelines is already in section 3.
- **Sequences:** drafts held for approval contact by contact, a daily limit on how many people start, different follow-up for different kinds of reply, wording that varies between recipients so a thousand emails are not identical, and cloning. Per-contact writing by the model is already in section 3.
- **Reports:** click a bar to see the records behind it, a goal line, comparison with the previous period, and charts over activity and sequences as well as records.
- **Changing a field's type after it holds data**, with the values carried over. Here a type never changes.
- **Quotes on a deal** with a status, built from the product library. Already under "Later"; noted because the importer's model will propose it for any account that uses quotes.

**Plugins, when there are plugins**

- **What a customer pays and whether they use the product, on the company record:** invoices and subscription status from a billing tool, support tickets from a help desk, usage from product analytics. Taking usage events over the CRM's own API needs no third party and would be a small core feature.
- **A shared Slack channel filed against the company or deal it is about**, and asking the assistant from Slack with the asker's own permissions.
- **LinkedIn and WhatsApp conversations** in the inbox and on the timeline.
- **Finding new leads** in an outside database and bringing in only the ones chosen.
- **Importers for Attio, Pipedrive and Affinity.** The step engine is not tied to HubSpot, so each is a set of steps.
- **HubSpot two-way sync**, for a team that wants to run both for a while. Connecting to HubSpot by an app the admin approves is friendlier than pasting a private app token, and worth doing once there is an Ensemble-wide HubSpot app.

**Considered and left out:** a built-in dialer, and a second formula language (the one here covers the ground).

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
