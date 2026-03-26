import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import NetInfo from '@react-native-community/netinfo';
import RecipeExtractorService from '../services/RecipeExtractorService';
import RecipeStore from '../store/RecipeStore';
import { useTheme } from '../hooks/useTheme';
import Header from '../components/Header';
import CustomPopup from '../components/CustomPopup';
import ContentWrapper from '../components/ContentWrapper';

// This helper function checks for a live internet connection in a privacy-friendly way.
const checkInternetConnection = async () => {
  const state = await NetInfo.fetch();
  return state.isConnected;
};

export default function AddRecipeUrl() {
  const navigation = useNavigation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const { colors } = useTheme();
  const [showPopup, setShowPopup] = useState(false);
  const [dots, setDots] = useState('');
  const [popupConfig, setPopupConfig] = useState<{
    title: string;
    message: string;
    buttons: Array<{ text: string; onPress: () => void; style?: 'default' | 'cancel' }>;
  }>({
    title: '',
    message: '',
    buttons: [],
  });

  const styles = useMemo(() => stylesFactory(colors), [colors]);
  
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setDots(prev => {
          if (prev === '') return '.';
          if (prev === '.') return '..';
          if (prev === '..') return '...';
          return '';
        });
      }, 400); // Change dots every 400ms
    }
    return () => {
      if (interval) {
        clearInterval(interval);
      }
      setDots('');
    };
  }, [loading]);

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

    setLoading(true);
    try {
      const recipe = await RecipeExtractorService.extractRecipe(url);
      recipe.sourceUrl = url.trim();
      await RecipeStore.addRecipe(recipe);
      navigation.goBack();

    } catch (error: any) {
      console.error('Failed to extract recipe from URL:', error);
      const msg = error?.message ?? '';

      let title = 'Import Failed';
      let message = 'Something went wrong. Please try again.';

      if (msg === 'BOT_PROTECTION') {
        title = 'Website Protected';
        message = 'This website blocks automatic imports. Try copying the recipe text and adding it manually instead.';
      } else if (msg === 'RATE_LIMIT') {
        title = 'Rate Limit Reached';
        message = 'The AI service is temporarily rate limited. Wait a moment and try again, or switch to a different model in AI Setup.';
      } else if (msg === 'EMPTY_RESPONSE') {
        title = 'No Response from AI';
        message = 'The AI returned an empty response. This can happen with reasoning models that run out of tokens. Try a different model in AI Setup.';
      } else if (msg === 'NO_RECIPE_FOUND') {
        title = 'No Recipe Found';
        message = 'No recipe could be extracted from this page. The page may require a login, be paywalled, or have an unusual layout.';
      } else if (msg === 'INVALID_API_KEY') {
        title = 'Invalid API Key';
        message = 'API request rejected. Check your API key in Settings → AI Setup.';
      } else if (msg === 'HTML_RESPONSE' || msg === 'NETWORK_ERROR') {
        title = 'Connection Error';
        message = 'Could not reach the AI endpoint. Check your endpoint URL and connection in Settings → AI Setup.';
      } else if (msg === 'JSON_PARSE_ERROR') {
        title = 'Unexpected Response';
        message = 'The model returned an unexpected response. Try a different model in Settings → AI Setup.';
      } else if (msg.startsWith('AI model is not configured')) {
        title = 'AI Not Configured';
        message = 'Go to Settings → AI Setup to connect an AI model before importing recipes.';
      } else if (msg.startsWith('API_ERROR:')) {
        const status = msg.split(':')[1];
        title = 'API Error';
        message = `The AI service returned an error (status ${status}). Check your API key and model name in AI Setup.`;
      }

      setPopupConfig({
        title,
        message,
        buttons: [{ text: 'OK', onPress: () => setShowPopup(false) }],
      });
      setShowPopup(true);
    
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.flexView}>
      <Header title="Add recipe" />
      <ScrollView 
        style={styles.flexView}
        contentContainerStyle={styles.flexGrow}
      >
        <ContentWrapper>
          <View style={styles.container}>
            <TextInput
              style={styles.input}
              placeholder="www.cookingwebite.com/recipe"
              placeholderTextColor={colors.deleteButton}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={styles.button}
              onPress={handleExtractRecipe}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <Text style={styles.buttonText}>
                    Adding
                  </Text>
                  <Text style={[styles.buttonText, styles.dotsContainer]}>
                    {dots}
                  </Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>
                  Add Recipe
                </Text>
              )}
            </TouchableOpacity>
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
  flexView: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flexGrow: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: 'transparent',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 16,
    height: 48,
    textAlignVertical: 'center',
    borderColor: colors.inputBorder,
    color: colors.text,
  },
  button: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.tint,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.background,
  },
  loadingContainer: {
    flexDirection: 'row',
  },
  dotsContainer: {
    width: 24, // Fixed width for 3 dots
  },
});
 
