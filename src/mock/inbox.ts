import type { Conversation, ConversationQuery, EmailTemplate, InboxApi, Message } from '../contracts/inbox';
import type { FileInfo } from '../contracts/files';
import type { CrmRecord, Reference } from '../contracts/records';
import { MOCK_NOW, OPEN_STAGES, users } from './definitions';
import { dataset, mulberry32 } from './generate';
import { session } from './team';
import { STARTERS, renderEmailText } from '../lib/emailDesign';

/** Generated email threads over the mock deals and contacts, and an in-memory inbox on top of them. */

const CONVERSATIONS = 420;
const HOUR = 3_600_000;
const NOW = Date.parse(MOCK_NOW);

const THREADS: Array<{ subject: string; opening: string; reply: string; followUp: string }> = [
  {
    subject: 'Re: Proposal',
    opening: 'Thanks for sending the proposal over. The scope looks right. Before we take it to the board, can you confirm how long onboarding would take for a team our size?',
    reply: 'Onboarding usually takes two to three weeks for a team of your size. I have attached the plan we used for a similar rollout.',
    followUp: 'That works for us. One more question from finance: is there any flexibility on the payment terms if we commit for two years?',
  },
  {
    subject: 'Pricing question',
    opening: 'We are comparing a couple of options this week. Could you send pricing for 40 seats, and tell me whether the reporting add-on is included?',
    reply: 'Happy to. For 40 seats the reporting add-on is included at no extra cost. I have put the figures in the attached quote.',
    followUp: 'Thank you. That is within budget. Who should our IT lead speak to about single sign-on?',
  },
  {
    subject: 'Security review',
    opening: 'Our IT team has a security questionnaire we need completed before we can sign. I have attached it. Is two weeks realistic?',
    reply: 'Two weeks is fine. I will have the completed questionnaire back to you by the end of next week, along with our latest audit report.',
    followUp: 'Received, thank you. IT has two follow-up questions about data residency. Can we get 20 minutes with someone technical?',
  },
  {
    subject: 'Contract redlines',
    opening: 'Legal has marked up the agreement. Most of it is minor, but they want to talk through the liability clause. The redlined version is attached.',
    reply: 'Thanks for turning that around. I have passed the liability clause to our legal team and will come back to you by Wednesday.',
    followUp: 'Appreciated. If Wednesday holds, we can still sign before month end.',
  },
  {
    subject: 'Following up on our call',
    opening: 'Good to speak earlier. As discussed, I am sending over the list of people who would need access in the first phase.',
    reply: 'Thanks. I have set up a draft rollout plan for those 12 people. Would Tuesday at 10 suit you for a walkthrough?',
    followUp: 'Tuesday at 10 works. Please include our operations lead on the invite.',
  },
  {
    subject: 'Renewal',
    opening: 'Our renewal is coming up next quarter. Usage has grown since we started, so I would like to talk about adding seats at the same time.',
    reply: 'Glad to hear it. I can put together a renewal with 15 extra seats and a multi-year option. Shall I send both versions?',
    followUp: 'Yes please, both. We will decide at the planning meeting on the 24th.',
  },
  {
    subject: 'Demo request',
    opening: 'A colleague recommended you. We are a team of about 30 and currently do this in spreadsheets. Could we see a demo this week or next?',
    reply: 'Of course. I have a few slots open on Thursday and Friday. Here is a link to pick a time that suits you.',
    followUp: 'Booked for Thursday at 2. Looking forward to it.',
  },
];

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

type Store = { conversations: Conversation[]; messages: Map<string, Message[]> };

let store: Store | undefined;

