// Tiny shared UI kit so screens stay consistent.
import React from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet, ActivityIndicator } from 'react-native';

export const colors = {
  primary: '#0a7c66',
  danger: '#c0392b',
  text: '#1c2733',
  muted: '#687585',
  bg: '#f4f6f8',
  card: '#ffffff',
  border: '#dde3ea',
  statusColors: {
    outstanding: '#c0392b',
    likely: '#d68910',
    matched: '#1e8449',
    archived: '#5d6d7e',
    ignored: '#909497',
  },
};

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Field({ label, style, ...props }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput
        style={[s.input, style]}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        {...props}
      />
    </View>
  );
}

export function Btn({ title, onPress, kind = 'primary', disabled, loading, style }) {
  const bg = disabled ? '#aab7c2' : kind === 'danger' ? colors.danger : kind === 'secondary' ? '#fff' : colors.primary;
  const fg = kind === 'secondary' ? colors.primary : '#fff';
  return (
    <TouchableOpacity
      style={[s.btn, { backgroundColor: bg, borderWidth: kind === 'secondary' ? 1 : 0, borderColor: colors.primary }, style]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: 16 }}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function Badge({ status }) {
  return (
    <View style={[s.badge, { backgroundColor: colors.statusColors[status] || colors.muted }]}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{(status || '').toUpperCase()}</Text>
    </View>
  );
}

export function Chip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.chip, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
    >
      <Text style={{ color: selected ? '#fff' : colors.text, fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <Text style={{ color: colors.danger, marginBottom: 10 }}>{children}</Text>;
}

export function Muted({ children, style }) {
  return <Text style={[{ color: colors.muted, fontSize: 13 }, style]}>{children}</Text>;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 4 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: colors.text,
  },
  btn: { borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginVertical: 5 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12,
    paddingVertical: 6, marginRight: 8, marginBottom: 8, backgroundColor: '#fff',
  },
});
