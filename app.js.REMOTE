const dotenv = require('dotenv').config();
const tmi = require( 'tmi.js' );
const request = require( 'request' );
const fetch = require( "node-fetch" );
const Storage = require( 'node-storage' );
const ComfyDB = require( "comfydb" );
const lang = "something"
const { runCommand } = require( './command' );
const { translateMessageWithAzure } = require( './translate' );

const store = new Storage( "channels.db" );
const translations = new Storage( "translations.db" );
const channels = store.get( "channels" ) || {};
const botChannelName = "#" + process.env.TWITCHUSER;
const prefix = '!'
const prefixRegex = new RegExp( '^' + prefix )

//OpenAI implementation test

const cooldowns = {};
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);
console.log(openai)
function randomSimpleHash( s ) {
	return s.split( "" ).map( c => c.charCodeAt( 0 ) ).reduce( ( p, c ) => p + c, 0 );
}

const serverId = 0;
const serverCount = 1;
let serverChannels = Object.keys( channels ).concat( botChannelName ).filter( x => randomSimpleHash( x ) % serverCount === serverId );
console.log( serverChannels );
console.log("Current directory:", __dirname);
(async () => {
	// Check and clean up channels
	for( let i = 0; i < serverChannels.length; i += 100 ) {
		let chans = serverChannels.slice( i, i + 100 ).map( x => x.replace( "#", "" ) );
		let result = await fetch( `https://api.twitch.tv/helix/users?login=${chans.join( "&login=" )}`, {
    headers: {
        "Client-ID": process.env.ClIENT_ID,
        "Authorization": process.env.OAUTH
    }
}).then(r => {
    //console.log(r)    Use this console.log to verify return from fetch command to API.twitch.tv
    return r.json()
});
		let existing = result.data.map( x => x.login );
		let badChans = chans.filter( c => !existing.includes( c ) );
		console.log( "Cleaning bad channels:", badChans );
		badChans.forEach( c => {
			// Leave bad channel
			console.log( "Removing bad channel:", channels[ "#" + c ] );
			delete channels[ "#" + c ];
		});
		store.put( "channels", channels );
	}

	const client = new tmi.Client({
	  options: { debug: false },
	  connection: {
		  secure: true,
		  reconnect: true,
	  },
	  channels: [ botChannelName ].concat( Object.keys( channels ) ),
	  identity: {
		  username: process.env.TWITCHUSER,
		  password: process.env.OAUTH_2
		  
	  },
	} );
	client.on( 'chat', onMessage );
	client.on( 'connected', ( address, port ) => {
		console.log( `Connected: ${ address }:${ port }` );
	} );
	client.on( 'notice', ( channel, msgid, message ) => {
		console.log( `Notice: ${ channel } ${ msgid } ${ message }` );
		switch( msgid ) {
		case "msg_banned":
			// Leave this channel
			console.log( "Leaving banned channel:", channels[ channel ] );
			delete channels[ channel ];
			store.put( "channels", channels );
			break;
		}
	} );
	client.on( 'reconnect', () => console.log( 'Reconnecting' ) );
	//console.log(client.opts.channels);   //Use These console commands to verify what is being passed from process.env.TWITCHUSER and OAUTH2
	//console.log(client.opts.identity);
	client.connect();
	ComfyDB.Connect();

	const appInjection = { client, prefixRegex, botChannelName, store, channels, translations, request }

	const errorPrefix = "\n[onMessage]  "
		//Chat GPT Cooldown test
	async function onMessage( channel, userstate, message, self ) {
			//console.log(channels[channel].pause) Used to log MangoDB Pause value
			
				


	  
			if(self){
			return;
			}
	  if( userstate.username === "twitchtranslatorbot" ) return;

	  try {
	    if( message.match( prefixRegex ) ) {
	      runCommand( channel, userstate, message, appInjection )
	    } else if( channels[ channel ] &&!channels[channel].pause ) {

				await translateMessageWithAzure( channel, userstate, message, appInjection );

			//console.log()
	      
			

		  // translateMessageComfyTranslations( channel, userstate, message, appInjection );
	    }
	  } catch( error ) {
	    console.log(
	      errorPrefix + "Failed handling message!",
	      errorPrefix + "From:  " + userstate.username,
	      errorPrefix + "Message:  " + message,
	      errorPrefix + "Error:  ", error
	    );
	  }
	  
	}


const messageCache = new Map();
 // 3 minutes



 
client.on('chat', async (channel, userstate, message, self,) => {
	

  if (self) return;
  if (prefixRegex.test(message) && channels[channel] && !channels[channel].gpt) {

	//console.log(channels[channel].cooldown) Console command to check cooldown value
	 const command = message.slice(prefix.length).split(" ")[0];
	 const cooldownTime = channels[channel].cooldown
    if (command === "gpt") {
      const username = userstate.username;
      const currentTime = new Date().getTime();
	  const elapsedTime = (currentTime - messageCache.get(username));
	  console.log(elapsedTime)
	  const TimeUntilCooldown = (cooldownTime - elapsedTime) / 1000;
	  const minutes = Math.floor(TimeUntilCooldown / 60);
	  console.log(minutes)
	  const seconds = Math.floor(TimeUntilCooldown % 60);
	  console.log(seconds)
	  const timeString = minutes + " minutes and " + seconds + " seconds";
	  console.log(channel,userstate.username,message)
	  
      // Check if the user has already sent a message recently
      if (messageCache.has(username) && (currentTime - messageCache.get(username)) < cooldownTime) {
        client.say(channel, "@" + username + "  cooldown " + timeString );
        return;
		
      }
	  
      // Update the cache with the new message and timestamp
      messageCache.set(username, currentTime);
	  async function queryOpenAI(message) {
		try {
			
			  const completion = await openai.createChatCompletion({
				model: "gpt-3.5-turbo",
				temperature:0.75,
				max_tokens: 50,
				messages: [
					{role: "system", content: channels[channel].prompt}, 
					{role: "user", content: message}, 
					
					],
	  });
	          const generatedText = completion.data.choices[0].message;
			  console.log(completion.data.choices[0].message);
	          return generatedText;
	  
	} catch (error) {
		return;
		
	
	}}

	 try {
	
      //console.log(messageCache.set(username, currentTime)) Logging command to check the MAP entries
      const response = await queryOpenAI(message.slice(prefix.length + command.length + 1));
	  console.log(response)
      if (message.length > 0) {client.say(channel, "@" + userstate.username + " " + response.content);}
		console.log(typeof response.content)
	  } catch (error){
		console.error(error);
		client.say(channel, '@' + userstate.username + " Failed to respond please try again later")


	  }

	}
  }
});


	}


)();



