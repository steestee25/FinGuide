import * as Haptics from 'expo-haptics'
import { useRouter } from 'expo-router'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { PieChart } from 'react-native-gifted-charts'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { COLORS } from '../../constants/color'
import { useAuth } from '../../contexts/AuthContext'
import LevelSelector from '../../components/LevelSelector'
import { LEVEL_CONFIG, PROFICIENCY_LEVELS, type ProficiencyLevel } from './_layout'
import { runAdvicesTurn } from '../../lib/advicesTurn'
import { normalizeLevel } from '../../lib/chatPrompt'
import { summarizeExpenses } from '../../lib/expenses'
import { useTranslation } from '../../lib/i18n'
import { useIsReviewer, useSharedLevel } from '../../lib/levelStore'
import { suggerimentoDaSpese } from '../../lib/projection'
import { getLlamaContext, isLlamaReady, releaseLlamaContext } from '../../lib/llamaContext'
import { ADVICES_MODEL, downloadUrl, migrateRenamedModels, minValidSize, modelPath } from '../../lib/modelConfig'
import {
  fetchExpensesByCategoryLast3Months,
  fetchExpensesByCategoryLastMonth,
  fetchExpensesByCategoryLastYear,
} from '../../lib/transactions'
import locales from '../../locales/locales.json'
import { HEADER_TOP, HORIZONTAL_GUTTER } from '../../styles/spacing'

const { width } = Dimensions.get('window')

// llama.rn — only available on mobile
let RNFS: any = null

if (Platform.OS !== 'web') {
  RNFS = require('react-native-fs')
}

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

