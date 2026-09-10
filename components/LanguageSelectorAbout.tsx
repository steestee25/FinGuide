import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/color';

type LanguageOption = {
  key: 'it' | 'en';
  label: string;
  flag: string;
  image: any;
};

type Props = {
  onSelect?: (language: 'it' | 'en') => void;
  selectedKey?: 'it' | 'en';
};

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { key: 'it', label: 'Italiano', flag: '🇮🇹', image: require('../assets/images/italia.png') },
  { key: 'en', label: 'English', flag: '🇬🇧', image: require('../assets/images/uk.jpg') },
];

export default function LanguageSelectorAbout({ onSelect, selectedKey = 'it' }: Props) {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<'it' | 'en'>(selectedKey);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0, width: 140 });
  const buttonRef = React.useRef<View>(null);

  useEffect(() => {
    if (selectedKey && selectedKey !== selected) {
      setSelected(selectedKey);
    }
  }, [selectedKey, selected]);

  const handleSelect = (key: 'it' | 'en') => {
    setSelected(key);
    setVisible(false);
    onSelect?.(key);
  };

  const openModal = () => {
    if (buttonRef.current) {
      buttonRef.current.measureInWindow((x, y, width, height) => {
        setModalPosition({ top: y + height + 4, left: x - 10, width });
      });
    }
    setVisible(true);
  };

  const selectedOption = LANGUAGE_OPTIONS.find(l => l.key === selected);

  const renderFlag = (option: LanguageOption | undefined) => {
    if (!option) return null;
    
    if (Platform.OS === 'web') {
      return <Image source={option.image} style={styles.flagImage} />;
    }
    return <Text style={styles.flagIcon}>{option.flag}</Text>;
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        ref={buttonRef}
        style={styles.selectorButton} 
        onPress={openModal}
      >
        {renderFlag(selectedOption)}
        <Text numberOfLines={1} style={styles.selectorText}>
          {selectedOption?.label}
        </Text>
        <Ionicons name="chevron-down" size={16} color={COLORS.temp3} />
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setVisible(false)} />
        <View style={[styles.modalContainer, { 
          width: Math.max(modalPosition.width, 140), 
          top: modalPosition.top,
          left: modalPosition.left,
        }]}> 
          {LANGUAGE_OPTIONS.filter(lang => lang.key !== selected).map(lang => (
            <TouchableOpacity
              key={lang.key}
              style={styles.option}
              onPress={() => handleSelect(lang.key)}
            >
              {renderFlag(lang)}
              <Text style={styles.optionText}>{lang.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '-5%',
    right: 8,
    zIndex: 10,
  },
  selectorButton: {
    minWidth: 120,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    shadowColor: COLORS.temp,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  flagIcon: {
    fontSize: 20,
  },
  flagImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
  },
  selectorText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    maxWidth: 70,
  },
  modalOverlay: {
    flex: 1,
  },
  modalContainer: {
    position: 'absolute',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 5,
    overflow: 'hidden',
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
});
