import { Types } from 'mongoose';

export function normalisePair(
  a: Types.ObjectId,
  b: Types.ObjectId,
): [Types.ObjectId, Types.ObjectId] {
  return a.toString() < b.toString() ? [a, b] : [b, a];
}
