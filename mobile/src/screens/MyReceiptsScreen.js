import React, { useCallback, useState } from 'react';
import { FlatList, Image, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api, dollars } from '../api/client';
import { Card, Chip, Muted, colors } from '../ui';

export default function MyReceiptsScreen() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { receipts } = await api.receipts.list(isAdmin && unmatchedOnly);
      setRows(receipts);
    } catch { /* pull to refresh retries */ }
  }, [isAdmin, unmatchedOnly]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {isAdmin && (
        <View style={{ flexDirection: 'row', padding: 12, paddingBottom: 0 }}>
          <Chip label="All" selected={!unmatchedOnly} onPress={() => setUnmatchedOnly(false)} />
          <Chip label="Unmatched only" selected={unmatchedOnly} onPress={() => setUnmatchedOnly(true)} />
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: 40 }}>No receipts yet.</Muted>}
        renderItem={({ item: r }) => (
          <Card>
            <View style={{ flexDirection: 'row' }}>
              {r.image_path ? (
                <Image
                  source={{ uri: api.receipts.imageUrl(r.id), headers: api.receipts.imageHeaders() }}
                  style={{ width: 64, height: 64, borderRadius: 8, marginRight: 12 }}
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>
                  {dollars(r.amount_cents)} · {r.merchant_name || '—'}
                </Text>
                <Muted>{r.transaction_date || 'no date'}{r.category ? ` · ${r.category}` : ''}</Muted>
                {isAdmin && r.submitted_by_name ? <Muted>by {r.submitted_by_name}</Muted> : null}
                <Muted>
                  {r.jotform_submission_id ? 'Synced with Jotform ✓' : r.jotform_status === 'failed' ? 'Jotform sync pending retry' : ''}
                </Muted>
              </View>
            </View>
          </Card>
        )}
      />
    </View>
  );
}
