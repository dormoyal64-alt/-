import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { PrimaryButton } from '@/components/PrimaryButton';
import { VerseBlock } from '@/components/VerseBlock';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';
import { useDailyPlan } from '@/hooks/useDailyPlan';
import { useReadingContent } from '@/hooks/useReadingContent';
import { getDayCalendarInfo, todayIsoDate } from '@/services/calendar';
import { isWeekFullyCompleted, makeIsRestDayFn } from '@/services/streak/streakEngine';
import type { AliyahContent } from '@/services/torah/readingContent';

export default function ReadingScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const date = params.date ?? todayIsoDate();
  const { settings, progress, completeVerse, completeDay } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();

  const plan = useDailyPlan(date);
  const { loading, error, content } = useReadingContent(plan);

  const [aliyahIndex, setAliyahIndex] = useState(0);
  const [revealedCommentary, setRevealedCommentary] = useState<Set<number>>(new Set());
  const startedAt = useRef(Date.now());

  useEffect(() => {
    startedAt.current = Date.now();
  }, [date]);

  const dayProgress = progress.days[date];
  const alreadyDone = Boolean(dayProgress?.completedAt);

  const finish = async () => {
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    const isShabbatDay = getDayCalendarInfo(date, settings.country === 'IL').isShabbat;
    const completingInAdvance = date > todayIsoDate();
    const updated = await completeDay(date, {
      secondsSpentReading: seconds,
      completedBeforeShabbat: isShabbatDay && completingInAdvance,
    });
    const isRestDay = makeIsRestDayFn(settings.country, settings.divisionScheme);
    if (isWeekFullyCompleted(plan.weekContext.shabbatDate, updated.days, isRestDay)) {
      Alert.alert('כל הכבוד! 🎉', 'השלמת שבוע מלא של שניים מקרא ואחד תרגום.');
    }
    router.back();
  };

  if (plan.isRestDay) {
    return (
      <ScreenContainer>
        <BackLink router={router} colors={colors} />
        <Text style={[styles.title, { color: colors.text }]}>{plan.weekContext.parasha?.displayNameHe ?? 'אין קריאה היום'}</Text>
        <Text style={[styles.note, { color: colors.textMuted }]}>
          {plan.weekContext.note ?? 'אין קטע חדש לשניים מקרא ואחד תרגום ביום זה.'}
        </Text>
      </ScreenContainer>
    );
  }

  if (loading) {
    return (
      <ScreenContainer scroll={false} contentContainerStyle={styles.centerFill}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.textMuted, marginTop: 12 }}>טוען טקסט...</Text>
      </ScreenContainer>
    );
  }

  if (error || !content) {
    return (
      <ScreenContainer>
        <BackLink router={router} colors={colors} />
        <Text style={[styles.note, { color: colors.danger }]}>
          {error ?? 'לא ניתן לטעון את הטקסט כרגע.'}
        </Text>
      </ScreenContainer>
    );
  }

  const showAliyah = (aliyah: AliyahContent, index: number) => {
    const showCommentary = !settings.hideCommentary && aliyah.commentary;
    const isRevealed = !settings.revealCommentaryAfterReading || revealedCommentary.has(index);
    return (
      <View key={aliyah.aliyah}>
        {aliyah.verses.map((v) => (
          <VerseBlock key={v.refLabel} verse={v} />
        ))}
        {showCommentary && (
          <View style={[styles.commentaryBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.commentaryLabel, { color: colors.accent }]}>פירוש — הסבר קצר</Text>
            {isRevealed ? (
              <Text style={[styles.commentaryText, { color: colors.text }]}>{aliyah.commentary!.text}</Text>
            ) : (
              <Pressable onPress={() => setRevealedCommentary((s) => new Set(s).add(index))}>
                <Text style={[styles.revealLink, { color: colors.primary }]}>הצג פירוש</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    );
  };

  const markVersesAndAdvance = async (aliyah: AliyahContent) => {
    for (const v of aliyah.verses) {
      await completeVerse(date, v.refLabel, content.totalVerses);
    }
  };

  if (settings.readingMode === 'verse-by-verse') {
    const current = content.aliyot[aliyahIndex];
    const isLast = aliyahIndex === content.aliyot.length - 1;
    return (
      <ScreenContainer>
        <BackLink router={router} colors={colors} />
        <Header content={content} colors={colors} />
        {showAliyah(current, aliyahIndex)}
        <PrimaryButton
          title={isLast ? 'סיימתי את הקריאה של היום ✅' : 'סיימתי את הפסוק'}
          size="large"
          onPress={async () => {
            await markVersesAndAdvance(current);
            if (isLast) {
              await finish();
            } else {
              setAliyahIndex((i) => i + 1);
            }
          }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <BackLink router={router} colors={colors} />
      <Header content={content} colors={colors} />
      {content.aliyot.map((a, i) => showAliyah(a, i))}
      <PrimaryButton
        title={alreadyDone ? 'סיימת את הקריאה של היום ✅' : 'סיימתי את הקריאה של היום'}
        size="large"
        disabled={alreadyDone}
        onPress={async () => {
          for (const a of content.aliyot) {
            await markVersesAndAdvance(a);
          }
          await finish();
        }}
      />
    </ScreenContainer>
  );
}

function BackLink({ router, colors }: { router: ReturnType<typeof useRouter>; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <Pressable onPress={() => router.back()}>
      <Text style={[styles.back, { color: colors.primary }]}>‹ חזרה</Text>
    </Pressable>
  );
}

function Header({ content, colors }: { content: NonNullable<ReturnType<typeof useReadingContent>['content']>; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <View style={styles.header}>
      <Text style={[styles.title, { color: colors.text }]}>{content.plan.weekContext.parasha?.displayNameHe}</Text>
      <Text style={[styles.attribution, { color: colors.textMuted }]}>
        {content.mikraAttribution.sourceName} · {content.targumAttribution.sourceName}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body, marginBottom: 8, textAlign: 'right' },
  header: { marginBottom: 12 },
  title: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right' },
  attribution: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.caption, textAlign: 'right', marginTop: 2 },
  note: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.body, textAlign: 'right', lineHeight: 22, marginTop: 12 },
  commentaryBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
  commentaryLabel: { fontFamily: fonts.sansBold, fontSize: 12, textAlign: 'right', marginBottom: 6 },
  commentaryText: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.body, textAlign: 'right', lineHeight: 22 },
  revealLink: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body, textAlign: 'right' },
});
