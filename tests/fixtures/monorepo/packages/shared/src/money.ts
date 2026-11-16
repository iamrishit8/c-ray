import type { Money } from './types';

export function zeroMoney(currency: string): Money {
  return { cents: 0, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error('currency mismatch');
  }
  return { cents: a.cents + b.cents, currency: a.currency };
}

export function formatMoney(amount: Money): string {
  const value = (amount.cents / 100).toFixed(2);
  return `${value} ${amount.currency}`;
}

export function legacyRound(cents: number): number {
  return Math.round(cents / 5) * 5;
}
