import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { APP_VERSION_LABEL } from '../src/app-version.js';

describe('app version', () => {
  it('exposes the package major and minor version', () => {
    const expected = `v${pkg.version.split('.').slice(0, 2).join('.')}`;
    expect(APP_VERSION_LABEL).toBe(expected);
    expect(APP_VERSION_LABEL).not.toContain('undefined');
  });
});
