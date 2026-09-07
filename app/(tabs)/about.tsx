import { Entypo, Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import LanguageSelectorAbout from '../../components/LanguageSelectorAbout';
import { COLORS } from '../../constants/color';
import { useAuth } from '../../contexts/AuthContext';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import aboutStyles from '../../styles/components/about.styles';
import txnStyles from '../../styles/components/transactionModal.styles';
import ChangePasswordForm from '../components/ChangePasswordForm';

const Avatar = ({ uri, width = 56, height = 56 }: { uri?: string; width?: number; height?: number }) => (
  <View style={[styles.avatarWrap, { width, height, borderRadius: width / 2, overflow: 'hidden' }]}>
    <Image
      source={{ uri: 'https://picsum.photos/100' }}
      style={{ width: '100%', height: '100%' }}
    />
  </View>
)

function RowItem({ icon, label, onPress, right }: { icon?: React.ReactNode; label: string; onPress?: () => void; right?: React.ReactNode }) {
  const Left = (
    <View style={styles.rowLeft}>
      <View style={styles.iconPlaceholder}>{icon ?? null}</View>
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  )

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.row} android_ripple={{ color: '#eee' }}>
        {Left}
        {right ?? <Text style={styles.chev}>›</Text>}
      </Pressable>
    )
  }

  return (
    <View style={styles.row}>
      {Left}
      {right ?? <Text style={styles.chev}>›</Text>}
    </View>
  )
}

