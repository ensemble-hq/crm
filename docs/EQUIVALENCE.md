# Functional equivalence with HubSpot

**This is not a list of HubSpot screens to copy. It is a list of the jobs a team does in HubSpot, so that someone who migrates can still do every one of them here, in a way that is as good or better.** Each row names the job, how HubSpot does it, how we do it, and whether the customer's existing data for it comes across.

Researched 2026-11-14 from HubSpot's public Product & Services Catalog (`legal.hubspot.com/hubspot-product-and-services-catalog`, its products, free-tools, add-ons and technical-limits pages), its pricing pages and its knowledge base. HubSpot repackages often; recheck before relying on a tier or limit.

## How to read this

**Principles**

1. **Equivalent or better, not identical.** We match the outcome, not the screen.
2. **AI-first.** Where HubSpot has a form to fill in or a builder to learn, we first ask whether the assistant can do the job from a sentence, with a plan the user approves. The manual screen still exists, as the fallback.
3. **Everything comes with you.** If HubSpot holds data for a job, the importer brings it, or says plainly that it cannot.
4. **No tiers inside the product.** HubSpot gates features by edition (Free, Starter, Professional, Enterprise). An instance here has everything; the "HubSpot tier" column only shows what a migrating customer was paying for.

**Status**

| Status | Meaning |
| --- | --- |
| **Mock** | On screen today in the frontend mock |
| **First release** | In the first release |
| **Later** | A later module; not needed to migrate |
| **By design** | Done differently on purpose; the row says how |
| **Not planned** | We do not intend to offer it; the row says what to use |

**Migrates** says whether the importer brings the customer's existing HubSpot data for that job: **Yes**, **Partly** (with what is lost), **No**, or **n/a** when there is nothing to bring.

## Names HubSpot has changed

Anyone checking this against HubSpot should know the current names:

| Was | Now |
| --- | --- |
| Commerce Hub | Revenue Hub (Professional and Enterprise only; owns quotes, e-signature, contracts and the product library) |
| Operations Hub | Data Hub |
| Lists | Segments |
| Breeze Copilot | Breeze Assistant |

## Core CRM: records, fields and views

HubSpot's free CRM plus "Smart CRM" Starter ($20 per seat per month). Several basics are gated high: custom objects are Enterprise only, calculated fields and association labels are Professional.

