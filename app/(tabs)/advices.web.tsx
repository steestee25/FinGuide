import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useIsFocused } from '@react-navigation/native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { PieChart } from 'react-native-gifted-charts'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Source, SourcesDisplay } from '../../components/SourcesDisplay'
import { COLORS } from '../../constants/color'
import { useAuth } from '../../contexts/AuthContext'
import { useTranslation } from '../../lib/i18n'
import {
  fetchExpensesByCategoryLast3Months,
  fetchExpensesByCategoryLastMonth,
  fetchExpensesByCategoryLastYear,
} from '../../lib/transactions'
import locales from '../../locales/locales.json'
import { HEADER_TOP, HORIZONTAL_GUTTER } from '../../styles/spacing'
import { LEVEL_CONFIG, PROFICIENCY_LEVELS, ProficiencyLevel } from './_layout'


const NGROK_URL = 'https://rhyme-headlamp-overnight.ngrok-free.dev'

type PeriodType = 'month' | '3months' | 'year'

interface Advice {
  text: string
  category: string
}


const appendHexOpacity = (hex: string, alpha = '20') => {
  if (!hex || typeof hex !== 'string') return hex
  if (hex.length === 7 && hex.startsWith('#')) return `${hex}${alpha}`
  return hex
}

const hexToRgba = (hex: string, alpha = 0.125) => {
  if (!hex || typeof hex !== 'string') return hex
  if (hex.startsWith('#') && (hex.length === 7 || hex.length === 9)) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return hex
}

type Translate = (path: string, vars?: Record<string, string | number>) => string

const staticAdvices = (t: Translate): Advice[] => [
  { text: t('advicesLabels.disclaimerGeneric'), category: '' },
  { text: t('advicesLabels.disclaimerMonitor'), category: '' },
]


/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) from model output.
 */
function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim()
}

/**
 * PRIMARY PARSER — handles the exact server response format:
 *
 * {
 *   "response": "```json\n{\"category\": \"Electronics\", \"advices\": [...], \"category\": \"Clothing\", \"advices\": [...]}```"
 * }
 *
 * The JSON has DUPLICATE "category" keys, so standard JSON.parse() only keeps
 * the last one. We use regex to extract all category+advices pairs sequentially.
 *
 * Also handles truncated responses (server cuts off mid-JSON).
 */
function parseServerResponse(serverData: any): Advice[] {
  // 1. Extract the raw string — server wraps everything in { "response": "..." }
  let raw: string

  if (typeof serverData === 'string') {
    raw = serverData
  } else if (serverData && typeof serverData.response === 'string') {
    raw = serverData.response
  } else {
    // Try stringifying whatever we got
    raw = JSON.stringify(serverData)
  }

  // 2. Strip markdown code fences (```json ... ```)
  raw = stripCodeFences(raw)

  // Also handle the case where the whole thing is wrapped in outer quotes
  // e.g. the response field itself contains escaped JSON
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      raw = JSON.parse(raw)
    } catch {}
  }

  console.log('[Parser] raw (first 300):', raw.substring(0, 300))

  const result: Advice[] = []

  // 3. Use regex to find all category+advices pairs — this handles duplicate keys
  // Pattern: "category": "NAME" ... "advices": [ {objects} ]
  // We find each "category" occurrence and then look for the nearest "advices" array after it.

  const categoryPattern = /"category"\s*:\s*"([^"]+)"/g
  let categoryMatch: RegExpExecArray | null

  // Collect all positions of "category" keys
  const categoryPositions: Array<{ name: string; index: number }> = []
  while ((categoryMatch = categoryPattern.exec(raw)) !== null) {
    categoryPositions.push({ name: categoryMatch[1], index: categoryMatch.index })
  }

  console.log('[Parser] found', categoryPositions.length, 'category entries')

  if (categoryPositions.length === 0) {
    // Fallback: try to extract any text fields
    return extractFallbackTexts(raw)
  }

  for (let i = 0; i < categoryPositions.length; i++) {
    const { name: categoryName, index: catIndex } = categoryPositions[i]
    // Search for "advices" between this category and the next (or end of string)
    const nextCatIndex =
      i < categoryPositions.length - 1 ? categoryPositions[i + 1].index : raw.length
    const segment = raw.substring(catIndex, nextCatIndex)

    // Extract advices array content — handle truncated JSON gracefully
    // by allowing the array to be unclosed at the end
    const advicesStartMatch = /"advices"\s*:\s*\[/.exec(segment)
    if (!advicesStartMatch) {
      console.warn('[Parser] no advices found for category:', categoryName)
      continue
    }

    const advicesStart = advicesStartMatch.index + advicesStartMatch[0].length
    const advicesSegment = segment.substring(advicesStart)

    // Extract all "text": "..." values from this segment
    // Use a robust regex that handles multi-line text and escaped quotes
    const textPattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
    let textMatch: RegExpExecArray | null
    let count = 0

    while ((textMatch = textPattern.exec(advicesSegment)) !== null) {
      const text = textMatch[1]
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .trim()

      if (text) {
        result.push({ category: categoryName, text })
        count++
      }
    }

    console.log('[Parser] category:', categoryName, '→', count, 'advices')
  }

  console.log('[Parser] total extracted:', result.length, 'advices')
  return result
}