export default function AboutScreen() {
  const { session } = useAuth()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const [accountModalVisible, setAccountModalVisible] = useState(false)
  const [changePwdModalVisible, setChangePwdModalVisible] = useState(false)
  const [profile, setProfile] = useState<any>(null)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [devicesVisible, setDevicesVisible] = useState(false)
  const { locale, setLocale, t } = useTranslation()
  const [isItalian, setIsItalian] = useState(locale === 'it')

  useEffect(() => {
    if (!session?.user?.id) return

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', session.user.id)
          .single()

        if (error) {
          console.log('Error fetching profile:', error.message || error)
          return
        }

        setProfile(data || null)
      } catch (err) {
        console.log('Unexpected error fetching profile:', err)
      }
    }

    fetchProfile()
  }, [session])

  const displayName = profile?.full_name || session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'User'
  const displayEmail = session?.user?.email || ''
  const avatarUri = session?.user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=8b5cf6&color=fff`

  const handleLogout = async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      const { error } = await supabase.auth.signOut()
      if (error) {
        console.log('Logout error:', error.message || error)
      }
    } catch (err) {
      console.log('Unexpected logout error:', err)
    }
  }

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 20, justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: "#333", fontSize: 34, fontWeight: 'bold' }}>{t ? t('tabs.profile') : 'Profile'}</Text>
        </View>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <View style={styles.headerLeft}>
            <Avatar uri={avatarUri} width={56} height={56} />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.email}>{displayEmail}</Text>
            </View>
          </View>
          <Pressable style={styles.editBtn}>
            <Text style={styles.editText}> </Text>
          </Pressable>
        </View>

        <Modal
          visible={accountModalVisible}
          animationType="slide"
          transparent
          statusBarTranslucent={true}
          onRequestClose={() => setAccountModalVisible(false)}
        >
          <View style={[styles.modalOverlay, Platform.OS === 'web' && { justifyContent: 'center', alignItems: 'center' }]}>
            <Pressable style={styles.overlayFill} onPress={() => setAccountModalVisible(false)} />
            <View style={[styles.bottomSheet, Platform.OS === 'web' && { maxWidth: 768, width: '90%', marginHorizontal: 'auto' }]}>
              <View style={txnStyles.topRow}>
                <Text style={txnStyles.sheetTitle}>{t ? t('about.accountInformation') : 'Account Information'}</Text>
                <View style={txnStyles.iconClose}>
                  <TouchableOpacity onPress={async () => { try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch (e) { }; setAccountModalVisible(false) }}>
                    <Ionicons name="close" size={20} color="#333" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.headerLeftModal}>
                <Avatar uri={avatarUri} width={150} height={150} />
              </View>

              <View style={styles.whiteCard}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('about.username')}</Text>
                  <Text style={styles.chev}>{displayName}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('about.email')}</Text>
                  <Text style={styles.chev}>{displayEmail}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t ? t('about.phone') : 'Phone'}</Text>
                  <Text style={styles.chev}>{profile?.phone ?? '-'}</Text>
                </View>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t ? t('about.country') : 'Country'}</Text>
                  <Text style={styles.chev}>{profile?.country ?? 'Italy'}</Text>
                </View>
              </View>

              <Pressable
                onPress={async () => {
                  try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch (e) { }
                  console.log('Cancella account pressed (modal)')
                }}
                style={styles.redCard}
                android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
              >
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <View style={styles.iconPlaceholderWhite}>
                      <MaterialCommunityIcons name="trash-can-outline" size={22} color={COLORS.white} />
                    </View>
                    <Text style={styles.rowLabelWhite}>{t ? t('about.deleteAccount') : 'Delete Account'}</Text>
                  </View>
                  <Text style={[styles.chev, { color: '#fff'}]}>›</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </Modal>
        <Modal
          visible={devicesVisible}
          animationType="slide"
          transparent
          statusBarTranslucent={true}
          onRequestClose={() => setDevicesVisible(false)}
        >
          
        </Modal>

        <Modal
          visible={changePwdModalVisible}
          animationType="slide"
          transparent
          statusBarTranslucent={true}
          onRequestClose={() => setChangePwdModalVisible(false)}
        >
          <View style={[styles.modalOverlay, Platform.OS === 'web' && { justifyContent: 'center', alignItems: 'center' }]}>
            <Pressable style={styles.overlayFill} onPress={() => setChangePwdModalVisible(false)} />
            <View style={[styles.bottomSheet, Platform.OS === 'web' && { maxWidth: 768, width: '90%', marginHorizontal: 'auto' }]}>
              <View style={txnStyles.topRow}>
                <Text style={txnStyles.sheetTitle}>{t ? t('changePassword.title') : 'Change Password'}</Text>
                <View style={txnStyles.iconClose}>
                  <TouchableOpacity onPress={async () => { try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch (e) { }; setChangePwdModalVisible(false) }}>
                    <Ionicons name="close" size={20} color="#333" />
                  </TouchableOpacity>
                </View>
              </View>
              <ChangePasswordForm onDone={() => setChangePwdModalVisible(false)} />
            </View>
          </View>
        </Modal>

        <Text style={styles.sectionTitle}>{t ? t('about.accountSettings') : 'Account Settings'}</Text>
        <View style={styles.whiteCard}>
          <RowItem
            icon={<MaterialCommunityIcons name="account" size={24} color={COLORS.temp} />}
            label={t ? t('about.accountInformation') : 'Account Information'}
            onPress={async () => {
              try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch (e) { }
              setAccountModalVisible(true)
            }}
          />
          <RowItem
            icon={<MaterialCommunityIcons name="form-textbox-password" size={24} color={COLORS.temp} />}
            label={t ? t('about.changePassword') : 'Change Password'}
            onPress={async () => {
              try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium) } catch (e) { }
              setChangePwdModalVisible(true)
            }}
          />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t ? t('settings.title') : 'Settings'}</Text>
        <View style={styles.whiteCard}>
          <RowItem
            icon={<Feather name="settings" size={22} color="black" />}
            label={t ? t('settings.title') : 'Settings'}
            onPress={() => setSettingsVisible(true)}
          />
        </View>

        <Modal
          visible={settingsVisible}
          animationType="slide"
          transparent
          statusBarTranslucent={true}
          onRequestClose={() => setSettingsVisible(false)}
        >
          <View style={[styles.modalOverlay, Platform.OS === 'web' && { justifyContent: 'center', alignItems: 'center' }]}>
            <Pressable style={styles.overlayFill} onPress={() => setSettingsVisible(false)} />
            <View style={[styles.bottomSheet, Platform.OS === 'web' && { maxWidth: 768, width: '90%', marginHorizontal: 'auto' }]}>
              <View style={txnStyles.topRow}>
                <Text style={txnStyles.sheetTitle}>{t ? t('about.setLanguage') : 'Set Language'}</Text>
                <View style={txnStyles.iconClose}>
                  <TouchableOpacity onPress={async () => { try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch (e) { }; setSettingsVisible(false) }}>
                    <Ionicons name="close" size={20} color="#333" />
                  </TouchableOpacity>
                </View>
              </View>
              <RowItem
                icon={<Entypo name="language" size={24} color="black" />}
                label={t ? t('settings.language') : 'Language'}
                right={(
                  <View style={styles.langRight}>
                    <LanguageSelectorAbout 
                      selectedKey={locale as 'it' | 'en'} 
                      onSelect={(lang) => {
                        setIsItalian(lang === 'it');
                        try {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        } catch (e) {
                          // ignore
                        }
                        setLocale(lang);
                      }}
                    />
                  </View>
                )}
              />
              <Text style={styles.langHint}>{t ? t('settings.languageHint') : 'Switch app language between Italiano and English'}</Text>
            </View>
          </View>
        </Modal>

        <Pressable
          onPress={handleLogout}
          style={styles.redCard}
          android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
        >
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconPlaceholder}>
                <MaterialCommunityIcons name="logout" size={22} color={COLORS.white} />
              </View>
              <Text style={[styles.rowLabel, { color: '#fff' }]}>{t ? t('about.logout') : 'Logout'}</Text>
            </View>
            <Text style={[styles.chev, { color: '#fff' }]}>›</Text>
          </View>
        </Pressable>

      </ScrollView>
    </View>
  )
}

const styles = aboutStyles;
