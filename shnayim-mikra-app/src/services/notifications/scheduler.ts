import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { NotificationSettings, ProgressStore } from '@/types';
import { addDaysIso, getDayCalendarInfo, todayIsoDate } from '@/services/calendar';

const DAYS_AHEAD = 14;
const ID_PREFIX = 'shnayim-mikra-daily-';
const SNOOZE_CATEGORY = 'shnayim-mikra-snooze';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensurePermissions(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function setupSnoozeCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(SNOOZE_CATEGORY, [
    {
      identifier: 'snooze',
      buttonTitle: 'הזכר לי מאוחר יותר',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'open',
      buttonTitle: 'התחל קריאה',
      options: { opensAppToForeground: true },
    },
  ]);
}

function notificationIdFor(date: string): string {
  return `${ID_PREFIX}${date}`;
}

function isCompleted(progress: ProgressStore, date: string): boolean {
  return Boolean(progress.days[date]?.completedAt);
}

/**
 * (Re)schedules the daily reminder for the next `DAYS_AHEAD` days, skipping:
 * - days of week the user disabled,
 * - Shabbat, when "Shabbat-observant mode" is on,
 * - any day already completed.
 *
 * Call this on app start/resume and whenever settings or progress change.
 * Local notifications can't be conditionally cancelled by the OS at fire
 * time, so we keep a short rolling window and re-run this often instead of
 * scheduling far into the future.
 */
export async function rescheduleDailyReminders(
  settings: NotificationSettings,
  progress: ProgressStore,
  shabbatObservantMode: boolean,
  country: 'IL' | 'DIASPORA'
): Promise<void> {
  await cancelAllAppNotifications();
  if (!settings.enabled) return;

  const granted = await ensurePermissions();
  if (!granted) return;

  const il = country === 'IL';
  let cursor = todayIsoDate();
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = cursor;
    cursor = addDaysIso(cursor, 1);

    const jsDate = new Date(date + 'T00:00:00');
    const weekday = jsDate.getDay(); // 0=Sunday
    if (!settings.activeDays.includes(weekday)) continue;

    const dayInfo = getDayCalendarInfo(date, il);
    if (shabbatObservantMode && dayInfo.isShabbat) continue;
    if (isCompleted(progress, date)) continue;

    const trigger = new Date(date + 'T00:00:00');
    trigger.setHours(settings.hour, settings.minute, 0, 0);
    if (trigger.getTime() <= Date.now()) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: notificationIdFor(date),
      content: {
        title: 'שניים מקרא – כל יום 📖',
        body: 'הגיע הזמן לקריאה היומית שלך.',
        data: { screen: 'reading', date },
        categoryIdentifier: Platform.OS === 'ios' ? SNOOZE_CATEGORY : undefined,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: trigger,
      },
    });
  }
}

export async function cancelNotificationForDate(date: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationIdFor(date));
}

export async function cancelAllAppNotifications(): Promise<void> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const mine = all.filter((n) => n.identifier?.startsWith(ID_PREFIX));
  await Promise.all(mine.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

export async function snoozeNotification(minutes: number, date: string): Promise<void> {
  const fireDate = new Date(Date.now() + minutes * 60 * 1000);
  await Notifications.scheduleNotificationAsync({
    identifier: `${ID_PREFIX}snooze-${date}-${Date.now()}`,
    content: {
      title: 'שניים מקרא – כל יום 📖',
      body: 'תזכורת: עדיין לא השלמת את הקריאה של היום.',
      data: { screen: 'reading', date },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireDate,
    },
  });
}
