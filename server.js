const express = require('express');
const util = require('minecraft-server-util');
const cors = require('cors');
const fetch = require('node-fetch');
const https = require('https');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const statusCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds cache

async function getCraftyStatus(uuid) {
    try {
        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        // Try getting the server details first
        const url = `${process.env.CRAFTY_API_URL}/api/v2/servers/${uuid}`;
        console.log('Attempting to fetch Crafty stats from:', url);

        const statsResponse = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${process.env.CRAFTY_API_KEY}`,
                'Accept': 'application/json'
            },
            agent: agent
        });
        
        if (!statsResponse.ok) {
            console.log('Response status:', statsResponse.status);
            const text = await statsResponse.text();
            console.log('Response body:', text);
            throw new Error(`Crafty API responded with ${statsResponse.status}`);
        }

        const statsData = await statsResponse.json();
        console.log('Received stats data:', statsData);

        return {
            uptime: statsData.data?.started || null,
            cpu: statsData.data?.cpu || null,
            memory: {
                used: statsData.data?.mem || null,
                max: statsData.data?.mem_percent ? (statsData.data?.mem / (statsData.data?.mem_percent / 100)) : null
            },
            worldSize: statsData.data?.world_size || null,
            autoStart: statsData.data?.auto_start || false,
            autoStop: false
        };
    } catch (error) {
        console.error('Failed to fetch Crafty status:', error);
        return { 
            uptime: null,
            cpu: null,
            memory: { used: null, max: null },
            worldSize: null,
            autoStart: false,
            autoStop: false
        };
    }
}

async function getServerStatus(host, port, craftyId) {
    const cacheKey = `${host}:${port}`;
    const now = Date.now();
    
    if (statusCache.has(cacheKey)) {
        const cachedResult = statusCache.get(cacheKey);
        if (now - cachedResult.timestamp < CACHE_DURATION) {
            return cachedResult.data;
        }
    }
    
    try {
        // Query the Minecraft server
        const mcData = await util.status(host, port || 25565, {
            timeout: 5000,
            enableSRV: true
        });

        // Check if version contains "Velocity"
        if (mcData.version.name.includes('Velocity') || 
            (mcData.motd.clean && mcData.motd.clean.includes('Velocity'))) {
            throw new Error('Proxy server detected');
        }

        // Get Crafty status if ID is provided
        const craftyData = craftyId ? await getCraftyStatus(craftyId) : null;

        const status = {
            online: true,
            players: {
                online: mcData.players.online,
                max: mcData.players.max
            },
            version: mcData.version.name,
            motd: mcData.motd.clean,
            latency: mcData.roundTripLatency,
            favicon: mcData.favicon,
            timestamp: now,
            craftyStats: craftyData
        };
        
        statusCache.set(cacheKey, {
            timestamp: now,
            data: status
        });
        
        return status;
    } catch (error) {
        console.error(`Error querying ${host}:${port}:`, error.message);
        
        const offlineStatus = {
            online: false,
            players: { online: 0, max: 0 },
            version: 'Unknown',
            motd: error.message === 'Proxy server detected' ? 
                  'Offline (Proxy Only)' : 'Server is offline',
            uptime: null,
            latency: -1,
            timestamp: now,
            craftyStats: null
        };
        
        statusCache.set(cacheKey, {
            timestamp: now,
            data: offlineStatus
        });
        
        return offlineStatus;
    }
}

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET']
}));

app.get('/api/status', async (req, res) => {
    const { server, port, craftyId } = req.query;
    
    if (!server) {
        return res.status(400).json({
            error: 'Server hostname is required'
        });
    }
    
    try {
        const status = await getServerStatus(server, parseInt(port) || 25565, craftyId);
        res.json(status);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to query server status',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Serve static files from the 'public' directory
app.use(express.static('public'));

app.listen(port, () => {
    console.log(`Minecraft status backend listening on port ${port}`);
});