| Job | In HubSpot (lowest tier) | Here | Status | Migrates |
| --- | --- | --- | --- | --- |
| Keep people, companies and deals | Contacts, companies, deals (Free: 1,000 contacts) | The same three objects, no record caps of ours | Mock | Yes |
| See everything that happened with a record | Record timeline (Free shows 30 days) | Full timeline on every record | Mock | Yes: notes, emails, calls, meetings, tasks |
| Keep your own kinds of record | Custom objects (Enterprise: 10) | Custom objects for everyone, created in Settings or by asking the assistant | Mock | Yes |
| Add your own fields | Custom properties (Free: 10 in total) | Unlimited properties; "add a renewal date to deals" in the assistant creates one | Mock | Yes |
| Compute a field from others | Calculated and roll-up properties (Professional: 40) | Calculated and roll-up properties | First release | Partly: formulas are translated, and flagged when they cannot be |
| Have AI fill in a field | Smart properties (Starter, uses credits) | AI fields: a property whose value is a prompt | First release | Partly: the value comes across, the prompt is rewritten |
| Stop bad data getting in | Required fields (Starter), validation rules (Free; regex Professional), unique values | Required, validation and unique rules on any property | First release | Yes |
| Show or require fields depending on another | Conditional property logic and options (Professional) | Conditions on a property: "ask for the loss reason when a deal is lost" | First release | Partly: simple rules yes, nested ones reviewed |
| Hide a field from some people | Field-level permissions (Enterprise; not enforced through the API) | Field-level permissions, enforced everywhere including the API | Later | Yes |
| Link records and say how they relate | Associations (Free), labels (Professional: 50 per pair) | Links between any objects, with labels | First release | Yes |
| See who is involved in a deal | Buying groups (Professional) | Labelled contacts on the deal; the assistant suggests roles from the emails | First release | Partly |
| Arrange the record page | Card and tab layout (Free), per-team layouts (Professional), conditional cards (Starter) | Record page layout per object; because each customer owns their code, any layout is possible by asking | First release (layout); By design (beyond) | No: layouts are set up fresh |
| Choose what the create form asks | Create-form customization | "Ask when creating" per property | Mock | No |
| Save a filtered list | Saved views (50 per user), board, calendar and report views (Beta) | Saved views with table and board; calendar view | Mock (table, board); First release (calendar, editing views) | Yes: filters and columns |
| Group records for campaigns and reports | Segments, formerly lists (Free: 10 active) | Segments, static and dynamic, unlimited; describe one in a sentence | First release | Yes: definitions and static membership |
| Move records through stages | Pipelines (Free: 1 per object), stage-required properties | Pipelines on any object, unlimited, with required fields per stage | Mock (one pipeline); First release (several, required fields) | Yes |
| Enforce how deals move | Pipeline rules (Professional): no skipping, no moving back | Stage rules on a pipeline | First release | Partly |
| Mark records with colour labels | Object tags (Starter: 20) | Coloured tags and dropdown colours | Mock (colours); First release (rule-based tags) | Yes |
| Work in several currencies | Multiple currencies (Starter: 5) | Multi-currency amounts with exchange rates | First release | Yes |
| Find and merge duplicates | Auto-dedupe by email and domain (Free), duplicate management (Professional) | Dedupe on import and continuously; the assistant proposes merges as a plan | First release | n/a |
| Keep data tidy | Data quality overview, formatting fixes (Starter, Beta) | The assistant proposes clean-ups as plans you approve | First release | n/a |
| Fill in missing company and contact details | Enrichment (Starter, uses credits), buyer intent | Enrichment from the web by the assistant; a data provider as an optional integration | Later | n/a |
| Bring data in and take it out | Import (Free: 500,000 rows a day), export | Import with AI column matching (in the mock assistant), full export at any time | Mock (import); First release (export) | n/a |
| Manage projects next to customers | Projects object (Free), HubSpot Work (Beta) | A custom object does this today (the mock has a "Projects" example); a project template later | By design | Yes |
| Use it on a phone | Mobile app with card scanner and caller ID (Free) | Mobile-friendly web app; native app later. Card scanning is "drop a photo on the assistant". | First release (web); Later (native) | n/a |

## Sales: prospecting, selling and forecasting

HubSpot's Sales Hub (Professional $100 per seat per month, Enterprise $150). Most of what follows is Professional or above there.

