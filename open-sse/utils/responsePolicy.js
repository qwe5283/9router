// Internal routing metadata. Never expose control flags in client-facing headers.
const noFallbackResponses = new WeakSet();

export function disableResponseFallback(response) {
  noFallbackResponses.add(response);
  return response;
}

export function isResponseFallbackDisabled(response) {
  return noFallbackResponses.has(response);
}
