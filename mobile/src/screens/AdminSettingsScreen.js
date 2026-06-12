import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Btn, Card, ErrorText, Field, Muted, colors } from '../ui';

export default function AdminSettingsScreen() {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [formId, setFormId] = useState('');
  const [schedule, setSchedule] = useState({});
  const [autoMatch, setAutoMatch] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await api.settings.get();
      setSettings(s);
      setFormId(s.jotform_form_id || '');
      setSchedule(s.reminder_schedule);
      setAutoMatch(Boolean(s.auto_match_enabled));
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const run = (name, fn, successMsg) => async () => {
    setBusy(name);
    setError('');
    try {
      const result = await fn();
      if (successMsg) Alert.alert('Done', typeof successMsg === 'function' ? successMsg(result) : successMsg);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  if (!settings) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}><ErrorText>{error}</ErrorText></View>;
  }

  const numField = (key, label) => (
    <View key={key} style={{ flex: 1, marginRight: 8 }}>
      <Field
        label={label}
        value={String(schedule[key] ?? '')}
        onChangeText={(v) => setSchedule({ ...schedule, [key]: Number(v) || 0 })}
        keyboardType="number-pad"
      />
    </View>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 64 }}>
      <ErrorText>{error}</ErrorText>

      <Text style={s.h}>JOTFORM CONNECTION</Text>
      <Card>
        <Muted style={{ marginBottom: 8 }}>
          API key: {settings.jotform_api_key_masked || 'not set'} · Form: {settings.jotform_form_id || 'not set'}
        </Muted>
        <Field label="Jotform API key (leave blank to keep current)" value={apiKey} onChangeText={setApiKey} secureTextEntry placeholder="••••••••" />
        <Field label="Jotform form ID" value={formId} onChangeText={setFormId} placeholder="261617924502052" />
        <Btn
          title="Save Jotform settings"
          loading={busy === 'jf'}
          onPress={run('jf', () => api.settings.update({
            ...(apiKey ? { jotform_api_key: apiKey } : {}),
            jotform_form_id: formId,
          }), 'Jotform settings saved.')}
        />
        <Btn title="Refresh field map (after editing the form)" kind="secondary" loading={busy === 'map'}
          onPress={run('map', api.settings.refreshJotformMap, (r) => r.missing?.length
            ? `Map refreshed, but unmapped required fields: ${r.missing.join(', ')}. Check the form labels.`
            : 'Field map refreshed — all required fields mapped.')} />
        <Btn title="Sync submissions from Jotform now" kind="secondary" loading={busy === 'sync'}
          onPress={run('sync', api.settings.syncJotform, (r) => `Imported ${r.imported} new submissions.`)} />
        {settings.jotform_map_warnings?.length > 0 && (
          <Muted style={{ color: colors.danger }}>
            ⚠ Unmapped required fields: {settings.jotform_map_warnings.join(', ')}
          </Muted>
        )}
      </Card>

      <Text style={s.h}>AMEX IMPORT (CSV)</Text>
      <Card>
        <Muted style={{ marginBottom: 8 }}>
          Download the CSV from AMEX online (Statements & Activity → Download), open it, and paste its contents here.
          Duplicates are skipped automatically, so overlapping date ranges are safe.
        </Muted>
        <Field
          label="CSV contents"
          value={csvText}
          onChangeText={setCsvText}
          multiline
          placeholder="Date,Description,Card Member,Account #,Amount…"
          style={{ minHeight: 100, fontFamily: 'Courier' }}
        />
        <Btn
          title="Import charges"
          disabled={!csvText.trim()}
          loading={busy === 'csv'}
          onPress={run('csv', async () => {
            const r = await api.transactions.importCsv(csvText);
            setCsvText('');
            return r;
          }, (r) => `Imported ${r.imported} · duplicates skipped ${r.skipped_duplicates} · credits skipped ${r.skipped_credits}${r.errors?.length ? ` · row errors: ${r.errors.length}` : ''}`)}
        />
      </Card>

      <Text style={s.h}>REMINDER SCHEDULE (DAYS)</Text>
      <Card>
        <View style={{ flexDirection: 'row' }}>
          {numField('second', 'First reminder')}
          {numField('third', 'Second reminder')}
        </View>
        <View style={{ flexDirection: 'row' }}>
          {numField('escalate', 'Escalate to admin')}
          {numField('periodic', 'Repeat every')}
        </View>
        <Muted style={{ marginBottom: 8 }}>
          The initial email goes out as soon as a charge is imported. Reminders stop automatically once a charge is matched, ignored, or archived.
        </Muted>
        <Btn title="Save schedule" loading={busy === 'sched'}
          onPress={run('sched', () => api.settings.update({ reminder_schedule: schedule }), 'Reminder schedule saved.')} />
      </Card>

      <Text style={s.h}>MATCHING</Text>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>Auto-confirm high-confidence matches</Text>
            <Muted>Off (recommended): an admin reviews every match before it is confirmed.</Muted>
          </View>
          <Switch
            value={autoMatch}
            onValueChange={(v) => { setAutoMatch(v); run('am', () => api.settings.update({ auto_match_enabled: v }))(); }}
            trackColor={{ true: colors.primary }}
          />
        </View>
      </Card>

      <Text style={s.h}>SMS REMINDERS</Text>
      <Card>
        <Muted>
          Coming in a later phase. Phone numbers are already being collected on user profiles, and the reminder
          system is channel-ready — connecting an SMS provider (e.g. Twilio) here will enable text reminders.
        </Muted>
      </Card>
    </ScrollView>
  );
}

const s = {
  h: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 8 },
};
