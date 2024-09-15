require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');
const { Client, Intents, MessageEmbed } = require('discord.js');

// Data file
const dataFile = 'channelMap.json';

// Function to load channel data
function loadChannelMap() {
    if (fs.existsSync(dataFile)) {
        const rawData = fs.readFileSync(dataFile, 'utf8');
        return JSON.parse(rawData);
    }
    return {};
}

// Function to save channel data
function saveChannelMap() {
    fs.writeFileSync(dataFile, JSON.stringify(channelMap, null, 2));
}

// Initialize Discord Client with necessary intents
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

// Initialize YouTube API
const youtube = google.youtube('v3');

// Data set
const channelMap = loadChannelMap();
const lastCheckedTime = {};


// Set interval for checking new videos (15 minutes)
const CHECK_INTERVAL = 1000 * 60 * 60 * 2;

// Mapping YouTube channels to Discord channels and tracking last notified video
const lastNotifiedVideoIds = {};

// Login to Discord with your bot's token
client.login(process.env.DISCORD_TOKEN);


// Bot ready event
client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    checkNewVideos();
    setInterval(checkNewVideos, CHECK_INTERVAL);
});

// Command handling
client.on('messageCreate', async message => {
    console.log('Checking new videos...');
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
        case 'add':
            if (args.length < 2) return message.reply('Usage: !add [YouTube Channel ID] [Discord Channel ID]');
            channelMap[args[0]] = args[1];
            lastNotifiedVideoIds[args[0]] = '';
            message.reply(`Added YouTube Channel ${args[0]} to Discord Channel ${args[1]}`);
            saveChannelMap();
            break;
        case 'remove':
            if (args.length < 1) return message.reply('Usage: !remove [YouTube Channel ID]');
            delete channelMap[args[0]];
            delete lastNotifiedVideoIds[args[0]];
            message.reply(`Removed YouTube Channel ${args[0]}`);
            saveChannelMap();
            break;
        case 'testcheck':
            console.log('Manually triggered video check');
            message.channel.send('Test check executed.'); // Send a basic response back
            await checkNewVideos();
            break;
        case 'checkrecent':
            console.log('Checking for recent videos...');
            await checkRecentVideos();
            break;
    }
});
let backoffInterval = CHECK_INTERVAL;

async function checkNewVideos() {
    const currentTime = new Date().getTime();
    const oneDayAgo = new Date(currentTime - 24 * 60 * 60 * 1000); // 24 hours in milliseconds
    const oneDayAgoISOString = oneDayAgo.toISOString();

    try {
        for (const [ytChannelId, discordChannelId] of Object.entries(channelMap)) {
            if (!lastCheckedTime[ytChannelId] || currentTime - lastCheckedTime[ytChannelId] > CHECK_INTERVAL) {
                const response = await youtube.search.list({
                    key: process.env.YOUTUBE_API_KEY,
                    channelId: ytChannelId,
                    order: 'date',
                    part: 'snippet',
                    type: 'video',
                    publishedAfter: oneDayAgoISOString, // Only get videos from the last 24 hours
                    maxResults: 1
                });

                let videoId = null;
                let videoTitle = null;
                let videoTimeStamp = null;
                let videoThumbnail = null;
                let channelName = null;

                if (response.data.items.length > 0) {
                    const video = response.data.items[0];
                    videoId = video.id.videoId; // Correctly assign videoId
                    videoTitle = video.snippet.title;
                    videoTimeStamp = video.snippet.publishedAt;
                    videoThumbnail = video.snippet.thumbnails.high.url;
                    channelName = video.snippet.channelTitle;
                    lastCheckedTime[ytChannelId] = currentTime;
                }

                if (videoId && lastNotifiedVideoIds[ytChannelId] !== videoId) {
                    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

                    const messageEmbed = new MessageEmbed()
                        .setTitle(videoTitle)
                        .setURL(videoUrl)
                        .setDescription(`**${channelName}** just uploaded a new video!\n\nWatch it here: ${videoUrl}`)
                        .setTimestamp(videoTimeStamp)
                        .setThumbnail(videoThumbnail);

                    if (messageEmbed.title || messageEmbed.description) {
                        const channel = client.channels.cache.get(discordChannelId);
                        if (channel) {
                            channel.send({ embeds: [messageEmbed] });
                        } else {
                            console.log(`Channel not found for ID: ${discordChannelId}`);
                        }
                    } else {
                        console.log("Error: Message content is empty or undefined.");
                    }

                    lastNotifiedVideoIds[ytChannelId] = videoId;
                }
            }
        }
    } catch (error) {
        if (error.code === 403) {
            console.error('Quota exceeded. Please check your YouTube API quota.');
            // Implement backoff strategy here if needed
        } else {
            console.error('Error in checkNewVideos:', error);
        }
    }
}



// Function to check for videos uploaded within the last 2 hours
async function checkRecentVideos() {
    const twoHoursAgo = new Date(new Date().getTime() - 2 * 60 * 60 * 1000); // 2 hours in milliseconds
    const twoHoursAgoISOString = twoHoursAgo.toISOString();

    try {
        for (const [ytChannelId, discordChannelId] of Object.entries(channelMap)) {
            const response = await youtube.search.list({
                key: process.env.YOUTUBE_API_KEY,
                channelId: ytChannelId,
                part: 'snippet',
                type: 'video',
                publishedAfter: twoHoursAgoISOString,
                maxResults: 5
            });

            response.data.items.forEach(video => {
                const videoId = video.id.videoId;
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                const channelName = video.snippet.channelTitle;
                const messageEmbed = new MessageEmbed()
                    .setTitle(video.snippet.title)
                    .setURL(videoUrl)
                    .setDescription(`**${channelName}** uploaded a new video!\n\nWatch it here: ${videoUrl}`)
                    .setTimestamp(video.snippet.publishedAt)
                    .setThumbnail(video.snippet.thumbnails.high.url);

                client.channels.cache.get(discordChannelId).send({ embeds: [messageEmbed] });
            });
        }
    } 
    catch (error) {
        if (error.code === 403) {
            console.error('Quota exceeded. Please check your YouTube API quota.');
            backoffInterval *= 2; // Double the interval
            setTimeout(() => backoffInterval = CHECK_INTERVAL, 2 * 60 * 60 * 1000); // Reset after 2 hours
        } else {
        console.error('Error in checkRecentVideos:', error);
        }
    }
}

