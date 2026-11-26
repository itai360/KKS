import { describe, expect, it } from 'vitest';
import { installWayOf } from '../src/lib/install';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const way = (ua: string, o: Partial<{ standalone: boolean; canPrompt: boolean; touch: boolean }> = {}) =>
  installWayOf(ua, { standalone: false, canPrompt: false, touch: false, ...o });

describe('how this device installs the app', () => {
  it('has nothing to offer once it runs from the home screen', () => {
    expect(way(IPHONE_SAFARI, { standalone: true })).toBe('installed');
    expect(way(ANDROID_CHROME, { standalone: true, canPrompt: true })).toBe('installed');
  });

  it("installs with one button where the browser offered it - Android's Chrome, a computer's", () => {
    expect(way(ANDROID_CHROME, { canPrompt: true })).toBe('prompt');
    expect(way(WINDOWS_CHROME, { canPrompt: true })).toBe('prompt');
  });

  it("on an iPhone says how: Safari's Share, or another browser's - an iPad too, though it says it is a Mac", () => {
    expect(way(IPHONE_SAFARI)).toBe('ios-safari');
    expect(way(IPHONE_CHROME)).toBe('ios-other');
    expect(way(IPAD, { touch: true })).toBe('ios-safari');
    expect(way(IPAD)).toBe('none');
  });

  it("on Android with no offer, the browser's menu installs it; a computer with none cannot", () => {
    expect(way(ANDROID_CHROME)).toBe('android-menu');
    expect(way(WINDOWS_CHROME)).toBe('none');
  });
});
