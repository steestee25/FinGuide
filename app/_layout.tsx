// app/_layout.tsx
import LoadingIndicator from '@/components/LoadingIndicator'
import * as Linking from 'expo-linking'
import { Slot, Stack, usePathname } from 'expo-router'
import { AppState, Platform, StyleSheet, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import CelebrationScreen from '../components/CelebrationScreen'
import { AuthProvider, useAuth } from '../contexts/AuthContext'
import { BENCHMARK_ENABLED } from '../lib/benchmark/flag'
import { I18nProvider } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import Auth from './auth'

// Global listener that starts/stops auto token refresh based on app state
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})

function RootLayoutContent() {
  // Get auth state values from context
  const { session, loading, isOnboarding, isCelebrating, endCelebration } = useAuth()
  const pathname = usePathname()
  const url = Linking.useURL()

  // The benchmark runs offline and needs no account (benchmark builds only).
  // The deep link is checked as well: offline with an expired token the auth
  // load never ends, no navigator mounts, and the pathname stays '/'.
  if (BENCHMARK_ENABLED && (pathname.startsWith('/benchmark') || url?.includes('://benchmark'))) return <Slot />

  if (loading) return <LoadingIndicator />
  if (isCelebrating) return <CelebrationScreen onFinish={endCelebration} />
  if (!session || isOnboarding) return <Auth /> // Show auth stack (login/signup/onboarding)

  // In all other cases, show the main app stack (tabs)
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AuthProvider>
          <View style={Platform.OS === 'web' ? styles.webContainer : styles.mobileContainer}>
            <RootLayoutContent />
          </View>
        </AuthProvider>
      </I18nProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    maxWidth: 768,
    marginHorizontal: 'auto',
    width: '100%',
  } as any,
  mobileContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
})
