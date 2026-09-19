import { AntDesign, Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { AnimationPhase } from '@/components/AnswerAnimation';
import ChatScreen from '@/components/ChatScreen';
import { Source, SourcesDisplay } from '@/components/SourcesDisplay';
import { COLORS } from '@/constants/color';
import { useTranslation } from '@/lib/i18n';
import { useSharedLevel } from '@/lib/levelStore';
import { ProficiencyLevel } from './_layout';

type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  sources?: Source[];
};

type IconConfig = {
  library: 'Ionicons' | 'Feather' | 'AntDesign';
  name: string;
};

type Category = {
  id: string;
  name: string;
  nameEn: string;
  questions: string[];
  // Not translations: the English corpus (FCA / Bank of England) covers different
  // topics from CONSOB, so each question targets a page that answers it.
  questionsEn: string[];
  iconConfig: IconConfig;
};

const QUESTION_CATEGORIES: Category[] = [
  {
    id: 'generali',
    name: 'Generali',
    nameEn: 'General',
    iconConfig: { library: 'Ionicons', name: 'grid-outline' },
    questions: [
      'Su cosa si fonda una buona pianificazione finanziaria?',
      'Cosa devi assolutamente sapere prima di investire?',
      'Chi può prestare i servizi di investimento?',
      'Che cos\'è il trading algoritmico?',
      'Che cos\'è l\'abuso di informazioni privilegiate?',
    ],
    questionsEn: [
      'What is the Prudential Regulation Authority (PRA)?',
      'What is not covered in GDP statistics?',
      'Why is the housing market important to the economy?',
      'How can you limit your exposure to risk?',
      'Can banks create as much money as they like?'
    ],
  },
  {
    id: 'prodotti-finanziari',
    name: 'Prodotti finanziari',
    nameEn: 'Financial Products',
    iconConfig: { library: 'Feather', name: 'pie-chart' },
    questions: [
      'Cosa sono i fondi comuni?',
      'Cosa sono le azioni?',
      'Che cosa significa il termine criptovaluta?',
      'Le monete a corso legale e le criptovalute assolvono alle stesse funzioni?',
      'Chi acquista un\'obbligazione cosa fa?',
      'Chi è l\'emittente di un\'obbligazione?',
      'Che cosa indica la scadenza di un\'obbligazione?',
      'Cosa sono i prodotti derivati?',
      'Che cos\'è uno swap?',
    ],
    questionsEn: [
      'Who can give debt advice?',
      'What are buildings insurance premiums?',
      'What are the benefits of tokenisation?',
      'What are the differences between commodity and fiat money?',
      'Is a stablecoin the same thing as a CBDC?',
      'How some debt products are advertised?',
      'Are there stablecoins in the UK today?'

    ],
  },
  {
    id: 'inflazione',
    name: 'Inflazione',
    nameEn: 'Inflation',
    iconConfig: { library: 'Feather', name: 'trending-up' },
    questions: [
      'Che cos\'è l\'inflazione?',
      'Qual è l\'effetto dell\'aumento dei tassi di interesse sui nuovi prestiti?',
      'Perché devo considerare l\'inflazione nella mia strategia di investimento?',
      'Perché dovrei seguire i movimenti dei tassi di interesse delle banche centrali?',
      'Puoi fornire un esempio dell\'effetto dell\'inflazione su un\'obbligazione a cedola fissa?',
    ],
    questionsEn: [
      'Inflation was not caused by people spending too much. So why will higher interest rates work?',
      'Should I be worried whenever I see reduced prices?',
      'How does the Bank of England influence the exchange rate?',
      'What does the Bank of England do to keep inflation low and stable?'
    ],
  },
  {
    id: 'crisi',
    name: 'Crisi',
    nameEn: 'Investing',
    iconConfig: { library: 'Feather', name: 'activity' },
    questions: [
      'Che cosa fu la crisi del 1929?',
      'Che cosa accadde il 24 ottobre 1929, il cosiddetto Giovedì nero?',
      'Qual è la sequenza tipica attraverso cui si sviluppa una crisi generata da una bolla speculativa?',
      'Quali errori si possono commettere negli investimenti durante le crisi?',
    ],
    questionsEn: [
      'Am I really ready to invest for the long term?',
      'What are the golden rules of investing?',
      'Are you tempted by high-risk investments?',
      'Should I be investing using a credit card?',
      'How to understand investment right for my risk tolerance?'
    ],
  },
  {
    id: 'rischi',
    name: 'Rischi dell\'investimento',
    nameEn: 'Investment Risks',
    iconConfig: { library: 'Feather', name: 'alert-circle' },
    questions: [
      'Cosa deve fare l\'investitore prima di effettuare un investimento in strumenti finanziari?',
      'Qual è la differenza tra titoli di capitale e titoli di debito?',
      'Cosa si intende per rischio emittente?',
      'Come valuto appropriatezza di un investimento?',
      'Qual è il rischio associato alla divisa in cui è denominato un investimento?',
      'Quando l\'investitore dovrebbe concludere un\'operazione avente ad oggetto strumenti finanziari derivati?',
    ],
    questionsEn: [
      'How to stop or reduce trail commission?',
      'What is an unregulated collective investment scheme (UCIS)?',
      'What is a collective investment scheme (CIS)?',
      'What are risks of investing in mini-bonds?',
      "What's the investment going to cost me in fees/charges?"
    ],
  },
  {
    id: 'truffe',
    name: 'Truffe',
    nameEn: 'Scams',
    iconConfig: { library: 'AntDesign', name: 'alert' },
    questions: [
      'Qual è la costante nelle truffe finanziarie?',
      'Che cos\'è lo schema Ponzi?',
      'Fino a quando riesce a funzionare lo schema Ponzi?',
      'Quali sono i principali ingredienti della truffa utilizzati dal truffatore?',
    ],
    questionsEn: [
      'How forex (FX) trading and brokerage scams work',
      'What happens after you cancel a recurring card payment?',
      'How binary options scams work?',
      'How landing banking scams work',
      "What precautions should you take when using your bank's website to avoid fake website scams?"
    ],
  },
];

