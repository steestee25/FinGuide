
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

import { AntDesign, Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useGlobalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';

// Import components
import ChatScreen from '@/components/ChatScreen';
import ProgressBar from '@/components/ProgressBar';

// Import utilities
import { SourcesDisplay } from '@/components/SourcesDisplay';
import { normalizeLevel } from '@/lib/chatPrompt';
import type { Lang } from '@/lib/retrieval';
import { CHAT_GENERATION, runChatTurn } from '@/lib/chatTurn';
import { downloadModel } from '@/lib/downloadModel';
import { useTranslation } from '@/lib/i18n';
import { useSharedLevel } from '@/lib/levelStore';
import { getLlamaContext } from '@/lib/llamaContext';
import { cleanupLegacyModels, downloadUrl, minValidSize, modelPath, resolveModel } from '@/lib/modelConfig';
import {
  initializeLocalModels
} from '@/lib/modelStorage';
import { appStyles } from '../../styles/components/chatStyles';

// Conditionally import native modules (only available on mobile)
let RNFS: any = null;

if (Platform.OS !== 'web') {
  RNFS = require('react-native-fs');
}

// ===================== Question Categories =====================
type IconConfig = {
  library: 'Ionicons' | 'Feather' | 'AntDesign';
  name: string;
};

type Category = {
  id: string;
  name: string;
  questions: string[];
  iconConfig: IconConfig;
};

/**
 * One list per language, not one list with translated labels: the fourth
 * category is a different subject in each — 'Crisi' in Italian, 'Investing' in
 * English — because the two corpora cover different ground (CONSOB vs FCA and
 * the Bank of England). The lists may differ in length too.
 *
 * Ids are shared where the subject is shared, so switching language keeps the
 * selected chip; 'crisi' and 'investing' are deliberately different ids, and
 * the effect below clears the selection when it has no counterpart.
 */
const QUESTION_CATEGORIES: Record<Lang, Category[]> = {
  it: [
    {
      id: 'generali',
      name: 'Generali',
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
      iconConfig: { library: 'Feather', name: 'activity' },
      questions: [
        'Che cosa fu la crisi del 1929?',
        'Che cosa accadde il 24 ottobre 1929, il cosiddetto Giovedì nero?',
        'Qual è la sequenza tipica attraverso cui si sviluppa una crisi generata da una bolla speculativa?',
        'Quali errori si possono commettere negli investimenti durante le crisi?',
      ],
    },
    {
      id: 'rischi',
      name: 'Rischi dell\'investimento',
      iconConfig: { library: 'Feather', name: 'alert-circle' },
      questions: [
        'Cosa deve fare l\'investitore prima di effettuare un investimento in strumenti finanziari?',
        'Qual è la differenza tra titoli di capitale e titoli di debito?',
        'Cosa si intende per rischio emittente?',
        'Come valuto appropriatezza di un investimento?',
        'Qual è il rischio associato alla divisa in cui è denominato un investimento?',
        'Quando l\'investitore dovrebbe concludere un\'operazione avente ad oggetto strumenti finanziari derivati?',
      ],
    },
    {
      id: 'truffe',
      name: 'Truffe',
      iconConfig: { library: 'AntDesign', name: 'alert' },
      questions: [
        'Qual è la costante nelle truffe finanziarie?',
        'Che cos\'è lo schema Ponzi?',
        'Fino a quando riesce a funzionare lo schema Ponzi?',
        'Quali sono i principali ingredienti della truffa utilizzati dal truffatore?',
      ],
    },
  ],
  en: [
    {
      id: 'generali',
      name: 'General',
      iconConfig: { library: 'Ionicons', name: 'grid-outline' },
      questions: [
        'What is the Prudential Regulation Authority (PRA)?',
        'What is not covered in GDP statistics?',
        'Why is the housing market important to the economy?',
        'How can you limit your exposure to risk?',
        'Can banks create as much money as they like?',
      ],
    },
    {
      id: 'prodotti-finanziari',
      name: 'Financial Products',
      iconConfig: { library: 'Feather', name: 'pie-chart' },
      questions: [
        'Who can give debt advice?',
        'What are buildings insurance premiums?',
        'What are the benefits of tokenisation?',
        'What are the differences between commodity and fiat money?',
        'Is a stablecoin the same thing as a CBDC?',
        'How some debt products are advertised?',
        'Are there stablecoins in the UK today?',
      ],
    },
    {
      id: 'inflazione',
      name: 'Inflation',
      iconConfig: { library: 'Feather', name: 'trending-up' },
      questions: [
        'Inflation was not caused by people spending too much. So why will higher interest rates work?',
        'Should I be worried whenever I see reduced prices?',
        'How does the Bank of England influence the exchange rate?',
        'What does the Bank of England do to keep inflation low and stable?',
      ],
    },
    {
      // No Italian counterpart: the Italian list has 'crisi' in this slot.
      id: 'investing',
      name: 'Investing',
      iconConfig: { library: 'Feather', name: 'activity' },
      questions: [
        'Am I really ready to invest for the long term?',
        'What are the golden rules of investing?',
        'Are you tempted by high-risk investments?',
        'Should I be investing using a credit card?',
        'How to understand investment right for my risk tolerance?',
      ],
    },
    {
      id: 'rischi',
      name: 'Investment Risks',
      iconConfig: { library: 'Feather', name: 'alert-circle' },
      questions: [
        'How to stop or reduce trail commission?',
        'What is an unregulated collective investment scheme (UCIS)?',
        'What is a collective investment scheme (CIS)?',
        'What are risks of investing in mini-bonds?',
        "What's the investment going to cost me in fees/charges?",
      ],
    },
    {
      id: 'truffe',
      name: 'Scams',
      iconConfig: { library: 'AntDesign', name: 'alert' },
      questions: [
        'How forex (FX) trading and brokerage scams work',
        'What happens after you cancel a recurring card payment?',
        'How binary options scams work?',
        'How landing banking scams work',
        "What precautions should you take when using your bank's website to avoid fake website scams?",
      ],
    },
  ],
};

// ===================== Main Chat Component =====================

export default function Chat(): React.JSX.Element {
  type Message = {
    role: 'system' | 'user' | 'assistant';
    content: string;
    sources?: { id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[];
  };

  // Global, not local: the header lives in the (tabs) layout, so router.setParams
  // writes onto the (tabs) route. useLocalSearchParams only sees this screen's own
  // route params, so on native those updates never arrive (on web the URL round-trip
  // hides the problem).
  const { resetMessages, rag, level, model, ask, askId } = useGlobalSearchParams();
  const ragParam = Array.isArray(rag) ? rag[0] : rag;
  const modelParam = Array.isArray(model) ? model[0] : model;
  const levelParam = Array.isArray(level) ? level[0] : level;
  const { locale, t } = useTranslation();
  const lang = locale === 'en' ? 'en' : 'it';
  // The model picked in the header, or the app language's default. Changing it
  // re-runs the init effect below, which loads the new weights.
  const MODEL = useMemo(() => resolveModel(modelParam, lang), [modelParam, lang]);

  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={appStyles.container}>
        <Text style={appStyles.title}>Web platform not fully supported yet</Text>
      </SafeAreaView>
    );
  }

  // Used when RAG is off or retrieves nothing, so it follows the model's own
  // fine-tuning language (never mix the two — benchmark/RISPOSTA_AGENTE.md §5).
  const FALLBACK_SYSTEM: Record<'it' | 'en', string> = {
    it: `Sei un assistente esperto in finanza personale e mercati finanziari. Rispondi sempre in italiano. Se la domanda non è in italiano rispondi che non puoi rispondere.
      Quando ti vengono forniti documenti recuperati, usa solo le informazioni in essi contenute per rispondere alla domanda dell'utente.
      Fornisci una spiegazione completa e chiara, senza interromperti a metà frase.
      Se le informazioni non sono sufficienti per rispondere, dì onestamente che non hai abbastanza dati.
      Non inventare dettagli né fornire consigli di investimento specifici.`,
    en: `You are an assistant expert in personal finance and financial markets. Always answer in English. If the question is not in English, reply that you cannot answer it.
      When retrieved documents are provided, use only the information they contain to answer the user's question.
      Give a complete and clear explanation, without breaking off mid-sentence.
      If the information is not enough to answer, say honestly that you do not have enough data.
      Do not make up details and do not give specific investment advice.`,
  };

  const INITIAL_CONVERSATION: Message[] = [
    { role: 'system', content: FALLBACK_SYSTEM[MODEL.lang] },
  ];

  const [conversation, setConversation] = useState<Message[]>(INITIAL_CONVERSATION);
  const [userInput, setUserInput] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [modelReady, setModelReady] = useState<boolean>(false);
  const [isPreparingModel, setIsPreparingModel] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isInitializingModels, setIsInitializingModels] = useState<boolean>(true);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<'conversation' | 'preparing'>('preparing');

  const [ragEnabled, setRagEnabled] = useState<boolean>(true);
  const [ragPhase, setRagPhase] = useState<'idle' | 'fetching' | 'reasoning' | 'generating' | 'complete'>('idle');
  const [streamingText, setStreamingText] = useState<string>('');
  const [retrievedDocs, setRetrievedDocs] = useState<{ id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[]>([]);
  const [currentSources, setCurrentSources] = useState<{ id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[]>([]);
  const [selectedSources, setSelectedSources] = useState<{ id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[]>([]);
  const [showSources, setShowSources] = useState<boolean>(false);
  const [sourcesSheetVisible, setSourcesSheetVisible] = useState<boolean>(false);
  const [webViewVisible, setWebViewVisible] = useState<boolean>(false);
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
  const [webViewTitle, setWebViewTitle] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showQuestionsModal, setShowQuestionsModal] = useState<boolean>(false);

  // Helper function to render icons
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

  function formatTitleFromUrl(urlStr: string | null): string {
    if (!urlStr) return t('chat.preview');
    try {
      const url = new URL(urlStr);
      const pathname = url.pathname.split('/').filter(p => p.length > 0);
      const last = pathname[pathname.length - 1] || '';
      if (!last) return (url.hostname || t('chat.preview')).replace(/^www\./, '').toUpperCase();
      const words = last.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      return words.join(' ');
    } catch (e) {
      return t('chat.preview');
    }
  }
  const [proficiencyLevel] = useSharedLevel();
  const isSendingRef = useRef(false);
  /** id of the model the init effect last ran for, so a switch re-runs it. */
  const initializedForRef = useRef<string | null>(null);
  // Index in `conversation` from which turns are sent as history (1 = after system).
  const historyStartRef = useRef(1);

  /** The categories of the app language; the two lists are not translations. */
  const categories = QUESTION_CATEGORIES[lang];
  const findCategory = (id: string | null) =>
    id ? categories.find(c => c.id === id) : undefined;

  // A category without a counterpart in the other language ('crisi' / 'investing')
  // must not stay selected across a language switch.
  useEffect(() => {
    if (selectedCategory && !findCategory(selectedCategory)) {
      setSelectedCategory(null);
      setShowQuestionsModal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // A config change (model, RAG, level) starts a fresh context: earlier turns stay
  // on screen but are no longer sent to the model. Declared before the reset effect
  // so a reset in the same render (model switch) wins.
  useEffect(() => {
    historyStartRef.current = conversation.length;
  }, [ragParam, modelParam, proficiencyLevel]);

  // Listen for reset messages from header button
  useEffect(() => {
    if (resetMessages) {
      setConversation(INITIAL_CONVERSATION);
      setUserInput('');
      setStreamingText('');
      setRagPhase('idle');
      setShowSources(false);
      setRetrievedDocs([]);
      historyStartRef.current = 1;
    }
  }, [resetMessages]);

  useEffect(() => {
    setRagEnabled(ragParam !== '0');
    setRagPhase('idle');
  }, [ragParam]);

  // Auto-send a question passed from the spending analysis card (once per askId),
  // as soon as the model is loaded and the rag param has been applied.
  const lastAskId = useRef<string | null>(null);
  useEffect(() => {
    const q = Array.isArray(ask) ? ask[0] : ask;
    const id = String(Array.isArray(askId) ? askId[0] : askId ?? q);
    if (!q || !modelReady || lastAskId.current === id) return;
    if (ragEnabled !== (ragParam !== '0')) return;
    lastAskId.current = id;
    handleSendMessage(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask, askId, modelReady, ragEnabled]);

  useEffect(() => {
    const initModels = async () => {
      try {
        await cleanupLegacyModels();
        const models = await initializeLocalModels();

        // downloadModel() registers models under their file name, not the alias.
        const existingModel = models.find(m => m.modelName === MODEL.cacheName);
        if (existingModel) {
          const loaded = await loadModel();
          if (loaded) {
            setCurrentPage('conversation');
            return;
          }
        }

        await downloadAndLoadModel();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t('model.initError');
        setModelLoadError(errorMessage);
        console.error('Error initializing models:', error);
      } finally {
        setIsInitializingModels(false);
        setIsPreparingModel(false);
      }
    };

    // A model switch (selector or language change) reloads the weights: the
    // shared context holds one model at a time.
    if (initializedForRef.current !== MODEL.id) {
      initializedForRef.current = MODEL.id;
      setModelReady(false);
      setModelLoadError(null);
      setProgress(0);
      setCurrentPage('preparing');
      setIsInitializingModels(true);
      setIsPreparingModel(true);
      setConversation(INITIAL_CONVERSATION);
      initModels();
    }
  }, [MODEL.id]);

  const downloadAndLoadModel = async () => {
    setIsPreparingModel(true);
    setProgress(0);
    setModelLoadError(null);

    try {
      const destPath = await downloadModel(
        MODEL.cacheName,
        downloadUrl(MODEL),
        progress => setProgress(progress),
        false,
        MODEL.label,
      );

      if (!destPath) {
        throw new Error(t('model.invalidPath'));
      }

      await initializeLocalModels();

      const loaded = await loadModel();
      if (!loaded) {
        throw new Error(t('model.loadAfterDownloadError'));
      }

      setCurrentPage('conversation');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('model.downloadUnknownError');
      setModelLoadError(errorMessage);
      Alert.alert(t('model.errorTitle'), errorMessage);
      console.error('Error downloading or loading model:', error);
    } finally {
      setIsPreparingModel(false);
    }
  };

  const retryModelInit = async () => {
    setModelLoadError(null);
    setIsPreparingModel(true);
    await downloadAndLoadModel();
  };

  const handleSendMessage = async (message?: string) => {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;

    const messageToSend = message || userInput.trim();
    console.log('handleSendMessage:', JSON.stringify(messageToSend));

    if (!modelReady) {
      isSendingRef.current = false;
      Alert.alert(t('chat.modelNotLoadedTitle'), t('chat.modelNotLoadedMessage'));
      return;
    }

    if (!messageToSend) {
      isSendingRef.current = false;
      Alert.alert(t('chat.inputErrorTitle'), t('chat.inputErrorMessage'));
      return;
    }

    const isFirstQuestion = conversation.length === 1; // only system message

    const newConversation: Message[] = [
      ...conversation,
      { role: 'user', content: messageToSend },
    ];

    setConversation(newConversation);
    if (!message) {
      setUserInput('');
    }
    setIsGenerating(true);
    setShowSources(false);
    setSourcesSheetVisible(false);
    setSelectedSources([]);
    setCurrentSources([]);
    setStreamingText('');

    try {
      // Retrieval, the training-format prompt and the streamed completion live in
      // lib/chatTurn.ts, shared with the benchmark screen.
      const { docs: retrievedDocsData, completion: result } = await runChatTurn({
        question: messageToSend,
        history: conversation.slice(Math.max(1, historyStartRef.current)),
        level: normalizeLevel(proficiencyLevel),
        lang: MODEL.lang,
        family: MODEL.family,
        ragEnabled,
        fallbackSystem: newConversation[0] ? `${newConversation[0].content}\n\n` : 'You are a helpful assistant.',
        generation: CHAT_GENERATION,
        onPhase: phase => {
          setRagPhase(phase);
          if (phase === 'fetching') {
            setRetrievedDocs([]);
            setCurrentSources([]);
          }
        },
        onDocs: docs => {
          setRetrievedDocs(docs);
          setCurrentSources(docs);
        },
        onText: setStreamingText,
      });

      if (result && result.text) {
        const finalResponse = result.text.trim();
        console.log('Final response text:', finalResponse);
        setConversation(prev => [
          ...prev,
          { role: 'assistant', content: finalResponse, sources: retrievedDocsData.length > 0 ? retrievedDocsData : undefined },
        ]);
        setStreamingText('');
        setRagPhase('complete');
        setShowSources(true);
      } else {
        throw new Error('No response from the model.');
      }
    } catch (error) {
      Alert.alert(
        t('chat.inferenceErrorTitle'),
        error instanceof Error ? error.message : t('chat.unknownError'),
      );
    } finally {
      setIsGenerating(false);
      isSendingRef.current = false;
    }
  };

  const loadModel = async () => {
    try {
      const destPath = modelPath(MODEL);

      console.log('[LoadModel] Attempting to load:', MODEL.cacheName);
      console.log('[LoadModel] Path:', destPath);

      const fileExists = await RNFS.exists(destPath);
      if (!fileExists) {
        Alert.alert(t('model.loadErrorTitle'), t('model.fileMissing', { path: destPath }));
        return false;
      }

      const fileStats = await RNFS.stat(destPath);
      console.log('[LoadModel] File size:', fileStats.size, 'bytes');

      if (fileStats.size < minValidSize(MODEL)) {
        Alert.alert(t('model.loadErrorTitle'), t('model.fileTooSmall', { size: fileStats.size }));
        return false;
      }

      console.log('[LoadModel] Acquiring shared llama context...');
      await getLlamaContext(MODEL);

      console.log('[LoadModel] Success! Context ready');
      setModelReady(true);
      Alert.alert(t('model.loadedTitle'), t('model.loadedMessage'));
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t('chat.unknownError');
      console.error('[LoadModel] Error:', errorMsg);
      console.error('[LoadModel] Full error:', error);

      Alert.alert(
        t('model.loadErrorTitle'),
        errorMsg + '\n\n' + t('model.quantHint')
      );
      return false;
    }
  };

  return (
    <SafeAreaView style={appStyles.container}>
      <View style={appStyles.content}>
        {(isPreparingModel || isInitializingModels) && (
          <View style={appStyles.card}>
            <Text style={appStyles.subtitle}>
              {t('model.preparing')}
            </Text>
            <Text style={appStyles.subtitle2}>{MODEL.label}</Text>
            <ProgressBar progress={progress} />
            {modelLoadError ? (
              <Text style={appStyles.errorText}>{modelLoadError}</Text>
            ) : null}
            {modelLoadError ? (
              <Text style={appStyles.retryText} onPress={retryModelInit}>
                {t('model.retry')}
              </Text>
            ) : null}
          </View>
        )}

        {!isPreparingModel && !isInitializingModels && currentPage === 'conversation' && modelReady && (
          <>
            {/* Categorie chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={appStyles.categoriesContainer}
              contentContainerStyle={appStyles.categoriesContent}
            >
              {categories.map((category) => (
                <TouchableOpacity
                  key={category.id}
                  style={[
                    appStyles.categoryChip,
                    selectedCategory === category.id && appStyles.categoryChipActive
                  ]}
                  onPress={() => {
                    setSelectedCategory(category.id);
                    setShowQuestionsModal(true);
                  }}
                >
                  <View style={appStyles.chipIconContainer}>
                    {renderIcon(category.iconConfig, selectedCategory === category.id ? '#FFFFFF' : '#1E293B')}
                  </View>
                  <Text
                    style={[
                      appStyles.categoryChipText,
                      selectedCategory === category.id && appStyles.categoryChipTextActive
                    ]}
                  >
                    {category.name}
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
              streamingText={streamingText}
              answerPhase={ragPhase}
              isFirstQuestion={conversation.length === 1}
              onOpenSources={(sources) => {
                setSelectedSources(sources);
                setSourcesSheetVisible(true);
              }}
            />

            <Modal
              visible={sourcesSheetVisible}
              transparent
              animationType="slide"
              statusBarTranslucent
              onRequestClose={() => {
                setSourcesSheetVisible(false);
              }}
            >
              <View style={appStyles.sheetOverlay}>
                <TouchableOpacity
                  style={appStyles.sheetOverlayTouchable}
                  activeOpacity={1}
                  onPress={() => {
                    setSourcesSheetVisible(false);
                  }}
                />
                <View style={appStyles.sheetContainer}>
                  <View style={appStyles.sheetHeader}>
                    <View style={appStyles.sheetTitleRow}>
                      <View style={appStyles.sheetTitleContainer}>
                        <Text style={appStyles.sheetTitle}>
                          {t('chat.retrievedSources')}
                        </Text>
                        <Text style={appStyles.sheetCount}>{selectedSources.length}</Text>
                      </View>
                      <View style={appStyles.iconClose}>
                        <TouchableOpacity
                          onPress={async () => {
                            try {
                              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            } catch (e) {
                              // ignore haptic failure
                            }
                            setSourcesSheetVisible(false);
                          }}
                        >
                          <Ionicons name="close" size={20} color="#333" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                  <View style={appStyles.sheetContent}>
                    <SourcesDisplay sources={selectedSources} visible={sourcesSheetVisible} onOpenUrl={(url) => {
                      if (url) {
                        setWebViewUrl(url);
                        setWebViewTitle(formatTitleFromUrl(url));
                        setWebViewVisible(true);
                      }
                    }} />
                  </View>
                </View>
              </View>
            </Modal>
            <Modal
              visible={webViewVisible}
              transparent
              animationType="slide"
              statusBarTranslucent={true}
              onRequestClose={() => setWebViewVisible(false)}
            >
              <View style={appStyles.sheetOverlay}>
                <TouchableOpacity
                  style={appStyles.sheetOverlayTouchable}
                  activeOpacity={1}
                  onPress={() => setWebViewVisible(false)}
                />
                <View style={[appStyles.sheetContainer, appStyles.webViewModalContainer]}>
                  <View style={appStyles.sheetTitleRow}>
                    <View style={appStyles.sheetTitleContainer}>
                      <Text style={appStyles.sheetTitle}>{webViewTitle || t('chat.preview')}</Text>
                    </View>
                    <View style={appStyles.iconClose}>
                      <TouchableOpacity
                        onPress={async () => {
                          try {
                            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          } catch (e) {}
                          setWebViewVisible(false);
                        }}
                      >
                        <Ionicons name="close" size={20} color="#333" />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View style={appStyles.webViewBody}>
                    {webViewUrl ? (
                      <View style={appStyles.webViewInner}>
                        <WebView source={{ uri: webViewUrl }} style={appStyles.webview} />
                      </View>
                    ) : null}
                  </View>
                </View>
              </View>
            </Modal>

            {/* Modal for category questions */}
            <Modal
              visible={showQuestionsModal}
              animationType="fade"
              transparent={true}
              statusBarTranslucent={true}
              onRequestClose={() => {
                setShowQuestionsModal(false);
                setSelectedCategory(null);
              }}
            >
              <TouchableOpacity
                style={appStyles.modalOverlay}
                activeOpacity={1}
                onPress={() => {
                  setShowQuestionsModal(false);
                  setSelectedCategory(null);
                }}
              >
                <TouchableOpacity
                  style={appStyles.questionsModalContent}
                  activeOpacity={1}
                  onPress={() => { }}
                >
                  {/* Modal header */}
                  {findCategory(selectedCategory) && (
                    <View style={appStyles.modalHeader}>
                      <View style={appStyles.headerWithBadge}>
                        <View style={appStyles.categorySquareIcon}>
                          {renderIcon(findCategory(selectedCategory)!.iconConfig, '#1E293B')}
                        </View>
                        <Text style={appStyles.modalTitle}>
                          {selectedCategory
                            ? findCategory(selectedCategory)!.name
                            : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setShowQuestionsModal(false);
                          setSelectedCategory(null);
                        }}
                        style={appStyles.closeButton}
                      >
                        <Feather name="x" size={24} color="#0F172A" />
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Questions list */}
                  {selectedCategory && (
                    <ScrollView style={appStyles.questionsListContainer}>
                      {(findCategory(selectedCategory)?.questions ?? []).map(
                        (question, index) => (
                          <TouchableOpacity
                            key={index}
                            style={appStyles.questionItem}
                            onPress={() => {
                              handleSendMessage(question);
                              setShowQuestionsModal(false);
                              setSelectedCategory(null);
                            }}
                          >
                            <Text style={appStyles.questionText}>{question}</Text>
                            <Feather name="arrow-right" size={16} color="#0F172A" />
                          </TouchableOpacity>
                        )
                      )}
                    </ScrollView>
                  )}
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          </>
        )}

        {!isPreparingModel && !isInitializingModels && !modelReady && modelLoadError && (
          <View style={appStyles.card}>
            <Text style={appStyles.subtitle}>{t('model.loadFailed')}</Text>
            <Text style={appStyles.errorText}>{modelLoadError}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}