# CRM template plan

**A complete CRM that anyone can take on Ensemble, run as their own hosted instance, and change by asking. It covers what teams use HubSpot for, it is built so AI does most of the data entry, and it is the first of several templates on one shared contract.**

Status: frontend mock in progress (2026-11-14). Nothing here is a commitment on dates.

On screen so far, all on mock data:

- Today: tasks due, deals closing, deals gone quiet and the pipeline, read live, with a written briefing
- Inbox: email threads linked to their contact, company and deal; assign, close, reply with templates or a drafted reply; sent replies are logged on the records (mock email until Gmail and Outlook sync exists)
- Import: a four-step wizard for CSV files (match columns, dry-run review, import, undo), and CSV export of any view
- Reports: a dashboard of saved reports, a report builder with live preview (count, total or average, split by any property or by month or quarter), and reports built by asking the assistant
- Email designer: an email is a look and a stack of blocks (banner, text, button, columns, highlight, picture, sign-off), edited in place, dragged into order, previewed for computer, phone and plain text, and sent to yourself as a test. The connected model writes a first version from a sentence, changes the whole email, or rewrites one part; what it returns is checked against the same format a person's design is. Designs are sent as HTML with a plain-text version, filled in per recipient, with the address and the way out added to automated email
- Sequences: steps of emails, calls and tasks with waits, drafted from a sentence, with enrolment from the contacts list and per-sequence results; editable email templates shared with the inbox
- Workflows: a canvas builder (React Flow) for "when this happens, if these conditions, do these things", built from a sentence or by hand; workflows that are on really run in the mock, with a history of runs
- Forms: a builder with a working preview, a hosted public page per form, and submissions that create or update a contact by email
- Meetings: booking pages (who, how long, which days and hours, round robin) with a public page to pick a day and time
- Across every screen: global search on Cmd/Ctrl+K, a working notifications bell, links between records changed by searching, merging two duplicates, and a calendar layout for deals and tasks
- People and permissions: invite, change role and team, deactivate with reassignment; teams; roles that set how far someone can see, change and delete (own, team, everything); enforced by the mock on every read and write, with "view as" for admins
- Selling: a product library; line items on a deal with quantity, price and discount, which can set the deal's amount; leads as their own object with a board, converted into a contact, company and deal in one step; a quarterly forecast against per-person goals (won, commit, best case, pipeline) that respects who can see which deals
- The product's own shape: a sidebar of nine links (Assistant, Today, Inbox, the records, Insights, Automation) with tools grouped into areas that share a row of tabs, so new tools join an area instead of the sidebar; every record page opens on a brief (where it stands, last, next, what to watch) with a suggested next step the assistant carries out; workflows, sequences, forms and reports all start from a sentence, with the builder for checking and changing the result
- Tasks: an object like any other, with one-click completion, created from any record or by asking the assistant
- Contacts, companies and deals: lists with saved views, a filter builder, column choice, search, sorting, bulk edit and delete; a stage board; record pages with fields edited in place
- Field rules: required and unique, checked on every save
- Settings: custom objects and properties
- The assistant: its own page, a bar on every page that knows what you are looking at, and voice mode

## What we are building

**The standard is functional equivalence or better, not a HubSpot replica.** A team that migrates must be able to do every job it did before, and bring its data. How we do each job is our own design, and AI-first: where HubSpot has a form or a builder, we first ask whether the assistant can do it from a sentence. The job-by-job comparison, with what migrates, is in [EQUIVALENCE.md](EQUIVALENCE.md).

- **A template, not a product to configure.** Each customer gets their own instance (their own VM and database), deployed and hosted by Ensemble, with previews for every change.
- **For people who are not engineers.** They customize by chat. They never see git, packages or merges.
- **Positioning:** a CRM you own and can change by asking. We are not competing with open-source CRMs.
- **Pricing wedge against HubSpot:** per instance, not per seat.
- **Built on Mariachi** (backend packages and the design library). The frontend is React on the design library's markup and tokens, with the Keel preset as the default look.