| Job | In HubSpot (lowest tier) | Here | Status | Migrates |
| --- | --- | --- | --- | --- |
| Qualify a lead before it becomes a deal | Leads object with its own pipeline (Professional) | A Lead object on the same model, or lifecycle stages on the contact; the template ships with one and the customer can switch | First release | Yes |
| Start the day knowing what to do | Sales workspace, guided actions (Professional) | The daily briefing and the assistant: "what should I do today?" answers with a list it can act on | First release; By design | n/a |
| Work through a list of tasks | Tasks (Free), queues, repeating tasks (Starter) | Tasks, queues and repeating tasks | First release | Yes |
| Share leads out fairly | Lead rotation (Professional), form routing with booking (Enterprise) | Assignment rules; a form can book straight into the right person's calendar | First release | Partly: rules re-created |
| Email from the CRM and have it logged | Inbox connection, 1-to-1 email (Free) | Gmail and Outlook two-way sync | First release | Yes: logged emails |
| Work from your own inbox | Chrome extension and Outlook add-in (Free) | Gmail and Outlook add-ins: log, track, templates, and the assistant in the sidebar | First release | n/a |
| Know when an email was opened | Tracking and notifications (Free: 200 a month) | Open and click tracking, unlimited | First release | Partly: past open history where the export has it |
| Reuse what you write | Templates and snippets (Free: 3 each) | Templates and snippets, unlimited; the assistant drafts in your voice | First release | Yes |
| Send later, and not too often | Scheduling (Starter), frequency controls (Professional) | Scheduled send and send limits | First release | n/a |
| Run a follow-up cadence | Sequences (Professional), with email, call, task and LinkedIn steps, auto-unenroll, A/B tests | Sequences with the same step types; unenroll on reply or booking, for the whole company if wanted; each email personalized by the assistant | First release | Partly: sequences and steps yes; contacts mid-sequence are listed for re-enrolment |
| Let people book time with you | Meeting links (Free: 1), round robin (Professional) | Booking links: personal, round robin, group | First release | Partly: links are re-created and old URLs listed for redirect |
| Have meetings write themselves up | Notetaker, prep and recap (Starter) | Meeting recordings become notes, next steps and suggested field updates | First release | Yes: past notes and transcripts |
| Call from the CRM | Calling, numbers (Starter), recording, IVR (Professional), power dialling | Calling module through Twilio | Later | Partly: call logs and recordings |
| Learn from calls | Conversation intelligence, coaching playlists (Professional) | Transcripts are searchable and summarized; the assistant reviews calls against your own checklist | Later | Partly |
| Guide reps through a call | Playbooks (Professional: 5) | Checklists on a record, plus the meeting prep brief | Later | Partly: text yes |
| Share collateral and see who read it | Documents (Starter) | Tracked documents | Later | Yes: files; not view history |
| Send a video | 1-to-1 video (Professional) | A third-party recorder; the link is logged | Not planned | n/a |
| Score deals and accounts | Predictive deal score (Starter), lead scoring (Professional: 5 scores) | AI fields: a score with its reasons, on any object, as many as you like | First release | No: scores are recomputed |
| See where a deal stands | Deal summaries, deal progression (Professional, Beta) | The record summary and suggested field updates, on every record | First release | n/a |
| Forecast the quarter | Forecasting (Professional; by team hierarchy Enterprise) | Forecast with categories and rep submissions; the assistant adds its own forecast with reasons | First release | Partly: categories on open deals |
| Set and track targets | Goals (Starter revenue only; custom Enterprise) | Goals on any number you can report on | First release | Partly |
| Split credit for a deal | Deal splits (Enterprise) | Deal splits | Later | Yes |
| Require sign-off to advance a deal | Deal approvals (Enterprise) | Approval step in workflows, on any object | Later | No |
| Agree a plan with the buyer | Deal plans (Professional, Beta) | A shared page per deal | Later | No |
| Focus on target accounts | ABM tools, target accounts (Professional) | A saved view and a tag; no separate tool | By design | Yes: the target flags |
| Automate the repetitive parts | Workflows (Starter: 50 limited; Professional: 300) | Workflows on any object, unlimited, built from a sentence or by hand | First release | Partly: see Automation under Platform |
| Report on the team | Sales analytics (Starter), custom reports (Professional: 100), deal journeys (Enterprise) | One report builder for everything; ask the assistant for the chart | First release | No: reports are rebuilt from a list of the old ones |
| Use LinkedIn alongside | Sales Navigator integration (Professional) | Sequence task steps for LinkedIn; no embedded panel | Later | n/a |

## Marketing: capture, email and campaigns

HubSpot's Marketing Hub. The price cliff is the story here: Starter is $20 per seat per month, Professional starts at $890 per month plus $3,000 onboarding, Enterprise at $3,600 per month plus $7,000. Full workflows, lead scoring, campaigns, A/B tests, social and custom reports all sit behind that jump, so small teams mostly live on forms, email, segments and simple automation. That is the part we cover first.