function build(): Store {
  const data = dataset();
  const random = mulberry32(7_114_2026);
  const deals = (data.byObject.get('deals') ?? []).filter((deal) => typeof deal.properties.contact === 'string');
  const conversations: Conversation[] = [];
  const messages = new Map<string, Message[]>();

  for (let index = 0; index < CONVERSATIONS; index += 1) {
    const deal = deals[Math.floor(random() * deals.length)] as CrmRecord;
    const contact = data.byId.get(String(deal.properties.contact)) as CrmRecord;
    const thread = THREADS[Math.floor(random() * THREADS.length)] as (typeof THREADS)[number];
    const open = OPEN_STAGES.includes(String(deal.properties.stage)) ? random() < 0.75 : random() < 0.08;
    const owner = typeof deal.properties.owner === 'string' ? deal.properties.owner : null;
    const assigneeId = random() < 0.12 ? null : owner;
    const rep = users.find((user) => user.id === (assigneeId ?? owner)) ?? users[0];
    const id = `conv_${String(index + 1).padStart(4, '0')}`;
    // Open threads are recent; closed ones can be months old.
    const last = NOW - Math.floor(open ? random() ** 2 * 14 * 24 * HOUR : (20 + random() * 300) * 24 * HOUR);
    const length = assigneeId === null ? 1 : 1 + Math.floor(random() * 3);
    const bodies = [thread.opening, thread.reply, thread.followUp].slice(0, length);
    const contactName = String(contact.properties.name);
    const list: Message[] = bodies.map((body, position) => {
      const inbound = position % 2 === 0;
      return {
        id: `${id}_m${position + 1}`,
        conversationId: id,
        direction: inbound ? 'in' : 'out',
        fromName: inbound ? contactName : (rep?.name ?? 'The team'),
        fromEmail: inbound ? String(contact.properties.email) : (rep?.email ?? ''),
        body: inbound ? `Hi ${firstName(rep?.name ?? 'there')},\n\n${body}\n\n${firstName(contactName)}` : `Hi ${firstName(contactName)},\n\n${body}\n\nBest,\n${firstName(rep?.name ?? 'The team')}`,
        sentAt: new Date(last - (bodies.length - 1 - position) * (5 + Math.floor(random() * 40)) * HOUR).toISOString(),
      };
    });
    const latest = list[list.length - 1] as Message;
    messages.set(id, list);
    conversations.push({
      id,
      subject: `${thread.subject}: ${String(deal.properties.name).toLowerCase()}`,
      status: open ? 'open' : 'closed',
      assigneeId,
      contactId: contact.id,
      companyId: typeof deal.properties.company === 'string' ? deal.properties.company : null,
      dealId: deal.id,
      unread: open && latest.direction === 'in' && random() < 0.5,
      lastMessageAt: latest.sentAt,
      preview: latest.body.split('\n\n')[1]?.slice(0, 120) ?? '',
      messageCount: list.length,
    });
  }
  conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return { conversations, messages };
}

export function inbox(): Store {
  if (!store) store = build();
  return store;
}

function label(id: string | null): Reference | undefined {
  if (!id) return undefined;
  const record = dataset().byId.get(id);
  if (!record) return undefined;
  return { objectId: record.objectId, label: String(record.properties.name ?? id) };
}

function referencesFor(conversations: Conversation[]): Record<string, Reference> {
  const result: Record<string, Reference> = {};
  for (const conversation of conversations) {
    for (const id of [conversation.contactId, conversation.companyId, conversation.dealId]) {
      const found = label(id);
      if (id && found) result[id] = found;
    }
  }
  return result;
}

function inFolder(conversation: Conversation, folder: ConversationQuery['folder']): boolean {
  switch (folder) {
    case 'mine':
      return conversation.status === 'open' && conversation.assigneeId === session.userId;
    case 'unassigned':
      return conversation.status === 'open' && conversation.assigneeId === null;
    case 'open':
      return conversation.status === 'open';
    case 'closed':
      return conversation.status === 'closed';
  }
}

function find(id: string): Conversation {
  const conversation = inbox().conversations.find((item) => item.id === id);
  if (!conversation) throw new Error('That conversation no longer exists.');
  return conversation;
}

