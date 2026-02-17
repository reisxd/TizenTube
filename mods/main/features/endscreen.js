export function applyEndscreen(parsedResponse, hideEndScreenCardsEnabled) {
  if (parsedResponse.endscreen && hideEndScreenCardsEnabled) {
    parsedResponse.endscreen = null;
  }
}