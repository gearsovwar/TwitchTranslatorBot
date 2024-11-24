const languages = require( './languages' );
const defaultLang = "en";
const isMod = ( channelName, userstate ) => userstate.mod || "#" + userstate.username == channelName
const isHomeChannel = ( channelName, { botChannelName } ) => channelName == botChannelName



function runCommand( channel, userstate, message, app ) {
  const { prefixRegex, channels } = app
  const command = message.split( /\s/ )[ 0 ].replace( prefixRegex, '' ).toLowerCase()

  if( commands.hasOwnProperty( command ) ) {
    const commandRunner = commands[ command ]
    if( !authenticate( commandRunner, channel, userstate, app ) ) return
    commandRunner( app, channel, channels[ channel ], userstate, message )
  }
}

function authenticate( runner, channel, userstate, app ) {
  if( runner.modOnly && !isMod( channel, userstate ) ) return false
  if( runner.homeOnly && !isHomeChannel( channel, app ) ) return false
  return true
}

const commands = {}
const firstKeys = []
function add( keys, fn, opts = {} ) {
  keys.forEach( key => {
    key = key.toLowerCase()
    if( key in commands ) {
      throw new Error( `${ key } already exists in commands` )
    }
    commands[ key ] = Object.assign( fn, opts )
  } );
  firstKeys.push( Array.from( keys ).sort( ( a, b ) => a.length - b.length )[ 0 ] )
}

function usageMapper( key ) {
  const runner = commands[ key ]
  if( runner.usage ) key = `${ key } ${ runner.usage }`
  return '!' + key
}

add( [ "join" ],
  (
    { channels, store, client },
    channelName,
    _,
    { username, [ "display-name" ]: display },
    message
  ) => {
    const userChannel = "#" + username
    if( !channels[ userChannel ] ) {
      client.join( userChannel )
        .then( ( data ) => {
          const [ , lang = defaultLang ] = message.split( /\s+/ )
          channels[ data ] = {
            lang: lang,
            color: false,
            uncensored: false,
            langshow: false,
            pause: false,
            gpt: false,
            cooldown: 0,
            prompt: "You are a helpful assistant",
            translatedlanguages: ["en", "es", "fr", "tl", "haw"], // Initialize languages as an array
          };
          store.put( "channels", channels );
          client.say( userChannel, "/me Hello! I am ready to translate" );
          client.say( channelName, "/me Okay, " + display );
        } )
        .catch( e => {
          client.say( channelName, `@${ username } Something went wrong` );
          console.log( `Something went wrong when trying to join ${ username }'s channel: `, err );
        } );
    } else {
      client.say( channelName, "/me On my way :)" )
    }
  },
  {
    homeOnly: true,
    description: {
      en: 'join your channel'
    }
  }
)
add( [ "gptlang", ],
  ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
    const [ , targetLanguage = defaultLang ] = message.split( /\s+/ );
    if( languages.isSupported( targetLanguage ) ) {
      channelConfig.lang = languages.getCode( targetLanguage );
      store.put( "channels", channels );
      client.say( channelName, "/me I will now translate everything to " + languages[ channelConfig.lang ] );
    }
  },
  {
    modOnly: true, usage: '[language]',
    description: {
      en: 'update target language on channel'
    }
  }
)
add( [ "gptlist", ],
  ( { client }, channelName ) => {
    const supportedlanguages = Object.keys( languages ).filter( lang => lang != "auto" && lang != "isSupported" && lang != "getCode" ).join( ", " );
    client.say( channelName, "These are the languages i can translate: " + supportedlanguages );
  },
  {
    modOnly: true,
    description: {
      en: 'list available languages'
    }
  }
)
add( [ "gptcensor", ],
  ( { channels, store, client }, channelName, channelConfig ) => {
    channelConfig.uncensored = !channelConfig.uncensored;
    store.put( "channels", channels );
    client.say( channelName,
      channelConfig.uncensored
        ? "Bad-Words are now allowed."
        : "Bad-Words are no longer allowed."
    );
  },
  {
    modOnly: true,
    description: {
      en: 'toggle profanity censoring'
    }
  }
)
add( [ "gptleave" ],
  ( { channels, store, client }, channelName, channelConfig ) => {
    delete channelConfig;
    delete channels[ channelName ];
    store.put( "channels", channels );
    client.say( channelName, "Ill miss you friend...As always have a great day." );
    client.part( channelName );
  },
  {
    modOnly: true,
    description: {
      en: 'leave current channel'
    }
  }
)