| Job | In HubSpot (lowest tier) | Here | Status | Migrates |
| --- | --- | --- | --- | --- |
| Capture leads from your website | Forms: embedded, standalone (Free, branded) | Forms, embedded and hosted, unbranded; describe the form and the assistant builds it | First release | Yes: definitions and submissions. Embeds on the customer's site must be swapped; the importer lists every page |
| Catch submissions from forms you already have | Collected (non-HubSpot) forms | A small script, or post to the API | First release | n/a |
| Split a long form into steps | Multi-step forms (Starter) | Multi-step forms | First release | Yes |
| Ask different questions depending on answers | Conditional logic (Professional); progressive fields (legacy) | Conditional fields; known answers are skipped for returning visitors | First release | Partly: simple rules yes |
| Keep spam out | CAPTCHA, blocked domains | Spam protection and blocked domains; AI screening of submissions | First release | n/a |
| Record consent | Consent elements, cookie banner (Free) | Consent checkbox per purpose, stored with the legal basis; cookie banner | First release | Yes: consent and legal basis per contact |
| Act on a submission | Notifications, follow-up email, form automation (Free: 1 action) | Notify, route, follow up, any workflow; no action cap | First release | Partly |
| Send a newsletter or announcement | Marketing email with editor and templates (Free: 2,000 sends a month) | Marketing email module with an editor; the assistant drafts from a brief | Later | Yes: templates as HTML, past sends as history |
| Personalize what each person gets | Tokens (Free), smart content (Professional), programmable email (Professional, Beta) | Tokens and conditional blocks; per-recipient rewriting by the assistant | Later | Partly |
| Send only to people who want it | Subscription types, preferences page, unengaged suppression (Free), double opt-in | Subscription types, a preferences page, suppression and double opt-in | First release | Yes. This is a legal requirement and the importer treats it as blocking |
| Land in the inbox | Authenticated domain (Starter), email health (Free), dedicated IP ($300 a month) | Ensemble sets up the sending domain (DKIM, SPF, DMARC) for each instance and monitors reputation | First release (domain setup); Later (bulk reputation tools) | n/a |
| Test what works | A/B tests (Professional), send-time optimization (Enterprise) | A/B tests and send-time choice | Later | No |
| Control how often people hear from you | Frequency cap, approvals (Enterprise) | Frequency cap; approval step in workflows | Later | No |
| Send receipts and notices | Transactional email add-on ($600 a month) | Transactional sends through the API, on the instance's own sending domain | Later | n/a |
| Group an audience | Segments (Free: 10 active) | Segments; see Core CRM | First release | Yes |
| Track where each person is in the funnel | Lifecycle stages (Free) | Lifecycle stages, customizable | Mock | Yes |
| Score leads | Lead scoring (Professional: 5 scores; AI-assisted Enterprise) | AI fields; see Sales | First release | No |
| See what a contact did on your site | Tracking code, website activity (Free: 30 days) | Tracking script and page-view history on the timeline | Later | Partly: page-view history where exportable |
| Know where visits and leads come from | Traffic analytics (Free), tracking URLs (Professional), attribution (Professional and Enterprise) | Source on every contact from UTM parameters in the first release; traffic and attribution reports later | First release (source); Later (reports) | Yes: original source per contact |
| Run a campaign across channels | Campaigns, Marketing studio (Professional) | A Campaign object that groups emails, forms and pages, with results | Later | Yes: campaign names and membership |
| Nurture leads automatically | Workflows (Professional: 300), simple automation (Free: 1 action) | Workflows, unlimited; see Platform | First release | Partly |
| Build a landing page | Landing pages (Free: 30) | Hosted pages for forms in the first release; a landing-page module later | Later | Partly: page content as HTML, with redirects |
| Publish a blog, host a site | Blog, CMS (Content Hub) | A separate template. Not part of the CRM. | Not planned | Partly: content export |
| Put a button or pop-up on your site | CTAs, pop-ups, banners (Starter) | Embeddable buttons and pop-up forms | Later | No: embeds are re-created |
| Run and measure ads | Ads management, audiences, conversion events (Free: 3 accounts) | Audience sync and conversion events to Google, Meta and LinkedIn | Later | No |
| Schedule social posts | Social publishing and monitoring (Professional) | A third-party tool; posts can be logged | Not planned | No |
| Improve search ranking | SEO recommendations (Free), analytics (Professional), AEO (Beta) | A third-party tool | Not planned | No |
| Text customers | SMS add-ons ($75 a month, US only), WhatsApp (Professional) | SMS and WhatsApp through Twilio as an integration | Later | Partly |
| Chat with visitors | Live chat, bots (Free), customer agent (Professional) | See Service | Later | Partly |
| See which companies visit | Visitor identification, buyer intent (Free, limited) | An optional data-provider integration | Later | No |
| Run webinars and events | Marketing events object (Free) | An Event object with registrations, from integrations | Later | Yes |
| Keep everything on brand | Brand identity (Starter, Beta); Brands add-on ($1,000 a month per brand) | Brand voice and colours stored once and used by the assistant and every template. Several brands: several instances, or a brand property. | First release (voice); By design (brands) | Partly |
| Host video | Video hosting (Professional: 50) | A third-party host; links are tracked | Not planned | No |
| Pay only for people you market to | Marketing contacts billing (Starter) | No per-contact pricing at all | By design | n/a |

## Service: tickets, inbox and self-service

HubSpot sells this as Service Hub (Starter $20 per seat per month; Professional $100; Enterprise $150, plus onboarding fees). For us it is one later module, "Service", except the shared inbox, which the sales side needs too.

