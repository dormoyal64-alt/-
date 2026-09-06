import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Dedication } from '@/components/Dedication';
import { Card } from '@/components/Card';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';
import { useDailyPlan } from '@/hooks/useDailyPlan';
import { addDaysIso, getDayCalendarInfo, todayIsoDate } from '@/services/calendar';
import { getPlanVerseCount } from '@/services/calendar/readingDivision';
import { getDailyReadingPlan } from '@/services/calendar';
import { estimateReadingMinutes } from '@/utils/readingEstimate';
import { countCompletedInMonth } from '@/services/streak/streakEngine';

export default function HomeScreen() {
  const { settings, progress, loading } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();
  const today = todayIsoDate();
  const plan = useDailyPlan(today);

  const dayInfo = useMemo(() => getDayCalendarInfo(today, settings.country === 'IL'), [today, settings.country]);
  const verseCount = getPlanVerseCount(plan);
  const readingMinutes = estimateReadingMinutes(verseCount);
  const isTodayDone = Boolean(progress.days[today]?.completedAt);

  const yesterday = addDaysIso(today, -1);
  const yesterdayPlan = useMemo(
    () => getDailyReadingPlan(yesterday, settings.country, settings.divisionScheme),
    [yesterday, settings.country, settings.divisionScheme]
  );
  const yesterdayDone = Boolean(progress.days[yesterday]?.completedAt);
  const [catchUpDismissed, setCatchUpDismissed] = React.useState(false);
  const showCatchUp = !yesterdayPlan.isRestDay && !yesterdayDone && !catchUpDismissed;

  const tomorrow = addDaysIso(today, 1);
  const tomorrowPlan = useMemo(
    () => getDailyReadingPlan(tomorrow, settings.country, settings.divisionScheme),
    [tomorrow, settings.country, settings.divisionScheme]
  );
  const showShabbatPrep =
    dayInfo.isErevShabbat &&
    settings.shabbatObservantMode &&
    settings.divisionScheme === 'sun-sat-7days' &&
    !tomorrowPlan.isRestDay &&
    !progress.days[tomorrow]?.completedAt;

  const now = new Date();
  const monthCompleted = countCompletedInMonth(progress.days, now.getFullYear(), now.getMonth() + 1);
  const daysSoFarInMonth = now.getDate();

  if (loading) return null;
  if (!settings.onboardingCompleted) return <Redirect href="/onboarding" />;

  return (
    <ScreenContainer>
      <Dedication />
      <Text style={[styles.greeting, { color: colors.text }]}>
        שלום, היום יום {dayInfo.gregorianWeekdayHe}, {dayInfo.hebrew.displayHe}
      </Text>

      <Card>
        <Text style={[styles.label, { color: colors.textMuted }]}>פרשת השבוע</Text>
        <Text style={[styles.parasha, { color: colors.primary }]}>
          {plan.weekContext.parasha?.displayNameHe ?? '—'}
        </Text>

        {plan.isRestDay ? (
          <Text style={[styles.note, { color: colors.textMuted }]}>
            {plan.weekContext.note ?? 'אין קטע חדש לשניים מקרא ואחד תרגום היום.'}
          </Text>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.textMuted, marginTop: 12 }]}>הקריאה שלך להיום</Text>
            <Text style={[styles.readingSummary, { color: colors.text }]}>
              עלייה {plan.dayPortion?.aliyot.join('-')} · {verseCount} פסוקים
            </Text>
          </>
        )}
      </Card>

      {showCatchUp && (
        <Card style={{ borderColor: colors.accent }}>
          <Text style={[styles.catchUpTitle, { color: colors.text }]}>
            יש לך קריאה שלא הושלמה מאתמול
          </Text>
          <View style={styles.catchUpRow}>
            <PrimaryButton
              title="השלם עכשיו"
              variant="secondary"
              onPress={() => router.push({ pathname: '/reading', params: { date: yesterday } })}
            />
            <PrimaryButton title="המשך לקריאה של היום" variant="ghost" onPress={() => setCatchUpDismissed(true)} />
          </View>
        </Card>
      )}

      {showShabbatPrep && (
        <Card style={{ borderColor: colors.accent }}>
          <Text style={[styles.catchUpTitle, { color: colors.text }]}>
            מצב שומר שבת פעיל — אפשר להשלים כבר עכשיו את קטע השבת, לפני כניסתה
          </Text>
          <PrimaryButton
            title="קרא את קטע השבת מראש"
            variant="secondary"
            onPress={() => router.push({ pathname: '/reading', params: { date: tomorrow } })}
          />
        </Card>
      )}

      {!plan.isRestDay && (
        <PrimaryButton
          title={isTodayDone ? 'סיימת את הקריאה של היום ✅' : 'התחל קריאה'}
          size="large"
          disabled={isTodayDone}
          onPress={() => router.push({ pathname: '/reading', params: { date: today } })}
        />
      )}

      <View style={styles.statsGrid}>
        <StatTile label="פסוקים היום" value={String(verseCount)} colors={colors} />
        <StatTile label="זמן קריאה משוער" value={`${readingMinutes} דק׳`} colors={colors} />
        <StatTile label="רצף ימים" value={`${progress.streak.currentStreak} 🔥`} colors={colors} />
        <StatTile label="הושלם החודש" value={`${monthCompleted}/${daysSoFarInMonth}`} colors={colors} />
      </View>
    </ScreenContainer>
  );
}

function StatTile({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}>
      <Text style={[styles.tileValue, { color: colors.primary }]}>{value}</Text>
      <Text style={[styles.tileLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  greeting: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.title, marginBottom: 16, textAlign: 'right' },
  label: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.caption, textAlign: 'right' },
  parasha: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right', marginTop: 2 },
  note: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.body, textAlign: 'right', marginTop: 10, lineHeight: 22 },
  readingSummary: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.bodyLarge, textAlign: 'right', marginTop: 2 },
  catchUpTitle: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.body, textAlign: 'right', marginBottom: 10 },
  catchUpRow: { flexDirection: 'row-reverse', gap: 10, flexWrap: 'wrap' },
  statsGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12, marginTop: 20 },
  tile: { flexBasis: '47%', borderRadius: 16, padding: 16, alignItems: 'center' },
  tileValue: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.title },
  tileLabel: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.caption, marginTop: 4 },
});
