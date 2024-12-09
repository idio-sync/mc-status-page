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
        // Create agent that ignores SSL certificate issues
        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        const response = await fetch(`${process.env.CRAFTY_API_URL}/api/v2/servers/server_detail?id=${uuid}`, {
            headers: {
                'Authorization': `Bearer ${process.env.CRAFTY_API_KEY}`,
                'Accept': 'application/json'
            },
            agent: agent  // Use the agent that ignores SSL validation
        });
        
        if (!response.ok) {
            throw new Error(`Crafty API responded with ${response.status}`);
        }

        const data = await response.json();
        return {
            uptime: data.server.stats.uptime || null,
            cpu: data.server.stats.cpu || null,
            memory: {
                used: data.server.stats.memory_used || null,
                max: data.server.stats.memory_max || null
            },
            worldSize: data.server.stats.world_size || null,
            autoStart: data.server.auto_start || false,
            autoStop: data.server.auto_stop || false
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
