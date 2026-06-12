import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, dollars } from '../api/client';
import { Card, ErrorText, Muted, colors } from '../ui';

function Stat({ label, value, color }) {
  return (
    <Card style={{ flex: 1, marginHorizontal: 4, alignItems: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: color || colors.text }}>{value}</Text>
      <Muted style={{ textAlign: 'center' }}>{label}</Muted>
    </Card>
  );
}

export default function AdminDashboardScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setError(''); setData(await api.dashboard()); }
    catch (err) { setError(err.message); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!data) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}><ErrorText>{error}</ErrorText></View>;
  }
  const { totals, byUser, oldest, likelyNeedingReview, recentlyReconciled } = data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={{ flexDirection: 'row', marginBottom: 8 }}>
        <Stat label="Outstanding" value={totals.open_count || 0} color={colors.statusColors.outstanding} />
        <Stat label="Likely matches" value={totals.likely_count || 0} color={colors.statusColors.likely} />
        <Stat label="Reconciled" value={(totals.matched_count || 0) + (totals.archived_count || 0)} color={colors.statusColors.matched} />
      </View>
      <Card>
        <Muted>Total outstanding amount</Muted>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.statusColors.outstanding }}>
          {dollars(totals.open_amount_cents || 0)}
        </Text>
      </Card>

      <Text style={s.h}>NEEDS REVIEW — LIKELY MATCHES</Text>
      {likelyNeedingReview.length === 0 && <Muted style={{ paddingHorizontal: 4 }}>Nothing waiting. 🎉</Muted>}
      {likelyNeedingReview.map((m) => (
        <TouchableOpacity key={`${m.transaction_id}-${m.receipt_id}`} onPress={() => navigation.navigate('ChargeDetail', { id: m.transaction_id })}>
          <Card style={{ borderColor: colors.statusColors.likely }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>
              {dollars(m.amount_cents)} · {m.merchant_name}
            </Text>
            <Muted>{m.transaction_date} · receipt match {m.confidence_score}% — tap to review</Muted>
          </Card>
        </TouchableOpacity>
      ))}

      <Text style={s.h}>MISSING RECEIPTS BY PERSON</Text>
      {byUser.map((u) => (
        <Card key={u.user_name}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>{u.user_name}</Text>
            <Text style={{ color: colors.statusColors.outstanding, fontWeight: '700' }}>
              {u.count} · {dollars(u.amount_cents)}
            </Text>
          </View>
        </Card>
      ))}

      <Text style={s.h}>OLDEST OUTSTANDING</Text>
      {oldest.map((t) => (
        <TouchableOpacity key={t.id} onPress={() => navigation.navigate('ChargeDetail', { id: t.id })}>
          <Card>
            <Text style={{ fontWeight: '600', color: colors.text }}>{dollars(t.amount_cents)} · {t.merchant_name}</Text>
            <Muted>{t.transaction_date} · {t.responsible_name || 'unassigned'}</Muted>
          </Card>
        </TouchableOpacity>
      ))}

      <Text style={s.h}>RECENTLY RECONCILED</Text>
      {recentlyReconciled.map((t) => (
        <TouchableOpacity key={t.id} onPress={() => navigation.navigate('ChargeDetail', { id: t.id })}>
          <Card>
            <Text style={{ fontWeight: '600', color: colors.text }}>{dollars(t.amount_cents)} · {t.merchant_name}</Text>
            <Muted>{t.transaction_date} · {t.status} · {t.responsible_name || '—'}</Muted>
          </Card>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = {
  h: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 8, paddingHorizontal: 4 },
};
