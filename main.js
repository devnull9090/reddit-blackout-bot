require('dotenv').config();
const tmi = require('tmi.js');
const io = require('socket.io-client');
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

// Twitch chat events
client.on('message', (channel, tags, message, self) => {
    // Ignore echoed messages.
    if (self) return;

    //console.log('message is', message);

    if (message.toLowerCase() === '!dark') {
        client.whisper(channel, `@${tags.username}, there are ${dark} subreddits that have gone dark out of ${amount} (${((dark / amount) * 100).toFixed(3)}%)`);
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

        let group = '';
        Object.keys(allData).forEach(function (key) {
            if (key === '') return;
            if (!allData || !allData[key]) return;
            const exists = allData[key].find(i => i.name.toLowerCase() === sub.toLowerCase());
            if (exists && !group) {
                group = key.trim();
            }
        });
        if (group) {
            const emoji = emojiMap[group.slice(-1) == ":" ? group.slice(0, -1) : group] || "🔵";
            client.say(channel, `@${tags.username}, ${sub} is ${allData[group].find(i => i.name.toLowerCase() === sub.toLowerCase()).status} (${group} ${emoji})`);
        } else {
            client.say(channel, `@${tags.username}, ${sub} is not in the list`);
        }
    }
});

console.log('Using socket url', process.env.SOCKET_URL);
const socket = io(process.env.SOCKET_URL);

let amount = 0;
let dark = 0;

socket.on("updatenew", (data) => {
    console.log('updatenew socket event');
    if (data.status != "public") {
        console.log(data.name + " HAS GONE, SO LONG");
        dark++;
    } else {
        console.log(data.name + " has returned? :/");
        dark--;
    }
    updateSubreddit(data, true);
});

socket.on("subreddits", (data) => {
    console.log('subreddits socket event');
    allData = data;
    fillSubredditsList(data);
});

socket.on("subreddits-refreshed", (data) => {
    console.log('subreddits-refreshed socket event');
    allData = data;
    fillSubredditsList(data);
});


// every 10 seconds, send a ping to the server to keep the socket alive
// this may not be needed but it's here just in case cuz i'm paranoid
setInterval(() => {
    socket.emit("ping");
}, 10000);

// not alerting for these subs as they've been spamming
// back and forth between private and public
const subsToFilter = [
    "r/bi_irl",
    "r/suddenlybi",
    "r/ennnnnnnnnnnnbbbbbby"
];

function fillSubredditsList(data) {
    console.log('hit fillSubredditsList');
    dark = 0;
    amount = 0;

    for (var section in data) {
        for (var subreddit of data[section]) {
            amount++;
            if (subreddit.status != "public") {
                dark++;
            }
        }
    }
}

let lastMessageTime = new Date();
let queuedMessagesPrivate = [];
let queuedMessagesPublic = [];
let message = '';


function updateSubreddit(data, _new = false) {
    console.log('updateSubreddit: data is', data);

    let group = '';
    Object.keys(allData).forEach(function (key) {
        if (key === '') return;
        if (!allData || !allData[key]) return;
        const exists = allData[key].find(i => i.name === data.name);

        if (exists && !group) {
            group = key.trim();
            // update the status of the subreddit in allData list
            exists.status = data.status;
        }
    });
    console.log('updateSubreddit: group is', group);

    // if the last character in group is ":" then remove it
    if (group.slice(-1) == ":") {
        group = group.slice(0, -1);
    }

    const emoji = emojiMap[group] || "🔵";

    if (data.status != "public") {
        if (_new && !subsToFilter.includes(data.name.toLowerCase())) {
            queuedMessagesPrivate.push(data.name.trim() + " (" + group.trim() + " " + emoji + ")");
        }
    } else {
        if (_new && !subsToFilter.includes(data.name.toLowerCase())) {
            queuedMessagesPublic.push(data.name.trim() + " (" + group.trim() + " " + emoji + ")");
        }
    }

    // if it's been 3 seconds since the last message, send the queued messages
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
            var percent = ((dark / amount) * 100).toFixed(3);

            // for each of our twitch channels, send the message
            twitchChannels.forEach(channel => {
                client.say(channel, `${dark} out of ${amount} (${percent}%) - ${message}`);
            });

            // if we have a discord webhook, send the message there too
            if (discordWebhookURL && discordWebhookURL.length > 0) {
                const data = {
                    "content": `${dark} out of ${amount} (${percent}%) - ${message}`
                };
                const color = colorMap[group] || "3092271";
                const data_embed =
                {
                    "content": null,
                    "embeds": [{
                        "title": `Darkened Subreddits: ${percent}%`,
                        "description": `Currently, ${dark} out of ${amount} participating subreddits are private.`,
                        "color": color,
                        "footer": {
                            "text": "Bot by devnull9090"
                        },
                        "fields": [
                            {
                                "name": "Subreddits that have gone dark",
                                "value": queuedMessagesPrivate.join("\n")
                            },
                            {
                                "name": "Subreddits that have gone public",
                                "value": queuedMessagesPublic.join("\n")
                            }
                        ]
                    }]
                }


                axios.post(discordWebhookURL, data_embed);
            }
            message = '';
            queuedMessagesPublic = [];
            queuedMessagesPrivate = [];
        }
    }
}