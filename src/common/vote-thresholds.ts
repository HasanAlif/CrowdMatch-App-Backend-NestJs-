export const GATE_INTERESTED_IN_GENDERS = 7;
export const GATE_AGE_PREFERENCE = 10;
export const GATE_MAX_DISTANCE_KM = 30;

export const REWARD_BOOST_FIRST = 50;
export const REWARD_EXTRA_MATCH = 80;
export const REWARD_BOOST_SECOND = 100;
export const VOTE_CYCLE_LENGTH = 200;

export const BOOST_DURATION_MS = 60 * 60 * 1000;
export const PICTURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export const BOOST_THRESHOLDS: number[] = [
  REWARD_BOOST_FIRST,
  REWARD_BOOST_SECOND,
];

export function votesUntilPictureUpdate(currentVotes: number): number {
  return VOTE_CYCLE_LENGTH - currentVotes;
}

export const ONE_TIME_GATE_LADDER: number[] = [
  GATE_INTERESTED_IN_GENDERS,
  GATE_AGE_PREFERENCE,
  GATE_MAX_DISTANCE_KM,
];

export const CYCLE_REWARD_LADDER: number[] = [
  REWARD_BOOST_FIRST,
  REWARD_EXTRA_MATCH,
  REWARD_BOOST_SECOND,
  VOTE_CYCLE_LENGTH,
];

/**
 * On the FIRST pass the ladder is 7 → 10 → 30 → 50 → 80 → 100 → 200. Once the
 * one-time gates are earned they drop out permanently, so every later cycle runs
 * 50 → 80 → 100 → 200 and restarts.
 */
export function nextTargetVotes(
  totalVotes: number,
  currentVotes: number,
): number {
  for (const gate of ONE_TIME_GATE_LADDER) {
    if (totalVotes < gate) return gate;
  }

  for (const reward of CYCLE_REWARD_LADDER) {
    if (currentVotes < reward) return reward;
  }

  return VOTE_CYCLE_LENGTH;
}