export default function Advices() {
  const { session, loading: authLoading } = useAuth()
  const { t, locale } = useTranslation()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [proficiencyLevel, setProficiencyLevel] = useSharedLevel()
  const isReviewer = useIsReviewer()

  const [period, setPeriod] = useState<PeriodType>('month')
  const [advices, setAdvices] = useState<Advice[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [useLocalModel, setUseLocalModel] = useState(true)
  const [statusText, setStatusText] = useState('')
  const [pieData, setPieData] = useState<{ value: number; color: string; gradientCenterColor?: string; label: string; key?: string; months?: number }[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  /** Category tapped on the chart, which narrows the advices shown. */
  const [filterCategory, setFilterCategory] = useState<string | null>(null)

  const isInitializedRef = useRef(false)
  const pendingSummaryRef = useRef<any>(null)
  const isGeneratingRef = useRef(false)
  const isFetchingRef = useRef(false)
  /** A fetch was requested while one was running; re-run once it finishes. */
  const rerunRef = useRef(false)
  /** Bumped when a queued re-run must start, so it runs with fresh settings. */
  const [rerunToken, setRerunToken] = useState(0)

  // Derive category colors and info from locales
  const categoriesFromLocale: Record<string, any> = (locales as any)[locale]?.categories || {}
  const categoryColors: Record<string, string[]> = Object.fromEntries(
    Object.entries(categoriesFromLocale).map(([k, v]) => [k, [v.color, v.color]])
  )

  const getCategoryKeyFromLabel = (label: string) => {
    if (!label) return null
    const b = label.toString().toLowerCase().trim()
    const entries = Object.entries(categoriesFromLocale)
    for (const [k, v] of entries) {
      const lab = (v && v.label) ? String(v.label).toLowerCase().trim() : ''
      if (!lab) continue
      if (lab === b || lab.includes(b) || b.includes(lab) || k.toLowerCase() === b) return k
    }
    return null
  }

  const getCategoryBaseColor = (keyOrLabel: string) => {
    if (!keyOrLabel) return '#CCCCCC'
    if (categoryColors[keyOrLabel] && categoryColors[keyOrLabel][0]) return categoryColors[keyOrLabel][0]
    const mapped = getCategoryKeyFromLabel(keyOrLabel)
    if (mapped && categoryColors[mapped] && categoryColors[mapped][0]) return categoryColors[mapped][0]
    return '#CCCCCC'
  }

  const getCategoryEmoji = (keyOrLabel: string) => {
    if (!keyOrLabel) return '💡'
    if (categoriesFromLocale[keyOrLabel] && categoriesFromLocale[keyOrLabel].icon) return categoriesFromLocale[keyOrLabel].icon
    const mapped = getCategoryKeyFromLabel(keyOrLabel)
    if (mapped && categoriesFromLocale[mapped] && categoriesFromLocale[mapped].icon) return categoriesFromLocale[mapped].icon
    return '💡'
  }

  const handlePiePress = (slice: any, index: number) => {
    const sliceKey = slice?.key || getCategoryKeyFromLabel(slice?.label) || slice?.label

    if (selectedIndex === index) {
      setSelectedIndex(null)
      setFilterCategory(null)
      setPieData((prev) => prev.map((p) => ({ ...p, focused: false })))
    } else {
      setSelectedIndex(index)
      setPieData((prev) => prev.map((p, i) => ({ ...p, focused: i === index })))
      // Narrow the view, don't throw the advices away: this used to filter the
      // state itself, so tapping a second slice filtered an already-filtered
      // list down to nothing and the advices were gone until the next
      // generation — two minutes of it.
      setFilterCategory(sliceKey ?? null)
    }
  }

  /** Advices for the tapped slice; the generic disclaimers always stay. */
  const visibleAdvices = filterCategory
    ? advices.filter(
      (a) => !a.category || a.category === filterCategory || getCategoryKeyFromLabel(a.category) === filterCategory,
    )
    : advices


  // The advices model does not follow the app language: it is the same base
  // Gemma for both (lib/modelConfig.ts), so this runs once.
  useEffect(() => {
    if (Platform.OS === 'web' || isInitializedRef.current) return
    isInitializedRef.current = true
    initModel()
  }, [])

  const MODEL = ADVICES_MODEL

  const initModel = async () => {
    setModelLoading(true)
    setModelError(null)
    try {
      // Chat does this too, but Advices can be the first screen to need weights.
      await migrateRenamedModels()

      const path = modelPath(MODEL)
      console.log('[Model] path:', path)

      const exists = await RNFS.exists(path)
      console.log('[Model] file exists:', exists)

      if (exists) {
        const stat = await RNFS.stat(path)
        console.log('[Model] cached file size:', stat.size, 'bytes')
        if (stat.size < minValidSize(MODEL)) {
          console.warn('[Model] file corrotto — eliminazione e re-download…')
          await RNFS.unlink(path)
        }
      }
      if (!(await RNFS.exists(path))) {
        console.log('[Model] starting download from:', downloadUrl(MODEL))
        setStatusText(t('model.downloading'))
        const dl = await RNFS.downloadFile({
          fromUrl: downloadUrl(MODEL),
          toFile: path,
          progressDivider: 5, 
          begin: (res: any) => {
            console.log('[Model] download started — expected size:', res.contentLength, 'bytes')
            setStatusText(t('model.downloadPercent', { pct: 0 }))
          },
          progress: (res: any) => {
            if (!res.contentLength || res.contentLength <= 0) {
              console.log(`[Model] download ${res.bytesWritten} bytes (size unknown)`)
              setStatusText(t('model.downloadMb', { mb: Math.round(res.bytesWritten / 1_000_000) }))
              return
            }
            const pct = Math.round((res.bytesWritten / res.contentLength) * 100)
            console.log(`[Model] download ${pct}% — ${Math.round(res.bytesWritten / 1_000_000)}/${Math.round(res.contentLength / 1_000_000)} MB`)
            setStatusText(t('model.downloadPercent', { pct }))
          },
        }).promise
        console.log('[Model] download done — statusCode:', dl.statusCode, 'bytes:', dl.bytesWritten)

        const stat = await RNFS.stat(path)
        console.log('[Model] file size after download:', stat.size, 'bytes')
        if (stat.size < minValidSize(MODEL)) {
          throw new Error(t('model.fileTooSmallShort', { size: stat.size }))
        }
      }

      console.log('[Model] acquiring shared llama context…')
      setStatusText(t('advicesLabels.modelLoading'))
      await getLlamaContext(MODEL)
      console.log('[Model] shared context ready')

      setModelReady(true)
      setStatusText('')

      // If data was already fetched while model was loading, generate now
      if (pendingSummaryRef.current && useLocalModel) {
        console.log('[Model] found pending summary — generating advices…')
        setLoading(true)
        await generateWithLocalModel(pendingSummaryRef.current)
        pendingSummaryRef.current = null
        setLoading(false)
        setRefreshing(false)
      }
    } catch (e: any) {
      const msg = e?.message ?? t('model.loadErrorTitle')
      setModelError(msg)
      console.error('[Model] init error:', msg, e)
      if (pendingSummaryRef.current) {
        console.warn('[Model] init failed — running fallback on pending summary')
        generateFallback(pendingSummaryRef.current)
        pendingSummaryRef.current = null
        setLoading(false)
        setRefreshing(false)
      }
    } finally {
      setModelLoading(false)
    }
  }

  // `locale` and `proficiencyLevel` are dependencies too: both go into the
  // prompt, so changing either has to produce a new set of advices instead of
  // leaving the previous ones on screen.
  useEffect(() => {
    if (!authLoading && session?.user) {
      fetchAndGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, period, authLoading, locale, proficiencyLevel, rerunToken])

  const fetchAndGenerate = async () => {
    if (!session?.user) return

    // One fetch at a time. A config change that lands mid-generation (period,
    // language, level) is remembered instead of dropped: dropping it left the
    // previous level's advices on screen under the new level's icon.
    if (isFetchingRef.current) {
      console.log('[Fetch] already fetching — queued a re-run for the new settings')
      rerunRef.current = true
      return
    }

    isFetchingRef.current = true
    setLoading(true)
    // The previous advices stay on screen until the new ones replace them:
    // generating them takes ~1-2 minutes on a phone, and blanking the list
    // meant staring at a spinner for that long after every period, language or
    // level change.
    pendingSummaryRef.current = null

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
        // Nothing to chart or advise on: here the old content must go.
        setAdvices([{ text: t('advicesLabels.noExpenses'), category: 'General' }])
        setPieData([])
        return
      }

      // 2. Build pie data
      // Find index of highest expense category
      const maxIndex = rows.reduce((acc: number, cur: any, i: number) =>
        (cur.total > (rows[acc]?.total || 0) ? i : acc), 0)

      const mapped = rows.map((r: any, idx: number) => {
        const base = (categoryColors[r.category] && categoryColors[r.category][0]) || '#CCCCCC'
        const gradBase = (categoryColors[r.category] && categoryColors[r.category][1]) || base
        const color = hexToRgba(base, 0.125)
        const gradient = hexToRgba(gradBase, 0.125)
        const localizedLabel = (categoriesFromLocale[r.category] && categoriesFromLocale[r.category].label) || r.category
        const item = { value: r.total, color, gradientCenterColor: gradient, label: localizedLabel, key: r.category, months: r.months }
        if (idx === maxIndex) (item as any).focused = true
        return item
      })

      setPieData(mapped)
      // The biggest slice is focused for the chart only: a fresh set of advices
      // is shown in full until the user taps a slice.
      setSelectedIndex(maxIndex)
      setFilterCategory(null)

      // 3. Build compact summary for LLM (lib/expenses.ts, shared with the benchmark)
      const summary = summarizeExpenses(rows, period)
      console.log('[Fetch] summary:', JSON.stringify(summary))

      // 4. Generate advices — park if model not ready yet
      if (useLocalModel) {
        if (isLlamaReady() && !isGeneratingRef.current) {
          await generateWithLocalModel(summary)
        } else {
          console.log('[Fetch] model not ready or already generating — parking summary for later')
          pendingSummaryRef.current = summary
          return // keep loading=true; initModel() will finish and call generateWithLocalModel
        }
      } else {
        generateFallback(summary)
      }
    } catch (err) {
      console.error('[Fetch] error:', err)
      setAdvices([{ text: t('advicesLabels.fetchError'), category: 'General' }])
    } finally {
      isFetchingRef.current = false
      if (rerunRef.current) {
        rerunRef.current = false
        // Settings changed while this run was in flight: redo it with them.
        // Through state, not a direct call: calling from here would re-enter
        // with this render's period, language and level — the very values the
        // re-run exists to replace.
        setRerunToken((t) => t + 1)
      } else if (!pendingSummaryRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  // ─── Prompt & inference ────────────────────────────────────────────────────


  const generateWithLocalModel = async (summary: any) => {
    // Prevent concurrent inference calls
    if (isGeneratingRef.current) {
      console.warn('[Inference] already generating — skipping request')
      return
    }

    if (!isLlamaReady()) {
      console.error('[Inference] no context available')
      generateFallback(summary)
      return
    }

    isGeneratingRef.current = true
    console.log('[Inference] starting generation…')
    setStatusText(t('advicesLabels.advicesGeneration'))

    try {
      // Chat may have loaded its own model in the meantime: the shared context
      // holds one at a time, so claim it for the advices model first.
      await getLlamaContext(MODEL)

      // Prompt, completion and parsing live in lib/advicesTurn.ts, shared with
      // the benchmark screen.
      const { advices: parsed } = await runAdvicesTurn({
        summary,
        lang: locale === 'en' ? 'en' : 'it',
        level: normalizeLevel(proficiencyLevel),
      })

      if (parsed.length) {
        setAdvices([...parsed, ...staticAdvices(t)])
      } else {
        console.warn('[Inference] JSON parse failed — using fallback')
        generateFallback(summary)
      }
    } catch (e: any) {
      const errMsg = e?.message ?? String(e)
      console.error('[Inference] error:', errMsg)

      // If context is busy, try to reinitialize it
      if (errMsg.includes('busy') || errMsg.includes('Context')) {
        console.log('[Inference] context is busy — reinitializing…')
        try {
          await releaseLlamaContext()
          // Restart initialization
          await initModel()
        } catch (reinitErr) {
          console.error('[Inference] reinit failed:', reinitErr)
        }
      }

      // Use fallback
      generateFallback(summary)
    } finally {
      isGeneratingRef.current = false
      setStatusText('')
    }
  }

  const generateFallback = (summary: any) => {
    console.log('[Fallback] generating from summary')
    const result: Advice[] = summary.topCategories.slice(0, 4).map((c: any) => ({
      text: t('advicesLabels.fallbackReduce', {
        category: c.category,
        amount: Math.round(c.total * 0.1),
        pct: c.pct,
      }),
      category: c.category,
    }))
    if (!result.length) {
      result.push({ text: t('advicesLabels.fallbackBudget'), category: 'General' })
    }
    setAdvices(result)
  }

  const onRefresh = () => {
    pendingSummaryRef.current = null
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
    <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: HEADER_TOP, paddingBottom: insets.bottom + 16 }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: HORIZONTAL_GUTTER, justifyContent: 'space-between' }}>
        {/* Shrinks rather than truncates: 'Analisi spese' fits at 34, the
            longer 'Transaction Analysis' does not once the level button takes
            its 40px. */}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={{ flex: 1, marginRight: 8, fontSize: 34, fontWeight: 'bold', color: '#333' }}
        >
          {t('tabs.analysis')}
        </Text>

        {/* Icon only: the title fills the row. Same reviewer rule as the chat
            header — everyone else keeps the level their questionnaire set. */}
        <LevelSelector
          levels={PROFICIENCY_LEVELS.filter((l) => isReviewer || l === proficiencyLevel).map((l) => ({
            key: l,
            label: LEVEL_CONFIG[l].label,
            icon: LEVEL_CONFIG[l].icon,
          }))}
          selectedKey={proficiencyLevel}
          onSelect={(key) => setProficiencyLevel(key as ProficiencyLevel)}
        />
      </View>

      {/* Period selector */}
      <View style={{ flexDirection: 'row', marginTop: 15, marginHorizontal: HORIZONTAL_GUTTER, borderRadius: 35, backgroundColor: '#faf9f9', padding: 4 }}>
        {(['month', '3months', 'year'] as PeriodType[]).map((p) => {
          const label =
            p === 'month'
              ? t('advicesLabels.lastMonth')
              : p === '3months'
                ? t('advicesLabels.threeMonths')
                : t('advicesLabels.lastYear')
          return (
            <TouchableOpacity
              key={p}
              onPress={async () => {
                try { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) } catch { }
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
              <Text style={{ textAlign: 'center', fontWeight: period === p ? '600' : '400', color: '#333', fontSize: 13 }}>
                {label}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Period range display */}
      <View style={{ marginTop: 12, alignItems: 'center', borderWidth: 0.5, borderColor: '#e0e0e0', backgroundColor: COLORS.white, alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 }}>
        <Text style={{ color: '#666', fontSize: 13, fontWeight: '450' }}>{getRangeText()}</Text>
      </View>

      {/* Pie Chart */}
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
          <View style={{
            flexDirection: 'row', justifyContent: 'center', marginTop: 10,
            marginLeft: '5%', flexWrap: 'wrap'
          }}>
            {(selectedIndex !== null ? [pieData[selectedIndex]].filter(Boolean) : pieData).map((p) => (
              <View key={p.label} style={{
                flexDirection: 'row', alignItems: 'center',
                width: 150, marginLeft: 25, marginBottom: 6
              }}>
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
        style={{ paddingHorizontal: HORIZONTAL_GUTTER, marginTop: 20 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
      >
        {/* The full-height spinner only while there is nothing to show yet;
            a re-run keeps the previous advices under a slim banner. */}
        {loading && !advices.length ? (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={{ marginTop: 12, color: '#888', fontSize: 14 }}>
              {statusText || t('advicesLabels.analysis')}
            </Text>
          </View>
        ) : (
          <>
            <Text style={{ fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#333' }}>
              {t('advicesLabels.advices')}
            </Text>
            {loading && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
                paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#F4F6FB',
              }}>
                <ActivityIndicator color={COLORS.primary} size="small" />
                <Text style={{ color: '#666', fontSize: 13, flex: 1 }}>
                  {statusText || t('advicesLabels.analysis')}
                </Text>
              </View>
            )}
            {(() => {
              const s = suggerimentoDaSpese(
                pieData.map((p) => ({
                  category: p.key ?? '',
                  total: p.value,
                  // Never more months than the selected period spans.
                  months: Math.min(p.months ?? 1, period === 'month' ? 1 : period === '3months' ? 3 : 12),
                })),
                proficiencyLevel,
                locale === 'en' ? 'en' : 'it',
                (c) => categoriesFromLocale[c]?.label || c,
                period
              )
              if (!s) return null
              return (
                <View style={{ backgroundColor: '#F4F6FB', borderRadius: 12, padding: 15, marginBottom: 12 }}>
                  <Text style={{ color: '#333', lineHeight: 20 }}>{s.messaggio}</Text>
                  <Text style={{ color: '#888', fontSize: 11, marginTop: 6 }}>{s.avvertenza}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: '/chat',
                        params: { rag: '1', ask: s.domanda_chat, askId: String(Date.now()) },
                      })
                    }
                    style={{ marginTop: 10, backgroundColor: COLORS.primary, borderRadius: 8, padding: 10 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '600', textAlign: 'center' }}>{s.collegamento}</Text>
                  </TouchableOpacity>
                </View>
              )
            })()}
            {visibleAdvices.map((item, idx) => {
              const baseColor = getCategoryBaseColor(item.category)
              const emoji = getCategoryEmoji(item.category)
              return (
                <View
                  key={idx}
                  style={{
                    backgroundColor: appendHexOpacity(baseColor || '#CCCCCC', '20'),
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
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#888', marginBottom: 4, textTransform: 'uppercase' }}>
                        {item.category}
                      </Text>
                    ) : null}
                    <Text style={{ color: '#333', lineHeight: 20 }}>{item.text}</Text>
                  </View>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>
    </View>
  )
}