import { Target } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { ForecastRow } from '../contracts/sales';
import { cardTitle, compactCurrency, currency, figure, medium, small } from '../ui/styles';

type Totals = Omit<ForecastRow, 'userId'>;

function percent(part: number, whole: number): string {
  return whole === 0 ? '–' : `${Math.round((part / whole) * 100)}%`;
}

/** Won plus what the owner has committed to: the number a manager plans around. */
function expected(row: Totals): number {
  return row.won + row.commit;
}

/**
 * One bar against the goal: won, then commit, then best case, with a tick where today falls in the
 * quarter. If the solid part is short of the tick, the person is behind pace.
 */
function GoalBar({ row, elapsed }: { row: Totals; elapsed: number }) {
  const scale = Math.max(row.goal, row.won + row.commit + row.best, 1);
  const part = (value: number, background: string, label: string) =>
    value > 0 ? <span title={`${label}: ${currency(value)}`} style={{ inlineSize: `${(value / scale) * 100}%`, background }} /> : null;
  return (
    <div
      role="img"
      aria-label={`${currency(row.won)} won, ${currency(row.commit)} committed, ${currency(row.best)} best case, against a goal of ${currency(row.goal)}`}
      style={{ position: 'relative', minInlineSize: 160 }}
    >
      <div style={{ display: 'flex', blockSize: 8, borderRadius: 'var(--m-radius-full)', overflow: 'hidden', background: 'var(--m-color-bg-sunken)' }}>
        {part(row.won, 'var(--m-color-success-solid)', 'Won')}
        {part(row.commit, 'var(--m-color-accent-default)', 'Commit')}
        {part(row.best, 'color-mix(in oklab, var(--m-color-accent-default) 35%, transparent)', 'Best case')}
      </div>
      {row.goal > 0 ? (
        <span
          aria-hidden
          title="Where today falls in the quarter"
          style={{ position: 'absolute', insetBlock: -3, insetInlineStart: `${((row.goal * elapsed) / scale) * 100}%`, inlineSize: 2, background: 'var(--m-color-fg-default)', borderRadius: 1 }}
        />
      ) : null}
    </div>
  );
}

function Pace({ row, elapsed }: { row: Totals; elapsed: number }) {
  if (row.goal === 0) return <span style={small}>No goal</span>;
  if (row.won >= row.goal)
    return (
      <span className="m-badge" data-tone="success" data-variant="solid">
        Goal met
      </span>
    );
  if (expected(row) >= row.goal)
    return (
      <span className="m-badge" data-tone="success">
        On track
      </span>
    );
  if (row.won >= row.goal * elapsed || expected(row) + row.best >= row.goal)
    return (
      <span className="m-badge" data-tone="warning">
        Needs best case
      </span>
    );
  return (
    <span className="m-badge" data-tone="danger">
      Short by {compactCurrency(row.goal - expected(row) - row.best)}
    </span>
  );
}