/** The team's saved emails. Used for replies in the inbox and for the email steps of sequences. */
/** One designed email, so the designer has something to show from the start. */
function welcomeEmail(): EmailTemplate {
  const design = (STARTERS.find((starter) => starter.id === 'announcement') ?? STARTERS[0])!.build();
  design.preheader = 'Here is what happens next, and who to ask.';
  const [header, hero, text, columns] = design.blocks;
  if (header?.kind === 'header') header.text = 'Northwind';
  if (hero?.kind === 'hero') Object.assign(hero, { heading: 'Welcome aboard, {{firstName}}', text: 'You are all set. Here is what happens over the next few days.', buttonLabel: 'Book your kickoff call', buttonUrl: 'https://example.com/kickoff' });
  if (text?.kind === 'text') text.text = 'Hi {{firstName}},\n\nThank you for choosing Northwind. I will be your contact from here on, so reply to this email whenever you need anything.';
  if (columns?.kind === 'columns') columns.items = [{ heading: 'Today', text: 'Your account is ready to sign in to.' }, { heading: 'This week', text: 'A 30 minute kickoff call to set things up together.' }, { heading: 'After that', text: 'A check-in once you have had a month with it.' }];
  return { id: 'tpl_welcome', name: 'Welcome a new customer', subject: 'Welcome to Northwind', body: renderEmailText(design), design };
}

export const emailTemplates: EmailTemplate[] = [
  { id: 'tpl_intro', name: 'Introduction', subject: 'A quick introduction', body: 'Hi {{firstName}},\n\nI look after new customers at Northwind. I saw you were interested in what we do, and wanted to introduce myself in case I can help.\n\nWould a short call this week be useful?\n\nBest,\n{{myName}}' },
  { id: 'tpl_thanks', name: 'Thanks, I am on it', subject: 'Thanks for your time', body: 'Hi {{firstName}},\n\nThanks for this. I am looking into it and will come back to you by the end of tomorrow.\n\nBest,\n{{myName}}' },
  { id: 'tpl_meeting', name: 'Offer a call', subject: 'Shall we talk it through?', body: 'Hi {{firstName}},\n\nIt might be quicker to talk this through. Do you have 20 minutes on Tuesday or Wednesday? Here is my calendar if it is easier to pick a time.\n\nBest,\n{{myName}}' },
  { id: 'tpl_pricing', name: 'Send pricing', subject: 'Pricing, as promised', body: 'Hi {{firstName}},\n\nI have attached the pricing we discussed. It includes onboarding and support, with no setup fee.\n\nLet me know if you would like me to walk your team through it.\n\nBest,\n{{myName}}' },
  { id: 'tpl_nudge', name: 'Gentle nudge', subject: 'Checking in', body: 'Hi {{firstName}},\n\nI wanted to check whether you had a chance to look at my last message. Happy to answer any questions, or to pick this up later if the timing is off.\n\nBest,\n{{myName}}' },
  welcomeEmail(),
];

let sequence = 0;