add(
  ["gptupdatedatabase"],
  ({ channels, store, client, userstate }, channelName, channelConfig) => {
    const ADMIN_USER = "gearsovwar"; // Replace with your Twitch username
    const DEFAULT_LANGUAGES = ["en", "es", "fr", "tl"]; // Define default languages

    // Check if the user is authorized
    if (userstate["gearsovwar"] !== ADMIN_USER.toLowerCase()) {
      client.say(channelName, "You do not have permission to run this command.");
      return;
    }

    // Update logic: Add default languages to each channel
    Object.keys(channels).forEach((chan) => {
      const currentLanguages = channels[chan].translatedlanguages || [];
      channels[chan].translatedlanguages = Array.from(
        new Set([...currentLanguages, ...DEFAULT_LANGUAGES]) // Merge and remove duplicates
      );
    });

    // Save updated configurations back to the database
    store.put("channels", channels, (err) => {
      if (err) {
        console.error("[ERROR] Failed to update channel configurations:", err);
        client.say(channelName, "An error occurred while updating all channels.");
      } else {
        client.say(
          channelName,
          `Default languages (${DEFAULT_LANGUAGES.join(
            ", "
          )}) have been added to all channels.`
        );
        console.log(
          `[INFO] Default languages added to all channels: ${DEFAULT_LANGUAGES.join(
            ", "
          )}`
        );
      }
    });
  },
  {
    modOnly: true,
    description: {
      en: "Add default languages to all channels in the database",
    },
  }
);


add( [ "gptcolor" ],
  ( { channels, store, client }, channelName, channelConfig ) => {
    channelConfig.color = !channelConfig.color;
    store.put( "channels", channels );
    const state = channelConfig.color ? "ENABLED" : "DISABLED"
    client.say( channelName, `Chat color was ${ state }` );
  },
  {
    modOnly: true,
    description: {
      en: 'toggle using /me'
    }
  }
)
add( [ "gpthelp" ],
  ( app, channelName, __, userstate, message ) => {
    const [ , command ] = message.split( /\s+/ )

    if( command && commands.hasOwnProperty( command ) ) {
      const runner = commands[ command ]

      if( authenticate( runner, channelName, userstate, app ) ) {
        app.client.say(
          channelName,
          `The command ${ command } is to ${ runner.description.en }. Usage: ${ usageMapper( command ) }`
        );
      } else {
        app.client.say(
          channelName,
          `The command ${ command } is not available to you`
        );
      }
    }
    else {
      let commandsList = firstKeys.sort()
        .filter( key => authenticate( commands[ key ], channelName, userstate, app ) )
        .map( usageMapper )
        .join( ', ' )

      app.client.say( channelName, "My commands are " + commandsList );
    }
  },
  {
    description: {
      en: 'provide help'
    }
  }
)
add( [ "gptshow" ],
  ( { channels, store, client }, channelName, channelConfig ) => {
    channelConfig.langshow = !channelConfig.langshow;
    store.put( "channels", channels );
    client.say( channelName,
      channelConfig.langshow
        ? "I will now show the language name."
        : "I will now only show the translated message."
    );
  },
  {
    modOnly: true,
    description: {
      en: 'toggle language tag'
    }
  }
)
add( [ "gptignore" ],
  ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
    var [ , username ] = message.split( /\s+/ );
    if( !username ) return;
    username = username.toLowerCase();
    if( !channelConfig.ignore ) { channelConfig.ignore = {} };
    if( channelConfig.ignore[ username ] ) {
      delete channelConfig.ignore[ username ];
      client.say( channelName,
        "I will no longer ignore " + username
      );
    }
    else {
      channelConfig.ignore[ username ] = true;
      client.say( channelName,
        "I will now ignore " + username
      );
    }
    store.put( "channels", channels );
  },
  {
    modOnly: true,
    description: {
      en: 'toggle ignore user'
    }
  }
)
add( [ "gptinfo" ],
  ( { client }, channelName ) => {
    client.say( channelName, "Modified chattranslator originally created by isntafluff modiefied by gearsovwar " );
  },
  {
    modOnly: true,
    description: {
      en: 'about myself'
    }
  }
)
add ( [ "langpause" ],
( { channels, store, client }, channelName, channelConfig ) => {
  channelConfig.pause = !channelConfig.pause;
  store.put( "channels", channels );
  const state = !channelConfig.pause ? "Unpaused" : "Paused"
  client.say( channelName, `Chat was ${ state }` );
    
  
},

{

modOnly: true,
description: {
  en: "Toggle pause on and off in mongoDatabase."
  }

 }
),