function GoalInput({ row, name, onSaved }: { row: ForecastRow; name: string; onSaved: () => void }) {
  const [value, setValue] = useState(String(row.goal));
  const commit = async () => {
    const amount = Math.max(0, Math.round(Number(value) || 0));
    setValue(String(amount));
    if (amount === row.goal) return;
    await api.setGoal({ userId: row.userId, amount });
    onSaved();
  };
  return (
    <input
      className="m-input"
      data-size="sm"
      type="number"
      min={0}
      step={50000}
      aria-label={`Goal for ${name}`}
      value={value}
      style={{ inlineSize: 120, textAlign: 'end' }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export function Forecast() {
  const { users, access, revision } = useWorkspace();
  const forecast = useQuery(() => api.getForecast(), [revision]);
  const data = forecast.data;
  const rows = data?.rows ?? [];
  const team = rows.reduce<Totals>(
    (sum, row) => ({ goal: sum.goal + row.goal, won: sum.won + row.won, commit: sum.commit + row.commit, best: sum.best + row.best, pipeline: sum.pipeline + row.pipeline, openDeals: sum.openDeals + row.openDeals }),
    { goal: 0, won: 0, commit: 0, best: 0, pipeline: 0, openDeals: 0 },
  );
  const elapsed = data?.elapsed ?? 0;
  const gap = team.goal - expected(team);

  const figures: { label: string; value: string; hint: string }[] = [
    { label: 'Goal', value: compactCurrency(team.goal), hint: `${Math.round(elapsed * 100)}% of the quarter gone` },
    { label: 'Won', value: compactCurrency(team.won), hint: `${percent(team.won, team.goal)} of goal` },
    { label: 'Commit', value: compactCurrency(team.commit), hint: `Won + commit is ${percent(expected(team), team.goal)} of goal` },
    { label: 'Best case', value: compactCurrency(team.best), hint: 'Could land, not promised' },
    { label: 'Pipeline', value: compactCurrency(team.pipeline), hint: `${team.openDeals} open deals closing this quarter` },
  ];

  return (
    <Page icon={Target} crumbs={[{ label: 'Forecast' }]} wide>
      <div className="m-stack" data-gap="4">
        <header>
          <h1 style={{ margin: 0, fontSize: 'var(--m-font-size-xl)' }}>{data ? `${data.period} forecast` : 'Forecast'}</h1>
          {data ? (
            <p style={{ ...small, margin: 'var(--m-space-1) 0 0' }}>
              {team.goal === 0
                ? 'No goals are set yet.'
                : gap <= 0
                  ? `Won and committed deals cover the goal with ${currency(-gap)} to spare.`
                  : `Won and committed deals leave ${currency(gap)} to find. Best case holds ${currency(team.best)}${team.best >= gap ? ', enough to close it.' : ', which does not close it.'}`}
            </p>
          ) : null}
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--m-space-3)' }}>
          {figures.map((item) => (
            <section key={item.label} className="m-card" aria-label={item.label}>
              <h2 style={cardTitle}>{item.label}</h2>
              <p style={{ ...figure, margin: 'var(--m-space-1) 0' }}>{data ? item.value : '…'}</p>
              <p style={{ ...small, margin: 0 }}>{data ? item.hint : ''}</p>
            </section>
          ))}
        </div>

        {data ? (
          <section className="m-card" aria-label="Team progress" style={{ padding: 'var(--m-space-3) var(--m-space-4)' }}>
            <div className="m-cluster" data-justify="between" style={{ marginBlockEnd: 'var(--m-space-2)' }}>
              <h2 style={cardTitle}>Team against goal</h2>
              <Pace row={team} elapsed={elapsed} />
            </div>
            <GoalBar row={team} elapsed={elapsed} />
            <p style={{ ...small, margin: 'var(--m-space-2) 0 0' }}>Solid is won, then commit, then best case. The tick is where today falls in the quarter.</p>
          </section>
        ) : null}

        <div className="m-table-wrap">
          <table className="m-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col" data-numeric="">
                  Goal
                </th>
                <th scope="col" data-numeric="">
                  Won
                </th>
                <th scope="col" data-numeric="">
                  Commit
                </th>
                <th scope="col" data-numeric="">
                  Best case
                </th>
                <th scope="col" data-numeric="">
                  Pipeline
                </th>
                <th scope="col" style={{ inlineSize: '22%' }}>
                  Against goal
                </th>
                <th scope="col">Standing</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = users.find((user) => user.id === row.userId)?.name ?? 'Unknown';
                return (
                  <tr key={row.userId}>
                    <td style={medium}>
                      {name}
                      <div style={{ ...small, fontWeight: 'normal' }}>
                        {row.openDeals} open {row.openDeals === 1 ? 'deal' : 'deals'}
                      </div>
                    </td>
                    <td data-numeric="">{access.managePeople ? <GoalInput row={row} name={name} onSaved={forecast.reload} /> : row.goal > 0 ? currency(row.goal) : '–'}</td>
                    <td data-numeric="">
                      {currency(row.won)}
                      <div style={small}>{percent(row.won, row.goal)}</div>
                    </td>
                    <td data-numeric="">{currency(row.commit)}</td>
                    <td data-numeric="">{currency(row.best)}</td>
                    <td data-numeric="">{currency(row.pipeline)}</td>
                    <td>
                      <GoalBar row={row} elapsed={elapsed} />
                    </td>
                    <td>
                      <Pace row={row} elapsed={elapsed} />
                    </td>
                  </tr>
                );
              })}
              {data && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...small, textAlign: 'center', padding: 'var(--m-space-6)' } as CSSProperties}>
                    No deals close this quarter that you can see.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p style={{ ...small, margin: 0 }}>Each deal's forecast category is set on the deal. Deals marked Omitted are left out.</p>
      </div>
    </Page>
  );
}