| Job | In HubSpot (lowest tier) | Here | Status | Migrates |
| --- | --- | --- | --- | --- |
| Log a customer issue and track it to done | Tickets with pipelines (Free: 1 pipeline) | A Ticket object on the same metadata model as deals: stages, board, properties, views. Unlimited pipelines. | Later | Yes |
| One team inbox for support@ and sales@ | Shared inbox (Free: 1; Professional: 100) | Shared inbox in the core product, any number of addresses | First release | Partly: threads and assignments; not unsent drafts |
| Assign incoming conversations automatically | Conversation routing (Starter); skills-based (Enterprise) | Routing rules written as a sentence ("billing questions go to Dana, the rest round robin"); the assistant can also triage by reading the message | Later | Partly: rules are re-created, not copied |
| Work tickets across every channel in one place | Help desk workspace (Professional) | The ticket list and inbox are the same screens as the rest of the CRM, so there is no separate workspace to learn | Later | n/a |
| Reply fast with saved text | Snippets and templates (Free: 3 each), macros (Professional) | Templates and snippets, unlimited; the assistant drafts a reply from the ticket history and the knowledge base | First release (templates); Later (ticket replies) | Yes |
| Promise and track response times | SLAs (Professional), conditional SLAs (Enterprise) | SLA rules on any ticket property, with working hours | Later | Partly: rules re-created |
| Stop two agents answering the same ticket | Agent presence (Professional) | Presence on every record, not only tickets | Later | n/a |
| Cap how much each agent is given | Ticket and chat capacity limits (Professional / Enterprise) | Capacity per person in routing rules | Later | No |
| Talk to website visitors | Live chat (Free, branded) and rule-based chatbots | Chat widget; an AI agent answers from the knowledge base and hands over to a person. No decision-tree bot builder. | Later; By design (no bot builder) | Partly: transcripts yes, bot flows no |
| Answer customers on WhatsApp, Messenger, SMS | WhatsApp (Professional, 1,000 messages a month), Messenger (Free), SMS add-on ($75 a month, US only) | Channels as optional integrations through the provider's API | Later | Partly: message history where the API exposes it |
| Call customers from the CRM | Calling with minutes, numbers, IVR (Starter to Professional) | Calling through Twilio as a module; see Sales | Later | Partly: call logs and recordings |
| Let customers help themselves | Knowledge base (Professional: 1; Enterprise: 100) | Knowledge base in the Service module, included. HubSpot has none below $100 a seat, which is a gap we can use. | Later | Yes: articles, categories, redirects |
| Let customers see and reply to their tickets | Customer portal (Professional) | Portal as part of the Service module | Later | n/a |
| Answer customers with AI | Customer agent (Professional, pay per use in credits) | The same assistant, pointed at customers, grounded in the knowledge base and ticket history | Later | n/a |
| Ask customers how it went | NPS, CSAT, CES and custom surveys (Professional) | Surveys as forms with a score; the assistant groups the free-text answers into themes | Later | Yes: responses and scores |
| Know which accounts are at risk | Customer success workspace, health scores (Professional) | An AI field on the company ("health", with its reasons) and a saved view; no separate workspace | Later; By design | No: scores are recomputed |
| Hand a won deal to the account team | Handoff briefing (Professional) | The record summary, generated when the deal is won | First release | n/a |
| Review agent quality | QA score, coaching (Enterprise) | The assistant reviews tickets against your own checklist | Later | No |
| Report on support | Service analytics (Starter), journey analytics (Enterprise) | The same report builder as everything else; ask the assistant for the chart | Later | No: reports are rebuilt |

## Revenue: quotes, billing and payments

HubSpot sells this as Revenue Hub (formerly Commerce Hub; Professional $95 per seat per month, Enterprise $140; some billing tools are free). We said payments were out of scope. The research changes that for part of it: invoices, payment links and subscriptions are free in HubSpot and are the features small teams use most, so a migrating team will expect them.

