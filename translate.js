const uuidv4 = require('uuid/v4');
const fetch = require("node-fetch");
const ComfyDB = require("comfydb");
const fs = require("fs");
const ignorelist = fs.readFileSync("ignore-words.txt", "utf-8").split(", ").filter(Boolean);
const { naughtyToNice, hasBlacklistedWord } = require('./censor');
const { parseEmotes, whitespaceRegex } = require('./emotes');
const languages = require('./languages');
const langDetect = require("@chattylabs/language-detection");
const moment = require('moment'); // Use moment to handle timestamps
const maxMessageLength = 64;
const memTranslations = [];
const memLimit = 1000;
const twitchUsernameRegex = /@[a-zA-Z0-9_]{4,25}\b/gi;
const { Translate } = require('@google-cloud/translate').v2;
const google_apikey = process.env.GOOGLE_API;
const projectID = process.env.ProjectID;
const translate = new Translate({
  projectID,
  key: google_apikey,
});
let translationCalls = 0;

// Cache expiration times in milliseconds
const MEM_CACHE_EXPIRATION_TIME = 3600000; // 1 hour for in-memory cache
const COMFYDB_CACHE_EXPIRATION_TIME = 86400000; // 1 day for ComfyDB cache

async function clearExpiredCache() {
  try {
    console.log('[INFO] Starting cache cleanup...');

    // Clear expired cache from ComfyDB (translations)
    const translations = await ComfyDB.GetAll("translations");

    translations.forEach(translation => {
      if (translation.timestamp) {
        const now = moment();
        const cacheTime = moment(translation.timestamp);
        const age = now.diff(cacheTime);

        // If cache entry is older than the expiration time, remove it
        if (age > COMFYDB_CACHE_EXPIRATION_TIME) {
          console.log(`[INFO] Cache expired for ${translation.key}, removing it.`);
          ComfyDB.Remove(translation.key, "translations");
        }
      }
    });

    // Clear expired cache from memTranslations (in-memory cache)
    const currentTime = moment().valueOf();
    for (let i = 0; i < memTranslations.length; i++) {
      if (memTranslations[i].timestamp && currentTime - memTranslations[i].timestamp > MEM_CACHE_EXPIRATION_TIME) {
        console.log(`[INFO] Cache expired for message: ${memTranslations[i].message}, removing it.`);
        memTranslations.splice(i, 1);
        i--; // Adjust index after removal
      }
    }

    console.log('[INFO] Cache cleanup completed.');
  } catch (err) {
    console.error('[ERROR] Error during cache cleanup:', err);
  }
}

// Schedule cache cleanup to run every hour (1 hour for both caches)
setInterval(clearExpiredCache, MEM_CACHE_EXPIRATION_TIME);

const allowedLanguages = ["es", "fr", "de"]; // Languages that will be translated, others will be ignored.

async function translateMessageWithGoogle(channel, userstate, message, app) {
  try {
    const { translations, request, channels } = app;

    // Fetch the channel-specific configuration
    const channelConfig = channels[channel];
    if (!channelConfig) {
      console.log(`[ERROR] Channel configuration not found for ${channel}`);
      return;
    }

    // Extract the target language (lang) and supported translated languages
    const targetLanguage = channelConfig.lang?.toLowerCase().trim();
    const supportedLanguages = channelConfig.translatedlanguages || [];

    if (!targetLanguage) {
      console.log(`[ERROR] Target language (.lang) not set for channel ${channel}`);
      return;
    }

    // Ensure supportedLanguages is an array and normalize the codes to lowercase
    const normalizedSupportedLanguages = supportedLanguages.map(lang => lang.toLowerCase().trim());

    // Use Google Cloud Translate's detect method for language detection with confidence score
    const [detection] = await translate.detect(message); // You need to ensure `translate` is the Google Translate client instance
    const detectedLanguage = detection.language.toLowerCase().trim();
    const confidence = detection.confidence;

    console.log(`[INFO] Detected language: ${detectedLanguage} with confidence: ${confidence}`);
    console.log(`[INFO] Supported languages: ${normalizedSupportedLanguages.join(', ')}`);
    console.log(`[INFO] Target language (.lang): ${targetLanguage}`);

    // Log if confidence is low (below threshold like 0.5)
    if (confidence < 0.5) {
      console.log(`[WARN] Low confidence detected for language detection: ${confidence}`);
    }

    // Check if the detected language is in the supported translated languages
    if (!normalizedSupportedLanguages.includes(detectedLanguage)) {
      console.log(`[INFO] Detected language '${detectedLanguage}' is not in the supported languages list. Skipping translation.`);
      return;
    }

    // Avoid translating to the same language as the detected one
    if (detectedLanguage === targetLanguage) {
      console.log(`[INFO] Detected language '${detectedLanguage}' matches the target language '${targetLanguage}'. No translation needed.`);
      return;
    }

    // Proceed with translation
    console.log(`[INFO] Translating message from '${detectedLanguage}' to '${targetLanguage}'`);

    // Perform translation using Google API
    let [translatedText] = await translate.translate(message, targetLanguage);
    translatedText = Array.isArray(translatedText) ? translatedText[0] : translatedText;

    console.log(`[INFO] Translated message: ${message} => ${translatedText}`);

    // Send the translated message back to the channel
    if (translatedText) {
      const response = {
        text: [translatedText],
        lang: detectedLanguage,
      };

      sendTranslationFromResponse(targetLanguage, message, channel, userstate, response, app);

      // Cache translation
      const translationCache = await ComfyDB.Get(message, "translations") || {};
      translationCache[detectedLanguage] = response;
      console.log(`[INFO] Caching translation: ${message} => ${translatedText}`);
      await ComfyDB.Store(message, translationCache, "translations");
    }
  } catch (err) {
    console.error(`[ERROR] Error in translateMessageWithGoogle: ${err.message}`);
  }
}









function sendTranslationFromResponse(language, filteredMessage, channel, userstate, resp, app, fromRequest = false) {
  const { client, channels } = app;
  const { uncensored, color, langshow } = channels[channel];

  // Determine text and language source based on `fromRequest`
  let text, langFrom;

  if (fromRequest) {
    text = resp.text?.[0] || ""; // Access the first translated text if available
    langFrom = resp.lang || "unknown"; // Fallback to "unknown" if lang isn't provided
  } else {
    // Adjust for the resp structure; `language` may not be a key in this case
    text = resp.text?.[0] || ""; // Directly access text
    langFrom = resp.lang || "unknown"; // Directly access lang
  }

  // Debugging logs for better visibility
  console.log(`[DEBUG] Detected source language: ${langFrom}`);
  console.log(`[DEBUG] Translated text: ${text}`);

  // Skip sending if translation failed or text is unchanged
  if (!text || text === filteredMessage) {
    console.log(`[INFO] No translation needed or translation failed for message: ${filteredMessage}`);
    return;
  }

  // Apply censorship if required
  if (!uncensored) {
    text = naughtyToNice(text);
  }

  // Language display in Twitch chat
  const sourceLanguage = languages[langFrom.split("-")[0]] || "unknown"; // Get readable name for langFrom
  const displayName = userstate["display-name"] || "Unknown";

  console.log(`[INFO] Sending translation: (${sourceLanguage}) ${displayName}: ${text}`);

  // Send the message to Twitch chat
  client.say(
    channel,
    `${color ? "/me " : ""}${langshow ? `(${sourceLanguage}) ` : ""}${displayName}: ${text}`
  );
}


module.exports = { translateMessageWithGoogle };
