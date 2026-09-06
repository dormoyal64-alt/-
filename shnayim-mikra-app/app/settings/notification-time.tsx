import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { SettingSectionTitle, SettingSwitchRow } from '@/components/SettingRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';

const DAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const SNOOZE_OPTIONS = [10, 30, 60];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export default function NotificationTimeScreen() {
  const { settings, updateSettings } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();
  const notif = settings.notifications;

  const setTime = (hour: number, minute: number) => updateSettings({ notifications: { ...notif, hour, minute } });
  const toggleDay = (day: number) => {
    const activeDays = notif.activeDays.includes(day)
      ? notif.activeDays.filter((d) => d !== day)
      : [...notif.activeDays, day].sort();
    updateSettings({ notifications: { ...notif, activeDays } });
  };

  return (
    <ScreenContainer>
      <Pressable onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>‹ חזרה</Text>
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]}>תזכורת יומית</Text>

      <SettingSwitchRow
        label="הפעל תזכורת יומית"
        value={notif.enabled}
        onValueChange={(enabled) => updateSettings({ notifications: { ...notif, enabled } })}
      />

      <SettingSectionTitle>שעה</SettingSectionTitle>
      <View style={styles.timeRow}>
        <Stepper value={notif.hour} min={0} max={23} onChange={(hour) => setTime(hour, notif.minute)} colors={colors} />
        <Text style={[styles.colon, { color: colors.text }]}>:</Text>
        <Stepper
          value={notif.minute}
          min={0}
          max={55}
          step={5}
          onChange={(minute) => setTime(notif.hour, minute)}
          colors={colors}
        />
      </View>
      <Text style={[styles.bigTime, { color: colors.primary }]}>
        {pad(notif.hour)}:{pad(notif.minute)}
      </Text>

      <SettingSectionTitle>ימים פעילים</SettingSectionTitle>
      <View style={styles.daysRow}>
        {DAY_LABELS.map((label, i) => {
          const active = notif.activeDays.includes(i);
          return (
            <Pressable
              key={i}
              onPress={() => toggleDay(i)}
              style={[
                styles.dayChip,
                { backgroundColor: active ? colors.primary : colors.surfaceAlt, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? colors.primaryText : colors.text, fontFamily: fonts.sansMedium }}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <SettingSectionTitle>הזכר לי מאוחר יותר (Snooze)</SettingSectionTitle>
      <View style={styles.daysRow}>
        {SNOOZE_OPTIONS.map((minutes) => {
          const active = notif.snoozeMinutes === minutes;
          return (
            <Pressable
              key={minutes}
              onPress={() => updateSettings({ notifications: { ...notif, snoozeMinutes: minutes } })}
              style={[
                styles.snoozeChip,
                { backgroundColor: active ? colors.primary : colors.surfaceAlt, borderColor: colors.border },
              ]}
            >
              <Text style={{ color: active ? colors.primaryText : colors.text, fontFamily: fonts.sansMedium }}>
                {minutes} דק׳
              </Text>
            </Pressable>
          );
        })}
      </View>

      <PrimaryButton title="שמור וחזרה" onPress={() => router.back()} />
    </ScreenContainer>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  colors,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(clamp(value + step > max ? min : value + step))}
        style={[styles.stepperBtn, { backgroundColor: colors.surfaceAlt }]}
      >
        <Text style={{ color: colors.primary, fontSize: 20 }}>+</Text>
      </Pressable>
      <Text style={[styles.stepperValue, { color: colors.text }]}>{pad(value)}</Text>
      <Pressable
        onPress={() => onChange(clamp(value - step < min ? max : value - step))}
        style={[styles.stepperBtn, { backgroundColor: colors.surfaceAlt }]}
      >
        <Text style={{ color: colors.primary, fontSize: 20 }}>−</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body, marginBottom: 8, textAlign: 'right' },
  title: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right', marginBottom: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 },
  colon: { fontSize: 24, fontFamily: fonts.sansBold },
  bigTime: {
    textAlign: 'center',
    fontFamily: fonts.serifBold,
    fontSize: 40,
    marginVertical: 12,
  },
  daysRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  dayChip: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  snoozeChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, borderWidth: 1 },
  stepper: { alignItems: 'center', gap: 6 },
  stepperBtn: { width: 44, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.title, minWidth: 40, textAlign: 'center' },
});
