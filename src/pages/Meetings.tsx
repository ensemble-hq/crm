import { CalendarDays, Check, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, type FormEvent, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { BookingPage, BookingPageSettings } from '../contracts/capture';
import { myTimeZone, timeZones, zoneName, zonedParts } from '../lib/zones';
import { Modal } from '../ui/Modal';
import { UserChip } from '../ui/PropertyValue';
import { ICON, cardTitle, figure, medium, plainList, rowDivider, small } from '../ui/styles';
import { PublicPage } from './Forms';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

function hour(value: number): string {
  return `${value % 12 === 0 ? 12 : value % 12}:00 ${value < 12 || value === 24 ? 'am' : 'pm'}`;
}

/** "10:30" as "10:30 am". */
function clock(time: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`;
}

function describeDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const run = sorted.every((day, index) => index === 0 || day === (sorted[index - 1] ?? 0) + 1);
  if (run && sorted.length > 2) return `${WEEKDAYS[(sorted[0] ?? 1) - 1]} to ${WEEKDAYS[(sorted[sorted.length - 1] ?? 1) - 1]}`;
  return sorted.map((day) => WEEKDAYS[day - 1]?.slice(0, 3)).join(', ');
}

/** Create a booking page, or change one: who, how long, and when. */
function BookingPageDialog({ page, onClose, onSaved }: { page: BookingPage | 'new'; onClose: () => void; onSaved: () => void }) {
  const { users, currentUser } = useWorkspace();
  const existing = page === 'new' ? undefined : page;
  const [draft, setDraft] = useState<BookingPageSettings>({
    name: existing?.name ?? '',
    hostIds: existing?.hostIds ?? [currentUser.id],
    durationMinutes: existing?.durationMinutes ?? 30,
    days: existing?.days ?? [1, 2, 3, 4, 5],
    fromHour: existing?.fromHour ?? 9,
    toHour: existing?.toHour ?? 17,
    timeZone: existing?.timeZone ?? myTimeZone(),
    attendance: existing?.attendance ?? 'turn',
  });
  const zones = useMemo(() => timeZones(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (changes: Partial<BookingPageSettings>) => setDraft((previous) => ({ ...previous, ...changes }));
  const toggle = (list: number[], value: number, on: boolean) => (on ? [...list, value] : list.filter((item) => item !== value));

  async function save() {
    if (draft.hostIds.length === 0 || draft.days.length === 0) {
      setError('Choose at least one person and one day.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.saveBookingPage({ ...draft, id: existing?.id });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The booking page could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={existing ? `Edit "${existing.name}"` : 'New booking page'} submitLabel={existing ? 'Save' : 'Create booking page'} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="booking-name">
          Name
        </label>
        <input className="m-input" id="booking-name" placeholder="30-minute intro call" value={draft.name} onChange={(event) => set({ name: event.target.value })} required />
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="booking-duration">
          Length
        </label>
        <select className="m-select" id="booking-duration" value={draft.durationMinutes} onChange={(event) => set({ durationMinutes: Number(event.target.value) })}>
          {[15, 30, 45, 60, 90].map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </div>
      <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-field-label">Who can be booked</legend>
        <div className="m-cluster" data-gap="3">
          {users.map((user) => (
            <label key={user.id} className="m-field" data-layout="inline">
              <input className="m-checkbox" type="checkbox" checked={draft.hostIds.includes(user.id)} onChange={(event) => set({ hostIds: event.target.checked ? [...draft.hostIds, user.id] : draft.hostIds.filter((id) => id !== user.id) })} />
              {user.name.split(' ')[0]}
            </label>
          ))}
        </div>
        {draft.hostIds.length > 1 ? (
          <div className="m-stack" data-gap="1" role="radiogroup" aria-label="Who takes each booking">
            <label className="m-field" data-layout="inline">
              <input className="m-radio" type="radio" name="booking-attendance" checked={draft.attendance === 'turn'} onChange={() => set({ attendance: 'turn' })} />
              They take turns: each booking goes to whoever is free and next
            </label>
            <label className="m-field" data-layout="inline">
              <input className="m-radio" type="radio" name="booking-attendance" checked={draft.attendance === 'all'} onChange={() => set({ attendance: 'all' })} />
              Everyone attends: only times when all of them are free are offered
            </label>
          </div>
        ) : null}
      </fieldset>
      <fieldset className="m-stack" data-gap="1" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-field-label">Days</legend>
        <div className="m-cluster" data-gap="3">
          {WEEKDAYS.map((name, index) => (
            <label key={name} className="m-field" data-layout="inline">
              <input className="m-checkbox" type="checkbox" checked={draft.days.includes(index + 1)} onChange={(event) => set({ days: toggle(draft.days, index + 1, event.target.checked) })} />
              {name.slice(0, 3)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="m-cluster" data-gap="3">
        <div className="m-field">
          <label className="m-field-label" htmlFor="booking-from">
            From
          </label>
          <select className="m-select" id="booking-from" value={draft.fromHour} onChange={(event) => set({ fromHour: Number(event.target.value) })}>
            {Array.from({ length: 16 }, (_, index) => index + 6).map((value) => (
              <option key={value} value={value}>
                {hour(value)}
              </option>
            ))}
          </select>
        </div>
        <div className="m-field">
          <label className="m-field-label" htmlFor="booking-to">
            Until
          </label>
          <select className="m-select" id="booking-to" value={draft.toHour} onChange={(event) => set({ toHour: Number(event.target.value) })}>
            {Array.from({ length: 16 }, (_, index) => index + 7).map((value) => (
              <option key={value} value={value}>
                {hour(value)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="m-field">
        <label className="m-field-label" htmlFor="booking-zone">
          Those hours are in
        </label>
        <select className="m-select" id="booking-zone" value={draft.timeZone} onChange={(event) => set({ timeZone: event.target.value })}>
          {(zones.includes(draft.timeZone) ? zones : [draft.timeZone, ...zones]).map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <p className="m-field-hint">People booking see the times on their own clock, wherever they are.</p>
      </div>
    </Modal>
  );
}

/** Booking pages people can use to get time with the team, and the meetings booked through them. */
export function Meetings() {
  const workspace = useWorkspace();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<BookingPage | 'new'>();
  const pages = useQuery(() => api.listBookingPages(), [version, workspace.revision]);
  const meetings = useQuery(() => api.listMeetings(), [version, workspace.revision]);

  async function remove(page: BookingPage) {
    await api.deleteBookingPage(page.id);
    setVersion((value) => value + 1);
  }

  return (
    <Page
      icon={CalendarDays}
      crumbs={[{ label: 'Meetings' }]}
      actions={
        <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setEditing('new')}>
          <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Booking page
        </button>
      }
    >
      <div className="m-stack" data-gap="5">
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Meetings</h1>
          <p style={{ color: 'var(--m-color-fg-muted)', margin: 0 }}>Links people use to book time with you. A booking creates the contact if they are new, and logs the meeting on their record.</p>
        </div>

        <section className="m-card" aria-label="Booking pages" style={{ padding: 0, overflow: 'hidden' }}>
          <ul style={plainList}>
            {(pages.data ?? []).map((page, index) => (
              <li key={page.id} className="m-cluster" data-gap="4" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                <div className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                  <span style={medium}>{page.name}</span>
                  <span style={small}>
                    {page.durationMinutes} minutes · {describeDays(page.days)}, {hour(page.fromHour)} to {hour(page.toHour)} {zoneName(page.timeZone)} time ·{' '}
                    {page.hostIds.length === 1 ? (workspace.user(page.hostIds[0])?.name ?? 'One person') : `${page.hostIds.length} people, ${page.attendance === 'all' ? 'all together' : 'in turn'}`}
                  </span>
                </div>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{page.booked} booked</span>
                <a href={`/book/${page.id}`} target="_blank" rel="noreferrer" className="m-button" data-variant="ghost" data-size="sm">
                  <ExternalLink size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Open
                </a>
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Edit ${page.name}`} onClick={() => setEditing(page)}>
                  <Pencil size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                </button>
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Delete ${page.name}`} onClick={() => void remove(page)}>
                  <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="m-card" aria-label="Upcoming meetings">
          <div className="m-card-body m-stack" data-gap="1">
            <h2 style={cardTitle}>Upcoming</h2>
            {meetings.data && meetings.data.meetings.length === 0 ? <p style={{ ...small, margin: 0 }}>Nothing is booked.</p> : null}
            <ul className="m-stack" data-gap="0" style={plainList}>
              {(meetings.data?.meetings ?? []).slice(0, 14).map((meeting, index) => {
                // Shown on the reader's own clock.
                const { date, time } = zonedParts(meeting.startsAt, myTimeZone());
                return (
                  <li key={meeting.id} className="m-cluster" data-gap="4" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
                    <span style={{ inlineSize: 168, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {dayFormat.format(new Date(`${date}T00:00:00Z`))}, {clock(time)}
                    </span>
                    <div className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0 }}>
                      <Link to={`/contacts/${meeting.contactId}`} style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                        {meetings.data?.references[meeting.contactId]?.label ?? 'A contact'}
                      </Link>
                      <span style={small}>
                        {pages.data?.find((page) => page.id === meeting.bookingPageId)?.name ?? 'A meeting'} · {meeting.durationMinutes} minutes
                      </span>
                    </div>
                    <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap' }}>
                      {[meeting.hostId, ...meeting.otherHostIds].map((userId) => (
                        <UserChip key={userId} userId={userId} />
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
        <p style={{ ...small, margin: 0 }}>Mock: free times ignore real calendars, and no invitations are sent. Calendar sync comes with Gmail and Outlook.</p>
      </div>
      {editing ? (
        <BookingPageDialog
          key={editing === 'new' ? 'new' : editing.id}
          page={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setVersion((value) => value + 1);
          }}
        />
      ) : null}
    </Page>
  );
}

/** The public page someone books on: `/book/<id>`. Pick a day, pick a time, say who you are. */
export function PublicBooking() {
  const { pageId = '' } = useParams();
  const [version, setVersion] = useState(0);
  const slots = useQuery(() => api.listSlots(pageId), [pageId, version]);
  const [date, setDate] = useState<string>();
  const [time, setTime] = useState<string>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [booked, setBooked] = useState<{ date: string; time: string }>();

  const page = slots.data?.page;
  const zone = useMemo(() => myTimeZone(), []);
  // The page's times are instants; here they are sorted into days on the visitor's own clock.
  const days = useMemo(() => {
    const byDate = new Map<string, Array<{ time: string; start: string }>>();
    for (const start of (slots.data?.days ?? []).flatMap((day) => day.starts)) {
      const local = zonedParts(start, zone);
      byDate.set(local.date, [...(byDate.get(local.date) ?? []), { time: local.time, start }]);
    }
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, times]) => ({ date, times: times.sort((a, b) => a.start.localeCompare(b.start)) }));
  }, [slots.data, zone]);
  const chosenDay = days.find((day) => day.date === date) ?? days[0];

  async function book(event: FormEvent) {
    event.preventDefault();
    if (!chosenDay || !time) return;
    setBusy(true);
    setError(undefined);
    try {
      const start = chosenDay.times.find((slot) => slot.time === time)?.start;
      if (!start) return;
      await api.bookMeeting({ bookingPageId: pageId, startsAt: start, name, email });
      setBooked({ date: chosenDay.date, time });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The booking did not go through. Please try again.');
      setVersion((value) => value + 1);
      setTime(undefined);
    } finally {
      setBusy(false);
    }
  }

  if (slots.error) {
    return (
      <PublicPage>
        <p style={{ margin: 0 }}>{/not found/i.test(slots.error.message) ? 'This booking page is no longer available.' : `This booking page could not be loaded. ${slots.error.message}`}</p>
      </PublicPage>
    );
  }
  if (!page) {
    return (
      <PublicPage>
        <span className="m-spinner" role="status" aria-label="Loading times" />
      </PublicPage>
    );
  }
  if (booked) {
    return (
      <PublicPage>
        <span style={{ display: 'grid', placeItems: 'center', inlineSize: 40, blockSize: 40, borderRadius: 'var(--m-radius-full)', background: 'var(--m-color-success-bg)', color: 'var(--m-color-success-fg)' }}>
          <Check size={20} strokeWidth={ICON.strokeWidth} aria-hidden />
        </span>
        <div className="m-stack" data-gap="1">
          <h1 style={{ fontSize: 'var(--m-font-size-xl)', fontWeight: 'var(--m-font-weight-medium)', margin: 0 }}>You are booked</h1>
          <p style={{ margin: 0 }}>
            {page.name}, {longDayFormat.format(new Date(`${booked.date}T00:00:00Z`))} at {clock(booked.time)} ({zoneName(zone)} time).
          </p>
          <p style={{ ...small, margin: 0 }}>In the finished product a calendar invitation would be on its way to {email}.</p>
        </div>
      </PublicPage>
    );
  }

  return (
    <PublicPage>
      <div className="m-stack" data-gap="1">
        <h1 style={{ fontSize: 'var(--m-font-size-xl)', fontWeight: 'var(--m-font-weight-medium)', margin: 0 }}>{page.name}</h1>
        <span style={small}>
          {page.durationMinutes} minutes{page.attendance === 'all' && page.hostIds.length > 1 ? ` with ${page.hostIds.length} of the team` : ''} · times shown for {zoneName(zone)}
        </span>
      </div>
      {days.length === 0 ? <p style={{ margin: 0 }}>There are no free times in the coming weeks.</p> : null}
      <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="m-field-label">Day</legend>
        <div className="m-cluster" data-gap="1">
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              className="m-button"
              data-size="sm"
              data-variant={day.date === chosenDay?.date ? 'primary' : undefined}
              aria-pressed={day.date === chosenDay?.date}
              onClick={() => {
                setDate(day.date);
                setTime(undefined);
              }}
            >
              {dayFormat.format(new Date(`${day.date}T00:00:00Z`))}
            </button>
          ))}
        </div>
      </fieldset>
      {chosenDay ? (
        <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="m-field-label">Time</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 'var(--m-space-1)' } as CSSProperties}>
            {chosenDay.times.map((slot) => (
              <button key={slot.start} type="button" className="m-button" data-size="sm" data-variant={slot.time === time ? 'primary' : undefined} aria-pressed={slot.time === time} onClick={() => setTime(slot.time)}>
                {clock(slot.time)}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {time ? (
        <form className="m-stack" data-gap="3" onSubmit={book}>
          <div className="m-field">
            <label className="m-field-label" htmlFor="booking-your-name">
              Your name
            </label>
            <input className="m-input" id="booking-your-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="m-field">
            <label className="m-field-label" htmlFor="booking-your-email">
              Email
            </label>
            <input className="m-input" id="booking-your-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </div>
          {error ? (
            <p className="m-field-error" role="alert" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
          <button type="submit" className="m-button" data-variant="primary" disabled={busy}>
            {busy ? 'Booking…' : `Book ${chosenDay ? dayFormat.format(new Date(`${chosenDay.date}T00:00:00Z`)) : ''} at ${clock(time)}`}
          </button>
        </form>
      ) : error ? (
        <p className="m-field-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </PublicPage>
  );
}
