import { UserMetadataKey } from 'src/enum';
import { getPreferences, getPreferencesPartial, mergePreferences } from 'src/utils/preferences';
import { describe, expect, it } from 'vitest';

// The gap preference defaults to null rather than a number so that "unset" can mean "follow the
// admin's value". That only works if null survives the round trip through getPreferencesPartial,
// which persists exactly the keys present in the defaults -- an undefined default would be
// dropped there and silently discard whatever the user chose.
const round = (value: number | null) => {
  const preferences = mergePreferences(getPreferences([]), {
    people: { videoAppearanceGapSeconds: value },
  } as never);
  const partial = getPreferencesPartial(preferences);
  return {
    partial,
    readBack: getPreferences([{ key: UserMetadataKey.Preferences, value: partial } as never]).people
      .videoAppearanceGapSeconds,
  };
};

describe('videoAppearanceGapSeconds preference', () => {
  it('defaults to null so the admin value is followed', () => {
    expect(getPreferences([]).people.videoAppearanceGapSeconds).toBeNull();
  });

  it('persists a chosen value', () => {
    const { partial, readBack } = round(30);
    expect(partial).toEqual({ people: { videoAppearanceGapSeconds: 30 } });
    expect(readBack).toBe(30);
  });

  it('persists 0, which means "show every detection" and must not be treated as empty', () => {
    const { partial, readBack } = round(0);
    expect(partial).toEqual({ people: { videoAppearanceGapSeconds: 0 } });
    expect(readBack).toBe(0);
  });

  it('drops the key when reset to null, falling back to the admin value again', () => {
    const { partial, readBack } = round(null);
    expect(partial).toEqual({});
    expect(readBack).toBeNull();
  });
});
