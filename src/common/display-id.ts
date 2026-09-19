import { Types } from 'mongoose';

export function displayIdFor(
  prefix: string,
  id: Types.ObjectId | string,
): string {
  return `${prefix}-${id.toString().slice(-4).toUpperCase()}`;
}

export function matchDisplayId(id: Types.ObjectId | string): string {
  return displayIdFor('MCH', id);
}

export function voteDisplayId(id: Types.ObjectId | string): string {
  return displayIdFor('VT', id);
}
