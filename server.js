require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEYS = [
    'AIzaSyCAOf1sXPctQzY9EegVoxnqTDNXPGwZk30',
    'AIzaSyBgf4gSFaMcs7RQsxxZDlrQA4P7aH_qMGg',
    'AIzaSyBup1psNibQ65VX9Eo00o11MIJIdYqDetQ',
    'AIzaSyCXQ1IO86GRDlJigeLj3FaH4jm_KXmgwSE',
    'AIzaSyBXUKRPiW2RconH9w8UH8odMuN_vwZI9xg',
    'AIzaSyBlHUVf87rvaZn37virnIgddM3Z2Svd3S8'
];

//const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

let videoQueue = [];

async function tryYouTubeAPI(requestFn) {
    for (const key of API_KEYS) {
        try {
            const result = await requestFn(key);
            return result; // Return on first success
        } catch (err) {
            console.warn(`API key failed: ${key}, trying next...`);
        }
    }
    throw new Error('All YouTube API keys failed.');
}

// Endpoint to add to queue
app.post('/api/queue', (req, res) => {
    const { video } = req.body;
    videoQueue.push(video);
    res.json({ success: true, queue: videoQueue });
});

// Endpoint to get queue
app.get('/api/queue', (req, res) => {
    res.json(videoQueue);
});

// Endpoint to clear queue
app.delete('/api/queue', (req, res) => {
    videoQueue = [];
    res.json({ success: true });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Search YouTube endpoint
app.get('/api/search', async (req, res) => {
    try {
        const { query, maxResults = 10 } = req.query;
        
        if (!query) {
            return res.status(400).json({ error: 'Search query is required' });
        }

        const response = await tryYouTubeAPI((key) =>
            axios.get('https://www.googleapis.com/youtube/v3/search', {
                params: {
                    part: 'snippet',
                    q: query,
                    type: 'video',
                    maxResults,
                    key
                }
            })
        );

        const videos = response.data.items.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.high.url,
            channelTitle: item.snippet.channelTitle
        }));

        res.json(videos);
    } catch (error) {
        console.error('YouTube API error:', error);
        res.status(500).json({ error: 'Failed to fetch videos' });
    }
});

// Get video details endpoint
app.get('/api/video/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const response = await tryYouTubeAPI((key) =>
            axios.get('https://www.googleapis.com/youtube/v3/videos', {
                params: {
                    part: 'snippet,contentDetails',
                    id,
                    key
                }
            })
        );

        if (response.data.items.length === 0) {
            return res.status(404).json({ error: 'Video not found' });
        }

        const video = response.data.items[0];
        const duration = parseYouTubeDuration(video.contentDetails.duration);

        res.json({
            id: video.id,
            title: video.snippet.title,
            thumbnail: video.snippet.thumbnails.high.url,
            channelTitle: video.snippet.channelTitle,
            duration
        });
    } catch (error) {
        console.error('YouTube API error:', error);
        res.status(500).json({ error: 'Failed to fetch video details' });
    }
});

// Helper function to parse YouTube duration
function parseYouTubeDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    
    return {
        totalSeconds: hours * 3600 + minutes * 60 + seconds,
        formatted: `${hours > 0 ? hours + ':' : ''}${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    };
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});