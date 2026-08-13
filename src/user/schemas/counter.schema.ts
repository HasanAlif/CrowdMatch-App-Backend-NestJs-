import { Schema } from 'mongoose';

export interface ICounter {
  _id: string;
  seq: number;
}

export const CounterSchema = new Schema<ICounter>({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

export const COUNTER_MODEL_NAME = 'Counter';