## The template contract

Every template ships these. The CRM is the first to use them.

1. **Modules** with clear boundaries and on/off switches. Removing a feature means switching its module off.
2. **A metadata layer.** Objects, properties, pipelines and views are data, so most changes need no code.
3. **Extension points:** events, procedures and UI slots where new features attach.
4. **Context for the agent:** what each module does and where new things go.
5. **A test suite** that defines "still works" for user changes and for updates.
6. **Onboarding:** an importer, seed data and a setup conversation.
7. **An update channel** with migrations and release notes in product terms.

## How customization and updates work

The agent picks the least invasive way to make a change, and the user never chooses a tier:

1. **Configure:** change metadata (a field, a pipeline, a view, a workflow).
2. **Extend:** add code beside the core, attached through the extension points.
3. **Edit the core:** allowed when nothing lighter works. Models are good enough for this to be routine.

Updates:

- Each template release ships three things: a plain-language spec of the feature, the tests that define it working, and the reference code change.
- For a customized instance, an agent applies the release to that instance's version of the code, using the spec and tests as the target.
- The user sees "an update is available", opens a preview running on a copy of their data, and accepts or skips it.
- Every change has a snapshot before it and one-click rollback in production.

## Build order

1. **Frontend first, on mock data** (in progress). Contracts are written first and the mock implements them, so the backend replaces the mock without page changes.
2. Realistic mock volume (50,000 contacts) so lists and search are designed for real data.
3. One slice built for real early (contacts end to end on Mariachi) to prove the stack.
4. Backend module by module behind the same contracts.
5. HubSpot importer, then email and calendar sync.
6. Prove the update flow on our own instance before release.

Start the Google and Microsoft OAuth verification early. It is waiting time, not building time.

## Functionality

Unmarked items are in the first release. **(L)** means later.

### Records and data
- Contacts, companies, deals, products
- Custom objects and custom properties (text, number, date, dropdown, multi-select, checkbox, currency, user, calculated, roll-up)
- Associations between any records, with labels
- Lifecycle stage, lead status, owner, tags
- Property change history, required fields, validation rules
- Duplicate detection and merge
- File attachments, multi-currency, bulk edit, restore deleted records
- Customizable record page layouts

### Views and search
- Table views with saved filters, columns and sorting; board view
- Static and dynamic lists (segments)
- Global search, record preview panel, export

### Deals and pipeline
- Multiple pipelines, stages with win probability, required fields per stage
- Line items from a product library
- Won/lost reasons, stale-deal indicators
- Weighted forecast, goals and quotas
- Quotes and e-signature **(L)**

### Activities
- Timeline per record: notes, emails, calls, meetings, tasks
- Notes with @mentions, pinned notes, comments
- Tasks with due dates, reminders and task queues
- Manual call and meeting logging with outcomes

### Email
- Gmail and Outlook two-way sync, send from a record
- Templates, snippets, signatures, scheduled send
- Open and click tracking
- Sequences: timed steps, task steps, stop on reply
- BCC logging address, never-log list
- Unsubscribe links and status
- Shared team inbox **(L)**

### Calendar and meetings
- Calendar sync, booking links (individual, round robin, group)
- Zoom and Google Meet links, reminders

### Lead capture
- Forms (embedded and hosted), field mapping, hidden and UTM fields, spam protection, consent checkbox
- Lead routing and assignment rules, submission alerts
- Website tracking script and page-view history **(L)**
- Live chat widget **(L)**

### Automation
- Workflows on contacts, companies and deals: triggers, conditions, branches, delays
- Actions: set property, create task, send email, notify, rotate owner, call webhook
- Run history
- Lead scoring **(L)**

