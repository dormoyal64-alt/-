import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Card } from '@/components/Card';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';
import { getWeekReadingContext } from '@/services/calendar/parasha';

export default function ProgressScreen() {
  const { settings, progress } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();

  const completedDates = useMemo(
    () =>
      Object.values(progress.days)
        .filter((d) => d.completedAt)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [progress.days]
  );

  const totalReadingMinutes = useMemo(
    () => Math.round(Object.values(progress.days).reduce((s, d) => s + d.secondsSpentReading, 0) / 60),
    [progress.days]
  );

  const completedParashaSet = useMemo(() => {
    const set = new Set<string>();
    for (const d of completedDates) {
      const ctx = getWeekReadingContext(d.date, settings.country);
      if (ctx.parasha) set.add(ctx.parasha.displayNameHe);
    }
    return set;
  }, [completedDates, settings.country]);

  const persistenceRate = useMemo(() => {
    if (completedDates.length === 0) return 0;
    const first = [...completedDates].sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const daysSinceStart =
      Math.round((Date.now() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return Math.min(100, Math.round((completedDates.length / Math.max(1, daysSinceStart)) * 100));
  }, [completedDates]);

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.text }]}>ההתקדמות שלי</Text>

      <View style={styles.statsRow}>
        <Stat label="רצף נוכחי" value={`${progress.streak.currentStreak} 🔥`} colors={colors} />
        <Stat label="השיא שלי" value={`${progress.streak.longestStreak}`} colors={colors} />
        <Stat label="אחוז התמדה" value={`${persistenceRate}%`} colors={colors} />
      </View>
      <View style={styles.statsRow}>
        <Stat label="ימים שהושלמו" value={`${progress.streak.totalDaysCompleted}`} colors={colors} />
        <Stat label="פרשות שהושלמו" value={`${completedParashaSet.size}`} colors={colors} />
        <Stat label="זמן קריאה כולל" value={`${totalReadingMinutes} דק׳`} colors={colors} />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>ימים שהשלמתי</Text>
      {completedDates.length === 0 && (
        <Text style={{ color: colors.textMuted, textAlign: 'right' }}>עדיין לא השלמת ימי קריאה. בוא נתחיל!</Text>
      )}
      {completedDates.slice(0, 60).map((d) => (
        <Card key={d.date} style={styles.dayRow}>
          <Text style={{ color: colors.text, fontFamily: fonts.sansMedium }}>{d.date}</Text>
          <PrimaryButton
            title="פתח שוב"
            variant="ghost"
            size="medium"
            onPress={() => router.push({ pathname: '/reading', params: { date: d.date } })}
          />
        </Card>
      ))}
    </ScreenContainer>
  );
}

function Stat({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={[styles.stat, { backgroundColor: colors.surfaceAlt }]}>
      <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right', marginBottom: 16 },
  sectionTitle: {
    fontFamily: fonts.sansBold,
    fontSize: UI_FONT_SIZES.title,
    textAlign: 'right',
    marginTop: 12,
    marginBottom: 10,
  },
  statsRow: { flexDirection: 'row-reverse', gap: 10, marginBottom: 10 },
  stat: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center' },
  statValue: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.title },
  statLabel: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.caption, marginTop: 4, textAlign: 'center' },
  dayRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
});
