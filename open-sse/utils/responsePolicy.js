// Provider-level fallback metadata; multi-member Combos apply their own policy.
// Never expose control flags in client-facing headers.
const noFallbackResponses = new WeakSet();

export function disableResponseFallback(response) {
  noFallbackResponses.add(response);
  return response;
}

export function isResponseFallbackDisabled(response) {
  return noFallbackResponses.has(response);
}
