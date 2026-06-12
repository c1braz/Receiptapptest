import React, { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { api, dollars } from '../api/client';
import { Btn, Card, Chip, ErrorText, Field, Muted, colors } from '../ui';

// Fallbacks if the backend hasn't synced options from Jotform yet.
const DEFAULT_CATEGORIES = ['Supplies', 'Wine / Beverage', 'Class / Program Materials', 'Food & Hospitality', 'Travel', 'Equipment', 'Marketing', 'Other'];
const DEFAULT_LINE_ITEMS = ['Class/Camp Supplies', 'Office Supplies', 'Event Expenses', 'Concessions & Retail Expenses', 'Meals & Entertainment', 'Props', 'Costume', 'Sets', 'Printing and Reproduction', 'Repairs & Maintanence'];

export default function SubmitReceiptScreen({ navigation, route }) {
  // When opened from a charge, fields arrive prefilled and the receipt links to it.
  const linkedCharge = route.params?.charge || null;
  const [image, setImage] = useState(null);
  const [amount, setAmount] = useState(linkedCharge ? (linkedCharge.amount_cents / 100).toFixed(2) : '');
  const [date, setDate] = useState(linkedCharge ? linkedCharge.transaction_date : '');
  const [merchant, setMerchant] = useState(linkedCharge ? linkedCharge.merchant_name : '');
  const [category, setCategory] = useState('');
  const [lineItem, setLineItem] = useState('');
  const [lineItemSearch, setLineItemSearch] = useState('');
  const [showLineItems, setShowLineItems] = useState(false);
  const [programClass, setProgramClass] = useState('');
  const [notes, setNotes] = useState('');
  const [options, setOptions] = useState({ category: DEFAULT_CATEGORIES, line_item: DEFAULT_LINE_ITEMS });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.receipts.formOptions()
      .then(({ options: live }) => setOptions({
        category: live.category?.length ? live.category : DEFAULT_CATEGORIES,
        line_item: live.line_item?.length ? live.line_item : DEFAULT_LINE_ITEMS,
      }))
      .catch(() => { /* fallbacks already set */ });
  }, []);

  const pickerOptions = { mediaTypes: ['images'], quality: 0.8 };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Camera unavailable',
        'Camera permission was denied. You can enable it in system Settings, or upload an existing photo instead.',
        [{ text: 'Upload instead', onPress: pickFromLibrary }, { text: 'OK' }],
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync(pickerOptions);
    if (!result.canceled) setImage(result.assets[0]);
  };

  const pickFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (!result.canceled) setImage(result.assets[0]);
  };

  const submit = async () => {
    if (!image) return setError('Add a receipt photo first.');
    if (!amount || !date || !merchant) return setError('Amount, date, and vendor are required.');
    if (!lineItem) return setError('Pick a line item (required for bookkeeping).');
    setBusy(true);
    setError('');
    try {
      const result = await api.receipts.submit({
        amount,
        transaction_date: date,
        merchant_name: merchant,
        category,
        line_item: lineItem,
        program_class: programClass,
        notes,
        transaction_id: linkedCharge ? linkedCharge.id : '',
      }, image);
      const dupNote = result.duplicate_image_warning
        ? '\n\nNote: this image looks identical to a previously submitted receipt — an admin will double-check.'
        : '';
      Alert.alert('Receipt submitted ✓', `Thanks! Finance will match it to the card charge.${dupNote}`,
        [{ text: 'Done', onPress: () => navigation.goBack() }]);
    } catch (err) {
      // Photo and fields stay in state so the user can simply retry.
      setError(`${err.message} — your photo and details are still here; tap Submit to retry.`);
    } finally {
      setBusy(false);
    }
  };

  const filteredLineItems = options.line_item.filter(
    (li) => !lineItemSearch || li.toLowerCase().includes(lineItemSearch.toLowerCase()),
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {linkedCharge && (
        <Card style={{ borderColor: colors.primary }}>
          <Muted>Submitting for charge</Muted>
          <Text style={{ fontWeight: '700', color: colors.text }}>
            {dollars(linkedCharge.amount_cents)} · {linkedCharge.merchant_name} · {linkedCharge.transaction_date}
          </Text>
        </Card>
      )}

      <Card>
        {image ? (
          <View>
            <Image source={{ uri: image.uri }} style={{ height: 220, borderRadius: 8, marginBottom: 10 }} resizeMode="cover" />
            <Btn title="Retake / choose different photo" kind="secondary" onPress={() => setImage(null)} />
          </View>
        ) : (
          <View>
            <Btn title="📷  Take photo of receipt" onPress={takePhoto} />
            <Btn title="🖼  Upload from photo library" kind="secondary" onPress={pickFromLibrary} />
          </View>
        )}
      </Card>

      <Field label="Transaction amount (USD) *" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="123.45" />
      <Field label="Transaction date *" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
      <Field label="Vendor / merchant *" value={merchant} onChangeText={setMerchant} placeholder="e.g. Blick Art Materials" autoCapitalize="words" />

      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6 }}>Purchase category</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
        {options.category.map((c) => (
          <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(category === c ? '' : c)} />
        ))}
      </View>

      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6 }}>Line item (bookkeeping) *</Text>
      <TouchableOpacity onPress={() => setShowLineItems(!showLineItems)}>
        <Card style={lineItem ? { borderColor: colors.primary } : null}>
          <Text style={{ color: lineItem ? colors.text : colors.muted, fontWeight: lineItem ? '600' : '400' }}>
            {lineItem || 'Tap to choose a line item…'}
          </Text>
        </Card>
      </TouchableOpacity>
      {showLineItems && (
        <Card>
          <Field value={lineItemSearch} onChangeText={setLineItemSearch} placeholder="Search line items…" />
          <View style={{ maxHeight: 260 }}>
            <ScrollView nestedScrollEnabled>
              {filteredLineItems.map((li) => (
                <TouchableOpacity
                  key={li}
                  style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  onPress={() => { setLineItem(li); setShowLineItems(false); setLineItemSearch(''); }}
                >
                  <Text style={{ color: colors.text }}>{li}</Text>
                </TouchableOpacity>
              ))}
              {filteredLineItems.length === 0 && <Muted>No line items match “{lineItemSearch}”.</Muted>}
            </ScrollView>
          </View>
        </Card>
      )}

      <Field label="Program / project (QBO class)" value={programClass} onChangeText={setProgramClass} placeholder="e.g. Summer Camp 2026" autoCapitalize="words" />
      <Field label="Notes / description" value={notes} onChangeText={setNotes} multiline placeholder="What was this purchase for?" style={{ minHeight: 60 }} />

      <ErrorText>{error}</ErrorText>
      <Btn title="Submit receipt" onPress={submit} loading={busy} disabled={!image} />
    </ScrollView>
  );
}