const NGROK_URL = "https://rhyme-headlamp-overnight.ngrok-free.dev";

// The server answers and retrieves in this language: CONSOB pages for "it",
// FCA and Bank of England pages for "en".
type Lingua = 'it' | 'en';

async function callModel(
  conversation: Message[],
  endpoint: ModelChoice,
  ragEnabled: boolean,
  proficiencyLevel: ProficiencyLevel,
  lingua: Lingua,
  query?: string,
  onPhaseChange?: (phase: AnimationPhase) => void
) {

  console.log("RAG ENABLED:", ragEnabled, "LEVEL:", proficiencyLevel, "LINGUA:", lingua);
  const messages = conversation.filter(m => m.role !== 'system');

  const url = ragEnabled
    ? `${NGROK_URL}/rag/${endpoint}`
    : `${NGROK_URL}/${endpoint}`;

  const body = ragEnabled
    ? {
      messages,
      query: query ?? messages[messages.length - 1]?.content,
      k: 6,
      //min_score: 0.05,
      min_score: 5.5,
      proficiency_level: proficiencyLevel,
      lingua,
    }
    : { messages, lingua };

  // Simula le fasi di elaborazione
  if (onPhaseChange) {
    onPhaseChange('fetching');
    await new Promise(r => setTimeout(r, 800));
    onPhaseChange('reasoning');
    await new Promise(r => setTimeout(r, 1000));
    onPhaseChange('generating');
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    // FastAPI's 422 carries `detail` as a list of validation errors, not a string.
    const detail = Array.isArray(err.detail)
      ? err.detail.map((d: any) => d.msg).join('; ')
      : err.detail;
    throw new Error(detail ?? `Server error ${response.status}`);
  }

  if (onPhaseChange) {
    onPhaseChange('complete');
  }

  return response.json();
}

