/**
 * Core domain types shared across the app.
 * Kept separate from any single data source (Sefaria, hebcal, etc.) so the
 * rest of the app never depends on a specific provider's shape.
 */

/** ISO date string, e.g. "2026-09-06" (Gregorian, local calendar day). */
export type IsoDate = string;

export type Country = 'IL' | 'DIASPORA';

/** One of the traditional 7 aliyot boundaries within a parasha (or combined parasha). */
export type AliyahNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface VerseRef {
  book: TorahBook;
  chapter: number;
  verse: number;
}

export type TorahBook =
  | 'Genesis'
  | 'Exodus'
  | 'Leviticus'
  | 'Numbers'
  | 'Deuteronomy';

export const TORAH_BOOK_HE: Record<TorahBook, string> = {
  Genesis: 'בראשית',
  Exodus: 'שמות',
  Leviticus: 'ויקרא',
  Numbers: 'במדבר',
  Deuteronomy: 'דברים',
};

/** A contiguous verse range, inclusive. */
export interface VerseRange {
  start: VerseRef;
  end: VerseRef;
}

/** A single Torah verse with its two customary readings + Targum Onkelos. */
export interface ShnayimMikraVerse {
  ref: VerseRef;
  /** Reference string for display / lookup, e.g. "בראשית א׳:א׳" */
  refLabel: string;
  /** The Hebrew verse text (with nikud when available), used for both mikra readings. */
  mikra: string;
  /** Targum Onkelos Aramaic text for the same verse. */
  targum: string;
  /** Short explanation ("הסבר קצר") for this verse or verse group. */
  commentary?: CommentaryEntry;
}

export interface CommentaryEntry {
  text: string;
  /** Marks whether this is a licensed quoted source or an original short explanation. */
  kind: 'licensed-source' | 'original-short-explanation';
  sourceName?: string;
  sourceUrl?: string;
  /** Verse ref(s) this commentary covers, for multi-verse grouping. */
  coversVerses: VerseRef[];
}

export interface TextAttribution {
  sourceName: string;
  license: string;
  sourceUrl?: string;
  versionTitle?: string;
}

/** Names for a week's Torah reading; more than one entry means a "double" (combined) parasha. */
export interface ParashaInfo {
  /** English/transliterated identifiers as used by hebcal (stable keys). */
  ids: string[];
  /** Hebrew display names, e.g. ["מטות", "מסעי"] */
  namesHe: string[];
  /** Combined display, e.g. "מטות-מסעי" */
  displayNameHe: string;
  /** hebcal parsha index (0-53), useful for lookups. */
  parshaNum: number[];
}

export type SpecialWeekReason =
  | 'none'
  | 'yomtov-shabbat-no-regular-torah-reading'
  | 'chol-hamoed-special-reading'
  | 'simchat-torah-vezot-habracha'
  | 'other-holiday-override';

export interface WeekReadingContext {
  /** The Shabbat (Saturday) that anchors this "shnayim mikra" week, as ISO date. */
  shabbatDate: IsoDate;
  hebrewDateShabbat: string;
  parasha: ParashaInfo | null;
  country: Country;
  /**
   * True when there IS an annual-cycle parasha assigned to this week (for
   * shnayim mikra purposes) even if the public Shabbat Torah reading that
   * week is a holiday reading instead (e.g. Shabbat Chol HaMoed Sukkot).
   */
  hasRegularParasha: boolean;
  specialReason: SpecialWeekReason;
  /** Human-readable note to show the user when the week is non-standard. Never fabricated. */
  note?: string;
}

export type ReadingDivisionSchemeId = 'sun-fri-6days' | 'sun-sat-7days';

export interface DayPortion {
  /** 1 = Sunday ... 7 = Shabbat, per the Hebrew week used for shnayim mikra. */
  dayOfWeek: number;
  dayNameHe: string;
  aliyot: AliyahNumber[];
  range: VerseRange;
}

export interface DailyReadingPlan {
  date: IsoDate;
  weekContext: WeekReadingContext;
  schemeId: ReadingDivisionSchemeId;
  dayPortion: DayPortion | null;
  /** True if today is not a normal shnayim-mikra reading day under the chosen scheme. */
  isRestDay: boolean;
}

export interface HebrewDateInfo {
  day: number;
  monthName: string;
  monthNameHe: string;
  year: number;
  displayHe: string;
  isLeapYear: boolean;
}

export interface HolidayInfo {
  nameHe: string;
  nameEn: string;
  isYomTov: boolean;
  isCholHamoed: boolean;
  isRoshChodesh: boolean;
}

export interface DayCalendarInfo {
  date: IsoDate;
  hebrew: HebrewDateInfo;
  gregorianWeekdayHe: string;
  holidays: HolidayInfo[];
  isShabbat: boolean;
  isErevShabbat: boolean;
  isErevYomTov: boolean;
  candleLightingNote?: string;
}

export type FontSizeOption = 'small' | 'medium' | 'large' | 'xlarge';
export type ReadingModeOption = 'sequential' | 'verse-by-verse';
export type ThemeOption = 'light' | 'dark' | 'system';

export interface UserSettings {
  country: Country;
  divisionScheme: ReadingDivisionSchemeId;
  readingMode: ReadingModeOption;
  fontSize: FontSizeOption;
  nikud: boolean;
  theme: ThemeOption;
  hideCommentary: boolean;
  revealCommentaryAfterReading: boolean;
  shabbatObservantMode: boolean;
  notifications: NotificationSettings;
  onboardingCompleted: boolean;
}

export interface NotificationSettings {
  enabled: boolean;
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday (JS convention) */
  activeDays: number[];
  snoozeMinutes: number;
}

export interface DayProgress {
  date: IsoDate;
  /** Verse refs (as ref labels) the user marked as completed. */
  completedVerseRefs: string[];
  totalVersesInPortion: number;
  completedAt?: string;
  startedAt?: string;
  secondsSpentReading: number;
  /** Marked complete via "Shabbat-observant" catch-up rule, not a missed day. */
  completedBeforeShabbat?: boolean;
}

export interface StreakState {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: IsoDate | null;
  totalDaysCompleted: number;
}

export interface ProgressStore {
  days: Record<IsoDate, DayProgress>;
  streak: StreakState;
}
