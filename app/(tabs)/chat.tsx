
import React, { useEffect, useRef, useState } from 'react';
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
import { useLocalSearchParams } from 'expo-router';
import { WebView } from 'react-native-webview';

// Import components
import ChatScreen from '@/components/ChatScreen';
import ProgressBar from '@/components/ProgressBar';

// Import utilities
import { SourcesDisplay } from '@/components/SourcesDisplay';
import { downloadModel } from '@/lib/downloadModel';
import { cleanupLegacyModels, downloadUrl, getModel, minValidSize, modelPath } from '@/lib/modelConfig';
import { useTranslation } from '@/lib/i18n';
import {
  initializeLocalModels
} from '@/lib/modelStorage';
import { loadProficiencyLevelWithFallback } from '@/lib/questionnaireStorage';
import { retrieveRelevant } from '@/lib/retrieval';
import { appStyles } from '../../styles/components/chatStyles';

// Conditionally import native modules (only available on mobile)
let RNFS: any = null;
let initLlama: any = null;
let releaseAllLlama: any = null;

if (Platform.OS !== 'web') {
  RNFS = require('react-native-fs');
  const llamaModule = require('llama.rn');
  initLlama = llamaModule.initLlama;
  releaseAllLlama = llamaModule.releaseAllLlama;
}

// ===================== Question Categories =====================
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

const MODEL = getModel();

// ===================== Main Chat Component =====================

