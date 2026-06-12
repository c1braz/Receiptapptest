import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Btn, Card, Chip, ErrorText, Field, Muted, colors } from '../ui';

const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'level1', label: 'Level 1 · Cardholder' },
  { key: 'level2', label: 'Level 2 · Non-cardholder' },
];

const EMPTY = { name: '', email: '', phone: '', role: 'level2', cardholder_name: '', card_last_four: '' };

export default function UserManagementScreen() {
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null); // null | {id?, ...form}
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setUsers((await api.users.list()).users); } catch (err) { setError(err.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    const f = editing;
    if (!f.name || !f.email) return setError('Name and email are required.');
    if (f.role === 'level1' && !f.cardholder_name) return setError('Level 1 users need the cardholder name exactly as it appears on AMEX statements.');
    setBusy(true);
    setError('');
    try {
      if (f.id) {
        await api.users.update(f.id, f);
      } else {
        const res = await api.users.create(f);
        if (res.temp_password) {
          Alert.alert('User created', `Temporary password for ${f.name}:\n\n${res.temp_password}\n\nShare it securely; they should change it after first login.`);
        }
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = (u) => {
    Alert.alert(
      u.active ? 'Deactivate user?' : 'Reactivate user?',
      u.active ? `${u.name} will no longer be able to log in or be assigned charges.` : `${u.name} will regain access.`,
      [{ text: 'Cancel' }, {
        text: 'Yes',
        onPress: async () => {
          try { await api.users.update(u.id, { active: u.active ? 0 : 1 }); await load(); }
          catch (err) { Alert.alert('Error', err.message); }
        },
      }],
    );
  };

  if (editing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 }}>
          {editing.id ? `Edit ${editing.name}` : 'Add user'}
        </Text>
        <Field label="Full name" value={editing.name} onChangeText={(v) => setEditing({ ...editing, name: v })} autoCapitalize="words" />
        <Field label="Email" value={editing.email} onChangeText={(v) => setEditing({ ...editing, email: v })} keyboardType="email-address" />
        <Field label="Phone (for future SMS reminders)" value={editing.phone || ''} onChangeText={(v) => setEditing({ ...editing, phone: v })} keyboardType="phone-pad" />
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6 }}>Role</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
          {ROLES.map((r) => (
            <Chip key={r.key} label={r.label} selected={editing.role === r.key} onPress={() => setEditing({ ...editing, role: r.key })} />
          ))}
        </View>
        {editing.role === 'level1' && (
          <>
            <Field label="Cardholder name (exactly as on AMEX statement)" value={editing.cardholder_name || ''} onChangeText={(v) => setEditing({ ...editing, cardholder_name: v })} autoCapitalize="characters" />
            <Field label="Card last four digits" value={editing.card_last_four || ''} onChangeText={(v) => setEditing({ ...editing, card_last_four: v })} keyboardType="number-pad" maxLength={4} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Btn title="Save" onPress={save} loading={busy} />
        <Btn title="Cancel" kind="secondary" onPress={() => { setEditing(null); setError(''); }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 12 }}>
        <Btn title="+ Add user" onPress={() => setEditing({ ...EMPTY })} />
        <ErrorText>{error}</ErrorText>
      </View>
      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32 }}
        renderItem={({ item: u }) => (
          <TouchableOpacity onPress={() => setEditing({ ...u })} onLongPress={() => toggleActive(u)}>
            <Card style={!u.active ? { opacity: 0.5 } : null}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{u.name}</Text>
                <Muted>{ROLES.find((r) => r.key === u.role)?.label || u.role}{u.active ? '' : ' · INACTIVE'}</Muted>
              </View>
              <Muted>{u.email}{u.card_last_four ? ` · card …${u.card_last_four}` : ''}</Muted>
              <Muted style={{ fontSize: 11 }}>Tap to edit · long-press to {u.active ? 'deactivate' : 'reactivate'}</Muted>
            </Card>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
