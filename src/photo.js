export function buildPhotoFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `downhill-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.png`;
}

export async function savePhoto(blob, {
  navigatorApi = globalThis.navigator,
  documentApi = globalThis.document,
  urlApi = globalThis.URL,
  FileConstructor = globalThis.File,
  date = new Date(),
  schedule = globalThis.setTimeout,
} = {}) {
  const file = new FileConstructor([blob], buildPhotoFilename(date), { type: 'image/png' });
  if (navigatorApi?.canShare?.({ files: [file] })) {
    await navigatorApi.share({ files: [file], title: 'Downhill' });
    return { method: 'share', filename: file.name };
  }

  const objectUrl = urlApi.createObjectURL(blob);
  const link = documentApi.createElement('a');
  link.href = objectUrl;
  link.download = file.name;
  documentApi.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    schedule(() => urlApi.revokeObjectURL(objectUrl), 1000);
  }
  return { method: 'download', filename: file.name };
}
