export function applyPreferredVideoCodec(parsedResponse, preferredCodec) {
  if (!parsedResponse?.streamingData?.adaptiveFormats || preferredCodec === 'any') return;

  const hasPreferredCodec = parsedResponse.streamingData.adaptiveFormats.find(
    (format) => format.mimeType.includes(preferredCodec)
  );

  if (!hasPreferredCodec) return;

  parsedResponse.streamingData.adaptiveFormats = parsedResponse.streamingData.adaptiveFormats.filter((format) => {
    if (format.mimeType.startsWith('audio/')) return true;
    return format.mimeType.includes(preferredCodec);
  });
}