import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import Ionicons from '@expo/vector-icons/Ionicons';
import Octicons from '@expo/vector-icons/Octicons';
import { Tabs, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ModelSelector from '../../components/ModelSelector';
import { COLORS } from '../../constants/color';

export const PROFICIENCY_LEVELS = ['base', 'intermediate', 'advanced'] as const;
export type ProficiencyLevel = typeof PROFICIENCY_LEVELS[number];

export const LEVEL_CONFIG: Record<ProficiencyLevel, { label: string; icon: 'signal-cellular-1' | 'signal-cellular-2' | 'signal-cellular-3' }> = {
  base: { label: 'Base', icon: 'signal-cellular-1' },
  intermediate: { label: 'Intermediate', icon: 'signal-cellular-2' },
  advanced: { label: 'Advanced', icon: 'signal-cellular-3' },
};

const CHAT_MODEL_OPTIONS = [
  { key: 'call_gemma_1b', label: 'Gemma 1B' },
  { key: 'call_gemma_270m', label: 'Gemma 270M' },
  { key: 'call_smollm3', label: 'SmolLM3 3B' },
];

export default function TabLayout() {
    const router = useRouter();
    const { model, rag, level } = useLocalSearchParams();
    const ragParam = Array.isArray(rag) ? rag[0] : rag;
    const levelParam = Array.isArray(level) ? level[0] : level;
    const { width } = useWindowDimensions();
    const isSmartphoneWidth = width < 600;
    // Default RAG to true on web, false on mobile
    const defaultRagValue = Platform.OS === 'web' ? true : (ragParam !== '0');
    const [isRagEnabled, setIsRagEnabled] = useState(defaultRagValue);
    const [proficiencyLevel, setProficiencyLevel] = useState<ProficiencyLevel>(
        PROFICIENCY_LEVELS.includes(levelParam as ProficiencyLevel) ? (levelParam as ProficiencyLevel) : 'intermediate'
    );

    useEffect(() => {
        if (levelParam === undefined) {
            router.setParams({ level: proficiencyLevel });
        } else if (PROFICIENCY_LEVELS.includes(levelParam as ProficiencyLevel)) {
            setProficiencyLevel(levelParam as ProficiencyLevel);
        }
    }, [levelParam]);

    useEffect(() => {
        // On web, default RAG to enabled if not specified
        if (Platform.OS === 'web' && ragParam === undefined) {
            setIsRagEnabled(true);
            router.setParams({ rag: '1' });
        } else {
            setIsRagEnabled(ragParam !== '0');
        }
    }, [ragParam]);

    const handleNewMessage = () => {
        // Send event to reset messages in chat screen
        // Use Date.now() to ensure a new value each time
        router.setParams({ resetMessages: Date.now().toString() });
    };

    const HeaderButton = ({ onPress, children, style }: any) => (
        <Pressable onPress={onPress} style={[styles.headerButton, style]}>{children}</Pressable>
    );

    return (
        <Tabs
            screenOptions={{
                tabBarActiveTintColor: '#9CF1F0',
                headerStyle: {
                    backgroundColor: COLORS.white,
                },
                headerShadowVisible: false,
                headerTintColor: '#007bff',
                tabBarStyle: {
                    position: 'absolute',
                    marginHorizontal: 10,
                    bottom: 25,
                    height: 65,
                    borderRadius: 35,
                    backgroundColor: COLORS.white,
                    shadowColor: '#000',
                },
                tabBarIconStyle: {
                    marginTop: Platform.OS === 'web' && !isSmartphoneWidth ? 0 : 12.5,
                },

            }}
        >
            <Tabs.Screen name="home"
                options={{
                    title: '',
                    tabBarIcon: ({ color, focused }) => (
                        <Octicons name={focused ? 'home-fill' : 'home'} color={color} size={24} />
                    ),
                    headerShown: false,
                }} />

            <Tabs.Screen name="chat"
                options={{
                    title: '',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} color={color} size={26} />
                    ),
                    headerStyle: { backgroundColor: COLORS.white },
                    headerShown: true,
                    headerLeft: () => (
                        <View style={{ marginLeft: 12, flexDirection: 'row', alignItems: 'center' }}>
                            <HeaderButton onPress={() => router.push('/home')}>
                                <MaterialIcons name="arrow-back" size={28} color={COLORS.black} />
                            </HeaderButton>
                            <ModelSelector
                                models={CHAT_MODEL_OPTIONS}
                                selectedKey={typeof model === 'string' ? model : undefined}
                                onSelect={(selected) => {
                                    router.setParams({ 
                                        model: selected,
                                        resetMessages: Date.now().toString()
                                    });
                                }}
                            />
                            <Pressable
                                onPress={() => {
                                    const nextRag = !isRagEnabled;
                                    setIsRagEnabled(nextRag);
                                    router.setParams({
                                        rag: nextRag ? '1' : '0',
                                        model: typeof model === 'string' ? model : undefined,
                                    });
                                }}
                                style={[styles.ragButton, !isRagEnabled && styles.ragButtonDisabled]}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <MaterialCommunityIcons
                                    name={isRagEnabled ? 'database' : 'database-off'}
                                    size={18}
                                    color={isRagEnabled ? COLORS.primary : '#94a3b8'}
                                />
                                <Text style={[styles.ragButtonText, !isRagEnabled && styles.ragButtonTextDisabled]}>
                                    {isRagEnabled ? 'RAG On' : 'RAG Off'}
                                </Text>
                            </Pressable>
                            <Pressable
                                onPress={() => {
                                    const currentIndex = PROFICIENCY_LEVELS.indexOf(proficiencyLevel);
                                    const nextLevel = PROFICIENCY_LEVELS[(currentIndex + 1) % PROFICIENCY_LEVELS.length];
                                    setProficiencyLevel(nextLevel);
                                    router.setParams({
                                        level: nextLevel,
                                        model: typeof model === 'string' ? model : undefined,
                                    });
                                }}
                                style={styles.levelButton}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                                <MaterialCommunityIcons
                                    name={LEVEL_CONFIG[proficiencyLevel].icon}
                                    size={18}
                                    color={COLORS.primary}
                                />
                                <Text style={styles.levelButtonText}>
                                    {LEVEL_CONFIG[proficiencyLevel].label}
                                </Text>
                            </Pressable>
                        </View>
                    ),
                    headerRight: () => (
                        <View style={styles.headerRightContainer}>
                            <HeaderButton onPress={handleNewMessage}>
                                <MaterialCommunityIcons name="shape-square-rounded-plus"
                                    size={28} color={COLORS.black} />
                            </HeaderButton>
                        </View>
                    ),
                    tabBarStyle: { display: 'none' },
                }} />

            <Tabs.Screen
                name="advices"
                options={{
                    title: '',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'sparkles' : 'sparkles-outline'} color={color} size={24} />
                    ),
                    headerShown: false,
                }}
            />

            <Tabs.Screen
                name="about"
                options={{
                    title: '',
                    tabBarIcon: ({ color, focused }) => (
                        <Ionicons name={focused ? 'person' : 'person-outline'} color={color} size={24} />
                    ),
                    headerShown: false,
                }}
            />
        </Tabs>
    )
}

const styles = StyleSheet.create({
    headerButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: COLORS.white,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: COLORS.temp,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 4,
    },
    headerRightContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 12,
    },
    ragButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: '9%',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 18,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    ragButtonDisabled: {
        backgroundColor: '#F1F5F9',
    },
    ragButtonText: {
        marginLeft: 6,
        fontSize: 12,
        fontWeight: '600',
        color: '#0F172A',
    },
    ragButtonTextDisabled: {
        color: '#94A3B8',
    },
    levelButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 18,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    levelButtonText: {
        marginLeft: 6,
        fontSize: 12,
        fontWeight: '600',
        color: '#0F172A',
    },
});
