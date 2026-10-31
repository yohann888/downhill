const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/').filter(Boolean)[0];
  } else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'music.youtube.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed') id = parts[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}