async function fetchSaluto() {
  try {
    const response = await fetch(
      `${NGROK_URL}/saluta?nome=stefano`,
      { headers: { "ngrok-skip-browser-warning": "true" } }
    );
    const data = await response.json();
    console.log("[saluta] risposta:", data);
  } catch (err) {
    console.error("[saluta] errore:", err);
  }
}

const MODEL_OPTIONS: { label: string; value: ModelChoice }[] = [
  { label: 'Gemma 1B', value: 'call_gemma_1b' },
  { label: 'Gemma 270M', value: 'call_gemma_270m' },
  { label: 'SmolLM3 3B', value: 'call_smollm3' },
];

type ModelChoice = 'call_gemma_1b' | 'call_gemma_270m' | 'call_smollm3';

export default function Chat(): React.JSX.Element {

  const { rag, resetMessages, ask, askId } = useLocalSearchParams();
  const { locale, t } = useTranslation();

  const INITIAL_CONVERSATION: Message[] = [
    {
      role: 'system',
      content: 'Chat con modello Gemma fine-tuned.',
    },
  ];

  const getCategoryName = (category: Category) => locale === 'en' ? category.nameEn : category.name;
  const getCategoryQuestions = (category: Category) => locale === 'en' ? category.questionsEn : category.questions;

  const renderIcon = (iconConfig: IconConfig, color: string) => {
    const size = 20;
    switch (iconConfig.library) {
      case 'Ionicons':
        return <Ionicons name={iconConfig.name as any} size={size} color={color} />;
      case 'Feather':
        return <Feather name={iconConfig.name as any} size={size} color={color} />;
      case 'AntDesign':
        return <AntDesign name={iconConfig.name as any} size={size} color={color} />;
    }
  };

  const router = useRouter();
  const searchParams = useLocalSearchParams();
  const paramModel = searchParams.model as ModelChoice | undefined;
  const DEFAULT_MODEL: ModelChoice = 'call_gemma_1b';
  const initialModel: ModelChoice = paramModel === 'call_gemma_270m' || paramModel === 'call_smollm3' ? paramModel : DEFAULT_MODEL;

  const [conversation, setConversation] = useState<Message[]>(INITIAL_CONVERSATION);
  const [userInput, setUserInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<ModelChoice>(initialModel);
  const [answerPhase, setAnswerPhase] = useState<AnimationPhase>('idle');
  const [currentSources, setCurrentSources] = useState<Source[]>([]);
  const [showSourcesModal, setShowSourcesModal] = useState<boolean>(false);
  const [ragEnabled, setRagEnabled] = useState<boolean>(false);
  const [proficiencyLevel] = useSharedLevel();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showQuestionsModal, setShowQuestionsModal] = useState<boolean>(false);

  // Aggiorna ragEnabled quando rag cambia
  useEffect(() => {
    const ragParam = Array.isArray(rag) ? rag[0] : rag;
    // Default to enabled on web if not specified
    const isEnabled = ragParam === undefined ? true : !!(ragParam && (ragParam === "1" || ragParam === "true" || String(ragParam).toUpperCase() === "ON"));
    console.log("DEBUG RAG - ragParam:", ragParam, "isEnabled:", isEnabled);
    setRagEnabled(isEnabled);
  }, [rag]);


  // Listen for reset messages from header button
  useEffect(() => {
    if (resetMessages) {
      setConversation(INITIAL_CONVERSATION);
      setUserInput('');
      setAnswerPhase('idle');
      setShowSourcesModal(false);
      setCurrentSources([]);
    }
  }, [resetMessages]);

  useEffect(() => {
    if (paramModel && paramModel !== selectedModel && (paramModel === 'call_gemma_1b' || paramModel === 'call_gemma_270m' || paramModel === 'call_smollm3')) {
      setSelectedModel(paramModel);
    }
  }, [paramModel, selectedModel]);

  useEffect(() => {
    fetchSaluto();
  }, []);

  // Auto-send a question passed from the spending analysis card (once per askId).
  const lastAskId = useRef<string | null>(null);
  useEffect(() => {
    const q = Array.isArray(ask) ? ask[0] : ask;
    const id = String(Array.isArray(askId) ? askId[0] : askId ?? q);
    if (!q || lastAskId.current === id) return;
    lastAskId.current = id;
    // Always through /rag/<model> with the user's level and language, and only this question:
    // the plain /<model> endpoints have no documents, language or level.
    const question: Message = { role: 'user', content: q };
    setConversation((prev) => [...prev, question]);
    requestReply([question], true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, askId]);

  const handleSendMessage = async (message?: string) => {
    const messageToSend = message || userInput.trim();

    if (!messageToSend) {
      Alert.alert(t('chat.errorTitle'), t('chat.emptyMessage'));
      return;
    }

    const newUserMessage: Message = { role: 'user', content: messageToSend };
    const updatedConversation = [...conversation, newUserMessage];

    setConversation(updatedConversation);
    if (!message) {
      setUserInput('');
    }
    await requestReply(updatedConversation);
  };

  // Asks the server to answer the last user message of `conv` and appends the reply.
  const requestReply = async (conv: Message[], forceRag = false) => {
    setIsGenerating(true);
    setAnswerPhase('fetching');

    try {
      const data = await callModel(conv, selectedModel, forceRag || ragEnabled, proficiencyLevel, locale, undefined, setAnswerPhase);

      const sources: Source[] = data.sources ? data.sources.map((source: any, idx: number) => ({
        id: source.id || `[${idx + 1}]`,
        text: source.text || '',
        metadata: {
          source_title: source.metadata?.source_title,
          source_url: source.metadata?.source_url,
          answer: source.metadata?.answer,
        }
      })) : [];

      const newMessage: Message = {
        role: 'assistant',
        content: data.reply,
        sources: sources.length > 0 ? sources : undefined
      };

      setConversation(prev => [...prev, newMessage]);
      setCurrentSources(sources);

      console.log("SOURCES:", sources);
    } catch (err: any) {
      console.error(err);
      setConversation(prev => [
        ...prev,
        { role: 'assistant', content: t('chat.errorPrefix', { message: err.message }) },
      ]);
    } finally {
      setIsGenerating(false);
      setAnswerPhase('idle');
    }
  };

  // When the user changes level or language, regenerate the last answer with the new value.
  const previousSettings = useRef({ locale, proficiencyLevel });
  useEffect(() => {
    const prev = previousSettings.current;
    previousSettings.current = { locale, proficiencyLevel };
    if (prev.locale === locale && prev.proficiencyLevel === proficiencyLevel) return;
    if (isGenerating) return;

    const last = conversation[conversation.length - 1];
    if (last?.role !== 'assistant') return;

    const withoutLastReply = conversation.slice(0, -1);
    setConversation(withoutLastReply);
    setCurrentSources([]);
    requestReply(withoutLastReply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, proficiencyLevel]);

  return (
    <SafeAreaView style={styles.container}>
      {/* Chip delle categorie */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.categoriesContainer}
        contentContainerStyle={styles.categoriesContent}
      >
        {QUESTION_CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[
              styles.categoryChip,
              selectedCategory === category.id && styles.categoryChipActive
            ]}
            onPress={() => {
              setSelectedCategory(category.id);
              setShowQuestionsModal(true);
            }}
          >
            <View style={styles.chipIconContainer}>
              {renderIcon(category.iconConfig, selectedCategory === category.id ? '#FFFFFF' : '#1E293B')}
            </View>
            <Text
              style={[
                styles.categoryChipText,
                selectedCategory === category.id && styles.categoryChipTextActive
              ]}
            >
              {getCategoryName(category)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ChatScreen
        conversation={conversation}
        userInput={userInput}
        onUserInputChange={setUserInput}
        onSendMessage={() => handleSendMessage()}
        isGenerating={isGenerating}
        answerPhase={answerPhase}
        showSourcesButton={currentSources.length > 0}
        onOpenSources={() => setShowSourcesModal(true)}
        isLargeScreen={true}
      />

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
                  console.error('Errore apertura URL:', err);
                  Alert.alert(t('chat.errorTitle'), t('chat.cannotOpenLink'));
                });
              }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Modal for category questions */}
      <Modal
        visible={showQuestionsModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          setShowQuestionsModal(false);
          setSelectedCategory(null);
        }}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowQuestionsModal(false);
            setSelectedCategory(null);
          }}
        >
          <TouchableOpacity
            style={styles.questionsModalContent}
            activeOpacity={1}
            onPress={() => { }}
          >
            {/* Modal header */}
            {selectedCategory && QUESTION_CATEGORIES.find(c => c.id === selectedCategory) && (
            <View style={styles.modalHeader}>
              <View style={styles.headerWithBadge}>
                <View style={styles.categorySquareIcon}>
                  {renderIcon(QUESTION_CATEGORIES.find(c => c.id === selectedCategory)!.iconConfig, '#1E293B')}
                </View>
                <Text style={styles.modalTitle}>
                  {getCategoryName(QUESTION_CATEGORIES.find(c => c.id === selectedCategory)!)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setShowQuestionsModal(false);
                  setSelectedCategory(null);
                }}
                style={styles.closeButton}
              >
                <Feather name="x" size={24} color="#0F172A" />
              </TouchableOpacity>
            </View>
            )}

            {/* Questions list */}
            {selectedCategory && (
            <ScrollView style={styles.questionsListContainer}>
              {getCategoryQuestions(QUESTION_CATEGORIES.find(c => c.id === selectedCategory)!).map(
                (question, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.questionItem}
                    onPress={() => {
                      handleSendMessage(question);
                      setShowQuestionsModal(false);
                      setSelectedCategory(null);
                    }}
                  >
                    <Text style={styles.questionText}>{question}</Text>
                    <Feather name="arrow-right" size={16} color="#0F172A" />
                  </TouchableOpacity>
                )
              )}
            </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  categoriesContainer: {
    backgroundColor: COLORS.white,
    borderBottomColor: '#E2E8F0',
    maxHeight: 56,
    marginBottom: 8,
    marginLeft: '-1%'
  },
  categoriesContent: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 8,
    justifyContent: 'center',
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    gap: 8,
  },
  categoryChipActive: {
    backgroundColor: '#1E293B',
    borderColor: '#1E293B',
  },
  chipIconContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 14,
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#475569',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#1E293B', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#334155', marginBottom: 12 },

  modelSelector: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  modelButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
  },
  modelButtonActive: {
    backgroundColor: '#1E293B',
    borderColor: '#1E293B',
  },
  modelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  modelButtonTextActive: {
    color: '#FFFFFF',
  },
  modelInfo: {
    fontSize: 12,
    color: '#94A3B8',
  },
  modelInfoBold: {
    fontWeight: '700',
    color: '#475569',
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
    maxHeight: '80%',
    maxWidth: 768,
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  questionsModalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
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
    marginBottom: 16,
  },
  headerWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categorySquareIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#E8F0FE',
    justifyContent: 'center',
    alignItems: 'center',
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
  questionsListContainer: {
    flex: 1,
    marginBottom: 12,
  },
  questionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 0,
    marginVertical: 2.5,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
  },
  questionText: {
    flex: 1,
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '500',
    marginRight: 12,
    lineHeight: 20,
  },
  disclaimerContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'flex-end',
  },
  disclaimerText: {
    fontSize: 10,
    fontWeight: '400',
    color: '#94A3B8',
    lineHeight: 14,
    textAlign: 'right',
    maxWidth: '90%',
  },
});