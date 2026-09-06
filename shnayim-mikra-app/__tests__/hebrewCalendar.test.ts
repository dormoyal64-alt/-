import { getDayCalendarInfo, getHebrewDateInfo, hebrewWeekDayOfWeek } from '@/services/calendar/hebrewCalendar';

describe('getHebrewDateInfo', () => {
  it('reports the correct Hebrew year and leap-year flag for a known leap year (5787)', () => {
    // 1 Tishrei 5787 == Sat Sep 12 2026 (verified against @hebcal/core directly).
    const info = getHebrewDateInfo('2026-09-12');
    expect(info.year).toBe(5787);
    expect(info.isLeapYear).toBe(true);
  });

  it('reports a non-leap year correctly (5786)', () => {
    // Rosh Hashana 5786 fell in September 2025; a date well inside that year (e.g. Cheshvan 5786).
    const info = getHebrewDateInfo('2025-11-01');
    expect(info.year).toBe(5786);
    expect(info.isLeapYear).toBe(false);
  });
});

describe('getDayCalendarInfo — holiday scenarios (Israel)', () => {
  it('flags Rosh Hashana as a Yom Tov', () => {
    const info = getDayCalendarInfo('2026-09-12', true);
    expect(info.holidays.some((h) => h.nameEn.startsWith('Rosh Hashana'))).toBe(true);
    expect(info.holidays.some((h) => h.isYomTov)).toBe(true);
  });

  it('flags Yom Kippur as a major fast / Yom Tov, and its eve as Erev Yom Tov', () => {
    // 10 Tishrei 5787 == Mon Sep 21 2026 (verified).
    const info = getDayCalendarInfo('2026-09-21', true);
    expect(info.holidays.some((h) => h.nameEn === 'Yom Kippur')).toBe(true);
    const erev = getDayCalendarInfo('2026-09-20', true);
    expect(erev.isErevYomTov).toBe(true);
  });

  it('flags the days of Sukkot, including Chol HaMoed', () => {
    // 15 Tishrei 5787 == Sat Sep 26 2026 (Sukkot I); 16th == Sukkot II (Chol HaMoed) in Israel.
    const first = getDayCalendarInfo('2026-09-26', true);
    expect(first.holidays.some((h) => h.nameEn.startsWith('Sukkot'))).toBe(true);
    expect(first.isShabbat).toBe(true);

    const cholHamoed = getDayCalendarInfo('2026-09-27', true);
    expect(cholHamoed.holidays.some((h) => h.isCholHamoed)).toBe(true);
  });

  it('flags Pesach I correctly for Israel (5787)', () => {
    // 15 Nisan 5787 == Thu Apr 22 2027 (verified).
    const info = getDayCalendarInfo('2027-04-22', true);
    expect(info.holidays.some((h) => h.nameEn === 'Pesach I')).toBe(true);
    expect(info.holidays.some((h) => h.isYomTov)).toBe(true);
  });

  it('does NOT show an 8th day of Pesach in Israel, but DOES in the Diaspora', () => {
    // 22 Nisan 5787 == Thu Apr 29 2027 (verified: "Pesach VIII" only appears in the Diaspora schedule).
    const il = getDayCalendarInfo('2027-04-29', true);
    const diaspora = getDayCalendarInfo('2027-04-29', false);
    expect(il.holidays.some((h) => h.nameEn === 'Pesach VIII')).toBe(false);
    expect(diaspora.holidays.some((h) => h.nameEn === 'Pesach VIII')).toBe(true);
  });

  it('flags Shavuot for Israel (5787, single day)', () => {
    // 6 Sivan 5787 == Fri Jun 11 2027 (verified).
    const info = getDayCalendarInfo('2027-06-11', true);
    expect(info.holidays.some((h) => h.nameEn === 'Shavuot')).toBe(true);
    expect(info.isErevShabbat).toBe(true);
  });

  it('correctly identifies Shabbat and Erev Shabbat on a plain mid-week scenario', () => {
    const friday = getDayCalendarInfo('2026-09-18', true); // Fri, week before Yom Kippur
    const saturday = getDayCalendarInfo('2026-09-19', true); // Shabbat Shuva
    const sunday = getDayCalendarInfo('2026-09-20', true); // Motzaei Shabbat's civil day
    expect(friday.isErevShabbat).toBe(true);
    expect(saturday.isShabbat).toBe(true);
    expect(sunday.isShabbat).toBe(false);
  });
});

describe('hebrewWeekDayOfWeek', () => {
  it('maps Sunday..Saturday to 1..7', () => {
    expect(hebrewWeekDayOfWeek('2026-09-06')).toBe(1); // Sunday
    expect(hebrewWeekDayOfWeek('2026-09-12')).toBe(7); // Saturday
  });
});
