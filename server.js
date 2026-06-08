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

function parseSize(size) {
    if (size === null || size === undefined) return null;

    // Crafty returns `mem` as a raw byte count (number), but `world_size`
    // as a human-readable string like "15.2GB". Handle both.
    if (typeof size === 'number') {
        return size > 0 ? size : null;
    }

    const match = String(size).match(/^([\d.]+)\s*([KMGT]?B)$/i);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();

    switch(unit) {
        case 'TB': return value * 1024 * 1024 * 1024 * 1024;
        case 'GB': return value * 1024 * 1024 * 1024;
        case 'MB': return value * 1024 * 1024;
        case 'KB': return value * 1024;
        case 'B': return value;
        default: return null;
    }
}

async function getCraftyStatus(uuid) {
    try {
        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        const statsUrl = `${process.env.CRAFTY_API_URL}/api/v2/servers/${uuid}/stats`;
        const statsResponse = await fetch(statsUrl, {
            headers: {
                'Authorization': `Bearer ${process.env.CRAFTY_API_KEY}`,
                'Accept': 'application/json'
            },
            agent: agent
        });
        
        if (!statsResponse.ok) {
            throw new Error(`Crafty API responded with ${statsResponse.status}`);
        }

        const statsData = await statsResponse.json();
        const stats = statsData.data;

        // Parse memory from the string (e.g., "1.6GB")
        const memoryUsed = parseSize(stats.mem);
        
        // Get max memory from execution_command
        const maxMemoryMatch = stats.server_id.execution_command.match(/-Xmx(\d+)([MG])/);
        let maxMemory = null;
        if (maxMemoryMatch) {
            const value = parseInt(maxMemoryMatch[1]);
            const unit = maxMemoryMatch[2];
            maxMemory = unit === 'G' ? 
                value * 1024 * 1024 * 1024 : 
                value * 1024 * 1024;
        }

        const worldSize = parseSize(stats.world_size);

        return {
            uptime: stats.started,  // Return the raw timestamp for frontend formatting
            cpu: stats.cpu || null,
            memory: {
                used: memoryUsed,
                max: maxMemory
            },
            worldSize: worldSize,
            autoStart: stats.server_id?.auto_start || false,
            autoStop: false,
            // Managed-state flags + metadata straight from Crafty
            running: stats.running || false,
            crashed: stats.crashed || false,
            waitingStart: stats.waiting_start || false,
            updating: stats.updating || false,
            type: stats.server_id?.type || null,        // e.g. "minecraft-java"
            icon: stats.icon || null                    // base64 PNG, or null
        };
    } catch (error) {
        console.error('Failed to fetch Crafty status:', error);
        return {
            uptime: null,
            cpu: null,
            memory: { used: null, max: null },
            worldSize: null,
            autoStart: false,
            autoStop: false,
            running: false,
            crashed: false,
            waitingStart: false,
            updating: false,
            type: null,
            icon: null
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
    
    // Query the Minecraft ping and the Crafty API independently, in parallel.
    // getCraftyStatus never rejects (it catches internally), so even a server
    // that fails the ping still returns Crafty's managed state
    // (running / crashed / stopped) for the status badge.
    const craftyPromise = craftyId ? getCraftyStatus(craftyId) : Promise.resolve(null);

    const pingPromise = util.status(host, port || 25565, {
        timeout: 5000,
        enableSRV: true
    }).then(mcData => {
        // Treat Velocity/proxy responses as "not a real server" for the ping.
        if (mcData.version.name.includes('Velocity') ||
            (mcData.motd.clean && mcData.motd.clean.includes('Velocity'))) {
            throw new Error('Proxy server detected');
        }
        return mcData;
    });

    const [craftyData, pingResult] = await Promise.all([
        craftyPromise,
        // Reflect the ping outcome instead of letting it reject the whole join,
        // so we always still have craftyData to attach.
        pingPromise.then(
            mcData => ({ ok: true, mcData }),
            error => ({ ok: false, error })
        )
    ]);

    let status;
    if (pingResult.ok) {
        const mcData = pingResult.mcData;
        status = {
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
    } else {
        const error = pingResult.error;
        console.error(`Error querying ${host}:${port}:`, error.message);
        const proxyOnly = error.message === 'Proxy server detected';
        status = {
            online: false,
            // Velocity is up but the real backend is down: keep the proxy-only
            // indication and never let Crafty's running flag flip it to Online.
            proxyOnly: proxyOnly,
            players: { online: 0, max: 0 },
            version: 'Unknown',
            motd: proxyOnly ? 'Offline (Proxy Only)' : 'Server is offline',
            uptime: null,
            latency: -1,
            timestamp: now,
            craftyStats: craftyData
        };
    }

    statusCache.set(cacheKey, {
        timestamp: now,
        data: status
    });

    return status;
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
