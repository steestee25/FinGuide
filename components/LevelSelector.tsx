import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/color';
import { useTranslation } from '../lib/i18n';

export type LevelOption = {
  key: string;
  label: string;
  icon: string;
};

type Props = {
  levels: LevelOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
};

/** Width of the dropdown, needed to right-align it under the button. */
const MENU_WIDTH = 190;
const SCREEN_MARGIN = 12;

/**
 * Icon-only proficiency control. The analysis header's title already fills its
 * row, so only the level's signal-bars icon is shown there and the labels live
 * in the dropdown — same anchored-dropdown interaction as ChatOptionsSelector,
 * but right-aligned, since the button sits at the end of the row.
 */
export default function LevelSelector({ levels, selectedKey, onSelect }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = React.useRef<View>(null);

  const selected = levels.find(l => l.key === selectedKey) ?? levels[0];

  const openMenu = () => {
    if (buttonRef.current) {
      buttonRef.current.measureInWindow((x, y, width, height) => {
        const screenWidth = Dimensions.get('window').width;
        const right = Math.min(x + width, screenWidth - SCREEN_MARGIN);
        setPosition({ top: y + height + 4, left: Math.max(SCREEN_MARGIN, right - MENU_WIDTH) });
      });
    }
    setVisible(true);
  };

  return (
    <View>
      <TouchableOpacity
        ref={buttonRef}
        style={styles.button}
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel={`${t('chat.level')}: ${selected?.label ?? ''}`}
      >
        <MaterialCommunityIcons
          name={(selected?.icon ?? 'signal-cellular-2') as any}
          size={20}
          color={COLORS.primary}
        />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} onPress={() => setVisible(false)} />
        <View style={[styles.menu, { top: position.top, left: position.left }]}>
          <Text style={styles.sectionTitle}>{t('chat.level')}</Text>
          {levels.map(level => {
            const isSelected = level.key === selectedKey;
            return (
              <TouchableOpacity
                key={level.key}
                style={styles.option}
                onPress={() => {
                  onSelect(level.key);
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
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
    // Same treatment as the other header controls: no border, soft shadow.
    shadowColor: COLORS.temp,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
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
});
