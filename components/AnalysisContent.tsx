import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PieChart } from 'react-native-gifted-charts';
import { COLORS } from '../constants/color';
import { useTranslation } from '../lib/i18n';
import locales from '../locales/locales.json';
import { useRouter } from 'expo-router';
import { loadProficiencyLevel } from '../lib/questionnaireStorage';
import { Livello, suggerimentoDaSpese } from '../lib/projection';


interface AnalysisContentProps {
  expensesByCategory: Array<{ category: string; total: number }>;
  categoryColors: Record<string, string>;
  categoryIcons: Record<string, string>;
  selectedMonth: { year: number; month: number } | null;
}

interface Advice {
  text: string;
  category: string;
}

const NGROK_URL = 'https://rhyme-headlamp-overnight.ngrok-free.dev';
const STATIC_ADVICES: Advice[] = [
  {
    text: 'Questi consigli sono generici e mirano a fornire un punto di partenza. La quantità esatta di denaro destinata a ciascuna categoria dipenderà dalle tue abitudini di spesa e dai tuoi obiettivi finanziari.',
    category: '',
  },
  {
    text: 'Ti consiglio di monitorare attentamente le tue spese nel tempo per identificare aree in cui puoi apportare modifiche e ottimizzare il tuo budget.',
    category: '',
  },
];

const hexToRgba = (hex: string, alpha = 0.125) => {
  if (!hex || typeof hex !== 'string') return hex;
  if (hex.startsWith('#') && (hex.length === 7 || hex.length === 9)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return hex;
};

const appendHexOpacity = (hex: string, alpha = '20') => {
  if (!hex || typeof hex !== 'string') return hex;
  if (hex.length === 7 && hex.startsWith('#')) return `${hex}${alpha}`;
  return hex;
};

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
}

function parseServerResponse(serverData: any): Advice[] {
  let raw: string;

  if (typeof serverData === 'string') {
    raw = serverData;
  } else if (serverData && typeof serverData.response === 'string') {
    raw = serverData.response;
  } else {
    raw = JSON.stringify(serverData);
  }

  raw = stripCodeFences(raw);

  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      raw = JSON.parse(raw);
    } catch {}
  }

  const result: Advice[] = [];
  const categoryPattern = /"category"\s*:\s*"([^"]+)"/g;
  let categoryMatch: RegExpExecArray | null;

  const categoryPositions: Array<{ name: string; index: number }> = [];
  while ((categoryMatch = categoryPattern.exec(raw)) !== null) {
    categoryPositions.push({ name: categoryMatch[1], index: categoryMatch.index });
  }

  if (categoryPositions.length === 0) {
    return extractFallbackTexts(raw);
  }

  for (let i = 0; i < categoryPositions.length; i++) {
    const { name: categoryName, index: catIndex } = categoryPositions[i];
    const nextCatIndex =
      i < categoryPositions.length - 1 ? categoryPositions[i + 1].index : raw.length;
    const segment = raw.substring(catIndex, nextCatIndex);

    const advicesStartMatch = /"advices"\s*:\s*\[/.exec(segment);
    if (!advicesStartMatch) continue;

    const advicesStart = catIndex + advicesStartMatch.index + advicesStartMatch[0].length;
    const advicesSegment = segment.substring(advicesStart);
    const textPattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let textMatch: RegExpExecArray | null;

    while ((textMatch = textPattern.exec(advicesSegment)) !== null) {
      const text = textMatch[1]
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .trim();
      if (text) {
        result.push({ category: categoryName.trim(), text });
      }
    }
  }

  return result;
}