### Reporting
- Dashboards and a report builder
- Standard reports: pipeline, funnel, activity, rep leaderboard, deal velocity, lead source
- Scheduled report emails, export
- Cross-object and attribution reports **(L)**

### Team and permissions
- Users, teams, roles
- Record access by own, team or all; field-level permissions **(L)**
- SSO, two-factor, audit log
- Deactivate a user and reassign their records

### Import and migration
- CSV import with mapping, dedupe and undo
- HubSpot importer: records, properties, pipelines, associations, owners, activity history, attachments, lists, templates, sequences, forms, unsubscribe status, and workflows (best effort)
- Salesforce and Pipedrive importers **(L)**
- Full data export

The importer reports on what migrators most often lose: unsubscribe and consent status, form embeds still pointing at HubSpot, workflows and sequences mid-run, activity history and attachments, list membership and saved reports.

### Integrations and API
- REST API, webhooks, API keys
- Slack, Zapier and Make
- Stripe, contact enrichment **(L)**

### Notifications and mobile
- In-app and email notifications, daily digest
- Mobile-friendly web app; native app and push **(L)**

### Admin and compliance
- GDPR export and delete, consent and legal basis, email subscription types
- Currency, time zone, fiscal year, branding
- Backups and restore

### Added after the HubSpot audit (first release)
- Gmail and Outlook add-ins: log, track, templates and the assistant, inside the user's inbox
- A lead object, and a "what should I do today" starting point from the assistant
- Unique-value, validation, conditional and stage-required rules on properties; pipeline rules
- Forecast categories and rep submissions; goals on any reportable number
- Booking round robin; repeating tasks
- Double opt-in and a subscription preferences page
- Sending-domain setup (DKIM, SPF, DMARC) done by Ensemble for every instance
- Cookie banner, choice of data region, scheduled report delivery
- View tracking on shared pages; tracked documents **(L)**; playbooks **(L)**; deal splits **(L)**; approvals as a workflow step **(L)**

### Core and plugins

**Decided 2026-11-14.** There are two kinds of functionality:

- **Core:** everything that works without an account at another company. It is always included in the open-source template. That covers records, views, pipelines, email and calendar sync, sequences, forms, workflows, reporting, the assistant, marketing email, the service module (tickets, shared inbox, knowledge base, surveys) and landing pages. Some of it ships after the first release, but none of it is held back.
- **Plugins:** anything that depends on a third-party service the customer signs up for. A plugin is installed per instance and uses the same extension points as a customer's own changes. Plugins are open source too and live in this repo, under `plugins/`.

| Plugin | Service it depends on |
| --- | --- |
| Billing: invoices, payment links, subscriptions | Stripe |
| Calling, call recording, SMS, WhatsApp | Twilio |
| E-signature on quotes | A signature provider |
| Accounting sync | QuickBooks, Xero |
| Ads: audiences and conversion events | Google, Meta, LinkedIn |
| Enrichment and visitor identification | A data provider |
| Social publishing | The social networks' APIs |
| SEO tools | Purchased keyword and crawl data |
| Meeting links | Zoom, Google Meet, Microsoft Teams |
| Chat and notifications | Slack, Microsoft Teams |

Gmail, Outlook and the two calendars are core even though they are third-party, because the CRM is not usable without them; Ensemble holds the verified Google and Microsoft apps.

## AI

The CRM is designed so people rarely type into fields. HubSpot's AI (Breeze) is the parity baseline; everything below is on by default unless marked **(L)**.

### The assistant
Two surfaces over the same assistant:

- **The assistant page.** A blank screen that asks "What do you want to do?". You talk to it; it answers in the conversation and puts its work beside it: charts, tables, drafts, and a plan of the changes it proposes, which you run with one click. It takes uploaded files. Modeled on Ensemble's new-change screen.
- **The assistant bar.** The same assistant floating over every page, aware of the record or list you are on.
- **Voice mode.** Talk to it and hear it answer, with captions, and the same charts and plans appearing beside it. Modeled on Ensemble's voice mode.