/**
 * Fallback: extract any text-like values from raw JSON when category detection fails.
 */
function extractFallbackTexts(raw: string): Advice[] {
  const result: Advice[] = []
  const textPattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null

  while ((match = textPattern.exec(raw)) !== null) {
    const text = match[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim()
    if (text) result.push({ category: 'General', text })
  }

  return result
}


export default function Advices() {
  const { session, loading: authLoading } = useAuth()
  const { t, locale } = useTranslation()
  const insets = useSafeAreaInsets()
  const isFocused = useIsFocused()
  const router = useRouter()
  const { level } = useLocalSearchParams()

  const [period, setPeriod] = useState<PeriodType>('month')
  const levelParam = Array.isArray(level) ? level[0] : level
  const [proficiencyLevel, setProficiencyLevel] = useState<ProficiencyLevel>(
    PROFICIENCY_LEVELS.includes(levelParam as ProficiencyLevel)
      ? (levelParam as ProficiencyLevel)
      : 'intermediate'
  )
  const [advices, setAdvices] = useState<Advice[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [pieData, setPieData] = useState<{
    value: number
    color: string
    gradientCenterColor?: string
    label: string
    key?: string
  }[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSourcesModal, setShowSourcesModal] = useState<boolean>(false)
  const [currentSources, setCurrentSources] = useState<Source[]>([])

  // Derive category colors and info from locales
  const categoriesFromLocale: Record<string, any> =
    (locales as any)[locale]?.categories || {}
  const categoryColors: Record<string, string[]> = Object.fromEntries(
    Object.entries(categoriesFromLocale).map(([k, v]) => [k, [(v as any).color, (v as any).color]])
  )


  const getCategoryKeyFromLabel = (label: string) => {
    if (!label) return null
    const b = label.toString().toLowerCase().trim()
    const entries = Object.entries(categoriesFromLocale)
    for (const [k, v] of entries) {
      const lab =
        v && (v as any).label ? String((v as any).label).toLowerCase().trim() : ''
      if (!lab) continue
      if (
        lab === b ||
        lab.includes(b) ||
        b.includes(lab) ||
        k.toLowerCase() === b
      )
        return k
    }
    return null
  }

  const getCategoryBaseColor = (keyOrLabel: string) => {
    if (!keyOrLabel) return '#CCCCCC'
    if (categoryColors[keyOrLabel] && categoryColors[keyOrLabel][0])
      return categoryColors[keyOrLabel][0]
    const mapped = getCategoryKeyFromLabel(keyOrLabel)
    if (mapped && categoryColors[mapped] && categoryColors[mapped][0])
      return categoryColors[mapped][0]
    return '#CCCCCC'
  }

  const getCategoryEmoji = (keyOrLabel: string) => {
    if (!keyOrLabel) return '💡'
    if (
      categoriesFromLocale[keyOrLabel] &&
      categoriesFromLocale[keyOrLabel].icon
    )
      return categoriesFromLocale[keyOrLabel].icon
    const mapped = getCategoryKeyFromLabel(keyOrLabel)
    if (mapped && categoriesFromLocale[mapped] && categoriesFromLocale[mapped].icon)
      return categoriesFromLocale[mapped].icon
    return '💡'
  }

  const handlePiePress = (slice: any, index: number) => {
    if (selectedIndex === index) {
      setSelectedIndex(null)
      setPieData((prev) => prev.map((p) => ({ ...p, focused: false })))
    } else {
      setSelectedIndex(index)
      setPieData((prev) => prev.map((p, i) => ({ ...p, focused: i === index })))
    }
  }


  // Aggiorna il livello di competenza dell'utente quando level cambia
  useEffect(() => {
    if (PROFICIENCY_LEVELS.includes(levelParam as ProficiencyLevel)) {
      setProficiencyLevel(levelParam as ProficiencyLevel)
    }
  }, [levelParam])

  const cycleProficiencyLevel = () => {
    const currentIndex = PROFICIENCY_LEVELS.indexOf(proficiencyLevel)
    const nextLevel = PROFICIENCY_LEVELS[(currentIndex + 1) % PROFICIENCY_LEVELS.length]
    setProficiencyLevel(nextLevel)
    router.setParams({ level: nextLevel })
  }

  useEffect(() => {
    if (isFocused && !authLoading && session?.user) {
      fetchAndGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, period, proficiencyLevel, authLoading, isFocused])

  const fetchAndGenerate = async () => {
    if (!session?.user) return
    setLoading(true)
    setAdvices([])
    setPieData([])
    setError(null)

    try {
      // 1. Fetch expenses for selected period
      let rows: any[] = []
      if (period === 'month') {
        rows = (await fetchExpensesByCategoryLastMonth(session.user.id)) || []
      } else if (period === '3months') {
        rows = (await fetchExpensesByCategoryLast3Months(session.user.id)) || []
      } else {
        rows = (await fetchExpensesByCategoryLastYear(session.user.id)) || []
      }
      console.log('[Fetch] rows:', rows.length, 'period:', period)

      if (!rows.length) {
        setAdvices([
          {
            text: t('advicesLabels.noExpenses'),
            category: 'General',
          },
        ])
        return
      }

      // 2. Build pie data and summary
      const total = rows.reduce((s: number, r: any) => s + (r.total ?? 0), 0)

      // Find index of highest expense category
      const maxIndex = rows.reduce(
        (acc: number, cur: any, i: number) =>
          cur.total > (rows[acc]?.total || 0) ? i : acc,
        0
      )

      const mapped = rows.map((r: any, idx: number) => {
        const base =
          (categoryColors[r.category] && categoryColors[r.category][0]) ||
          '#CCCCCC'
        const gradBase =
          (categoryColors[r.category] && categoryColors[r.category][1]) || base
        const color = hexToRgba(base, 0.125)
        const gradient = hexToRgba(gradBase, 0.125)
        const localizedLabel =
          (categoriesFromLocale[r.category] &&
            categoriesFromLocale[r.category].label) ||
          r.category
        const item = {
          value: r.total,
          color,
          gradientCenterColor: gradient,
          label: localizedLabel,
          key: r.category,
        }
        if (idx === maxIndex) (item as any).focused = true
        return item
      })

      setPieData(mapped)
      setSelectedIndex(maxIndex)

      // 3. Build compact summary for server
      const topCategories = [...rows]
        .sort((a, b) => b.total - a.total)
        .slice(0, 6)
        .map((r: any) => ({
          category: r.category,
          total: Math.round(r.total),
          pct: total ? Math.round((r.total / total) * 100) : 0,
        }))
      const summary = { total: Math.round(total), topCategories, period }
      console.log('[Fetch] summary:', JSON.stringify(summary))

      // 4. Generate advices from server
      await generateWithServer(summary)
    } catch (err) {
      console.error('[Fetch] error:', err)
      setError(t('advicesLabels.fetchError'))
      setAdvices([{ text: t('advicesLabels.fetchError'), category: 'General' }])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }


  const generateWithServer = async (summary: any) => {
    console.log('[Server] starting request to analyze_transaction…')
    setStatusText(t('advicesLabels.analysis'))

    try {
      const payload = {
        transactions: summary.topCategories.map((c: any) => ({
          category: c.category,
          total: c.total,
          percentage: c.pct,
        })),
        totalSpent: summary.total,
        period: summary.period,
        proficiency_level: proficiencyLevel,
      }

      console.log('[Server] payload:', JSON.stringify(payload))

      const response = await fetch(`${NGROK_URL}/analyze_transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(
          `Server error: ${response.status} ${response.statusText}`
        )
      }

      const data = await response.json()
      console.log('[Server] raw response keys:', Object.keys(data))

      const parsed = parseServerResponse(data)
      console.log('[Server] parsed advices:', parsed.length)

      if (parsed.length > 0) {
        setAdvices([...parsed, ...staticAdvices(t)])
      } else {
        console.warn('[Server] parsing yielded 0 advices — using fallback')
        generateFallback(summary)
      }
    } catch (e) {
      console.error('[Server] error:', e)
      setError(
        t('advicesLabels.serverError', {
          message: e instanceof Error ? e.message : t('chat.unknownError'),
        })
      )
      generateFallback(summary)
    } finally {
      setStatusText('')
    }
  }

  const generateFallback = (summary: any) => {
    console.log('[Fallback] generating from summary')
    const result: Advice[] = summary.topCategories
      .slice(0, 4)
      .map((c: any) => ({
        text: t('advicesLabels.fallbackReduce', {
          category: c.category,
          amount: Math.round(c.total * 0.1),
          pct: c.pct,
        }),
        category: c.category,
      }))
    if (!result.length) {
      result.push({
        text: t('advicesLabels.fallbackBudget'),
        category: 'General',
      })
    }
    setAdvices(result)
  }

  const onRefresh = () => {
    setRefreshing(true)
    fetchAndGenerate()
  }

  const formatDate = (d: Date) =>
    d.toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

  const getRangeText = () => {
    const today = new Date()
    const start = new Date(today.getTime())
    const end = new Date(today.getTime())

    if (period === 'month') {
      start.setDate(1)
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
      end.setTime(nextMonth.getTime() - 1)
    } else if (period === '3months') {
      start.setMonth(start.getMonth() - 3)
    } else {
      start.setFullYear(start.getFullYear() - 1)
    }

    return `${formatDate(start)} - ${formatDate(end)}`
  }


  if (authLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    )
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#fff',
        paddingTop: HEADER_TOP,
        paddingBottom: insets.bottom + 16,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: HORIZONTAL_GUTTER,
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 34, fontWeight: 'bold', color: '#333' }}>
            {t('tabs.analysis')}
          </Text>
          <TouchableOpacity
            onPress={cycleProficiencyLevel}
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
          </TouchableOpacity>
        </View>
      </View>

      {/* Error message */}
      {error ? (
        <View
          style={{
            paddingHorizontal: HORIZONTAL_GUTTER,
            marginTop: 8,
            paddingVertical: 8,
            backgroundColor: '#fee',
            borderRadius: 8,
          }}
        >
          <Text style={{ color: '#c00', fontSize: 13 }}>⚠ {error}</Text>
        </View>
      ) : null}

      {/* Period selector */}
      <View
        style={{
          flexDirection: 'row',
          marginTop: 15,
          marginHorizontal: HORIZONTAL_GUTTER,
          borderRadius: 35,
          backgroundColor: '#faf9f9',
          padding: 4,
        }}
      >
        {(['month', '3months', 'year'] as PeriodType[]).map((p) => {
          const label =
            p === 'month'
              ? t
                ? t('advicesLabels.lastMonth')
                : 'Ultimo mese'
              : p === '3months'
              ? t
                ? t('advicesLabels.threeMonths')
                : '3 Mesi'
              : t
              ? t('advicesLabels.lastYear')
              : "Quest'anno"
          return (
            <TouchableOpacity
              key={p}
              onPress={() => {
                setPeriod(p)
                setSelectedIndex(null)
              }}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 35,
                backgroundColor: period === p ? '#fff' : 'transparent',
                borderWidth: period === p ? 0.5 : 0,
                borderColor: '#e0e0e0',
              }}
            >
              <Text
                style={{
                  textAlign: 'center',
                  fontWeight: period === p ? '600' : '400',
                  color: '#333',
                  fontSize: 13,
                }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Period range display */}
      <View style={{ marginTop: '2%', alignItems: 'center', borderWidth: 0.5, borderColor: '#e0e0e0', backgroundColor: COLORS.white, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
        <Text style={{ color: '#666', fontSize: 13, fontWeight: '450' }}>{getRangeText()}</Text>
      </View>

      {/* Pie chart */}
      {pieData.length > 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <PieChart
            data={pieData.map((p, i) => ({ ...p, onPress: () => handlePiePress(p, i) }))}
            donut
            showGradient={false}
            sectionAutoFocus
            focusOnPress
            extraRadiusForFocused={10}
            radius={90}
            innerRadius={60}
            innerCircleColor={'#F5F5F5'}
            centerLabelComponent={() => <View />}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {(selectedIndex !== null ? [pieData[selectedIndex]].filter(Boolean) : pieData).map((p) => (
              <View key={p.label} style={{ flexDirection: 'row', alignItems: 'center', width: 150, marginLeft: '5%', marginRight: 12, marginBottom: 6 }}>
                <View style={{ height: 10, width: 10, borderRadius: 5, backgroundColor: p.color, marginRight: 10 }} />
                <Text style={{ color: 'black', fontSize: 12 }}>
                  {p.label}: {Math.round((p.value / Math.max(1, pieData.reduce((s, x) => s + x.value, 0))) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Advice list */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={{ paddingHorizontal: HORIZONTAL_GUTTER, marginTop: '-1%', marginBottom: '5%' }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
      >
        {loading ? (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={{ marginTop: 12, color: '#888', fontSize: 14 }}>
              {statusText || t('advicesLabels.analysis')}
            </Text>
          </View>
        ) : (
          <>
            <Text
              style={{
                fontSize: 22,
                fontWeight: 'bold',
                marginBottom: 15,
                color: '#333',
              }}
            >
              {t('advicesLabels.advices')}
            </Text>

            {advices.map((item, idx) => {
              const baseColor = getCategoryBaseColor(item.category)
              const emoji = getCategoryEmoji(item.category)
              return (
                <View
                  key={idx}
                  style={{
                    backgroundColor: appendHexOpacity(
                      baseColor || '#CCCCCC',
                      '20'
                    ),
                    borderRadius: 12,
                    padding: 15,
                    marginBottom: 12,
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      borderWidth: 1.5,
                      borderColor: hexToRgba(baseColor, 0.3),
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    {item.category ? (
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: '600',
                          color: '#888',
                          marginBottom: 4,
                          textTransform: 'uppercase',
                        }}
                      >
                        {item.category}
                      </Text>
                    ) : null}
                    <Text style={{ color: '#333', lineHeight: 20 }}>
                      {item.text}
                    </Text>
                  </View>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>

      {/* Modal per visualizzare le fonti */}
      <Modal
        visible={showSourcesModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSourcesModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSourcesModal(false)}
        >
          <TouchableOpacity
            style={styles.modalContent}
            activeOpacity={1}
            onPress={() => { }}
          >
            {/* Handle bar */}
            <View style={styles.handleBar} />

            {/* Header del modal */}
            <View style={styles.modalHeader}>
              <View style={styles.headerWithBadge}>
                <Text style={styles.modalTitle}>{t('chat.retrievedSources')}</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{currentSources.length}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setShowSourcesModal(false)}
                style={styles.closeButton}
              >
                <Feather name="x" size={24} color="#0F172A" />
              </TouchableOpacity>
            </View>

            {/* Componente SourcesDisplay */}
            <SourcesDisplay
              sources={currentSources}
              visible={true}
              onOpenUrl={(url) => {
                Linking.openURL(url).catch(err => {
                  console.error('Errore apertura URL:', err)
                })
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  levelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    maxWidth: 768,
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
  },
  badge: {
    backgroundColor: '#ddecff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  badgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6fa1df',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 25,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#f0f0f0eb',
  },
})