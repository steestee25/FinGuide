import { AntDesign, Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { PROFICIENCY_LEVELS, ProficiencyLevel } from './_layout';

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
  },
  {
    id: 'crisi',
    name: 'Crisi',
    nameEn: 'Crisis',
    iconConfig: { library: 'Feather', name: 'shield' },
    questions: [
      'Che cosa fu la crisi del 1929?',
      'Quali furono le cause remote della crisi del 1929?',
      'Qual è la sequenza tipica attraverso cui si sviluppa una crisi generata da una bolla speculativa?',
      'Qual è stato l\'impatto del Covid-19 sui mercati azionari a livello mondiale?',
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
      'Che cos\'è il rischio di mercato?',
      'Qual è il rischio associato alla divisa in cui è denominato un investimento?',
      'Quando l\'investitore dovrebbe concludere un\'operazione avente ad oggetto strumenti finanziari derivati?',
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
  },
];

const NGROK_URL = "https://rhyme-headlamp-overnight.ngrok-free.dev";

async function callModel(
  conversation: Message[],
  endpoint: ModelChoice,
  ragEnabled: boolean,
  proficiencyLevel: ProficiencyLevel,
  query?: string,
  onPhaseChange?: (phase: AnimationPhase) => void
) {

  console.log("RAG ENABLED:", ragEnabled, "LEVEL:", proficiencyLevel);
  const messages = conversation.filter(m => m.role !== 'system');

  const url = ragEnabled
    ? `${NGROK_URL}/rag/${endpoint}`
    : `${NGROK_URL}/${endpoint}`;

  const body = ragEnabled
    ? {
      messages,
      query: query ?? messages[messages.length - 1]?.content,
      k: 6,
      min_score: 0.05,
      proficiency_level: proficiencyLevel,
    }
    : { messages };

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
    const err = await response.json();
    throw new Error(err.detail ?? "Server error");
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

  const { rag, level, resetMessages } = useLocalSearchParams();
  const { locale, t } = useTranslation();

  const INITIAL_CONVERSATION: Message[] = [
    {
      role: 'system',
      content: 'Chat con modello Gemma fine-tuned.',
    },
  ];

  const getCategoryName = (category: Category) => locale === 'en' ? category.nameEn : category.name;

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
  const [proficiencyLevel, setProficiencyLevel] = useState<ProficiencyLevel>('intermediate');
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

  // Aggiorna il livello di competenza dell'utente quando level cambia
  useEffect(() => {
    const levelParam = Array.isArray(level) ? level[0] : level;
    if (PROFICIENCY_LEVELS.includes(levelParam as ProficiencyLevel)) {
      setProficiencyLevel(levelParam as ProficiencyLevel);
    }
  }, [level]);

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
    setIsGenerating(true);
    setAnswerPhase('fetching');

    try {
      const data = await callModel(updatedConversation, selectedModel, ragEnabled, proficiencyLevel, undefined, setAnswerPhase);

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
              {QUESTION_CATEGORIES.find(c => c.id === selectedCategory)?.questions.map(
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