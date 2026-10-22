// The Claude SDK in the browser demo: a talk is not summed up there - a page holds no keys, so the
// site reports the summary as off (talkAi.ts) and nothing here is ever called.
class APIError extends Error {
  status = 0;
}

export default class Anthropic {
  static APIError = APIError;
  static NotFoundError = class extends APIError {};
  static AuthenticationError = class extends APIError {};
  static PermissionDeniedError = class extends APIError {};
  static RateLimitError = class extends APIError {};
  constructor() {
    throw new Error('סיכום שיחות לא זמין בהדגמה');
  }
}

export const zodOutputFormat = () => ({});
