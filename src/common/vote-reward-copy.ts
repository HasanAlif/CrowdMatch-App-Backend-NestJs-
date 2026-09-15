import {
  GATE_AGE_PREFERENCE,
  GATE_INTERESTED_IN_GENDERS,
  GATE_MAX_DISTANCE_KM,
  nextTargetVotes,
  ONE_TIME_GATE_LADDER,
  REWARD_BOOST_FIRST,
  REWARD_BOOST_SECOND,
  REWARD_EXTRA_MATCH,
  VOTE_CYCLE_LENGTH,
} from './vote-thresholds';

export type RewardKey =
  | 'interested_in_genders'
  | 'age_preference'
  | 'max_distance'
  | 'boost'
  | 'extra_match'
  | 'picture_update';

export interface NextReward {
  key: RewardKey;
  title: string;
  message: string;
  threshold: number;
  votesRemaining: number;
}

/** Both boost thresholds grant the same thing, so they share one key. */
export const REWARD_KEY_BY_THRESHOLD: Record<number, RewardKey> = {
  [GATE_INTERESTED_IN_GENDERS]: 'interested_in_genders',
  [GATE_AGE_PREFERENCE]: 'age_preference',
  [GATE_MAX_DISTANCE_KM]: 'max_distance',
  [REWARD_BOOST_FIRST]: 'boost',
  [REWARD_EXTRA_MATCH]: 'extra_match',
  [REWARD_BOOST_SECOND]: 'boost',
  [VOTE_CYCLE_LENGTH]: 'picture_update',
};

export const REWARD_TITLE: Record<RewardKey, string> = {
  interested_in_genders: 'Interested in',
  age_preference: 'Age range',
  max_distance: 'Distance range',
  boost: 'Profile boost',
  extra_match: 'Bonus match',
  picture_update: 'Photo update',
};

/** Noun phrases that read naturally after "to unlock". */
export const REWARD_UNLOCK: Record<RewardKey, string> = {
  interested_in_genders: 'the "Interested in" setting',
  age_preference: 'the age-range preference',
  max_distance: 'the distance preference',
  boost: 'a 1-hour profile boost',
  extra_match: 'a bonus match',
  picture_update: 'a 24-hour window to change your profile photo',
};

export function rewardMessage(key: RewardKey, votesRemaining: number): string {
  const unlock = REWARD_UNLOCK[key];

  if (votesRemaining <= 0) {
    return `You have unlocked ${unlock}.`;
  }

  return votesRemaining === 1
    ? `Just 1 more vote to unlock ${unlock}.`
    : `Cast ${votesRemaining} more votes to unlock ${unlock}.`;
}

export function nextReward(
  totalVotes: number,
  currentVotes: number,
): NextReward {
  const threshold = nextTargetVotes(totalVotes, currentVotes);
  const progress = ONE_TIME_GATE_LADDER.includes(threshold)
    ? totalVotes
    : currentVotes;

  const votesRemaining = Math.max(0, threshold - progress);
  const key = REWARD_KEY_BY_THRESHOLD[threshold] ?? 'picture_update';

  return {
    key,
    title: REWARD_TITLE[key],
    message: rewardMessage(key, votesRemaining),
    threshold,
    votesRemaining,
  };
}