function extractFallbackTexts(raw: string): Advice[] {
  const result: Advice[] = [];
  const textPattern = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;

  while ((match = textPattern.exec(raw)) !== null) {
    const text = match[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim();
    if (text) {
      result.push({ category: '', text });
    }
  }

  return result;
}

export default function AnalysisContent({
  expensesByCategory,
  categoryColors,
  categoryIcons,
  selectedMonth,
}: AnalysisContentProps) {
  const { locale, t } = useTranslation();
  const [advices, setAdvices] = useState<Advice[]>([]);
  const [loading, setLoading] = useState(false);
  const [pieData, setPieData] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [livello, setLivello] = useState<Livello>('intermediate');
  const router = useRouter();

  useEffect(() => {
    loadProficiencyLevel().then((l) => {
      if (l === 'base' || l === 'intermediate' || l === 'advanced') setLivello(l);
    });
  }, []);

  const lingua = locale === 'en' ? 'en' : 'it';

  const categoriesFromLocale: Record<string, any> =
    (locales as any)[locale]?.categories || {};
  const projection = suggerimentoDaSpese(
    expensesByCategory,
    livello,
    lingua,
    (c) => categoriesFromLocale[c]?.label || c
  );

  const getCategoryBaseColor = (keyOrLabel: string) => {
    if (!keyOrLabel) return '#CCCCCC';
    if (categoryColors[keyOrLabel]) return categoryColors[keyOrLabel];
    return '#CCCCCC';
  };

  const getCategoryEmoji = (keyOrLabel: string) => {
    if (!keyOrLabel) return '💡';
    if (categoryIcons[keyOrLabel]) return categoryIcons[keyOrLabel];
    if (
      categoriesFromLocale[keyOrLabel] &&
      categoriesFromLocale[keyOrLabel].icon
    )
      return categoriesFromLocale[keyOrLabel].icon;
    return '💡';
  };

  useEffect(() => {
    if (expensesByCategory.length > 0) {
      console.log('[AnalysisContent] expensesByCategory received:', expensesByCategory);
      generateAnalysis();
    }
  }, [expensesByCategory, locale]);

  const generateAnalysis = async () => {
    setLoading(true);
    setAdvices([]);
    setPieData([]);

    try {
      // Build pie data
      const total = expensesByCategory.reduce((s, r) => s + (r.total ?? 0), 0);
      const maxIndex = expensesByCategory.reduce(
        (acc, cur, i) =>
          cur.total > (expensesByCategory[acc]?.total || 0) ? i : acc,
        0
      );

      const mapped = expensesByCategory.map((r, idx) => {
        const base = getCategoryBaseColor(r.category);
        const color = hexToRgba(base, 0.125);
        const localizedLabel =
          (categoriesFromLocale[r.category] &&
            categoriesFromLocale[r.category].label) ||
          r.category;
        const item = {
          value: r.total,
          color,
          gradientCenterColor: color,
          label: localizedLabel,
          key: r.category,
        };
        if (idx === maxIndex) (item as any).focused = true;
        return item;
      });

      setPieData(mapped);
      setSelectedIndex(maxIndex);

      // Generate advices from server
      const topCategories = [...expensesByCategory]
        .sort((a, b) => b.total - a.total)
        .slice(0, 6)
        .map((r) => ({
          category: r.category,
          total: Math.round(r.total),
          pct: total ? Math.round((r.total / total) * 100) : 0,
        }));

      const payload = {
        transactions: topCategories.map((c) => ({
          category: c.category,
          total: c.total,
          percentage: c.pct,
        })),
        totalSpent: Math.round(total),
        period: 'month',
        lingua: locale,
      };

      console.log('[AnalysisContent] payload:', JSON.stringify(payload));

      const response = await fetch(`${NGROK_URL}/analyze_transaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Server error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      console.log('[AnalysisContent] server response:', data);
      const parsed = parseServerResponse(data);
      console.log('[AnalysisContent] parsed advices:', parsed);

      if (parsed.length > 0) {
        setAdvices([...parsed, ...STATIC_ADVICES]);
      } else {
        generateFallback(topCategories);
      }
    } catch (err) {
      console.error('[Analysis] error:', err);
      generateFallback(expensesByCategory);
    } finally {
      setLoading(false);
    }
  };

  const generateFallback = (categories: any[]) => {
    const result: Advice[] = categories
      .slice(0, 4)
      .map((c) => ({
        text: `Riduci del 10% le spese in ${c.category}: risparmieresti circa €${Math.round(
          c.total * 0.1
        )} (attualmente ${c.pct}% del totale).`,
        category: c.category,
      }));
    if (!result.length) {
      result.push({
        text: 'Imposta un budget mensile per le categorie principali.',
        category: 'General',
      });
    }
    setAdvices(result);
  };

  const handlePiePress = (slice: any, index: number) => {
    if (selectedIndex === index) {
      setSelectedIndex(null);
      setPieData((prev) => prev.map((p) => ({ ...p, focused: false })));
    } else {
      setSelectedIndex(index);
      setPieData((prev) => prev.map((p, i) => ({ ...p, focused: i === index })));
    }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
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
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'center',
              marginTop: 10,
              flexWrap: 'wrap',
            }}
          >
            {(selectedIndex !== null
              ? [pieData[selectedIndex]].filter(Boolean)
              : pieData
            ).map((p) => (
              <View
                key={p.label}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  width: 150,
                  marginRight: 12,
                  marginBottom: 6,
                }}
              >
                <View
                  style={{
                    height: 10,
                    width: 10,
                    borderRadius: 5,
                    backgroundColor: p.color,
                    marginRight: 10,
                  }}
                />
                <Text style={{ color: 'black', fontSize: 12 }}>
                  {p.label}:{' '}
                  {Math.round(
                    (p.value / Math.max(1, pieData.reduce((s, x) => s + x.value, 0))) *
                      100
                  )}
                  %
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Advice list */}
      <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
        {loading ? (
          <View style={{ alignItems: 'center', paddingTop: 40 }}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={{ marginTop: 12, color: '#888', fontSize: 14 }}>
              {t ? t('advicesLabels.analysis') : 'Analisi in corso...'}
            </Text>
          </View>
        ) : (
          <>
            <Text
              style={{
                fontSize: 18,
                fontWeight: 'bold',
                marginBottom: 15,
                color: '#333',
              }}
            >
              Consigli
            </Text>

            {projection && (
              <View style={{ backgroundColor: '#F4F6FB', borderRadius: 12, padding: 15, marginBottom: 12 }}>
                <Text style={{ color: '#333', lineHeight: 20 }}>{projection.messaggio}</Text>
                <Text style={{ color: '#888', fontSize: 11, marginTop: 6 }}>{projection.avvertenza}</Text>
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: '/chat',
                      params: { rag: '1', level: livello, ask: projection.domanda_chat, askId: String(Date.now()) },
                    })
                  }
                  style={{ marginTop: 10, backgroundColor: COLORS.primary, borderRadius: 8, padding: 10 }}
                >
                  <Text style={{ color: '#fff', fontWeight: '600', textAlign: 'center' }}>{projection.collegamento}</Text>
                </TouchableOpacity>
              </View>
            )}

            {advices.map((item, idx) => {
              const baseColor = getCategoryBaseColor(item.category);
              const emoji = getCategoryEmoji(item.category);
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
              );
            })}
          </>
        )}
      </View>
    </ScrollView>
  );
}
