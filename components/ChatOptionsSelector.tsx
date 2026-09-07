import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/color';
import { useTranslation } from '../lib/i18n';

export type LevelOption = {
  key: string;
  label: string;
  icon: string;
};

type Props = {
  ragEnabled: boolean;
  onToggleRag: (next: boolean) => void;
  levels: LevelOption[];
  selectedLevelKey: string;
  onSelectLevel: (key: string) => void;
};

/**
 * Groups the RAG toggle and the proficiency level into a single header control,
 * so the chat header stays narrow enough for the "new chat" button on mobile.
 * Opens an anchored dropdown, same interaction as ModelSelector.
 */
export default function ChatOptionsSelector({
  ragEnabled,
  onToggleRag,
  levels,
  selectedLevelKey,
  onSelectLevel,
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = React.useRef<View>(null);

  const selectedLevel = levels.find(l => l.key === selectedLevelKey) ?? levels[0];

  const openModal = () => {
    if (buttonRef.current) {
      buttonRef.current.measureInWindow((x, y, _width, height) => {
        setPosition({ top: y + height + 4, left: x });
      });
    }
    setVisible(true);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        ref={buttonRef}
        style={styles.selectorButton}
        onPress={openModal}
        accessibilityRole="button"
        accessibilityLabel={`Opzioni chat. RAG ${ragEnabled ? 'attivo' : 'disattivo'}, livello ${selectedLevel?.label ?? ''}`}
      >
        <MaterialCommunityIcons
          name={(ragEnabled ? 'database' : 'database-off') as any}
          size={18}
          color={ragEnabled ? COLORS.primary : '#94a3b8'}
        />
        <MaterialCommunityIcons
          name={(selectedLevel?.icon ?? 'signal-cellular-2') as any}
          size={18}
          color={COLORS.primary}
          style={styles.secondIcon}
        />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setVisible(false)} />
        <View style={[styles.modalContainer, { top: position.top, left: position.left }]}>
          {/* RAG */}
          <Text style={styles.sectionTitle}>{t('chat.retrieval')}</Text>
          <TouchableOpacity
            style={styles.option}
            onPress={() => onToggleRag(!ragEnabled)}
          >
            <MaterialCommunityIcons
              name={(ragEnabled ? 'database' : 'database-off') as any}
              size={18}
              color={ragEnabled ? COLORS.primary : '#94a3b8'}
            />
            <Text style={[styles.optionText, !ragEnabled && styles.optionTextDisabled]}>
              {ragEnabled ? 'RAG On' : 'RAG Off'}
            </Text>
            {ragEnabled && (
              <MaterialCommunityIcons name="check" size={16} color={COLORS.primary} />
            )}
          </TouchableOpacity>

          <View style={styles.divider} />

          {/* Livello */}
          <Text style={styles.sectionTitle}>{t('chat.level')}</Text>
          {levels.map(level => {
            const isSelected = level.key === selectedLevelKey;
            return (
              <TouchableOpacity
                key={level.key}
                style={styles.option}
                onPress={() => {
                  onSelectLevel(level.key);
                  setVisible(false);
                }}
              >
                <MaterialCommunityIcons
                  name={level.icon as any}
                  size={18}
                  color={isSelected ? COLORS.primary : '#94a3b8'}
                />
                <Text style={[styles.optionText, !isSelected && styles.optionTextDisabled]}>
                  {level.label}
                </Text>
                {isSelected && (
                  <MaterialCommunityIcons name="check" size={16} color={COLORS.primary} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginLeft: 6,
  },
  selectorButton: {
    height: 36,
    borderRadius: 18,
    paddingHorizontal: 10,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    flexDirection: 'row',
    // Same treatment as ModelSelector: no border, soft shadow.
    shadowColor: COLORS.temp,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  secondIcon: {
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalContainer: {
    position: 'absolute',
    minWidth: 190,
    backgroundColor: COLORS.white,
    borderRadius: 8,
    paddingVertical: 8,
    shadowColor: COLORS.temp,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 4,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
  },
  optionTextDisabled: {
    color: '#94a3b8',
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
});
