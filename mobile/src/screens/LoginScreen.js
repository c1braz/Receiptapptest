import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Btn, Field, ErrorText, Muted, colors } from '../ui';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) return setError('Enter your email and password.');
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }}
    >
      <Text style={{ fontSize: 30, fontWeight: '800', color: colors.text, marginBottom: 4 }}>Receipts</Text>
      <Muted style={{ marginBottom: 24 }}>AMEX receipt intake & reconciliation</Muted>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <Btn title="Sign in" onPress={submit} loading={busy} />
      <View style={{ marginTop: 16 }}>
        <Muted>Forgot your password? Ask an administrator to reset it.</Muted>
      </View>
    </KeyboardAvoidingView>
  );
}
