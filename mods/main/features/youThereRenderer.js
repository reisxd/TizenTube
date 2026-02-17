export function applyYouThereRenderer(parsedResponse, youThereRendererEnabled) {
  if (parsedResponse.messages && Array.isArray(parsedResponse.messages) && !youThereRendererEnabled) {
    parsedResponse.messages = parsedResponse.messages.filter((message) => !message?.youThereRenderer);
  }
}