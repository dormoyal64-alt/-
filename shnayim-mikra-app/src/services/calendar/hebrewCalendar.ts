/**
 * Thin, well-tested wrapper around @hebcal/core for turning a Gregorian date
 * into the Hebrew calendar facts the app needs (Hebrew date, holidays,
 * Shabbat/erev-Shabbat flags). All halachic/astronomical facts here come
 * from @hebcal/core — nothing is invented.
 */
import { HDate, flags, getHolidaysOnDate, Event } from '@hebcal/core';
import type { DayCalendarInfo, HebrewDateInfo, HolidayInfo, IsoDate } from '@/types';

export const HEBREW_MONTH_NAMES: Record<string, string> = {
  Nisan: 'ניסן',
  Iyyar: 'אייר',
  Sivan: 'סיוון',
  Tamuz: 'תמוז',
  Av: 'אב',
  Elul: 'אלול',
  Tishrei: 'תשרי',
  Cheshvan: 'חשוון',
  Kislev: 'כסלו',
  Tevet: 'טבת',
  "Sh'vat": 'שבט',
  Shvat: 'שבט',
  Adar: 'אדר',
  'Adar I': "אדר א׳",
  'Adar II': "אדר ב׳",
};

const GREGORIAN_WEEKDAY_HE = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
];

export function isoDateToJsDate(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function jsDateToIsoDate(date: Date): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIsoDate(): IsoDate {
  return jsDateToIsoDate(new Date());
}

export function getHebrewDateInfo(date: IsoDate): HebrewDateInfo {
  const hd = new HDate(isoDateToJsDate(date));
  const monthNameEn = hd.getMonthName();
  return {
    day: hd.getDate(),
    monthName: monthNameEn,
    monthNameHe: HEBREW_MONTH_NAMES[monthNameEn] ?? monthNameEn,
    year: hd.getFullYear(),
    displayHe: hd.renderGematriya(false, false),
    isLeapYear: hd.isLeapYear(),
  };
}

function classifyHoliday(ev: Event): HolidayInfo {
  return {
    nameHe: ev.render('he'),
    nameEn: ev.getDesc(),
    isYomTov: Boolean(ev.getFlags() & flags.CHAG),
    isCholHamoed: Boolean(ev.getFlags() & flags.CHOL_HAMOED),
    isRoshChodesh: Boolean(ev.getFlags() & flags.ROSH_CHODESH),
  };
}

export function getDayCalendarInfo(date: IsoDate, il: boolean): DayCalendarInfo {
  const jsDate = isoDateToJsDate(date);
  const hd = new HDate(jsDate);
  const dow = jsDate.getDay(); // 0=Sunday ... 6=Saturday
  const holidayEvents = getHolidaysOnDate(hd, il) ?? [];
  const holidays = holidayEvents.map(classifyHoliday);

  const tomorrow = new HDate(hd.abs() + 1);
  const tomorrowHolidays = getHolidaysOnDate(tomorrow, il) ?? [];
  const isErevYomTov = tomorrowHolidays.some(
    (ev) => Boolean(ev.getFlags() & flags.CHAG) && !(ev.getFlags() & flags.CHOL_HAMOED)
  );

  return {
    date,
    hebrew: getHebrewDateInfo(date),
    gregorianWeekdayHe: GREGORIAN_WEEKDAY_HE[dow],
    holidays,
    isShabbat: dow === 6,
    isErevShabbat: dow === 5,
    isErevYomTov,
  };
}

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  const d = isoDateToJsDate(date);
  d.setDate(d.getDate() + days);
  return jsDateToIsoDate(d);
}

/** 1=Sunday ... 7=Saturday, matching the convention used for shnayim-mikra day portions. */
export function hebrewWeekDayOfWeek(date: IsoDate): number {
  const dow = isoDateToJsDate(date).getDay(); // 0-6, Sunday=0
  return dow === 0 ? 1 : dow + 1;
}

export const DAY_NAMES_HE_1_TO_7 = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
];
