export interface DeprecatedLikeResult {
  matched: false;
  matchId: null;
  deprecated: true;
}

export function deprecatedLikeResult(): DeprecatedLikeResult {
  return {
    matched: false,
    matchId: null,
    deprecated: true,
  };
}