What it does:

- Answers questions over the data.
- Takes actions, always as a plan the user approves first, with undo.
- Builds views, reports and workflows from a sentence.
- Hands customization requests ("I wish deals had a renewal date") to Ensemble, which builds the change in a preview.

### No data entry
- Emails and meetings log themselves; contacts are created from signatures.
- Meeting recordings become notes, next steps and suggested field updates.
- Paste or drop anything (an email, a business card photo, a spreadsheet) and it becomes records.

### Record intelligence
- A "where this stands" summary at the top of every record.
- "What changed since I last looked."
- Deal risk flags with the reason, and a suggested next step.

### Writing
- Email drafts and replies that use the record's history and the user's own voice.
- A prep brief before each meeting.
- Sequences personalized per recipient.

### AI fields
- A property whose value is a prompt, such as "fit score" or "summary of the last three calls".

### Pipeline
- A daily briefing on the dashboard.
- A forecast with reasons, a written weekly pipeline review, and win/loss analysis.

### Data quality
- Duplicate detection, enrichment from the web, job-change alerts.

### Search and reports
- Search by meaning across emails, notes and calls.
- "Why is win rate down this month?" answered with a chart.

### Migration
- AI maps HubSpot or spreadsheet columns to fields, cleans the data, and translates workflows.

### Background agents (L)
- A lead qualifier and router for form submissions.
- A follow-up agent that drafts emails for approval.
- A prospect researcher and a renewal watcher.
- Workflow steps that use AI to decide, extract or write.

### Design rules
- **One set of actions, three users.** Everything the CRM can do is one tool layer, used by the assistant, by workflows, and by outside agents through an MCP server.
- **AI acts as the user.** Same permissions, proposes before writing, and every AI change is marked in the audit log.

### First to ship
The assistant (page, bar and voice), record summaries, email drafting, AI fields, meeting notes into the CRM, the daily briefing, AI import mapping and the MCP server. Background agents come after.

## Backend

One instance per customer: an API server, a worker and the web app, with Postgres and Redis on the customer's VM. Built on Mariachi's packages.

- **The contract is the seam.** The pages call `CrmApi` only. The server implements it one group of methods at a time, and the mock stays as the test double and the demo mode.
- **Records** are rows with fixed columns (id, object, owner, timestamps) and a JSONB column of properties. Objects and properties are data, so adding a field or an object needs no migration. Properties that are filtered and sorted often get indexes.
- **Permissions** (own, team, everything) are one filter applied where records are read and written, so no endpoint can leave it out.
- **Automation runs on events.** Every write records an event in the same transaction. The worker runs workflows, sequences, notifications and indexing from those events, so imports and bulk edits set off workflows too.
- **The assistant** runs on the server with the `CrmApi` methods as its tools, as the signed-in user, proposing before it writes.
- **One list of operations, three ways in.** Every operation of the CRM is defined once: a name, a description in plain words, a zod input, a zod output, the access it needs, and the code. The HTTP API the web app calls, the MCP server and the built-in assistant's tools are all generated from that list. Nothing can be done on screen that an agent cannot do, because both go through the same operation.
- **The whole CRM is reachable over MCP.** An outside agent connects to the instance's MCP endpoint and can run everything: records, views, pipeline, tasks, inbox, sequences, workflows, forms, booking, reports, forecast, import, people and settings. It acts as a person or as a named agent with a role, so the same permissions apply, and every change it makes is marked in the audit log. Operations that destroy or send (delete, merge, bulk edit, send email) are marked as such so a client can ask before running them.
- **Search** starts on Postgres full-text search.

Decided:

