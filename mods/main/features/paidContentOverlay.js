export function applyPaidContentOverlay(parsedResponse, paidPromotionOverlayEnabled) {
  if (parsedResponse.paidContentOverlay && !paidPromotionOverlayEnabled) {
    parsedResponse.paidContentOverlay = null;
  }
}