require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FALLBACK_API_KEYS = [
    'AIzaSyCAOf1sXPctQzY9EegVoxnqTDNXPGwZk30',
    'AIzaSyBgf4gSFaMcs7RQsxxZDlrQA4P7aH_qMGg',
    'AIzaSyBup1psNibQ65VX9Eo00o11MIJIdYqDetQ',
    'AIzaSyCXQ1IO86GRDlJigeLj3FaH4jm_KXmgwSE',
    'AIzaSyBXUKRPiW2RconH9w8UH8odMuN_vwZI9xg',
    'AIzaSyBlHUVf87rvaZn37virnIgddM3Z2Svd3S8'
];

const API_KEYS = (process.env.YOUTUBE_API_KEYS || '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);

const ACTIVE_API_KEYS = API_KEYS.length > 0 ? API_KEYS : FALLBACK_API_KEYS;

//const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

let videoQueue = [];
const rooms = {};
const globalChat = [];
const roomChats = {};

function assignHost(roomId, newHostId) {
    if (!rooms[roomId]) {
        return;
    }

    rooms[roomId].hostId = newHostId || null;
    if (newHostId) {
        io.to(newHostId).emit('role', { role: 'host' });
        io.to(roomId).emit('host-changed', { hostId: newHostId });
    } else {
        io.to(roomId).emit('host-changed', { hostId: null });
    }
}

async function tryYouTubeAPI(requestFn) {
    for (const key of ACTIVE_API_KEYS) {
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
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false 
                })
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
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false 
                })
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

// List active rooms for clients to join
app.get('/api/rooms', (req, res) => {
    const data = Object.entries(rooms).map(([id, room]) => ({
        id,
        members: room.members ? room.members.size : 0,
        currentVideoId: room.currentVideoId || null,
        updatedAt: room.updatedAt || Date.now()
    }));
    res.json(data);
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
io.on('connection', (socket) => {
    const roomId = socket.handshake.query.roomId;

    if (!roomId) {
        socket.disconnect(true);
        return;
    }

    socket.join(roomId);

    if (!rooms[roomId]) {
        rooms[roomId] = {
            playlist: [],
            currentVideoId: null,
            currentVideoIndex: 0,
            isPlaying: false,
            currentTime: 0,
            updatedAt: Date.now(),
            hostId: socket.id,
            members: new Set(),
            isRepeat: false,
            isShuffle: false
        };
    }

    rooms[roomId].members.add(socket.id);
    if (!rooms[roomId].hostId) {
        rooms[roomId].hostId = socket.id;
    }

    socket.join('global-chat');

    const isHost = rooms[roomId].hostId === socket.id;
    socket.emit('role', { role: isHost ? 'host' : 'guest' });
    socket.emit('sync-state', rooms[roomId]);
    socket.emit('previous-chats', {
        scope: 'global',
        messages: globalChat
    });

    if (!roomChats[roomId]) {
        roomChats[roomId] = [];
    }
    socket.emit('previous-chats', {
        scope: 'room',
        roomId,
        messages: roomChats[roomId]
    });

    socket.on('request-sync', () => {
        socket.emit('sync-state', rooms[roomId]);
        if (rooms[roomId]?.hostId && rooms[roomId].hostId !== socket.id) {
            io.to(rooms[roomId].hostId).emit('request-sync');
        }
    });

    socket.on('sync-state', (state) => {
        if (rooms[roomId]?.hostId !== socket.id) {
            return;
        }

        if (!state || typeof state !== 'object') {
            return;
        }

        rooms[roomId] = {
            ...rooms[roomId],
            playlist: Array.isArray(state.playlist) ? state.playlist : rooms[roomId].playlist,
            currentVideoId: state.currentVideoId ?? rooms[roomId].currentVideoId,
            currentVideoIndex: Number.isInteger(state.currentVideoIndex) ? state.currentVideoIndex : rooms[roomId].currentVideoIndex,
            isPlaying: typeof state.isPlaying === 'boolean' ? state.isPlaying : rooms[roomId].isPlaying,
            currentTime: typeof state.currentTime === 'number' ? state.currentTime : rooms[roomId].currentTime,
            isRepeat: typeof state.isRepeat === 'boolean' ? state.isRepeat : rooms[roomId].isRepeat,
            isShuffle: typeof state.isShuffle === 'boolean' ? state.isShuffle : rooms[roomId].isShuffle,
            updatedAt: Date.now()
        };

        socket.to(roomId).emit('sync-state', rooms[roomId]);
    });

    socket.on('queue-add', (video) => {
        if (!video || !video.id) {
            return;
        }

        const exists = rooms[roomId].playlist.some(item => item.id === video.id);
        if (!exists) {
            rooms[roomId].playlist.push(video);
            rooms[roomId].updatedAt = Date.now();
            io.to(roomId).emit('sync-state', rooms[roomId]);
        }
    });

    socket.on('chat-message', (payload) => {
        if (!payload || typeof payload !== 'object') {
            return;
        }

        const scope = payload.scope === 'room' ? 'room' : 'global';
        const message = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text: String(payload.text || '').slice(0, 500),
            sender: String(payload.sender || 'Anonymous user').slice(0, 40),
            isHost: !!payload.isHost,
            time: Date.now(),
            roomId: scope === 'room' ? roomId : null
        };

        if (!message.text.trim()) {
            return;
        }

        if (scope === 'global') {
            globalChat.push(message);
            if (globalChat.length > 200) {
                globalChat.shift();
            }
            io.to('global-chat').emit('chat-message', { scope: 'global', message });
        } else {
            if (!roomChats[roomId]) {
                roomChats[roomId] = [];
            }
            roomChats[roomId].push(message);
            if (roomChats[roomId].length > 200) {
                roomChats[roomId].shift();
            }
            io.to(roomId).emit('chat-message', { scope: 'room', roomId, message });
        }
    });

    socket.on('disconnect', () => {
        if (!rooms[roomId]) {
            return;
        }

        rooms[roomId].members.delete(socket.id);
        if (rooms[roomId].hostId === socket.id) {
            const nextHost = rooms[roomId].members.values().next().value;
            assignHost(roomId, nextHost);
        }

        if (rooms[roomId].members.size === 0) {
            delete rooms[roomId];
            delete roomChats[roomId];
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
