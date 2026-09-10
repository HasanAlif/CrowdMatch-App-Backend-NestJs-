import { Types } from 'mongoose';

export function normalisePair(
  a: Types.ObjectId,
  b: Types.ObjectId,
): [Types.ObjectId, Types.ObjectId] {
  return a.toString() < b.toString() ? [a, b] : [b, a];
}

export function pairKey(a: Types.ObjectId, b: Types.ObjectId): string {
  const [first, second] = normalisePair(a, b);
  return `${first.toString()}:${second.toString()}`;
}
