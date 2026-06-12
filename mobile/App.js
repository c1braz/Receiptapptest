import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { colors } from './src/ui';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SubmitReceiptScreen from './src/screens/SubmitReceiptScreen';
import ChargesScreen from './src/screens/ChargesScreen';
import ChargeDetailScreen from './src/screens/ChargeDetailScreen';
import MyReceiptsScreen from './src/screens/MyReceiptsScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import UserManagementScreen from './src/screens/UserManagementScreen';
import AdminSettingsScreen from './src/screens/AdminSettingsScreen';

const Stack = createNativeStackNavigator();

function Router() {
  const { user, booting } = useAuth();
  if (booting) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return (
    <Stack.Navigator screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: { color: colors.text } }}>
      {!user ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Receipts' }} />
          <Stack.Screen name="SubmitReceipt" component={SubmitReceiptScreen} options={{ title: 'Submit Receipt' }} />
          <Stack.Screen name="Charges" component={ChargesScreen} options={{ title: 'Charges' }} />
          <Stack.Screen name="ChargeDetail" component={ChargeDetailScreen} options={{ title: 'Charge' }} />
          <Stack.Screen name="MyReceipts" component={MyReceiptsScreen} options={{ title: 'Receipts' }} />
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard' }} />
          <Stack.Screen name="UserManagement" component={UserManagementScreen} options={{ title: 'Users' }} />
          <Stack.Screen name="AdminSettings" component={AdminSettingsScreen} options={{ title: 'Settings' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <StatusBar style="dark" />
        <Router />
      </NavigationContainer>
    </AuthProvider>
  );
}
