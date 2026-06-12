import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api, dollars } from '../api/client';
import { Btn, Card, Muted, colors } from '../ui';

export default function HomeScreen({ navigation }) {
  const { user, isAdmin, logout } = useAuth();
  const [openCharges, setOpenCharges] = useState([]);
  const [receiptCount, setReceiptCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [tx, rc] = await Promise.all([api.transactions.list('open'), api.receipts.list()]);
      setOpenCharges(tx.transactions);
      setReceiptCount(rc.receipts.length);
    } catch { /* pull-to-refresh will retry */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const assignedToMe = openCharges.filter((t) => t.assigned_user_id === user.id);
  const openAmount = openCharges.reduce((sum, t) => sum + t.amount_cents, 0);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 12 }}>
        Hi, {user.name.split(' ')[0]}
      </Text>

      <Btn title="📷  Submit Receipt" onPress={() => navigation.navigate('SubmitReceipt')} style={{ paddingVertical: 18 }} />

      <TouchableOpacity onPress={() => navigation.navigate('Charges', { status: 'open' })}>
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
            {isAdmin ? 'Outstanding charges' : 'My outstanding charges'}
          </Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.statusColors.outstanding }}>
            {openCharges.length}
          </Text>
          <Muted>{dollars(openAmount)} awaiting receipts — tap to view</Muted>
        </Card>
      </TouchableOpacity>

      {assignedToMe.length > 0 && (
        <TouchableOpacity onPress={() => navigation.navigate('Charges', { status: 'open', assignedOnly: true })}>
          <Card>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>Charges assigned to me</Text>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.statusColors.likely }}>{assignedToMe.length}</Text>
            <Muted>Someone lent you their card — these need your receipts</Muted>
          </Card>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => navigation.navigate('MyReceipts')}>
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
            {isAdmin ? 'All receipts' : 'My submitted receipts'}
          </Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.primary }}>{receiptCount}</Text>
        </Card>
      </TouchableOpacity>

      {isAdmin && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.muted, marginBottom: 8 }}>ADMIN</Text>
          <Btn title="Dashboard" kind="secondary" onPress={() => navigation.navigate('AdminDashboard')} />
          <Btn title="Manage Users" kind="secondary" onPress={() => navigation.navigate('UserManagement')} />
          <Btn title="Settings & Imports" kind="secondary" onPress={() => navigation.navigate('AdminSettings')} />
        </View>
      )}

      <Btn title="Sign out" kind="secondary" onPress={logout} style={{ marginTop: 24 }} />
    </ScrollView>
  );
}
