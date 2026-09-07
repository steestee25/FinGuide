import * as Haptics from 'expo-haptics'
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
import { useTranslation } from '../../lib/i18n'
import { downloadUrl, getModel, minValidSize, modelPath } from '../../lib/modelConfig'
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
let initLlama: any = null
let releaseAllLlama: any = null

if (Platform.OS !== 'web') {
  RNFS = require('react-native-fs')
  const llamaModule = require('llama.rn')
  initLlama = llamaModule.initLlama
  releaseAllLlama = llamaModule.releaseAllLlama
}

const MODEL = getModel()

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
 * Try to extract an array of Advice from whatever the model returned.
 * Handles:
 *   - {"advices": [...]}
 *   - {"advice": [...]}
 *   - [...]  (bare array)
 *   - Output wrapped in ```json ... ```
 *   - Malformed output with duplicate "category"/"advice" keys
 */
function tryParseAdvices(raw: string): Advice[] {
  const cleaned = stripCodeFences(raw)

  const results: Advice[] = []

  // 1. Strategy: detect all categories
  const categoryRegex = /"category"\s*:\s*"([^"]+)"/g
  const categories: string[] = []
  let match

  while ((match = categoryRegex.exec(cleaned)) !== null) {
    categories.push(match[1])
  }

  if (!categories.length) {
    console.warn('[Parse] no categories found')
  }

  // 2. Strategy: extract all advice texts globally
  // works even if duplicated keys or broken JSON
  const adviceRegex = /"text"\s*:\s*"([\s\S]*?)"|"advice"\s*:\s*"([\s\S]*?)"/g

  const texts: string[] = []
  while ((match = adviceRegex.exec(cleaned)) !== null) {
    const value = match[1] || match[2]
    if (value?.trim()) texts.push(value.trim())
  }

  // fallback for your old "advice": ...
  const looseAdviceRegex = /"advice"\s*:\s*"([\s\S]*?)"/g
  while ((match = looseAdviceRegex.exec(cleaned)) !== null) {
    const value = match[1]
    if (value?.trim()) texts.push(value.trim())
  }

  if (!texts.length) {
    console.warn('[Parse] no advice texts found')
    return []
  }

  // 3. Map: distribute advices across categories
  // assumption: 3 advices per category (your requirement)
  const perCategory = 3

  let textIndex = 0

  for (const cat of categories) {
    for (let i = 0; i < perCategory; i++) {
      if (!texts[textIndex]) break

      results.push({
        category: cat,
        text: texts[textIndex],
      })

      textIndex++
    }
  }

  console.log(
    '[Parse] extracted:',
    results.length,
    'advices for',
    categories.length,
    'categories'
  )

  return results
}

