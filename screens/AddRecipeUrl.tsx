import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import RecipeExtractorService from '../services/RecipeExtractorService';
import RecipeStore from '../store/RecipeStore';
import { useTheme } from '../hooks/useTheme';
import Header from '../components/Header';
import CustomPopup from '../components/CustomPopup';
import ContentWrapper from '../components/ContentWrapper';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

// This helper function checks for a live internet connection in a privacy-friendly way.
const checkInternetConnection = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected;
};

type LoadingState = 'idle' | 'url' | 'file';

export default function AddRecipeUrl() {
  const navigation = useNavigation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState<LoadingState>('idle');
  const { colors } = useTheme();
  const [showPopup, setShowPopup] = useState(false);
  const [dots, setDots] = useState('');
  const [popupConfig, setPopupConfig] = useState<{
    title: string;
    message: string;
    buttons: Array<{ text: string; onPress: () => void; style?: 'default' | 'cancel' }>;
  }>({ title: '', message: '', buttons: [] });

  const styles = useMemo(() => stylesFactory(colors), [colors]);
  const isLoading = loading !== 'idle';

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) {
      interval = setInterval(() => {
        setDots(prev => {
          if (prev === '') return '.';
          if (prev === '.') return '..';
          if (prev === '..') return '...';
          return '';
        });
      }, 400);
    }
    return () => {
      if (interval) clearInterval(interval);
      setDots('');
    };
  }, [isLoading]);

  // Shared error message mapping — used by both URL and file handlers
  const resolveErrorMessage = (error: any): { title: string; message: string } => {
    const msg = error?.message ?? '';
    if (msg === 'BOT_PROTECTION') return {
      title: 'Website Protected',
      message: 'This website blocks automatic imports. Try saving the page as HTML and importing that file instead.',
    };
    if (msg === 'RATE_LIMIT') return {
      title: 'Rate Limit Reached',
      message: 'The AI service is temporarily rate limited. Wait a moment and try again, or switch to a different model in AI Setup.',
    };
    if (msg === 'EMPTY_RESPONSE') return {
      title: 'No Response from AI',
      message: 'The AI returned an empty response. This can happen with reasoning models that run out of tokens. Try a different model in AI Setup.',
    };
    if (msg === 'NO_RECIPE_FOUND') return {
      title: 'No Recipe Found',
      message: 'No recipe could be extracted. The content may be paywalled, require a login, or have an unusual layout.',
    };
    if (msg === 'INVALID_API_KEY') return {
      title: 'Invalid API Key',
      message: 'API request rejected. Check your API key in Settings → AI Setup.',
    };
    if (msg === 'HTML_RESPONSE' || msg === 'NETWORK_ERROR') return {
      title: 'Connection Error',
      message: 'Could not reach the AI endpoint. Check your endpoint URL and connection in Settings → AI Setup.',
    };
    if (msg === 'JSON_PARSE_ERROR') return {
      title: 'Unexpected Response',
      message: 'The model returned an unexpected response. Try a different model in Settings → AI Setup.',
    };
    if (msg.startsWith('AI model is not configured')) return {
      title: 'AI Not Configured',
      message: 'Go to Settings → AI Setup to connect an AI model before importing recipes.',
    };
    if (msg.startsWith('API_ERROR:')) return {
      title: 'API Error',
      message: `The AI service returned an error (status ${msg.split(':')[1]}). Check your API key and model name in AI Setup.`,
    };
    return {
      title: 'Import Failed',
      message: 'Something went wrong. Please try again.',
    };
  };

  const showError = (error: any) => {
    const { title, message } = resolveErrorMessage(error);
    setPopupConfig({ title, message, buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }] });
    setShowPopup(true);
  };

  // ── URL import ────────────────────────────────────────────────────────────
  const handleExtractRecipe = async () => {
    if (!url.trim()) {
      setPopupConfig({
        title: 'Missing Information',
        message: 'Please enter a URL',
        buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }],
      });
      setShowPopup(true);
      return;
    }

    // Check internet connectivity
    const isConnected = await checkInternetConnection();
    if (!isConnected) {
      setPopupConfig({
        title: 'No Internet Connection',
        message: 'You are not connected to the internet',
        buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }],
      });
      setShowPopup(true);
      return;
    }
    setLoading('url');
    try {
      const recipe = await RecipeExtractorService.extractRecipe(url);
      recipe.sourceUrl = url.trim();
      await RecipeStore.addRecipe(recipe);
      navigation.goBack();
    } catch (error) {
      console.error('Failed to extract recipe from URL:', error);
      const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
      setPopupConfig({
        title: 'Could not import recipe',
        message,
        buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }],
      });
      setShowPopup(true);
      return;
    }

    // Single picker — accepts all readable text formats
    // Format is detected from the file extension after picking
    let res;
    try {
      res = await DocumentPicker.pick({
        type: [
          DocumentPicker.types.plainText,
          'text/html',
          'application/xhtml+xml',
          'text/markdown',
          'text/x-markdown',
        ],
      });
    } catch (err) {
      if (DocumentPicker.isCancel(err)) return;
      console.error('Document picker error:', err);
      setPopupConfig({
        title: 'Error',
        message: 'Failed to open file picker.',
        buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }],
      });
      setShowPopup(true);
      return;
    }

    const picked = Array.isArray(res) ? res[0] : res;
    const sourceUri = picked?.fileCopyUri ?? picked?.uri;
    const fileName = picked?.name ?? 'recipe.txt';

    if (!sourceUri) {
      setPopupConfig({
        title: 'Error',
        message: 'Could not read the selected file.',
        buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }],
      });
      setShowPopup(true);
      return;
    }

    setLoading('file');
    try {
      // Android content:// URIs must be copied to a temp path first
      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'txt';
      let localPath = sourceUri.replace('file://', '');
      if (Platform.OS === 'android' && sourceUri.startsWith('content://')) {
        const tempPath = `${RNFS.TemporaryDirectoryPath}/sift_import_${Date.now()}.${ext}`;
        await RNFS.copyFile(sourceUri, tempPath);
        localPath = tempPath;
      }

      console.log(`Importing file: ${fileName} (ext: ${ext})`);
      const recipe = await RecipeExtractorService.extractRecipeFromFile(localPath, fileName);
      await RecipeStore.addRecipe(recipe);
      navigation.goBack();
    } catch (error) {
      console.error('Failed to extract recipe from file:', error);
      showError(error);
    } finally {
      setLoading('idle');
    }
  };

  return (
    <View style={styles.flexView}>
      <Header title="Add recipe" />
      <ScrollView style={styles.flexView} contentContainerStyle={styles.flexGrow}>
        <ContentWrapper>
          <View style={styles.container}>
            <Input
              placeholder="www.cookingwebsite.com/recipe"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />

            <Button onPress={handleExtractRecipe} disabled={loading}>
              {loading ? (
                <View style={styles.loadingContainer}>
                  <Text style={[styles.buttonText, { color: colors.background }]}>Adding</Text>
                  <Text style={[styles.buttonText, styles.dotsContainer, { color: colors.background }]}>{dots}</Text>
                </View>
              ) : (
                <Text style={[styles.buttonText, { color: colors.background }]}>Add Recipe</Text>
              )}
            </Button>
          </View>
        </ContentWrapper>
      </ScrollView>
      <CustomPopup
        visible={showPopup}
        title={popupConfig.title}
        message={popupConfig.message}
        buttons={popupConfig.buttons}
        onClose={() => setShowPopup(false)}
      />
    </View>
  );
}

const stylesFactory = (colors: any) => StyleSheet.create({
  flexView: { flex: 1, backgroundColor: colors.background },
  flexGrow: { flexGrow: 1 },
  container: { flex: 1, padding: 16, backgroundColor: 'transparent' },
  sectionLabel: {
    fontSize: 15,
    opacity: 0.7,
    marginBottom: 10,
    color: colors.text,
  },
  sectionLabelFile: {
    marginTop: 32,
  },
  input: {
    height: 48,
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  fileButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.tint,
  },
  dotsContainer: {
    width: 24,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.5,
    color: colors.text,
    marginBottom: 16,
  },
  loadingContainer: { flexDirection: 'row' },
  dotsContainer: { width: 24 },
});