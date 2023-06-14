require('dotenv').config();
const tmi = require('tmi.js');
const axios = require('axios');
const discordWebhookURL = process.env.DISCORD_WEBHOOK;
const twitchChannels = process.env.TWITCH_CHANNELS.split(',');

const client = new tmi.Client({
    options: {
        debug: true
    },
    identity: {
        username: process.env.TWITCH_USERNAME,
        password: process.env.TWITCH_OAUTH_TOKEN
    },
    channels: twitchChannels
});

client.connect();

// this holds all the data from the socket.io server
// it's a list of subreddits and their status
let allData;

// not alerting for these subs as they've been spamming
// back and forth between private and public
const subsToFilter = [
    "r/bi_irl",
    "r/suddenlybi",
    "r/ennnnnnnnnnnnbbbbbby",
    "r/inzaghi"
];

/* 40+ million, 30+ million, 20+ million, 10+ million, 5+ million, 1+ million, 500k+, 250k+, 100k+, 50k+, 5k+, 5k */
const emojiMap = {
    "40+ million": "🔥",
    "30+ million": "🔥",
    "20+ million": "🔥",
    "10+ million": "🔥",
    "5+ million": "🔴",
    "1+ million": "🔴",
    "500k+": "🟢",
    "250k+": "🟢",
    "100k+": "🟢",
    "50k+": "🟢",
    "5k+": "🔵",
    "5k": "🔵",
    "": "🔵"
};

const colorMap = {
    "40+ million": "16724838",
    "30+ million": "16724947",
    "20+ million": "10695679",
    "10+ million": "7812095",
    "5+ million": "3370495",
    "1+ million": "3389695",
    "500k+": "3396607",
    "250k+": "3407752",
    "100k+": "3407725",
    "50k+": "11861811",
    "5k+": "7434609",
    "5k": "7434609",
    "": "3092271"
}


let darkSubs = 0;
let publicSubs = 0;
let privateSubs = 0;
let restrictedSubs = 0;
let participatingSubs = 0;

// Twitch chat events
client.on('message', (channel, tags, message, self) => {
    // Ignore echoed messages.
    if (self) return;

    //console.log('message is', message);

    if (message.toLowerCase() === '!dark') {
        client.whisper(channel, `@${tags.username}, there are ${darkSubs} subreddits that have gone darkSubs out of ${participatingSubs} (${((darkSubs / participatingSubs) * 100).toFixed(3)}%)`);
        return;
    }

    // add a !check command to check if a subreddit is dark or not
    if (message.toLowerCase().startsWith('!check')) {

        if (!allData) {
            return;
        }
        const sub = message.split(' ')[1];

        // make sure a subreddit was provided
        if (!sub) {
            client.say(channel, `@${tags.username}, please provide a subreddit to check. For example, !check r/ChatGPT`);
            return;
        }

        // make sure the subreddit starts with r/
        if (!sub.toLowerCase().startsWith('r/')) {
            client.say(channel, `@${tags.username}, please provide a subreddit to check including the "r/". For example, !check r/ChatGPT`);
            return;
        }

        const subData = allData.find(i => i.name.toLowerCase() === sub.toLowerCase());

        
        if (subData) {
            const emoji = emojiMap[subData.section] || "🔵";
            client.say(channel, `@${tags.username}, ${sub} is ${subData.status} (${subData.section} ${emoji})`);
        } else {
            client.say(channel, `@${tags.username}, ${sub} is not in the list`);
        }
    }
});


console.log('Using SSE url', process.env.SSE_URL);
const EventSource = require('eventsource');

let eventSource = newEventSource();

function newEventSource() {
    var eventSource = new EventSource('https://reddark.rewby.archivete.am/sse');

    eventSource.onopen = function (event) {
        console.log("Server connection open!");
    }

    eventSource.onerror = function (event) {
        console.log("Error with event source. Reconnect in 3 seconds...");
        eventSource.close();
        setTimeout(() => {
            eventSource = newEventSource();
        }, 3000);
    }

    eventSource.onmessage = function (event) {
        console.log('Message from server!');
        const message = JSON.parse(event.data);
        console.log('Event type:', message.type);
        switch (message.type) {
            case "CurrentStateUpdate":
                handleStateUpdate(message["content"]);
                break;
            case "Delta":
                handleDeltaUpdate(message["content"]);
                break;
            default:
                break;
        }
    };

    return eventSource;
}
function mapState(state) {
    switch (state) {
        case "PUBLIC":
            return "public";
        case "PRIVATE":
            return "private";
        case "RESTRICTED":
            return "restricted";
        default:
            return "unknown";
    }
}

