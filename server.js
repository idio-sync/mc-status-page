// Required dependencies
const express = require('express');
const util = require('minecraft-server-util');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET']
}));

// Enhanced cache to store both status and first connection time
const statusCache = new Map();
const serverUptimes = new Map();
const CACHE_DURATION = 30000; // 30 seconds cache

function formatUptime(startTime) {
    const uptime = Date.now() - startTime;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let uptimeString = '';
    if (days > 0) uptimeString += `${days}d `;
    if (hours % 24 > 0) uptimeString += `${hours % 24}h `;
    if (minutes % 60 > 0) uptimeString += `${minutes % 60}m`;
    if (uptimeString === '') uptimeString = 'Just started';

    return uptimeString;
}

async function getServerStatus(host, port) {
    const cacheKey = `${host}:${port}`;
    const now = Date.now();
    
    // Return cached result if available and fresh
    if (statusCache.has(cacheKey)) {
        const cachedResult = statusCache.get(cacheKey);
        if (now - cachedResult.timestamp < CACHE_DURATION) {
            const status = cachedResult.data;
            if (status.online && serverUptimes.has(cacheKey)) {
                status.uptime = formatUptime(serverUptimes.get(cacheKey));
            }
            return status;
        }
    }
    
    try {
        // Query the Minecraft server
        const result = await util.status(host, port || 25565, {
            timeout: 5000,
            enableSRV: true // Enables SRV record lookup
        });
        
        // If server is newly online or coming back online, update uptime
        if (!serverUptimes.has(cacheKey)) {
            serverUptimes.set(cacheKey, now);
        }

        const status = {
            online: true,
            players: {
                online: result.players.online,
                max: result.players.max
            },
            motd: result.motd.clean, // Clean MOTD without formatting codes
            version: result.version.name,
            latency: result.roundTripLatency,
            favicon: result.favicon,
            timestamp: now,
            uptime: formatUptime(serverUptimes.get(cacheKey))
        };
        
        // Cache the result
        statusCache.set(cacheKey, {
            timestamp: now,
            data: status
        });
        
        return status;
    } catch (error) {
        console.error(`Error querying ${host}:${port}:`, error.message);
        
        // Clear uptime if server goes offline
        serverUptimes.delete(cacheKey);
        
        const offlineStatus = {
            online: false,
            players: { online: 0, max: 0 },
            motd: 'Server is offline',
            version: 'Unknown',
            latency: -1,
            timestamp: now,
            uptime: null
        };
        
        // Cache the offline status (but for a shorter duration)
        statusCache.set(cacheKey, {
            timestamp: now,
            data: offlineStatus
        });
        
        return offlineStatus;
    }
}

// Main status endpoint
app.get('/api/status', async (req, res) => {
    const { server, port } = req.query;
    
    if (!server) {
        return res.status(400).json({
            error: 'Server hostname is required'
        });
    }
    
    try {
        const status = await getServerStatus(server, parseInt(port) || 25565);
        res.json(status);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to query server status',
            message: error.message
        });
    }
});

// Batch status endpoint for multiple servers
app.get('/api/batch-status', async (req, res) => {
    const servers = req.query.servers;
    
    if (!servers) {
        return res.status(400).json({
            error: 'Servers parameter is required (comma-separated list)'
        });
    }
    
    const serverList = servers.split(',');
    const results = {};
    
    await Promise.all(
        serverList.map(async (server) => {
            const [host, port] = server.split(':');
            results[server] = await getServerStatus(host, parseInt(port) || 25565);
        })
    );
    
    res.json(results);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Start the server
app.listen(port, () => {
    console.log(`Minecraft status backend listening on port ${port}`);
});