import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Image, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { COLORS } from '../constants/color'
import { useAuth } from '../contexts/AuthContext'
import { useTranslation } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import accountStyles from '../styles/components/account.styles'

const Avatar = ({ uri }: { uri?: string }) => (
    <View style={styles.avatarWrap}>
        <Image
            source={{ uri: uri || 'https://picsum.photos/100' }}
            style={styles.avatar}
        />
    </View>
)

export default function AccountScreen() {
    const router = useRouter()
    const { session } = useAuth()
    const { t } = useTranslation()
    const [profile, setProfile] = useState<any>(null)

    useEffect(() => {
        if (!session?.user?.id) return

        const fetchProfile = async () => {
            try {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('*')
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
    const avatarUri = session?.user?.user_metadata?.avatar_url || 'https://picsum.photos/100'

    return (
        <View style={styles.container}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 40, justifyContent: 'space-between' }}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backIcon}>
                    <MaterialIcons name="arrow-back" size={28} color="#00C6D3" />
                </TouchableOpacity>
                <View />
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.headerCard}>
                    <View style={styles.headerLeft}>
                        <Avatar uri={avatarUri} />
                        <View style={{ marginLeft: 12 }}>
                            <Text style={styles.name}>{displayName}</Text>
                            <Text style={styles.email}>{displayEmail}</Text>
                        </View>
                    </View>
                </View>

                <Text style={styles.sectionTitle}>{t('about.accountSettings')}</Text>
                <View style={styles.whiteCard}>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>{t('about.fullName')}</Text>
                        <Text style={styles.chev}>{profile?.full_name ?? '-'}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>{t('about.email')}</Text>
                        <Text style={styles.chev}>{displayEmail}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>{t('about.phone')}</Text>
                        <Text style={styles.chev}>{profile?.phone ?? '-'}</Text>
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>{t('about.country')}</Text>
                        <Text style={styles.chev}>{profile?.country ?? 'Italy'}</Text>
                    </View>
                </View>

                <Pressable
                    onPress={async () => {
                        try {
                            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                        } catch (e) {
                            // ignore
                        }
                        console.log('Cancella account pressed')
                    }}
                    style={styles.redCard}
                    android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
                >
                    <View style={styles.row}>
                        <View style={styles.rowLeft}>
                            <View style={styles.iconPlaceholderWhite}>
                                <MaterialCommunityIcons name="trash-can-outline" size={22} color={COLORS.white} />
                            </View>
                            <Text style={[styles.rowLabel, { color: '#fff' }]}>{t('about.deleteAccount')}</Text>
                        </View>
                        <Text style={[styles.chev, { color: '#fff', fontSize: 20 }]}>›</Text>
                    </View>
                </Pressable>

            </ScrollView>
        </View>
    )
}

const styles = accountStyles
