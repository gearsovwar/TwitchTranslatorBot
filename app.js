const dotenv = require('dotenv').config();
const tmi = require('tmi.js');
const fetch = require("node-fetch");
const Storage = require('node-storage');
const ComfyDB = require("comfydb");
const { runCommand } = require('./command');
const { translateMessageWithGoogle } = require('./translate');

const store = new Storage("channels.db");
const translations = new Storage("translations.db");
const channels = store.get("channels") || {};
const botChannelName = "#" + process.env.TWITCHUSER;
const prefix = '!';
const prefixRegex = new RegExp('^' + prefix);

// OpenAI implementation test
const cooldowns = {};
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
console.log(openai);

function randomSimpleHash(s) {
  return s.split("").map(c => c.charCodeAt(0)).reduce((p, c) => p + c, 0);
}

const serverId = 0;
const serverCount = 1;
let serverChannels = Object.keys(channels).concat(botChannelName).filter(x => randomSimpleHash(x) % serverCount === serverId);
console.log(serverChannels);
console.log("Current directory:", __dirname);

// Function to refresh OAuth token
async function refreshAccessToken() {
  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams();
  params.append('client_id', process.env.CLIENT_ID);
  params.append('client_secret', process.env.CLIENT_SECRET);
  params.append('refresh_token', process.env.REFRESH_TOKEN); // Store this securely
  params.append('grant_type', 'refresh_token');

  try {
    const response = await fetch(url, { method: 'POST', body: params });
    const data = await response.json();

    if (data.access_token) {
      console.log('OAuth token refreshed successfully');
      process.env.OAUTH = data.access_token;  // Update the OAUTH token
      process.env.REFRESH_TOKEN = data.refresh_token || process.env.REFRESH_TOKEN; // Optionally update refresh token if provided
      return data.access_token;
    } else {
      console.error('Failed to refresh OAuth token', data);
      throw new Error('Failed to refresh OAuth token');
    }
  } catch (error) {
    console.error('Error refreshing OAuth token', error);
    throw error;
  }
}

// Function to check if the token is expired by making an API request
async function checkTokenValidity() {
  const url = 'https://api.twitch.tv/helix/users';
  const headers = {
    'Client-ID': process.env.CLIENT_ID,
    'Authorization': `Bearer ${process.env.OAUTH}`
  };

  const response = await fetch(url, { headers });
  const data = await response.json();

  if (data.error === 'Unauthorized') {
    // Token is expired, refresh it
    console.log('OAuth token expired, refreshing...');
    await refreshAccessToken();
  } else {
    console.log('OAuth token is valid');
  }
}

// Check token validity periodically
setInterval(checkTokenValidity, 60 * 60 * 1000); // Check every hour

(async () => {
  // Check and clean up channels
  for (let i = 0; i < serverChannels.length; i += 100) {
    let chans = serverChannels.slice(i, i + 100).map(x => x.replace("#", ""));
    
    // Ensure `chans` is populated and check if there are any channels to query
    if (chans.length > 0) {
      let result = await fetch(`https://api.twitch.tv/helix/users?login=${chans.join("&login=")}`, {
        headers: {
          "Client-ID": process.env.CLIENT_ID,
          "Authorization": `Bearer ${process.env.OAUTH}`
        }
      }).then(r => r.json());

      if (result.data) {
        let existing = result.data.map(x => x.login);
        let badChans = chans.filter(c => !existing.includes(c));
        console.log("Cleaning bad channels:", badChans);
        badChans.forEach(c => {
          // Leave bad channel
          console.log("Removing bad channel:", channels["#" + c]);
          delete channels["#" + c];
        });
        store.put("channels", channels);
      } else {
        console.log("No data returned from Twitch API.");
      }
    }
  }

  const client = new tmi.Client({
    options: { debug: false },
    connection: {
      secure: true,
      reconnect: true,
    },
    channels: [botChannelName].concat(Object.keys(channels)),
    identity: {
      username: process.env.TWITCHUSER,
      password: process.env.OAUTH_2
    },
  });

  client.on('chat', onMessage);
  client.on('connected', (address, port) => {
    console.log(`Connected: ${address}:${port}`);
  });
  client.on('notice', (channel, msgid, message) => {
    console.log(`Notice: ${channel} ${msgid} ${message}`);
    switch (msgid) {
      case "msg_banned":
        // Leave this channel
        console.log("Leaving banned channel:", channels[channel]);
        delete channels[channel];
        store.put("channels", channels);
        break;
    }
  });
  client.on('reconnect', () => console.log('Reconnecting'));
  
  client.connect();
  ComfyDB.Connect();

  const appInjection = { client, prefixRegex, botChannelName, store, channels, translations };

  const errorPrefix = "\n[onMessage]  ";
  
  async function onMessage(channel, userstate, message, self) {
    if (self) return;
    if (userstate.username === "twitchtranslatorbot") return;

    try {
      if (message.match(prefixRegex)) {
        runCommand(channel, userstate, message, appInjection);
      } else if (channels[channel] && !channels[channel].pause) {
        await translateMessageWithGoogle(channel, userstate, message, appInjection);
      }
    } catch (error) {
      console.log(
        errorPrefix + "Failed handling message! ",
        errorPrefix + "From:  " + userstate.username,
        errorPrefix + "Message:  " + message,
        errorPrefix + "Error:  ", error
      );
	}
  }

  const messageCache = new Map();
  
  client.on('chat', async (channel, userstate, message, self) => {
    if (self) return;
    if (prefixRegex.test(message) && channels[channel] && !channels[channel].gpt) {
      const command = message.slice(prefix.length).split(" ")[0];
      const cooldownTime = channels[channel].cooldown;
      if (command === "gpt") {
        const username = userstate.username;
        const currentTime = new Date().getTime();
        const elapsedTime = (currentTime - messageCache.get(username));
        const TimeUntilCooldown = (cooldownTime - elapsedTime) / 1000;
        const minutes = Math.floor(TimeUntilCooldown / 60);
        const seconds = Math.floor(TimeUntilCooldown % 60);
        const timeString = minutes + " minutes and " + seconds + " seconds";
        
        if (messageCache.has(username) && (currentTime - messageCache.get(username)) < cooldownTime) {
          client.say(channel, "@" + username + "  cooldown " + timeString);
          return;
        }

        messageCache.set(username, currentTime);

        async function queryOpenAI(message) {
          try {
            const completion = await openai.createChatCompletion({
              model: "gpt-3.5-turbo",
              temperature: 0.75,
              max_tokens: 50,
              messages: [
                { role: "system", content: channels[channel].prompt },
                { role: "user", content: message },
              ],
            });
            const generatedText = completion.data.choices[0].message;
            return generatedText;
          } catch (error) {
            console.error(error);
            return;
          }
        }

        try {
          const response = await queryOpenAI(message.slice(prefix.length + command.length + 1));
          if (response && response.content) {
            client.say(channel, "@" + userstate.username + " " + response.content);
          }
        } catch (error) {
          console.error(error);
          client.say(channel, '@' + userstate.username + " Failed to respond, please try again later");
        }
      }
    }
  });
})();
