import { AnimationPhase, AnswerAnimation } from '@/components/AnswerAnimation';
import { COLORS } from '@/constants/color';
import { useTranslation } from '@/lib/i18n';
import { Feather } from "@expo/vector-icons";
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Clipboard,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  sources?: { id: string; text: string; metadata?: { source_title?: string; source_url?: string; answer?: string } }[];
};

type Props = {
  conversation: Message[];
  userInput: string;
  onUserInputChange: (text: string) => void;
  onSendMessage: () => void;
  isGenerating: boolean;
  isLargeScreen?: boolean;
  streamingText?: string;
  onOpenSources?: (sources: any[]) => void;
  answerPhase?: AnimationPhase;
  isFirstQuestion?: boolean;
  /** Layout of the streaming text: the benchmark's "first token visible". */
  onStreamingTextLayout?: () => void;
  /** Layout of the last assistant message: the benchmark's "answer visible". */
  onLastAssistantLayout?: () => void;
};

export default function ChatScreen({
  conversation,
  userInput,
  onUserInputChange,
  onSendMessage,
  isGenerating,
  isLargeScreen = false,
  streamingText = '',
  showSourcesButton = false,
  onOpenSources = () => { },
  answerPhase = 'idle',
  isFirstQuestion = false,
  onStreamingTextLayout,
  onLastAssistantLayout,
}: Props): React.JSX.Element {
  const { locale, t } = useTranslation();
  const placeholderText = locale === 'en' ? 'Ask a question' : 'Fai una domanda';
  const visibleMessages = conversation.slice(1);
  const userQuestionCount = visibleMessages.filter(msg => msg.role === 'user').length;
  const lastAssistantIndex = visibleMessages.reduce((lastIndex, msg, idx) => {
    return msg.role === 'assistant' ? idx : lastIndex;
  }, -1);
  const lastUserIndex = visibleMessages.reduce((lastIndex, msg, idx) => {
    return msg.role === 'user' ? idx : lastIndex;
  }, -1);
  const scrollViewRef = useRef<any>(null);

  const scrollToBottom = (animated = true) => {
    try {
      scrollViewRef.current?.scrollToEnd({ animated });
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    scrollToBottom(true);
  }, [conversation.length, streamingText, isGenerating]);

  return (
    <>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollWrapper}
        contentContainerStyle={[
          visibleMessages.length > 0 ? styles.chatContainer : null,
          isLargeScreen && styles.chatContainerLarge,
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollToBottom(false)}
      >
        {visibleMessages.map((msg, index) => {
          const isLastAssistantMessage = index === lastAssistantIndex && msg.role === 'assistant';
          return (
            <View key={index} style={styles.messageWrapper}>
              {msg.role === 'assistant' ? (
                <>
                  <View style={styles.responseCard}>
                    <Image
                      source={require('@/assets/images/coin_logo_no_bg.png')}
                      style={styles.responseImage}
                    />
                    <View style={styles.responseBody}>
                      <Text
                        style={styles.responseText}
                        onLayout={isLastAssistantMessage ? onLastAssistantLayout : undefined}
                      >
                        {msg.content}
                      </Text>
                    </View>
                    <View style={styles.responseActions}>
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => {
                          try {
                            Clipboard.setString(msg.content || '');
                            Haptics.selectionAsync();
                          } catch (e) { }
                        }}
                      >
                        <Feather name="copy" size={20} color="#000" />
                      </TouchableOpacity>

                      {msg.sources?.length ? (
                        <TouchableOpacity 
                          style={styles.sourcesButton} 
                          onPress={() => onOpenSources?.(msg.sources || [])}
                        >
                          <Text style={styles.sourcesButtonText}>{t('chat.sources')}</Text>
                          <Feather name="chevron-down" size={16} color="#000" style={{ marginLeft: 8 }} />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                  {isLastAssistantMessage && (
                    <View style={styles.disclaimerContainer}>
                      <Text style={styles.disclaimerText}>
                        {locale === 'en'
                          ? 'LIRA is an AI system and can make errors. It does not provide financial advice or investment recommendations. Always verify information before making financial decisions.'
                          : 'LIRA è un sistema di IA e può commettere errori. Non fornisce consulenza finanziaria né consigli di investimento. \n Verifica sempre le informazioni prima di prendere decisioni finanziarie.'}
                      </Text>
                    </View>
                  )}
                </>
              ) : (
                <View
                  style={[
                    styles.messageBubble,
                    msg.role === 'user' ? styles.userBubble : styles.modelBubble,
                  ]}>
                  <Text
                    style={[
                      styles.messageText,
                      msg.role === 'user' && styles.userMessageText,
                    ]}>
                    {msg.content}
                  </Text>
                </View>
              )}
              {index === lastUserIndex ? (
                <AnswerAnimation phase={answerPhase} hideSpinner={isLargeScreen ? false : userQuestionCount === 1} />
              ) : null}
            </View>
          );
        })}
        {isGenerating && streamingText ? (
          <View style={styles.messageWrapper}>
            <View style={styles.responseCard}>
              <Image
                source={require('@/assets/images/coin_logo_no_bg.png')}
                style={styles.responseImage}
              />
              <View style={styles.responseBody}>
                <Text style={styles.responseText} onLayout={onStreamingTextLayout}>{streamingText}</Text>
              </View>
            </View>
            <View style={styles.disclaimerContainer}>
              <Text style={styles.disclaimerText}>
                {locale === 'en'
                  ? 'LIRA is an artificial intelligence system and can make errors. It does not provide financial advice or investment recommendations. Always verify information before making financial decisions.'
                  : 'LIRA è un sistema di intelligenza artificiale e può commettere errori. Non fornisce consulenza finanziaria né consigli di investimento. Verifica sempre le informazioni prima di prendere decisioni finanziarie.'}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.inputContainer, isLargeScreen && styles.inputContainerLarge]}>
        <View style={[styles.inputWrapper, isLargeScreen && styles.inputWrapperLarge]}>
          <TextInput
            style={[styles.input, isLargeScreen && styles.inputLarge]}
            placeholder={placeholderText}
            placeholderTextColor="#94A3B8"
            value={userInput}
            onChangeText={onUserInputChange}
            editable={!isGenerating}
            returnKeyType="send"
            onSubmitEditing={onSendMessage}
          />
          <TouchableOpacity
            style={[styles.sendButton]}
            onPress={onSendMessage}
            disabled={isGenerating}>
            {isGenerating ? (
              <ActivityIndicator size="small" color={COLORS.temp3} />
            ) : (
              <Feather name="send" size={22} color={COLORS.temp3} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  chatContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },

  scrollWrapper: {
    flex: 1,
  },
  chatContainerLarge: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    marginBottom: 24,
  },
  messageWrapper: {
    marginBottom: 16,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 12,
    maxWidth: '80%',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#3B82F6',
  },
  modelBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  messageText: {
    fontSize: 16,
    color: '#334155',
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  greetingText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginVertical: 12,
    color: '#64748B',
  },
  greetingTextLarge: {
    fontSize: 14,
    marginVertical: 16,
  },
  streamingContainer: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  streamingLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  streamingText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  sourceActionRow: {
    alignItems: 'flex-start',
    marginTop: 8,
  },
  sourceActionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  sourceActionEmoji: {
    fontSize: 18,
  },
  toggleContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  toggleLabel: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '600',
  },
  inputContainer: {
    margin: 16,
    alignItems: 'center',
  },
  inputContainerLarge: {
    marginHorizontal: 32,
    marginBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  inputWrapperLarge: {
    paddingVertical: 16,
  },
  input: {
    flex: 1,
    minHeight: 44,
    color: '#334155',
    fontSize: 16,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  inputLarge: {
    fontSize: 18,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  responseCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E8EEF8',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  responseImage: {
    width: 50,
    height: 50,
  },
  responseTitle: {
    fontSize: 15,
    padding: 8,
    fontWeight: '600',
    color: '#0F172A',
  },
  responseBody: {
    marginBottom: 12,
  },
  responseText: {
    fontSize: 15,
    padding: 8,
    color: '#334155',
    lineHeight: 22,
  },
  responseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionButton: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#f8f9fa',
  },
  sourcesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  sourcesButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  spinnerInline: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 3,
  },
  spinnerDotActive: {
    backgroundColor: '#4338CA',
  },
  spinnerDotInactive: {
    backgroundColor: '#CBD5E1',
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
