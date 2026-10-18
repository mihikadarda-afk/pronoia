import type { Plan } from './types';

export interface PlanInfo {
  id: Plan;
  name: string;
  price: string;
  priceYearly?: string;
  short: string;
  features: string[];
}

export const PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    short: 'Reminders and taps',
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
    short: 'An old phone becomes a dose station',
    features: [
      'Everything in Free',
      'Dose station on an old phone next to the pill box',
      'Camera turns on at dose time and an AI check sees the pill taken',
      'WhatsApp alerts with the time and a confidence score',
      'Missed check-ins alert the refiller, then you',
    ],
  },
  {
    id: 'device',
    name: 'Device',
    price: '$199 once + $15 a month',
    short: 'The Pronoia dispenser',
    features: [
      'Everything in Phone',
      '5 slots that give out only the right pill',
      'Weight sensors, built-in camera and an I’m okay button',
      'Pill counts and refill reminders 1 to 2 weeks ahead',
      'Replacement for defects',
    ],
  },
];

export const planInfo = (p: Plan) => PLANS.find((x) => x.id === p)!;

export const planRank: Record<Plan, number> = { free: 0, phone: 1, device: 2 };

/** Does `current` include what `needed` offers? */
export const hasPlan = (current: Plan, needed: Plan) => planRank[current] >= planRank[needed];
