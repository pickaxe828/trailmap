/** Spaced-repetition review is opt-in (PLAN §4.5b). Everything here is off unless the user turned it on. */
export type ReviewSettings = {
  /** "Review concepts I have learned". Off: no Review entry point, no cards, no model calls. */
  enabled?: boolean;
  /** "Write question cards with a model". Only meaningful while `enabled`; sends concept names, glosses and snippets. */
  modelQuestions?: boolean;
};

export const REVIEW_SETTINGS_KEY = 'trailmap.reviewSettings';

export const reviewEnabled = ({ enabled }: ReviewSettings) => enabled === true;
/** The sub-setting counts only while review itself is on, so turning review off also stops model questions. */
export const modelQuestionsEnabled = (settings: ReviewSettings) => reviewEnabled(settings) && settings.modelQuestions === true;

export async function readReviewSettings(): Promise<ReviewSettings> {
  const { [REVIEW_SETTINGS_KEY]: stored } = await chrome.storage.local.get({ [REVIEW_SETTINGS_KEY]: {} });
  const { enabled, modelQuestions } = (stored ?? {}) as ReviewSettings;
  return { enabled: enabled === true, modelQuestions: modelQuestions === true };
}

export function saveReviewSettings(settings: ReviewSettings): Promise<void> {
  return chrome.storage.local.set({ [REVIEW_SETTINGS_KEY]: settings });
}
