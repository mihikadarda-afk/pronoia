import type { Plan } from './types';

export interface PlanInfo {
  id: Plan;
  name: string;
  price: string;
  priceYearly?: string;
  short: string;
  /** What happens with video on this plan, in one line. */
  video: string;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    short: 'Reminders and taps, no camera',
    video: 'No camera and no video. The parent taps I took it.',
    features: [
      'Dose reminders on the parent’s phone, with a photo of the right pill',
      'The parent taps I took it',
      'Daily check-ins with one tap',
      'A simple log for you',
    ],
  },
  {
    id: 'phone',
    name: 'Phone',
    price: '$9 a month',
    priceYearly: '$79 a year',
    short: 'An old phone films each dose',
    video: 'An old phone on a stand films a short video at each dose. AI checks it was taken.',
    features: [
      'Everything in Free',
      'An old phone by the pill box becomes a dose station',
      'It films a 12-second video at each dose, and AI checks the pill was taken',
      'WhatsApp alerts with the time and a confidence score',
      'Missed check-ins alert the refiller, then you',
    ],
  },
  {
    id: 'device',
    name: 'Device',
    price: '$299 once + $15 a month',
    short: 'The Pronoia dispenser films and uploads each dose',
    video: 'The dispenser’s own camera films each dose and uploads the video. AI checks it was taken.',
    features: [
      'Everything in Phone, without the old phone',
      '5 slots that give out only the right pill',
      'Its camera films each dose and uploads the video for the AI check',
      'Weight sensors count pills, so refill reminders go out 1 to 2 weeks ahead',
      'A physical I’m okay button, and replacement for defects',
    ],
  },
];

export const planInfo = (p: Plan) => PLANS.find((x) => x.id === p)!;

export const planRank: Record<Plan, number> = { free: 0, phone: 1, device: 2 };

/** Does `current` include what `needed` offers? */
export const hasPlan = (current: Plan, needed: Plan) => planRank[current] >= planRank[needed];