- **Sign-in comes from Ensemble by default, behind an interface.** The server asks an auth provider "who is this request from?" and nothing else. Ensemble's provider is the default; another provider is a different adapter, with no change to the rest.
- **Email is sent through Ensemble's email service by default, behind the same kind of interface,** so a customer can use their own provider.
- **Redis on every VM** for jobs, events and live updates.
- **Mariachi's libraries** are used wherever one fits.
- **MCP is part of the core,** not a plugin: it ships switched on in every instance.
- **The assistant's model is the customer's choice.** The assistant talks to a model through one provider interface, as sign-in and email do. The customer picks the model in settings and can bring their own (their own key, or their own endpoint); further providers are plugins in `plugins/`. Nothing in the assistant is written against one vendor.

Built so far (in `server/`):

- Tables for objects, people, teams, roles, records, activity, workflows and their runs, notifications, and the event outbox. Filters, search and sorting run over JSONB.
- All 74 operations of the CRM: workspace, records, import, merging, activity, the record brief, people, teams, roles, "view as", objects, properties, saved views, line items, lead conversion, workflows, notifications, the inbox, email templates, sequences, forms, booking pages, reports, dashboards and the forecast. Each is served over HTTP at `/api/ops/<name>` and as an MCP tool at `/api/mcp`, both generated from `src/contracts/operations.ts`. In live mode the web app no longer uses the mock for anything.
- Every operation first works out who it runs as, and the records service turns that person's role into SQL, so the app, the API and an agent over MCP all get exactly what the person may see and change.
- Every record write records an event in the same transaction. The worker (`server/src/worker.ts`) relays events through Redis and runs workflows from them; an event delivered twice runs a workflow once, and what a workflow changes never sets off another workflow.
- Workflows also run on a schedule and when another system calls. A scheduled workflow (every day, or one day a week, at an hour in UTC) goes through each record that passes its conditions at that moment, up to 500; if the worker was down when it was due it runs late, once. A called workflow has its own address, `/api/hooks/<id and signature>`, which is the credential and is shown only to people who manage settings; the caller names the record by id or by a contact's email and is told whether the workflow ran and, if not, why. A call that carries the caller's own id runs once however often it is sent.
- Import reads everything a file needs in a few queries, writes in bulk and announces each record, so 5,000 rows take about two seconds and workflows run for imported records. A dry run writes nothing and says what would happen.
- Email that is not lost. An arriving message is stored before the provider is told it was received, then filed into a conversation from the stored copy; one delivered twice is stored once. A sent message is stored as queued in the same transaction as the action, and the worker sends it with its id as the idempotency key, retrying with a growing wait. A sweep on a timer finishes anything left over and asks the provider what arrived without the CRM being told. Every outgoing message ends as sent or failed, a failure tells its sender, and `inbox.health` gives the numbers to watch. The email service sits behind `server/src/email/provider.ts`; `dev` keeps mail in the database and misbehaves on purpose for two test domains.
- Sending later. A reply can be given a time; it waits in the same queue as every other outgoing message, simply not due until then, so it has the same guarantees. Until its time it can be cancelled, it is checked against consent again when it goes, and it is not counted as a backlog in `inbox.health`.
- Consent and opting out. Whether an address may be emailed is kept by address, so it outlives the contact: subscribed, unsubscribed (no automated email) or blocked (nothing; set when an address bounces, or by hand). Every email is checked when it is queued and again just before it goes. Email the CRM sends on its own (a sequence step, a workflow) carries a signed unsubscribe link, the organization's postal address and the header mail apps use for their own unsubscribe button, and is held to a weekly limit per address; over the limit, a sequence waits instead of sending. Opening the link changes nothing until the person presses the button. Resuming email needs a reason on record, and only someone who manages settings may undo a choice the recipient made. A form can ask for agreement in set words; a tick is kept with the words, the form and the date.
- Sequences really run. Each step is one database transaction with moving the contact on: the email is queued or the task created and the schedule advances, or none of it happens. Waits are working days. Later emails go out on the thread the first one started, and a contact who replies leaves the sequence.
- Adding an object, a field or a saved view is a change to a row of data, made under a lock so two changes cannot overwrite each other, and takes effect at once. Deleting a field removes its values in the same transaction. Merging two records, and converting a lead, each happen entirely or not at all.
- Forms and booking pages have operations a visitor's browser calls with no sign-in. Those take only what the form or page asks for, give back nothing about anyone else, never overwrite what the team has on a contact, and are held to a rate per address. A form has two quiet traps for programs that fill forms in (a field people cannot see, and a form sent the instant it appears); what they catch is answered as if it worked and nothing is kept. A booking checks the time is really on offer while holding the hosts' calendars, so two visitors cannot be given the same slot.
- Live updates. Browsers hold a WebSocket open on the API's own port (`/api/live`), signed in like any request, and are told which part of the CRM to read again when it changes: records of an object, the inbox, notifications, or the CRM's shape. A notice says where to look and never what is there, so it cannot show anyone something their role hides. Notices travel through Redis, so the worker reaches browsers connected to the API. A browser that loses the connection reconnects and reads once to catch up.
- The assistant on a model the customer chooses. `server/src/assistant/providers.ts` is a registry of model providers behind one small interface (Mariachi's AI adapter): Anthropic, OpenAI, and "your own endpoint" for anything that speaks the OpenAI chat format. A plugin adds a provider by registering it. An admin connects a model in Settings; the key is stored encrypted and never sent back. The model is given the CRM's operations as tools and acts as the person asking: it reads freely with their access, and any operation that changes, deletes or sends is not run but becomes a step in a plan, which the person approves and their own browser then runs as them. With no model connected, the scripted demo assistant answers. Each event of a turn (a lookup, a chart, a paragraph) is pushed to the asker's browser over the live connection as it happens, and only to them; the reply at the end carries all of them, so nothing is lost if the connection is down. Every turn is recorded with who asked, the model, tokens in and out and how long it took, and Settings shows the last 30 days.
- Agents as members. An agent (an AI agent over MCP, a script, an integration) is a member with its own name, a role like anyone else, and a limit on what kind of thing it may do at all: look things up; also create and change; or everything its role allows, including deleting, merging and sending. It signs in with a key (Mariachi's API keys: only a hash is stored, the key is shown once, and it can be revoked). What an agent does carries its name. Only people create agents and hand out keys: an agent can never manage people, agents or the assistant's model, whatever its role.
- An audit log of every change. Each operation that changes, deletes or sends leaves an entry once it has been tried: who or what asked (a person, an agent, a visitor; and the real person when an admin was viewing as someone else), how it arrived (the app, an approved assistant plan, an agent over MCP, the API, a public page), what it was done to, and whether it went through or was refused. Secrets are removed and long values shortened. It is Mariachi's audit trail: the database refuses to edit or delete an entry, and entries are hash-chained, so tampering behind the database's back is found when the chain is checked. People who have left and agents that were removed keep their names on what they did.
- Rules that keep data right, enforced by the server whichever way a change arrives. Computed fields: a property can be worked out from others by a formula in a small closed language (`src/lib/formula.ts`, shared with the app so a formula is checked where it is typed); the answer is stored, so it can be filtered, sorted and reported on, and formulas that count from today are refreshed hourly. Conditional fields: a property can be shown, or required, only when the record meets a condition. Stage rules: each stage can name the fields a record must have to be in it, and an object can insist on one stage at a time (going back, and closing as won or lost, are always allowed). Imports work computed fields out but are not held to stage rules, so a migration is never blocked by them. Scores: a number can be a score, the sum of the points of every rule a record meets (points can be negative, and a rule can count on a computed field); like a formula's answer it is stored and kept current, and the record shows which rules counted, so a score can be argued with. Leads come with an example "Fit score". Duplicates: sets of records sharing an email address, a website or a name are found by the database, each pair one click from being merged.
- Reports and the forecast are grouping and adding up done by the database, over the records the acting person may see. Every seeded report and the forecast give the same numbers on the server as on the mock.
- A report can be emailed on a schedule (every day, or one day a week, at an hour in UTC) to chosen members. Each person's email is worked out as that person, so it never shows more than their role shows them in the app. It comes from whoever set it up, is sent once per time it is due even if the worker restarts half way, and a failed send tells that person.
- Privacy requests, from the "more" menu on a contact or lead and as operations. Export gathers everything held about the person into one document: the record, whether they may be emailed and what they agreed to, activity, conversations with every message, form submissions, meetings, sequences and the names of linked records. Erase is the one place the CRM really deletes: all of that leaves the database in one transaction, linked deals and tasks stay without them, and only their address is kept, blocked, so a later import cannot start emailing them again. It needs their email address typed to confirm, and what was typed is not kept in the audit log. Not covered: copies held by the email service itself, and audit entries, which cannot be edited by design.
- People on a deal. Beyond its main contact, a deal lists the contacts involved and the part each plays (decision maker, champion, budget holder, influencer, legal, end user, blocker). The deal then shows on each of those contacts. Merging contacts carries their parts across, and erasing a person removes them.
- Segments built by hand. A segment is a choice on a several-choices field ("Segments" on contacts and leads), so filters, saved views, reports and workflow conditions already understand it; a saved view is the kind that keeps itself up to date. One operation adds or removes choices on many records at once without touching their other choices: the rows ticked, or everything a list shows (up to 5,000). Someone who manages settings can name a new segment as they add to it. Each record is announced as changed, so workflows that watch the field run.
- Working through tasks. `/queue` takes what is due once and shows one task at a time with where the record it is about stands; done, tomorrow, next week or skip brings the next. A task can repeat (every day, week, month or quarter): finishing it puts the next one on the list in the same step, dated from when it was due, or from today if it was finished late.
- Sign-in behind an interface with `dev` and `jwt` providers, and a seed of the demo company.
- The web app's live mode sends those operations to the server and everything else to the mock.

Not yet: the Ensemble sign-in and email adapters and connected mailboxes (only development providers exist), delivery and bounce reports, attachments, time zones on booking pages, restoring deleted records, the assistant's words appearing letter by letter as the model writes them (events stream, text within one does not), and files given to the assistant on a model.

Tests: `pnpm test` (needs `pnpm db:up`). Unit tests sit beside the shared code (`src/lib/*.test.ts`). The server tests in `server/test` run the real services against a real Postgres database, `crm_test`, which they create and empty themselves, and call operations the way the HTTP API and MCP do, so who is acting, an agent's limits and the audit log are exercised too. They cover access by role, records and import, computed fields and stage rules, email in and out with its failure cases, consent and opting out, sequences, workflows (on events, on a schedule and when called), agents, the audit log, public forms and booking, and the assistant on a scripted model.

To run it: `pnpm db:up`, `pnpm db:seed` (once), `pnpm api`, `pnpm worker`, then `pnpm dev:live` and open http://localhost:5185. Plain `pnpm dev` still runs on the mock alone. Mariachi must be checked out beside this repo and built, because its packages are linked, not installed.

Order: records end to end (contacts first; the other objects follow because they are metadata), auth and people, activity and tasks and the record brief, events with workflows and sequences, import, inbox and email, reports and forecast, the assistant on a real model.

## Open decisions

- **Who pays for AI tokens:** Ensemble credits, or the customer's own key.
- **How strong the update promise is** for instances whose core code has been changed.
- **Publishing `@mariachi/design`.** The repo links it from a local checkout today, so nobody else can install it.
- **Licence and README** for the public repo.
- **The importer's promise:** agree the list of things that do not migrate cleanly (see EQUIVALENCE.md) and how the pre-migration report presents them.

## Other templates on the same contract

Help desk, invoicing, booking, applicant tracking, client portal.
