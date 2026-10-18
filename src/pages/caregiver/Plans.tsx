import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar, Placeholder, Says, SectionHead, useToast } from '../../components/ui';
import { fmtDate } from '../../lib/time';
import { deviceService } from '../../services/deviceService';
import { PLANS, planInfo, planRank } from '../../services/plans';
import { useAppState, usePeople } from '../../services/useApp';
import type { Billing, Plan } from '../../services/types';

const FEATURES: { label: string; on: Plan[] }[] = [
  { label: 'Reminders with the pill’s photo', on: ['free', 'phone', 'device'] },
  { label: 'Parent taps I took it', on: ['free', 'phone', 'device'] },
  { label: 'Daily check-ins and a log', on: ['free', 'phone', 'device'] },
  { label: 'Video of each dose, checked by AI', on: ['phone', 'device'] },
  { label: 'Filmed by an old phone on a stand', on: ['phone'] },
  { label: 'Filmed and uploaded by the dispenser', on: ['device'] },
  { label: 'Notifications with a confidence score', on: ['phone', 'device'] },
  { label: 'Missed check-ins alert you', on: ['phone', 'device'] },
  { label: 'Gives out only the right pill', on: ['device'] },
  { label: 'Pill counts and early refill reminders', on: ['device'] },
];

export function priceFor(p: Plan, billing: Billing) {
  return p === 'phone' && billing === 'yearly' ? planInfo(p).priceYearly! : planInfo(p).price;
}

/** The three plans side by side. Also used in onboarding. */
export function PlanPicker({ value, billing, onPick, onBilling }: { value: Plan; billing: Billing; onPick: (p: Plan) => void; onBilling: (b: Billing) => void }) {
  return (
    <>
      <div className="row-between" style={{ margin: '4px 0 10px' }}>
        <span className="small muted">Phone plan billing</span>
        <span className="segmented" role="group" aria-label="Billing">
          <button aria-pressed={billing === 'monthly'} onClick={() => onBilling('monthly')}>
            Monthly
          </button>
          <button aria-pressed={billing === 'yearly'} onClick={() => onBilling('yearly')}>
            Yearly, save 27%
          </button>
        </span>
      </div>
      <div className="plans" role="radiogroup" aria-label="Plans">
        {PLANS.map((p) => (
          <button key={p.id} className="plan" role="radio" aria-checked={value === p.id} aria-pressed={value === p.id} onClick={() => onPick(p.id)}>
            <div className="row-between">
              <strong>{p.name}</strong>
              <span className="plan-price">{priceFor(p.id, billing)}</span>
            </div>
            <div className="small muted">{p.short}</div>
            <div className="small" style={{ marginTop: 6 }}>{p.video}</div>
            <ul>
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </>
  );
}

export function Plans() {
  const s = useAppState();
  const toast = useToast();
  const nav = useNavigate();
  const { parent } = usePeople();
  const current = s.plan.tier;
  const [billing, setBilling] = useState<Billing>(s.plan.billing);
  const [pick, setPick] = useState<Plan>(current === 'device' ? 'device' : current === 'phone' ? 'device' : 'phone');
  const nextBill = new Date(s.plan.since + Math.ceil((deviceService.now().getTime() - s.plan.since) / (30 * 86_400_000)) * 30 * 86_400_000);
  const changing = pick !== current || (pick === 'phone' && billing !== s.plan.billing);
  const up = planRank[pick] > planRank[current];

  return (
    <main className="screen">
      <AppBar title="Plans" back />
      <Says mood="happy" size={40}>
        You’re on {planInfo(current).name}. {current === 'free' ? `The Phone plan turns an old phone into a dose station for ${parent.name}.` : 'Change any time.'}
      </Says>

      <SectionHead title="Compare" />
      <table className="compare">
        <thead>
          <tr>
            <th />
            {PLANS.map((p) => (
              <th key={p.id} className={p.id === current ? 'current' : undefined}>
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f.label}>
              <td>{f.label}</td>
              {PLANS.map((p) => (
                <td key={p.id} className={`${f.on.includes(p.id) ? 'yes' : 'no'}${p.id === current ? ' current' : ''}`}>
                  {f.on.includes(p.id) ? '✓' : '–'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <SectionHead title="Choose" />
      <PlanPicker value={pick} billing={billing} onPick={setPick} onBilling={setBilling} />
      <button
        className="btn btn--block"
        style={{ marginTop: 14 }}
        disabled={!changing}
        onClick={() => {
          deviceService.setPlan(pick, billing);
          toast(pick === current ? 'Billing updated' : `You’re on ${planInfo(pick).name} now`);
          if (up && pick === 'device' && !s.device.paired) nav('/care/station');
          else if (up && pick === 'phone') nav('/care/station');
        }}
      >
        {!changing ? `${planInfo(current).name} is your plan` : up ? `Upgrade to ${planInfo(pick).name}` : pick === current ? 'Switch billing' : `Switch to ${planInfo(pick).name}`}
      </button>

      <SectionHead title="Billing" />
      <ul className="list">
        <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
          <span>{planInfo(current).name}</span>
          <span className="num">{current === 'free' ? 'Free' : priceFor(current, s.plan.billing)}</span>
        </li>
        {current !== 'free' && (
          <>
            <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
              <span>Next payment</span>
              <span className="num">{fmtDate(nextBill, 'UTC')}</span>
            </li>
            <li className="lrow lrow--simple" style={{ cursor: 'default' }}>
              <span>Card</span>
              <span className="num">Visa ending 4242</span>
            </li>
          </>
        )}
      </ul>
      <Placeholder>Payments are mocked. Nothing is charged.</Placeholder>
    </main>
  );
}
