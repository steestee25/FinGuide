import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/color';

type ModelOption = {
  key: string;
  label: string;
};

type Props = {
  onSelect?: (model: string) => void;
  selectedKey?: string;
  models?: ModelOption[];
  /** Narrower layout for width-constrained headers (mobile). */
  compact?: boolean;
};

const DEFAULT_MODELS: ModelOption[] = [
  { key: 'Stee201/gguf-server-q', label: 'Stee201/gguf-server-q' },
  { key: 'qwen2.5-0.5b', label: 'qwen2.5 0.5b' },
];

export default function ModelSelector({ onSelect, selectedKey, models = DEFAULT_MODELS, compact = false }: Props) {
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState(selectedKey ?? models[0].key);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0, width: 140 });
  const buttonRef = React.useRef<View>(null);

  useEffect(() => {
    if (selectedKey && selectedKey !== selected) {
      setSelected(selectedKey);
    }
  }, [selectedKey, selected]);

  const handleSelect = (key: string) => {
    setSelected(key);
    setVisible(false);
    onSelect?.(key);
  };

  const openModal = () => {
    if (buttonRef.current) {
      buttonRef.current.measureInWindow((x, y, width, height) => {
        setModalPosition({ top: y + height + 4, left: x, width });
      });
    }
    setVisible(true);
  };

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <TouchableOpacity 
        ref={buttonRef}
        style={[styles.selectorButton, compact && styles.selectorButtonCompact]} 
        onPress={openModal}
      >
        <Text numberOfLines={1} style={styles.selectorText}>
          {models.find(m => m.key === selected)?.label ?? 'Select Model'}
        </Text>
      </TouchableOpacity>

      <Modal visible={visible} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} onPress={() => setVisible(false)} />
        <View style={[styles.modalContainer, { 
          width: Math.max(modalPosition.width, 200), 
          top: modalPosition.top,
          left: modalPosition.left,
        }]}> 
          {models.map(m => (
            <TouchableOpacity
              key={m.key}
              style={styles.option}
              onPress={() => handleSelect(m.key)}
            >
              <Text style={styles.optionText}>{m.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginLeft: 10,
  },
  containerCompact: {
    marginLeft: 6,
  },
  selectorButton: {
    minWidth: 140,
    height: 36,
    borderRadius: 18,
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
  selectorButtonCompact: {
    // Sized to the longest option label ('Gemma 270M'): ~72dp of text at
    // fontSize 12, + 8 text marginRight + 16 horizontal padding.
    minWidth: 96,
    paddingHorizontal: 8,
  },
  selectorText: {
    fontSize: 12,
    color: '#334155',
    flex: 1,
    marginRight: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalContainer: {
    position: 'absolute',
    backgroundColor: COLORS.white,
    borderRadius: 8,
    paddingVertical: 8,
    shadowColor: COLORS.temp,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  option: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  optionText: {
    fontSize: 14,
    color: '#0f172a',
  },
});