export default function Chat(): React.JSX.Element {
  type Message = {
    role: 'system' | 'user' | 'assistant';
    content: string;
    sources?: { id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[];
  };

  const { resetMessages, rag } = useLocalSearchParams();
  const ragParam = Array.isArray(rag) ? rag[0] : rag;
  const { locale, t } = useTranslation();

  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={appStyles.container}>
        <Text style={appStyles.title}>Web platform not fully supported yet</Text>
      </SafeAreaView>
    );
  }

  const INITIAL_CONVERSATION: Message[] = [
    {
      role: 'system',
      content: `Sei un assistente esperto in finanza personale e mercati finanziari. Rispondi sempre in italiano. Se la domanda non è in italiano rispondi che non puoi rispondere.
      Quando ti vengono forniti documenti recuperati, usa solo le informazioni in essi contenute per rispondere alla domanda dell'utente.
      Fornisci una spiegazione completa e chiara, senza interromperti a metà frase.
      Se le informazioni non sono sufficienti per rispondere, dì onestamente che non hai abbastanza dati.
      Non inventare dettagli né fornire consigli di investimento specifici.`,
    },
  ];

  const [conversation, setConversation] = useState<Message[]>(INITIAL_CONVERSATION);
  const [userInput, setUserInput] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [context, setContext] = useState<any>(null);
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
  const [proficiencyLevel, setProficiencyLevel] = useState<string>('intermediate');
  const isSendingRef = useRef(false);
  const isInitializedRef = useRef(false);

  const getLocalizedCategoryName = (category: Category): string => {
    return locale?.startsWith('en') ? category.nameEn : category.name;
  };

  // Listen for reset messages from header button
  useEffect(() => {
    if (resetMessages) {
      setConversation(INITIAL_CONVERSATION);
      setUserInput('');
      setStreamingText('');
      setRagPhase('idle');
      setShowSources(false);
      setRetrievedDocs([]);
    }
  }, [resetMessages]);

  useEffect(() => {
    setRagEnabled(ragParam !== '0');
    setRagPhase('idle');
  }, [ragParam]);

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

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      initModels();
    }
  }, []);

  // Load proficiency level from user profile (con fallback a Supabase)
  useEffect(() => {
    const loadUserProficiency = async () => {
      const level = await loadProficiencyLevelWithFallback();
      if (level) {
        setProficiencyLevel(level);
        console.log('✓ Proficiency level caricato:', level);
      } else {
        console.warn('Proficiency level non trovato, usando default: intermediate');
        setProficiencyLevel('intermediate');
      }
    };

    loadUserProficiency();
  }, []);

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

  // Helper: Get proficiency instruction
  const getProficiencyInstruction = (): string => {
    switch (proficiencyLevel) {
      case 'base':
        return 'L\'utente ha conoscenze base di finanza. Usa spiegazioni semplici e esempi pratici. Evita termini tecnici o complessi.';
      case 'advanced':
        return 'L\'utente ha conoscenze avanzate di finanza personale. Evita spiegazioni eccessivamente basilari, puoi usare termini tecnici e spiegazioni più approfondite.';
      default:
        return 'L\'utente ha conoscenze di finanza intermedie. Puoi introdurre alcuni termini tecnici, ma sempre accompagnati da una spiegazione.';
    }
  };

  const handleSendMessage = async (message?: string) => {
    if (isSendingRef.current) {
      return;
    }
    isSendingRef.current = true;

    const messageToSend = message || userInput.trim();
    console.log('handleSendMessage:', JSON.stringify(messageToSend));

    if (!context) {
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
      let retrievedDocsData: { id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[] = [];

      if (ragEnabled) {
        setRagPhase('fetching');
        setRetrievedDocs([]);
        setCurrentSources([]);

        try {
          retrievedDocsData = await retrieveRelevant(messageToSend, { k: 6, minScore: 0.05 });
          setRetrievedDocs(retrievedDocsData);
          setCurrentSources(retrievedDocsData);
        } catch (error) {
          console.warn('Retrieval failed:', error);
        }

        setRagPhase('reasoning');
      } else {
        setRagPhase('reasoning');
      }

      const messagesForModel: Message[] = [];
      let systemMessage = 'You are a helpful assistant.';

      if (newConversation[0]) {
        systemMessage = `${newConversation[0].content}\n\n`;
      }

      const maxDocs = 6;
      const trimmedDocs = retrievedDocsData.slice(0, maxDocs);
      if (ragEnabled && trimmedDocs.length) {
        const safeRetrievedText = trimmedDocs
          .map((doc, index) => {
            return `DOCUMENTO ${index + 1}:\n${doc.text}`;
          })
          .join('\n\n');

          systemMessage = `Sei un assistente di finanza personale. 
          
          REGOLE: Rispondi usando esclusivamente le informazioni contenute nei documenti seguenti. Non inventare nulla. Non dare consigli specifici di investimento. Rispondi in italiano in modo conciso.
          
          ${safeRetrievedText}
          ${getProficiencyInstruction()}`;

      }

      messagesForModel.push({ role: 'system', content: systemMessage });
      const recentConversation = newConversation.slice(1);
      const recentTrimmed = recentConversation.slice(-6);

      if (recentTrimmed.length > 0 && recentTrimmed[0].role === 'assistant') {
        recentTrimmed.shift();
      }

      messagesForModel.push(...recentTrimmed);

      console.log('===== FULL PROMPT SENT TO MODEL =====');
      console.log('Proficiency Level:', proficiencyLevel);
      console.log('System Message:', systemMessage);
      console.log('Full Messages Array:', JSON.stringify(messagesForModel, null, 2));
      console.log('===== END PROMPT =====');

      setRagPhase('generating');
      const stopWords = [
        '</s>',
        '<|end|>',
        '<|im_end|>',
        '<|eot_id|>',
      ];

      let fullResponse = '';
      const result = await context.completion(
        {
          messages: messagesForModel,
          n_predict: 2048,
          stop: stopWords,
          temperature: 0.1,
          top_p: 0.95,
          repeat_penalty: 1.2,
          repeat_last_n: 128,
          
        },
        (data: { token: string }) => {
          const { token } = data;
          if (token) {
            fullResponse += token;
            setStreamingText(fullResponse);
            console.log('Streaming token:', token);
          }
        },
      );
      console.log('Full generated response:', fullResponse);

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

      if (context) {
        await releaseAllLlama();
        setContext(null);
        setConversation(INITIAL_CONVERSATION);
      }

      console.log('[LoadModel] Initializing llama with model...');
      const llamaContext = await initLlama({
        model: destPath,
        use_mlock: true,
        n_ctx: 2048,      // was 4096 — halved, loads faster
        n_gpu_layers: 1,
        n_threads: 4,     
      });

      console.log('[LoadModel] Success! Context created');
      setContext(llamaContext);
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

        {!isPreparingModel && !isInitializingModels && currentPage === 'conversation' && context && (
          <>
            {/* Categorie chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={appStyles.categoriesContainer}
              contentContainerStyle={appStyles.categoriesContent}
            >
              {QUESTION_CATEGORIES.map((category) => (
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
                    {getLocalizedCategoryName(category)}
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
                  {selectedCategory && QUESTION_CATEGORIES.find(c => c.id === selectedCategory) && (
                    <View style={appStyles.modalHeader}>
                      <View style={appStyles.headerWithBadge}>
                        <View style={appStyles.categorySquareIcon}>
                          {renderIcon(QUESTION_CATEGORIES.find(c => c.id === selectedCategory)!.iconConfig, '#1E293B')}
                        </View>
                        <Text style={appStyles.modalTitle}>
                          {selectedCategory
                            ? getLocalizedCategoryName(QUESTION_CATEGORIES.find(c => c.id === selectedCategory)!)
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
                      {QUESTION_CATEGORIES.find(c => c.id === selectedCategory)?.questions.map(
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

        {!isPreparingModel && !isInitializingModels && !context && modelLoadError && (
          <View style={appStyles.card}>
            <Text style={appStyles.subtitle}>{t('model.loadFailed')}</Text>
            <Text style={appStyles.errorText}>{modelLoadError}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}