| Job | In HubSpot (lowest tier) | Here | Status | Migrates |
| --- | --- | --- | --- | --- |
| Keep a catalogue of what you sell | Product library (Free: 100 products) | Product object with prices; unlimited | First release | Yes |
| Price by quantity, or differently per market | Tiered pricing, price books (Professional) | Price tiers and price lists on the product | Later | Yes |
| Put products on a deal | Line items | Line items on the deal | First release | Yes |
| Send a proposal the buyer can accept | Quotes, templates, single-page editor (Professional) | Quote from a deal as a shareable page; the assistant drafts it from the deal | Later | Partly: quote records and PDFs; not templates |
| Get it signed | E-signature (Professional: 25 a month per user) | E-signature through a provider, no monthly cap of ours | Later | Partly: signed documents as attachments |
| Require approval for big discounts | Quote approvals (Professional; multi-step Enterprise) | An approval step in workflows, usable on any record, not only quotes | Later | No |
| Stop reps quoting invalid combinations | CPQ rules (Enterprise) | Validation rules on line items | Later | No |
| Know when the buyer opened it | Quote activity tracking | View tracking on every shared page (quotes, documents) | Later | No |
| Bill a customer | Invoices, reminders, credit memos (Free) | Invoices through a connected Stripe account, shown on the company and deal | Later | Partly: invoice records; not payment methods |
| Take a payment from a link | Payment links, checkout (Free, with a processor) | Stripe payment links created from a deal or quote | Later | No: links are re-created |
| Bill on a schedule | Subscriptions, retries (Free) | Stripe subscriptions, mirrored into the CRM | Later | Partly: subscription records; the billing itself stays in the processor |
| Track contracts and recurring revenue | Contracts with ACV, ARR, MRR (Free) | Contract object with the same figures as calculated properties | Later | Yes |
| Process the payment itself | HubSpot payments (US, UK, Canada; 2.9% cards plus 0.5% platform fee) or Stripe (plus 0.75%) | Stripe only, with no platform fee of ours | By design | n/a |
| Charge the right tax | Tax rates (Free), automated sales tax (Professional) | Stripe Tax | Later | No |
| Keep the books in sync | QuickBooks and Xero sync (Free) | QuickBooks and Xero integrations | Later | n/a |
| Offer instalments, financing | Affirm, Klarna, capital financing | Whatever the connected Stripe account offers | Not planned (ours); available through Stripe | n/a |
| Report on revenue | Revenue reports (Free simple; Professional full) | The same report builder, over invoices and subscriptions | Later | No |

**Decision this raises:** move "Payments" out of "out of scope". Mirroring Stripe (invoices, payment links, subscriptions) is far less work than processing payments, and covers what small teams use.

## Platform: automation, data, people and security

HubSpot spreads this across Data Hub (formerly Operations Hub; Professional $800 a month, Enterprise $2,000) and the admin features of every hub.