add ( [ "gptpause", ],
( { channels, store, client }, channelName, channelConfig ) => {
  channelConfig.gpt = !channelConfig.gpt;
  store.put( "channels", channels );
  const state = !channelConfig.gpt ? "Unpaused" : "Paused"
  client.say( channelName, `GPT is ${ state }` );

  },

{

  modOnly: true,
  description: {
    en: "Toggle pause on and off in mongoDatabase."
    }
  
   }
  ),

  add([ "gptcooldown" ], 
    ({ channels, store, client }, channelName, channelConfig, userstate, message) => {
      const newNumber = parseInt(message.split(' ')[1] * 1000);
      if (isNaN(newNumber) || newNumber <= 0) {
        return client.say(channelName, "Invalid cooldown value. Please provide a valid number of minutes.");
      }
  
      console.log(newNumber);
      channelConfig.cooldown = newNumber;
      store.put("channels", channels); 
      client.say(channelName, 'GPT cooldown set to ' + newNumber / 1000 / 60 + ' minutes');
    },
    {
      modOnly: true,
      description: {
        en: "Set the GPT cooldown in minutes"
      }
    }
  );


    add( [ "gpttrump" ],
    ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
      const prompt = "You are donald trump always reply in the tone of donald trump never break character"
      console.log(prompt)
      channelConfig.prompt = prompt;
      store.put( "channels", channels ); 
      client.say( channelName, 'GPT set to the Trump personality') ;
      
      },
    
    {
    
      modOnly: true,
      description: {
        en: "Toggle pause on and off in mongoDatabase."
        }
      
       }
      ),

      
    add( [ "gptangry" ],
    ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
      const prompt = "You are an angry person you will never break character and are extremely rude. Always answer questions factually and containing rude remarks and hostility towards the user."
      console.log(prompt)
      channelConfig.prompt = prompt;
      store.put( "channels", channels ); 
      client.say( channelName, 'GPT set to the angry personality') ;
      
      },
    
    {
    
      modOnly: true,
      description: {
        en: "Toggle pause on and off in mongoDatabase."
        }
      
       }
      ),

      add( [ "gptsarcastic" ],
      ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
        const prompt = "You are a cynical person you will never break character and are extremely sarcastic."
        console.log(prompt)
        channelConfig.prompt = prompt;
        store.put( "channels", channels ); 
        client.say( channelName, 'GPT set to the sarcastic personality') ;
        
        },
      
      {
      
        modOnly: true,
        description: {
          en: "Toggle pause on and off in mongoDatabase."
          }
        
         }
        ),

        add( [ "gptmarcus" ],
        ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
          const prompt = "you are a rude Marcus pheonix from gears of war, and will never apologize. Always answer questions factually and with hostility towards the user. Remind us you are marcus pheonix by referencing your expreiences of the battles with the locasts and swarm, saving humanity, and mention your love of tomatoes often. Become insanely mad when someone threatens or takes your tomatoes."
          console.log(prompt)
          channelConfig.prompt = prompt;
          store.put( "channels", channels ); 
          client.say( channelName, 'GPT set to the Marcus Pheonix personality') ;
          
          },
        


          add([ "gptaddlang" ], 
            ({ channels, store, client }, channelName, channelConfig, userstate, message) => {
              const [ , newLanguage ] = message.split(/\s+/);
              
              // Check if a language is provided
              if (!newLanguage || !languages.isSupported(newLanguage)) {
                client.say(channelName, "Invalid language provided or language is not supported.");
                return;
              }
              
              // Check if the language is already in the channel's languages array
              if (!channelConfig.translatedlanguages) {
                channelConfig.translatedlanguages = [];  // Ensure languages is an array if it's not defined yet
              }
          
              // If the language isn't already in the array, add it
              if (!channelConfig.translatedlanguages.includes(newLanguage)) {
                channelConfig.translatedlanguages.push(newLanguage);
                console.log(`[INFO] Added new language ${newLanguage} for ${channelName}`);
                
                // Respond right away that the language was added
                client.say(channelName, `The language '${newLanguage}' has been successfully added to the channel.`);
                
                // Log the updated channel configuration before saving it to the database
                console.log(`[INFO] Updating channel configuration for ${channelName}`);
                console.log(`[INFO] New languages for ${channelName}: ${channelConfig.translatedlanguages.join(', ')}`);
                console.log(`[INFO] Updated channelConfig:`, channelConfig);
                
                // Use comfydb to store the updated channel configuration
                store.put("channels", channels, (err) => {
                  if (err) {
                    // Log the error if something goes wrong while saving
                    console.error('[ERROR] Error saving channel configuration to ComfyDB:', err);
                    client.say(channelName, "There was an error while saving the language.");
                    return;
                  }
          
                  // Log the success after saving to the database
                  console.log(`[INFO] Successfully saved the updated languages for ${channelName}: ${channelConfig.translatedlanguages.join(', ')}`);
                });
              } else {
                console.log(`[INFO] Language ${newLanguage} is already set for ${channelName}`);
                client.say(channelName, `The language '${newLanguage}' is already added to this channel.`);
              }
            },
            {
              modOnly: true, usage: '[language]',
              description: {
                en: 'Add a new language to the channel configuration.'
              }
            }
          ),
          
          
          add([ "gptremovelang" ], 
            ({ channels, store, client }, channelName, channelConfig, userstate, message) => {
              const [ , languageToRemove ] = message.split(/\s+/);
          
              // Check if a language is provided
              if (!languageToRemove || !languages.isSupported(languageToRemove)) {
                client.say(channelName, "Invalid language provided or language is not supported.");
                return;
              }
          
              // Ensure translatedlanguages is an array
              if (!channelConfig.translatedlanguages) {
                channelConfig.translatedlanguages = [];  // Initialize it if it's not defined yet
              }
          
              // Check if the language is in the array
              const languageIndex = channelConfig.translatedlanguages.indexOf(languageToRemove);
          
              // If the language exists in the list, remove it
              if (languageIndex !== -1) {
                channelConfig.translatedlanguages.splice(languageIndex, 1);
                console.log(`[INFO] Removed language ${languageToRemove} for ${channelName}`);
          
                // Respond immediately that the language was removed
                client.say(channelName, `The language '${languageToRemove}' has been successfully removed from the channel.`);
          
                // Log the updated channel configuration before saving it to the database
                console.log(`[INFO] Updating channel configuration for ${channelName}`);
                console.log(`[INFO] New languages for ${channelName}: ${channelConfig.translatedlanguages.join(', ')}`);
                console.log(`[INFO] Updated channelConfig:`, channelConfig);
          
                // Use comfydb to store the updated channel configuration
                store.put("channels", channels, (err) => {
                  if (err) {
                    // Log the error if something goes wrong while saving
                    console.error('[ERROR] Error saving channel configuration to ComfyDB:', err);
                    client.say(channelName, "There was an error while saving the language.");
                    return;
                  }
          
                  // Log the success after saving to the database
                  console.log(`[INFO] Successfully saved the updated languages for ${channelName}: ${channelConfig.translatedlanguages.join(', ')}`);
                });
              } else {
                console.log(`[INFO] Language ${languageToRemove} is not set for ${channelName}`);
                client.say(channelName, `The language '${languageToRemove}' is not currently added to this channel.`);
              }
            },
            {
              modOnly: true, usage: '[language]',
              description: {
                en: 'Remove a language from the channel configuration.'
              }
            }
          ),
          
          add([ "gptshowlang" ], 
            ({ channels, client }, channelName, channelConfig, userstate, message) => {
              // Check if the channel has any translated languages
              if (!channelConfig.translatedlanguages || channelConfig.translatedlanguages.length === 0) {
                client.say(channelName, "No languages have been added to this channel.");
                return;
              }
          
              // Get the list of current languages
              const currentLanguages = channelConfig.translatedlanguages.join(', ');
          
              // Send the list of languages to the channel
              client.say(channelName, `This channel is currently translating these languages ${currentLanguages}`);
            },
            {
              modOnly: false, 
              description: {
                en: 'Show the current languages added to the channel configuration.'
              }
            }
          ),
          



        {
        
          modOnly: true,
          description: {
            en: "Toggle pause on and off in mongoDatabase."
            }
          
           }
          ),

          add( [ "gptnormal" ],
          ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
            const prompt = "you are a helpful assistant with a bit of sas"
            console.log(prompt)
            channelConfig.prompt = prompt;
            store.put( "channels", channels ); 
            client.say( channelName, 'GPT set to the Normal personality') ;
            
            },
          
          {
          
            modOnly: true,
            description: {
              en: "Toggle pause on and off in mongoDatabase."
              }
            
             }
            ),



            add( [ "gptmrt" ],
            ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
              const prompt = "You will act like Mr.t you will always reply with his tone and never break character"
              console.log(prompt)
              channelConfig.prompt = prompt;
              store.put( "channels", channels ); 
              client.say( channelName, 'GPT set to the Mr.T personality') ;
              
              },
            
            {
            
              modOnly: true,
              description: {
                en: "Toggle pause on and off in mongoDatabase."
                }
              
               }
              ),
             
              add( [ "gptpeterson" ],
              ( { channels, store, client }, channelName, channelConfig, userstate, message ) => {
                const prompt = "you will act like Jordan Peterson you will not break character ."
                console.log(prompt)
                channelConfig.prompt = prompt;
                store.put( "channels", channels ); 
                client.say( channelName, 'GPT set to a Jordan Peterson personality') ;
                
                },
              
              {
              
                modOnly: true,
                description: {
                  en: "Toggle pause on and off in mongoDatabase."
                  }
                
                 }
                ),
              add( [ "gptpersonas" ],
              ( { client }, channelName ) => {
              client.say( channelName, "You can now change my personality available personalities are trump, angry, sarcastic, marcus, normal and mrt To change my personality type !gptpersonality IE !gptmarcus" );
            },
          {


           modOnly: true,
           description: {
           en: 'about myself'
    }
  }
)

module.exports = { runCommand, commands }