export default function Advices() {
  const { session, loading: authLoading } = useAuth()
  const { t, locale } = useTranslation()
  const insets = useSafeAreaInsets()

  const [period, setPeriod] = useState<PeriodType>('month')
  const [advices, setAdvices] = useState<Advice[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [useLocalModel, setUseLocalModel] = useState(true)
  const [statusText, setStatusText] = useState('')
  const [pieData, setPieData] = useState<{ value: number; color: string; gradientCenterColor?: string; label: string; key?: string }[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const contextRef = useRef<any>(null)
  const isInitializedRef = useRef(false)
  const pendingSummaryRef = useRef<any>(null)
  const isGeneratingRef = useRef(false)
  const isFetchingRef = useRef(false)

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
      setPieData((prev) => prev.map((p) => ({ ...p, focused: false })))
    } else {
      setSelectedIndex(index)
      setPieData((prev) => prev.map((p, i) => ({ ...p, focused: i === index })))
      setAdvices((prev) =>
        prev.filter((a) => {
          const cat = a.category
          return cat === sliceKey || cat === slice.label || getCategoryKeyFromLabel(cat) === sliceKey
        })
      )
    }
  }


  useEffect(() => {
    if (Platform.OS === 'web' || isInitializedRef.current) return
    isInitializedRef.current = true
    initModel()
  }, [])

  const getModelPath = () => modelPath(MODEL)

  const initModel = async () => {
    setModelLoading(true)
    setModelError(null)
    try {
      const path = getModelPath()
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

      if (contextRef.current) {
        console.log('[Model] releasing previous context…')
        await releaseAllLlama()
        contextRef.current = null
      }

      console.log('[Model] calling initLlama…')
      setStatusText(t('advicesLabels.modelLoading'))
      contextRef.current = await initLlama({
        model: path,
        use_mlock: true,
        n_ctx: 2048,
        n_gpu_layers: 1,
        n_threads: 4,
      })
      console.log('[Model] initLlama done, context ok:', !!contextRef.current)

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

  useEffect(() => {
    if (!authLoading && session?.user) {
      fetchAndGenerate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, period, authLoading])

  const fetchAndGenerate = async () => {
    if (!session?.user) return

    // Prevent concurrent fetch calls
    if (isFetchingRef.current) {
      console.warn('[Fetch] already fetching — skipping request')
      return
    }

    isFetchingRef.current = true
    setLoading(true)
    setAdvices([])
    setPieData([])
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
        setAdvices([{ text: t('advicesLabels.noExpenses'), category: 'General' }])
        return
      }

      // 2. Build pie data and summary
      const total = rows.reduce((s: number, r: any) => s + (r.total ?? 0), 0)

      // Find index of highest expense category
      const maxIndex = rows.reduce((acc: number, cur: any, i: number) =>
        (cur.total > (rows[acc]?.total || 0) ? i : acc), 0)

      const mapped = rows.map((r: any, idx: number) => {
        const base = (categoryColors[r.category] && categoryColors[r.category][0]) || '#CCCCCC'
        const gradBase = (categoryColors[r.category] && categoryColors[r.category][1]) || base
        const color = hexToRgba(base, 0.125)
        const gradient = hexToRgba(gradBase, 0.125)
        const localizedLabel = (categoriesFromLocale[r.category] && categoriesFromLocale[r.category].label) || r.category
        const item = { value: r.total, color, gradientCenterColor: gradient, label: localizedLabel, key: r.category }
        if (idx === maxIndex) (item as any).focused = true
        return item
      })

      setPieData(mapped)
      setSelectedIndex(maxIndex)

      // 3. Build compact summary for LLM
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

      // 4. Generate advices — park if model not ready yet
      if (useLocalModel) {
        if (contextRef.current && !isGeneratingRef.current) {
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
      if (!pendingSummaryRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  // ─── Prompt & inference ────────────────────────────────────────────────────


  const buildPrompt = (summary: any): string => {
    const cats = summary.topCategories
      .map((c: any) => `${c.category} €${c.total} (${c.pct}%)`)
      .join(', ')

    return (
      `<start_of_turn>user\n` +
      `Sei un consulente finanziario personale. Analizza le spese e genera 3 consigli pratici in italiano per le 
      diverse categorie.\n` +
      `Categorie: ${cats}\n` +
      `Genera un unico file JSON per le categorie elencate.\n` +
      `Esempio formato della risposta: {"category": "Electronics", "advices": [{"text": "Il 65% delle spese è destinato all'acquisto di elettronica, stabilisci un budget massimo per gli acquisti di elettronica."}, {"text": "Considera l'usato o il ricondizionamento per risparmiare.  Fai attenzione alle offerte e agli sconti"}, {"text": "Valuta se puoi dispositivi nuovi o ricondizionati per spendere meno"}]}, "category": "Car", "advices": [{"text": "Le spese per "Car" rappresentano il 13% delle tue spese.  È consigliabile monitorare l'utilizzo del veicolo e valutare se è necessario un nuovo modello o se puoi ottimizzare i consumi per ridurre i costi.  Considera l'acquisto di un'auto usata per risparmiare."}, {"text": "Considera l'usato o il ricondizionamento per risparmiare.  Fai attenzione alle offerte e agli sconti"}, {"text": "Valuta se puoi dispositivi nuovi o ricondizionati per spendere meno"}]}\n` +
      `<end_of_turn>\n` +
      `<start_of_turn>model\n`
    )

  }

  const generateWithLocalModel = async (summary: any) => {
    // Prevent concurrent inference calls
    if (isGeneratingRef.current) {
      console.warn('[Inference] already generating — skipping request')
      return
    }

    if (!contextRef.current) {
      console.error('[Inference] no context available')
      generateFallback(summary)
      return
    }

    isGeneratingRef.current = true
    console.log('[Inference] starting generation…')
    setStatusText(t('advicesLabels.advicesGeneration'))
    let fullResponse = ''

    try {
      const prompt = buildPrompt(summary)
      console.log('[Inference] prompt length:', prompt.length)

      const result = await contextRef.current.completion(
        {
          prompt,
          n_predict: 800,
          temperature: 0.3,
          top_p: 0.9,
          repeat_penalty: 1.1,
          stop: ['<end_of_turn>', '<start_of_turn>', '</s>'],
        },
        (data: { token: string }) => {
          if (data.token) fullResponse += data.token
        },
      )

      const rawText = (result?.text ?? fullResponse).trim()
      console.log('[Inference] raw output:', rawText)

      const parsed = tryParseAdvices(rawText)
      console.log('[Inference] parsed advices:', parsed.length)

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
          if (contextRef.current) {
            await releaseAllLlama()
            contextRef.current = null
          }
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
        <Text style={{ fontSize: 34, fontWeight: 'bold', color: '#333' }}>
          {t('tabs.analysis')}
        </Text>

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
        {loading ? (
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
            {advices.map((item, idx) => {
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