import { describe, expect, it } from 'vitest';
import { parseYouTubeId } from '../src/youtube.js';

describe('parseYouTubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=30', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parses %s', (url, id) => {
    expect(parseYouTubeId(url)).toBe(id);
  });

  it.each([
    '',
    'not a url',
    'https://example.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=short',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/channel/UC123456789',
  ])('rejects %s', (url) => {
    expect(parseYouTubeId(url)).toBeNull();
  });
});
