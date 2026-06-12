import React, { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api, dollars } from '../api/client';
import { Badge, Card, Chip, Muted, colors } from '../ui';

const FILTERS = [
  { key: 'open', label: 'Outstanding' },
  { key: 'matched', label: 'Matched' },
  { key: 'archived', label: 'Archived' },
  { key: 'ignored', label: 'Ignored' },
];

export default function ChargesScreen({ navigation, route }) {
  const { user } = useAuth();
  const [filter, setFilter] = useState(route.params?.status || 'open');
  const [assignedOnly] = useState(route.params?.assignedOnly || false);
  const [rows, setRows] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const { transactions } = await api.transactions.list(filter);
      setRows(assignedOnly ? transactions.filter((t) => t.assigned_user_id === user.id) : transactions);
    } catch (err) {
      setError(err.message);
    }
  }, [filter, assignedOnly, user.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, paddingBottom: 4 }}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
        ))}
      </View>
      {error ? <Muted style={{ paddingHorizontal: 16, color: colors.danger }}>{error}</Muted> : null}
      <FlatList
        data={rows}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: 40 }}>No charges here. 🎉</Muted>}
        renderItem={({ item: t }) => (
          <TouchableOpacity onPress={() => navigation.navigate('ChargeDetail', { id: t.id })}>
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontWeight: '700', fontSize: 17, color: colors.text }}>{dollars(t.amount_cents)}</Text>
                <Badge status={t.status} />
              </View>
              <Text style={{ color: colors.text, marginBottom: 2 }} numberOfLines={1}>{t.merchant_name}</Text>
              <Muted>
                {t.transaction_date}
                {t.cardholder_name_display ? ` · card: ${t.cardholder_name_display}` : ' · unassigned card'}
                {t.assigned_user_name ? ` · assigned to ${t.assigned_user_name}` : ''}
              </Muted>
              {t.status === 'likely' && <Muted style={{ color: colors.statusColors.likely }}>Possible receipt found — {t.match_confidence}% confidence</Muted>}
            </Card>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
