import React, { useCallback, useState } from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api, dollars } from '../api/client';
import { Badge, Btn, Card, Chip, ErrorText, Muted, colors } from '../ui';

export default function ChargeDetailScreen({ navigation, route }) {
  const { user, isAdmin } = useAuth();
  const [tx, setTx] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [showAssign, setShowAssign] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.transactions.get(route.params.id);
      setTx(data.transaction);
      setCandidates(data.candidates);
    } catch (err) {
      setError(err.message);
    }
  }, [route.params.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!tx) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}><ErrorText>{error}</ErrorText></View>;
  }

  const canAssign = isAdmin || tx.cardholder_user_id === user.id;
  const act = (fn, confirmText) => async () => {
    const run = async () => {
      try { await fn(); await load(); } catch (err) { Alert.alert('Error', err.message); }
    };
    if (confirmText) Alert.alert('Confirm', confirmText, [{ text: 'Cancel' }, { text: 'Yes', onPress: run }]);
    else run();
  };

  const openAssign = async () => {
    try {
      const { users } = await api.users.assignable();
      setAssignees(users.filter((u) => u.id !== user.id));
      setShowAssign(true);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: colors.text }}>{dollars(tx.amount_cents)}</Text>
          <Badge status={tx.status} />
        </View>
        <Text style={{ fontSize: 16, color: colors.text, marginTop: 4 }}>{tx.merchant_name}</Text>
        <Muted>Transaction date: {tx.transaction_date}{tx.posted_date ? ` · posted ${tx.posted_date}` : ''}</Muted>
        <Muted>Cardholder: {tx.cardholder_name_display || 'unknown'}{tx.card_last_four ? ` (…${tx.card_last_four})` : ''}</Muted>
        {tx.assigned_user_name ? <Muted>Assigned to: {tx.assigned_user_name}</Muted> : null}
        {tx.external_transaction_id ? <Muted>AMEX ref: {tx.external_transaction_id}</Muted> : null}
      </Card>

      {['outstanding', 'likely'].includes(tx.status) && (
        <Btn title="📷  Submit receipt for this charge" onPress={() => navigation.navigate('SubmitReceipt', { charge: tx })} />
      )}

      {canAssign && ['outstanding', 'likely'].includes(tx.status) && !showAssign && (
        <Btn title="Someone else used this card → assign charge" kind="secondary" onPress={openAssign} />
      )}
      {showAssign && (
        <Card>
          <Text style={{ fontWeight: '600', color: colors.text, marginBottom: 8 }}>Who used the card?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {assignees.map((u) => (
              <Chip
                key={u.id}
                label={u.name}
                onPress={act(async () => {
                  await api.transactions.assign(tx.id, u.id);
                  setShowAssign(false);
                  Alert.alert('Assigned', `${u.name} will now receive the reminders for this charge.`);
                })}
              />
            ))}
          </View>
          <Btn title="Cancel" kind="secondary" onPress={() => setShowAssign(false)} />
        </Card>
      )}

      {candidates.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.muted, marginBottom: 8 }}>
            POSSIBLE MATCHING RECEIPTS
          </Text>
          {candidates.map((c) => (
            <Card key={c.id} style={c.status === 'confirmed' ? { borderColor: colors.statusColors.matched } : null}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{dollars(c.receipt_amount_cents)} · {c.receipt_merchant || '—'}</Text>
                <Text style={{ fontWeight: '800', color: c.confidence_score >= 80 ? colors.statusColors.matched : colors.statusColors.likely }}>
                  {c.confidence_score}%
                </Text>
              </View>
              <Muted>
                {c.receipt_date || 'no date'} · by {c.submitted_by_name || 'unknown'}
                {c.status === 'confirmed' ? ' · ✓ CONFIRMED' : ''}
              </Muted>
              {c.has_image ? (
                <Image
                  source={{ uri: api.receipts.imageUrl(c.receipt_id), headers: api.receipts.imageHeaders() }}
                  style={{ height: 140, borderRadius: 8, marginTop: 8 }}
                  resizeMode="cover"
                />
              ) : null}
              {isAdmin && c.status === 'suggested' && ['outstanding', 'likely'].includes(tx.status) && (
                <Btn title="Confirm this match" onPress={act(() => api.transactions.confirmMatch(tx.id, c.receipt_id))} />
              )}
            </Card>
          ))}
        </View>
      )}

      {isAdmin && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.muted, marginBottom: 8 }}>ADMIN ACTIONS</Text>
          {tx.status === 'matched' && (
            <>
              <Btn title="Archive (move to reconciled)" onPress={act(() => api.transactions.archive(tx.id))} />
              <Btn title="Undo match" kind="danger" onPress={act(() => api.transactions.undoMatch(tx.id), 'Undo this match? The charge returns to outstanding.')} />
            </>
          )}
          {tx.status === 'archived' && (
            <>
              <Btn title="Unarchive" kind="secondary" onPress={act(() => api.transactions.unarchive(tx.id))} />
              {tx.matched_receipt_id ? <Btn title="Undo match" kind="danger" onPress={act(() => api.transactions.undoMatch(tx.id), 'Undo this match? The charge returns to outstanding.')} /> : null}
            </>
          )}
          {['outstanding', 'likely'].includes(tx.status) && (
            <Btn title="Ignore (no receipt expected)" kind="danger" onPress={act(() => api.transactions.ignore(tx.id), 'Mark this charge as ignored? Reminders will stop.')} />
          )}
          {tx.status === 'ignored' && (
            <Btn title="Restore to outstanding" kind="secondary" onPress={act(() => api.transactions.unarchive(tx.id).catch(() => api.transactions.undoMatch(tx.id)))} />
          )}
        </View>
      )}
    </ScrollView>
  );
}