/** The inbox half of the mock API. `respond` adds latency; `logEmail` writes the sent email onto a record's timeline. */
export function createInboxApi(respond: <T>(compute: () => T) => Promise<T>, logEmail: (recordId: string, subject: string, body: string) => void, filesById: (id: string) => FileInfo | undefined = () => undefined): InboxApi {
  return {
    listConversations: (query) =>
      respond(() => {
        const needle = query.search?.trim().toLowerCase();
        const matching = inbox().conversations.filter((conversation) => {
          if (!inFolder(conversation, query.folder)) return false;
          if (!needle) return true;
          return conversation.subject.toLowerCase().includes(needle) || conversation.preview.toLowerCase().includes(needle) || (label(conversation.contactId)?.label.toLowerCase().includes(needle) ?? false);
        });
        matching.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
        const start = (query.page - 1) * query.pageSize;
        const conversations = matching.slice(start, start + query.pageSize);
        return { conversations, total: matching.length, references: referencesFor(conversations) };
      }),

    getConversation: (id) =>
      respond(() => {
        const conversation = find(id);
        return { conversation, messages: inbox().messages.get(id) ?? [], references: referencesFor([conversation]) };
      }),

    updateConversation: (input) =>
      respond(() => {
        const conversation = find(input.id);
        if (input.status !== undefined) conversation.status = input.status;
        if (input.assigneeId !== undefined) conversation.assigneeId = input.assigneeId;
        if (input.unread !== undefined) conversation.unread = input.unread;
        return conversation;
      }),

    sendReply: (input) =>
      respond(() => {
        const body = input.body.trim();
        if (!body) throw new Error('Write something before sending.');
        const conversation = find(input.conversationId);
        const me = users.find((user) => user.id === session.userId) ?? users[0];
        sequence += 1;
        const message: Message = {
          id: `${conversation.id}_new_${sequence}`,
          conversationId: conversation.id,
          direction: 'out',
          fromName: me?.name ?? 'You',
          fromEmail: me?.email ?? '',
          body,
          sentAt: new Date().toISOString(),
          ...(input.attachmentIds?.length ? { attachments: input.attachmentIds.flatMap((fileId) => { const file = filesById(fileId); return file ? [file] : []; }) } : {}),
          ...(input.sendAt ? { status: 'queued' as const, scheduledFor: input.sendAt } : {}),
        };
        const list = inbox().messages.get(conversation.id) ?? [];
        list.push(message);
        inbox().messages.set(conversation.id, list);
        conversation.lastMessageAt = message.sentAt;
        conversation.preview = body.replace(/\s+/g, ' ').slice(0, 120);
        conversation.messageCount = list.length;
        conversation.unread = false;
        // Replying to something in the shared queue takes it.
        if (conversation.assigneeId === null) conversation.assigneeId = session.userId;
        logEmail(conversation.contactId, conversation.subject, body);
        if (conversation.dealId) logEmail(conversation.dealId, conversation.subject, body);
        return message;
      }),

    cancelScheduledReply: (messageId) =>
      respond(() => {
        for (const [conversationId, list] of inbox().messages) {
          const index = list.findIndex((message) => message.id === messageId && message.scheduledFor);
          if (index < 0) continue;
          list.splice(index, 1);
          const conversation = find(conversationId);
          conversation.messageCount = list.length;
          conversation.preview = (list[list.length - 1]?.body ?? '').replace(/\s+/g, ' ').slice(0, 120);
          return;
        }
        throw new Error('That email has already been sent, or is being sent now.');
      }),

    listEmailTemplates: () => respond(() => emailTemplates),
    // The demo sends nothing, so there is nothing to report.
    getEmailReport: () => respond(() => ({ from: MOCK_NOW.slice(0, 10), sent: 0, delivered: 0, bounced: 0, complained: 0, failed: 0, automated: { sent: 0, delivered: 0, bounced: 0, complained: 0 }, days: [], problems: [] })),

    // The demo sends no email, so there is nobody to stop emailing.
    getEmailPreference: (email) => respond(() => ({ email, status: 'subscribed' as const, source: 'none' as const, reason: null, changedAt: null, consent: null, sentThisWeek: 0, weeklyLimit: 3 })),
    setEmailPreference: () => Promise.reject(new Error('Email preferences need the server. This is the demo, which runs in your browser.')),
    getEmailSettings: () => respond(() => ({ weeklyLimit: 3, postalAddress: '' })),
    saveEmailSettings: () => Promise.reject(new Error('Email settings need the server.')),
    getUnsubscribePage: () => Promise.reject(new Error('This link is not valid.')),
    unsubscribe: () => Promise.reject(new Error('This link is not valid.')),

    // The mock sends nothing, so nothing is ever waiting or failed.
    getEmailHealth: () => respond(() => ({ queued: 0, oldestQueuedSeconds: null, failedOutgoing: 0, waitingIncoming: 0, failedIncoming: 0, lastSweepAt: null })),

    inboxCounts: () =>
      respond(() => {
        const all = inbox().conversations;
        const mine = all.filter((conversation) => inFolder(conversation, 'mine'));
        return {
          mineUnread: mine.filter((conversation) => conversation.unread).length,
          mine: mine.length,
          unassigned: all.filter((conversation) => inFolder(conversation, 'unassigned')).length,
          open: all.filter((conversation) => inFolder(conversation, 'open')).length,
        };
      }),
  };
}
