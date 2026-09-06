import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';
import { getDailyReadingPlan, jsDateToIsoDate } from '@/services/calendar';

const WEEKDAY_HEADERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTH_NAMES_HE = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

export default function CalendarScreen() {
  const { settings, progress } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();
  const [cursor, setCursor] = useState(() => new Date());

  const year = cursor.getFullYear();
  const month = cursor.getMonth(); // 0-11

  const weeks = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay(); // 0=Sunday
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [year, month]);

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.text }]}>לוח שנה</Text>

      <View style={styles.monthNav}>
        <Pressable onPress={() => setCursor(new Date(year, month + 1, 1))}>
          <Text style={[styles.navArrow, { color: colors.primary }]}>›</Text>
        </Pressable>
        <Text style={[styles.monthLabel, { color: colors.text }]}>
          {MONTH_NAMES_HE[month]} {year}
        </Text>
        <Pressable onPress={() => setCursor(new Date(year, month - 1, 1))}>
          <Text style={[styles.navArrow, { color: colors.primary }]}>‹</Text>
        </Pressable>
      </View>

      <View style={styles.weekHeaderRow}>
        {WEEKDAY_HEADERS.map((w) => (
          <Text key={w} style={[styles.weekHeaderCell, { color: colors.textMuted }]}>
            {w}
          </Text>
        ))}
      </View>

      {weeks.map((row, i) => (
        <View key={i} style={styles.weekRow}>
          {row.map((date, j) => {
            if (!date) return <View key={j} style={styles.dayCell} />;
            const iso = jsDateToIsoDate(date);
            const plan = getDailyReadingPlan(iso, settings.country, settings.divisionScheme);
            const done = Boolean(progress.days[iso]?.completedAt);
            const disabled = plan.isRestDay;
            return (
              <Pressable
                key={j}
                style={styles.dayCell}
                disabled={disabled}
                onPress={() => router.push({ pathname: '/reading', params: { date: iso } })}
              >
                <View
                  style={[
                    styles.dayCircle,
                    done && { backgroundColor: colors.success },
                    !done && !disabled && { borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  <Text style={[styles.dayNumber, { color: done ? '#fff' : disabled ? colors.textMuted : colors.text }]}>
                    {date.getDate()}
                  </Text>
                </View>
                <Text style={styles.dayMark}>{done ? '✅' : disabled ? '' : '○'}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right', marginBottom: 16 },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  navArrow: { fontSize: 30, fontFamily: fonts.sansBold, paddingHorizontal: 12 },
  monthLabel: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.title },
  weekHeaderRow: { flexDirection: 'row', marginBottom: 6 },
  weekHeaderCell: { flex: 1, textAlign: 'center', fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.caption },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  dayCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body },
  dayMark: { fontSize: 10, marginTop: 2 },
});