| Job | In HubSpot (lowest tier) | Here | Status | Migrates |
| --- | --- | --- | --- | --- |
| Automate "when this happens, do that" | Workflows (Starter: limited; Professional: 300 to 400; Enterprise: about 1,000) | Workflows on any object, unlimited. You describe the automation; the assistant builds it and shows it as a diagram you can edit. | First release | Partly: each workflow is translated and listed as translated, needs review, or not possible. Records mid-workflow are listed. |
| Run automation on a schedule or from another system | Scheduled and webhook triggers (Professional: 10 webhook triggers) | Schedule and webhook triggers, unlimited | First release | Partly |
| Call another system from an automation | Webhook actions (Professional) | Webhook action | First release | Yes |
| Do something the builder cannot | Custom code actions (Professional) | Because the customer owns the code, "something the builder cannot do" is a change Ensemble makes in a preview; small custom steps run as code in the instance | By design | Partly: code actions are ported by an agent and flagged for review |
| Use AI inside an automation | AI workflow actions (10 credits each) | AI steps: decide, extract, write | Later | Partly |
| Keep data in step with other tools | Data sync, HubSpot-built integrations only (Free; custom field mappings Starter) | Two-way sync through the API and integration platforms; common ones built in; others built on request | First release (API, Zapier, Make, Slack); Later (native syncs) | n/a |
| Combine CRM data with outside data | Data studio, formerly datasets (Professional, Beta) | The report builder joins objects; outside data comes in through an import or integration. Each instance has its own database, so direct SQL access is possible. | Later; By design | No |
| Feed a data warehouse | Snowflake, BigQuery, S3 (Enterprise) | Direct database access and scheduled exports | Later | n/a |
| Build dashboards and reports | Dashboards (Free: 10), custom reports (Professional: 100) | Dashboards and a report builder, unlimited; ask for a chart and pin it | First release | No: the importer lists every report and dashboard so they can be rebuilt, and the assistant rebuilds the common ones |
| Send reports on a schedule | Scheduled email and Slack delivery | Scheduled delivery by email and Slack | First release | No |
| Add and remove people | Users, seat types | Users with no seat types and no per-seat price | First release | Yes: users and ownership |
| Control who can see and change what | Permissions (Free), permission sets (Starter templates; custom Enterprise) | Roles with record access by own, team or all | First release | Partly: roles are mapped, and custom sets are reviewed |
| Organize people into teams | Teams (Professional: 10), hierarchy (Enterprise) | Teams and nested teams | First release | Yes |
| Set defaults for new people | Presets (Professional) | Default settings per role | Later | No |
| Sign in securely | Google and Microsoft sign-in, two-factor, passkeys (Free), SSO (Professional), SCIM (Enterprise) | The same, provided by Ensemble's sign-in for every instance | First release (sign-in, two-factor); Later (SSO, SCIM) | n/a |
| See who did what | Audit log (Starter: logins only; record changes Professional) | A full audit log of record and settings changes, with AI actions marked | First release | No |
| Help a colleague by seeing what they see | Log in as another user (Enterprise) | View as another user, recorded in the audit log | Later | n/a |
| Handle privacy requests | Legal basis, consent, permanent delete, data export (Free) | The same four, and the assistant can carry out a request end to end as a plan | First release | Yes |
| Keep data in a region | Data residency: US, EU, Canada, Australia | The instance runs in the region the customer chooses | First release | n/a |
| Store sensitive data | Sensitive Data (Enterprise) | Encrypted properties with restricted access | Later | Partly |
| Try changes safely | Sandbox (Enterprise: 1; extra $750 a month) | Every change, by anyone, gets a preview with a copy of the data. This is the platform, not a feature. | By design | n/a |
| Run several brands or business units | Brands add-on ($1,000 a month each), multi-account | Separate instances, or a brand property | By design | Partly |
| Be notified | Email, in-app, mobile, Slack notifications | In-app, email and Slack; a daily digest written by the assistant | First release | No |
| Find anything | Global search | Global search, and search by meaning across emails, notes and calls | First release | n/a |
| Build on it | REST API (250,000 calls a day and up), webhooks, apps, UI extensions | REST API and webhooks with no daily cap of ours. No app framework is needed: the customer changes the product itself. | First release; By design | Partly: integrations that call HubSpot's API must be repointed |
| Connect the tools you already use | Marketplace: about 2,500 listings | See below | By design | n/a |

### Integrations

We will not match 2,500 marketplace listings by building them, and do not need to. The most-installed HubSpot apps are a short list: Gmail, Google Calendar, Outlook mail and calendar, the connectors for Claude and ChatGPT, WordPress, Zapier, Make, Meta, Google and LinkedIn Ads, LinkedIn Sales Navigator, Zoom, Google Meet, Microsoft Teams, Slack and Google Contacts.

- **Built in for the first release:** Gmail, Outlook, both calendars, Zoom and Google Meet links, Slack, Zapier, Make, and an MCP server.
- **Later:** ad platforms, WordPress forms, Teams, QuickBooks and Xero, Stripe.
- **Everything else:** the API, Zapier and Make cover most; for the rest, the customer asks and Ensemble builds the integration into their instance.

## AI

HubSpot has three layers: Breeze Assistant (a chat assistant, free in every edition), Agent Hub (about a dozen named agents, most in beta), and AI embedded in features. It is priced in credits: 500 to 5,000 a month included per edition, then $0.01 each, at per-outcome rates such as 50 credits per resolved customer conversation and 100 per prospecting lead.

