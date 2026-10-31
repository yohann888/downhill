import { describe, expect, it, vi } from 'vitest';
import { buildPhotoFilename, savePhoto } from '../src/photo.js';

class TestFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}

describe('photo saving', () => {
  it('builds a local date and time filename', () => {
    expect(buildPhotoFilename(new Date(2026, 2, 8, 9, 5)))
      .toBe('downhill-2026-03-08-0905.png');
  });

  it('shares the PNG when the file share API accepts it', async () => {
    const blob = { type: 'image/png' };
    const navigatorApi = {
      canShare: vi.fn(() => true),
      share: vi.fn().mockResolvedValue(undefined),
    };
    const documentApi = { createElement: vi.fn() };

    await expect(savePhoto(blob, {
      navigatorApi,
      documentApi,
      FileConstructor: TestFile,
      date: new Date(2026, 2, 8, 9, 5),
    })).resolves.toEqual({ method: 'share', filename: 'downhill-2026-03-08-0905.png' });

    const [shareOptions] = navigatorApi.canShare.mock.calls[0];
    expect(shareOptions.files[0]).toMatchObject({ name: 'downhill-2026-03-08-0905.png', type: 'image/png' });
    expect(navigatorApi.share).toHaveBeenCalledWith({
      files: [shareOptions.files[0]],
      title: 'Downhill',
    });
    expect(documentApi.createElement).not.toHaveBeenCalled();
  });

  it('downloads the PNG and revokes its object URL afterwards', async () => {
    const blob = { type: 'image/png' };
    const link = { click: vi.fn(), remove: vi.fn() };
    const documentApi = {
      body: { append: vi.fn() },
      createElement: vi.fn(() => link),
    };
    const urlApi = {
      createObjectURL: vi.fn(() => 'blob:photo'),
      revokeObjectURL: vi.fn(),
    };
    const schedule = vi.fn();

    await expect(savePhoto(blob, {
      navigatorApi: { canShare: vi.fn(() => false) },
      documentApi,
      urlApi,
      FileConstructor: TestFile,
      date: new Date(2026, 2, 8, 9, 5),
      schedule,
    })).resolves.toEqual({ method: 'download', filename: 'downhill-2026-03-08-0905.png' });

    expect(urlApi.createObjectURL).toHaveBeenCalledWith(blob);
    expect(documentApi.body.append).toHaveBeenCalledWith(link);
    expect(link).toMatchObject({
      href: 'blob:photo',
      download: 'downhill-2026-03-08-0905.png',
    });
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
    const [revoke, delay] = schedule.mock.calls[0];
    expect(delay).toBe(1000);
    revoke();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
  });
});
