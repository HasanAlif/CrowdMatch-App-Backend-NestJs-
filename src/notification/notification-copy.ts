import {
  GATE_AGE_PREFERENCE,
  GATE_INTERESTED_IN_GENDERS,
  GATE_MAX_DISTANCE_KM,
  REWARD_BOOST_FIRST,
  REWARD_BOOST_SECOND,
  VOTE_CYCLE_LENGTH,
} from '../common/vote-thresholds';

export interface PartnerSource {
  fullName?: string;
  picture?: string;
  photos?: { url?: string }[];
}

export interface PartnerRef {
  matchId: string;
  userId: string;
  fullName: string;
  picture: string | null;
}

export const UNKNOWN_PARTNER_NAME = 'Someone';

export function partnerPicture(
  user: PartnerSource | null | undefined,
): string | null {
  return user?.photos?.[0]?.url ?? user?.picture ?? null;
}

export function partnerName(user: PartnerSource | null | undefined): string {
  return user?.fullName ?? UNKNOWN_PARTNER_NAME;
}

export type MilestoneKey =
  | 'interested_in_genders'
  | 'age_preference'
  | 'max_distance'
  | 'boost_started'
  | 'picture_update';

export interface Milestone {
  key: MilestoneKey;
  threshold: number;
}

export function resolveMilestone(
  newTotal: number,
  newCurrent: number,
): Milestone | null {
  switch (newTotal) {
    case GATE_INTERESTED_IN_GENDERS:
      return { key: 'interested_in_genders', threshold: newTotal };
    case GATE_AGE_PREFERENCE:
      return { key: 'age_preference', threshold: newTotal };
    case GATE_MAX_DISTANCE_KM:
      return { key: 'max_distance', threshold: newTotal };
  }

  switch (newCurrent) {
    case REWARD_BOOST_FIRST:
    case REWARD_BOOST_SECOND:
      return { key: 'boost_started', threshold: newCurrent };
    case VOTE_CYCLE_LENGTH:
      return { key: 'picture_update', threshold: newCurrent };
  }

  return null;
}

export interface Copy {
  title: string;
  body: string;
}

export const MILESTONE_COPY: Record<MilestoneKey, Copy> = {
  interested_in_genders: {
    title: 'New setting unlocked',
    body: "You can now choose who you're interested in.",
  },
  age_preference: {
    title: 'Age range unlocked',
    body: "Set the age range you'd like to match with.",
  },
  max_distance: {
    title: 'Distance unlocked',
    body: 'Choose how far away your matches can be.',
  },
  boost_started: {
    title: "You're boosted!",
    body: 'Your profile is featured for the next hour.',
  },
  picture_update: {
    title: 'Photo update unlocked',
    body: 'You can change your profile photo — you have 24 hours.',
  },
};

export const BOOST_ENDED_COPY: Copy = {
  title: 'Boost finished',
  body: 'Your hour in the spotlight is up — keep voting to earn another.',
};

export function newMatchCopy(count: number): Copy {
  return count === 1
    ? {
        title: 'You have a new match!',
        body: 'You have 1 new match waiting for you.',
      }
    : {
        title: 'You have new matches!',
        body: `You have ${count} new matches waiting for you.`,
      };
}

export function matchAcceptedCopy(name: string): Copy {
  return {
    title: 'Match accepted!',
    body: `${name} accepted the match with you.`,
  };
}

export const DAILY_REMINDER_TITLE = 'Your daily activity';
export const DAILY_REMINDER_FALLBACK_BODY = 'Here is your daily update.';

export function dailyVotesLine(votes: number): string {
  return `You cast ${votes} vote${votes === 1 ? '' : 's'} today.`;
}

export function dailySentimentLine(positivePercent: number): string {
  return (
    `Your matches are at ${positivePercent}% positive and ` +
    `${100 - positivePercent}% negative.`
  );
}