| Job | In HubSpot | Here | Status |
| --- | --- | --- | --- |
| Ask about your data and get things done | Breeze Assistant | The assistant, on its own page, on every page and by voice. It shows its work beside the conversation and runs changes as plans you approve. | Mock |
| Have it change the CRM, not only the data | Not possible; the product is fixed | Fields, objects, views and workflows by asking; anything deeper is built by Ensemble in a preview | Mock (fields); By design |
| Research and write to prospects | Prospecting agent (100 credits per lead) | Research and a personalized draft, from the contact or in bulk as a plan | First release (drafts); Later (bulk research) |
| Keep records filled in | Data agent, smart properties, enrichment | AI fields and enrichment by the assistant | First release |
| Answer customers | Customer agent (50 credits per conversation) | The assistant, pointed at customers, in the Service module | Later |
| Qualify inbound leads | Lead qualification agent (Beta) | A lead qualifier on form submissions | Later |
| Follow up automatically | Nurture agent (10 credits per email) | A follow-up agent that drafts for approval | Later |
| Summarize a deal, a call, a handover | Deal summaries, handoff summaries, notetaker | Record summaries and meeting notes on every record | First release |
| Forecast and score | Predictive deal score, AI lead scoring, forecasting | AI fields with reasons, and a forecast with reasons | First release |
| Write content and plan campaigns | Content and Campaign agents (1,000 credits per piece) | Drafting in the marketing module | Later |
| Chase unpaid invoices | Revenue agent (500 credits per outreach) | A follow-up agent over invoices | Later |
| Build your own agent | Agent builder (Beta) | A workflow with AI steps, or ask Ensemble to build it | Later; By design |
| Use the CRM from Claude or ChatGPT | Official connectors and a remote MCP server (Free) | An MCP server on every instance, exposing the same tools the built-in assistant uses | First release |

**Where we are different on purpose.** HubSpot has a dozen separately named, separately priced agents. We have one assistant with one set of tools; what HubSpot calls an agent is, for us, the assistant doing a job on a schedule or a trigger.

**Open decision: pricing.** HubSpot's credit prices give a reference point for what customers already accept (for example $0.50 per resolved customer conversation, $1 per researched lead). We still need to decide between Ensemble credits and the customer's own model key.

## What the audit changed

### Things the plan had missed, now added
- Gmail and Outlook add-ins. For many sales users the add-in is the product.
- A lead object and a "what should I do today" starting point.
- Unique-value, validation, conditional and stage-required rules on properties, and pipeline rules.
- Segments as the name and model for lists.
- Forecast categories, goals, deal splits and approvals.
- Tracked documents, playbooks, booking round robin.
- Subscription types, double opt-in and a preferences page in the first release, because consent has to survive migration.
- Sending-domain setup (DKIM, SPF, DMARC) done by Ensemble for every instance.
- Cookie banner, data residency, view-as-user, scheduled report delivery.
- Invoices, payment links and subscriptions through Stripe (was "out of scope").
- An MCP server as a first-release item; HubSpot already ships one.

### Where we are simply better
- **No tiers.** Custom objects are Enterprise in HubSpot; calculated fields, association labels, sequences, teams, SSO, workflows and custom reports are Professional. Here they are just there.
- **No limits to buy your way past.** HubSpot sells packs for workflows ($200 a month per 100), reports, segments, properties, API calls and users.
- **No seat types and no per-contact marketing price.**
- **A knowledge base without paying $100 a seat.**
- **Field permissions that also apply through the API.**
- **A sandbox for everyone:** every change gets a preview with a copy of the data.
- **You can change the product itself.**

### What we will not offer, and what to use
Blog and CMS, social publishing, SEO tools, video hosting and recording, financing. A migrating team that relies on one of these keeps its existing tool or picks a specialist one; the importer exports the content.

### What does not migrate cleanly
The importer reports each of these per account before the customer commits:

- Reports and dashboards (listed, and rebuilt by the assistant where it can).
- Workflows and sequences in flight (definitions are translated; enrolled records are listed).
- Form and CTA embeds on the customer's own website (every page is listed).
- Booking links and tracked URLs (old addresses are listed for redirect).
- Scores of every kind (recomputed).
- Record page layouts and permission sets (set up fresh, with roles mapped).
- Integrations that call HubSpot's API (must be repointed).
- Chatbot flows (replaced by the AI agent).

### Caveats on the research
- HubSpot's own pages disagree in places (for example journey analytics at 10 million or 20 million events). The catalog's figure is used.
- Rows HubSpot marks as beta are included; they change quickly.
- A few tiers could not be confirmed on a live page: saved views, line items, the email add-ins, stage-required properties, conditional property logic, SCIM. None changes what we build.
- "What small teams use most" is inferred from what sits in HubSpot's free and Starter tiers; HubSpot publishes no usage data.