function handleStateUpdate(message) {
    console.log('handleStateUpdate');

    if (!message.subreddits) {
        console.error('No subreddits in message', message);
        return;
    }

    darkSubs = 0;
    publicSubs = 0;
    privateSubs = 0;
    restrictedSubs = 0;

    participatingSubs = message.subreddits.length;

    message.subreddits.forEach(subreddit => {

        if (subsToFilter.includes(subreddit.name.toLowerCase())) {
            console.log('Ignoring sub', subreddit.name);
            return;
        }
        switch (subreddit.state) {
            case 'PUBLIC':
                publicSubs++;
                break;
            case 'PRIVATE':
                privateSubs++;
                darkSubs++;
                break;
            case 'RESTRICTED':
                restrictedSubs++;
                darkSubs++;
                break;
            default:
        }
    });

    allData = message.subreddits;
}


/*
    {"type":"Delta","content":{"name":"r/AskUK","section":"1+ million","previous_state":"RESTRICTED","state":"PUBLIC"}}
    {"type":"Delta","content":{"name":"r/EdgeTogether","section":"50k+","previous_state":"PRIVATE","state":"RESTRICTED"}}
*/
function handleDeltaUpdate(data) {
    if(!allData || allData.length === 0) {
        return;
    }
    console.log('handleDeltaUpdate event', data);

    console.log(`${data.name} is now ${data.state}`);
    if (data.state !== 'PUBLIC') {
        darkSubs++;
    } else if (data.previous_state === 'PRIVATE') {
        privateSubs--;
        darkSubs--;
    } else if (data.previous_state === 'RESTRICTED') {
        restrictedSubs--;
        darkSubs--;
    }

    if (data.state === 'PRIVATE') {
        privateSubs++;
    }

    if (data.state === 'RESTRICTED') {
        restrictedSubs++;
    }

    if (data.state === 'PUBLIC') {
        publicSubs++;
    }

    // update the subreddit in allData list
    const exists = allData.find(i => i.name === data.name);
    if (exists) {
        exists.state = data.state;
    } else {
        allData.push({
            name: data.name,
            state: data.state,
            section: data.section
        });
        participatingSubs++;
    }

    updateSubreddit(data);
}

let lastMessageTime = new Date();
let queuedMessagesPrivate = [];
let queuedMessagesPublic = [];
let message = '';


function updateSubreddit(updateData) {
    console.log('updateSubreddit: data is', updateData);

    const emoji = emojiMap[updateData.section] || "🔵";

    if (updateData.state != "PUBLIC") {
        if (!subsToFilter.includes(updateData.name.toLowerCase())) {
            queuedMessagesPrivate.push(updateData.name.trim() + " (" + updateData.section + " " + emoji + ")");
        }
    } else {
        if (!subsToFilter.includes(updateData.name.toLowerCase())) {
            queuedMessagesPublic.push(updateData.name.trim() + " (" + updateData.section + " " + emoji + ")");
        }
    }

    // if it's been 5 seconds since the last message, send the queued messages
    // this is not quite like a debounce since we will miss sending a message if
    // the last message was sent 4 seconds ago, but it's good enough for now.. it will
    // eventually send the message when the next subreddit goes dark/public
    if (new Date() - lastMessageTime > 5000) {
        if (queuedMessagesPrivate.length > 0) {
            if (message.length > 0) {
                message += "\n";
            }
            message += "Subreddits that have gone dark: " + queuedMessagesPrivate.join(", ");
        }
        if (queuedMessagesPublic.length > 0) {
            if (message.length > 0) {
                message += "\n";
            }
            message += "Subreddits that have gone public: " + queuedMessagesPublic.join(", ");
        }
        lastMessageTime = new Date();
        if (message.length > 0) {
            var percent = ((darkSubs / participatingSubs) * 100).toFixed(3);

            // for each of our twitch channels, send the message
            twitchChannels.forEach(channel => {
                client.say(channel, `${darkSubs} out of ${participatingSubs} (${percent}%) - ${message}`);
            });

            // if we have a discord webhook, send the message there too
            if (discordWebhookURL && discordWebhookURL.length > 0) {
                const data = {
                    "content": `${darkSubs} out of ${participatingSubs} (${percent}%) - ${message}`
                };
                const color = colorMap[updateData.section] || "3092271";
                const fields = [];

                if (queuedMessagesPrivate.length > 0) {
                    fields.push({
                        "name": "Subreddits that have gone dark",
                        "value": queuedMessagesPrivate.join("\n")
                    });
                }

                if (queuedMessagesPublic.length > 0) {
                    fields.push({
                        "name": "Subreddits that have gone public",
                        "value": queuedMessagesPublic.join("\n")
                    });
                }

                const data_embed = {
                    "content": null,
                    "embeds": [{
                        "title": `Darkened Subreddits: ${percent}%`,
                        "description": `Currently, ${darkSubs} out of ${participatingSubs} participating subreddits are dark.`,
                        "color": color,
                        "footer": {
                            "text": "Reddit-blackout-bot by devnull9090",
                            "icon_url": "https://i.imgur.com/tl2KzNW.gif"
                        },
                        "fields": fields
                    }]
                };

                axios.post(discordWebhookURL, data_embed);
            }
            message = '';
            queuedMessagesPublic = [];
            queuedMessagesPrivate = [];
        }
    }
}