// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');

// --- Configuration ---
const PORT = 3000;
const SYMBOL = 'SOLUSDTM'; // The futures contract symbol
const INTERVAL = '1min';    // The candlestick granularity

// KuCoin Futures API Endpoints
const KUCOIN_API_BASE = 'https://api-futures.kucoin.com';
const KLINE_URL = `${KUCOIN_API_BASE}/api/v1/kline/query`; // Historical data endpoint

// --- Initialization ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Set(); // Stores connected frontend clients
let kucoinWs = null;        // The connection to KuCoin
let kucoinWsUrl = null;     // Dynamically fetched KuCoin WS URL

// --- Express Middleware & Routes ---

// Serve static files from the React app build folder
app.use(express.static(path.join(__dirname, 'client', 'build')));

// Fallback to serve index.html for all other requests (essential for React routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'client', 'build', 'index.html'));
});

// --- WebSocket Broker Functions ---

/**
 * Sends a message to all currently connected frontend clients.
 * @param {object} data - The object to send (will be JSON stringified).
 */
function broadcast(data) {
    const message = JSON.stringify(data);
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

/**
 * Connects to the KuCoin public Futures WebSocket endpoint.
 */
async function connectToKuCoin() {
    // 1. Fetch the actual WebSocket endpoint and token using REST API
    try {
        const response = await axios.post(`${KUCOIN_API_BASE}/api/v1/bullet-public`);
        
        const endpoint = response.data.data.instanceServers[0].endpoint;
        const token = response.data.data.token;
        // Construct the full WebSocket URL
        kucoinWsUrl = `${endpoint}?token=${token}`; 

        console.log('📡 KuCoin WS Endpoint fetched.');
    } catch (e) {
        console.error('Failed to fetch KuCoin endpoint, retrying in 10s:', e.message);
        setTimeout(connectToKuCoin, 10000);
        return; 
    }
    
    // 2. Open the WebSocket connection
    kucoinWs = new WebSocket(kucoinWsUrl);

    kucoinWs.on('open', () => {
        console.log('✅ Connected to KuCoin Futures WebSocket.');
        
        // 3. Subscribe to the real-time candlestick feed
        const subscription = {
            id: Date.now().toString(),
            type: 'subscribe',
            topic: `/contractMarket/limitCandle:${SYMBOL}_1min`,
            subject: `candle.stick`,
            privateChannel: false,
            response: true,
        };
        // console.log('subscription=', subscription);

        kucoinWs.send(JSON.stringify(subscription));

        // Set up a regular ping to keep the connection alive (KuCoin requires this)
        setInterval(() => {
            if (kucoinWs && kucoinWs.readyState === WebSocket.OPEN) {
                kucoinWs.send(JSON.stringify({ id: Date.now().toString(), type: 'ping' }));
            }
        }, 25000); 
    });

    kucoinWs.on('message', (data) => {
        const msg = JSON.parse(data);
        // console.log('msg=', msg);
        
        // Process real-time candle updates
        if (msg.type === 'message' && msg.subject && msg.subject.includes('candle.stick')) {
            const kucoinCandle = msg.data;
            // console.log('kucoinCandle:', kucoinCandle);
            
            // CRITICAL TRANSFORMATION: Format real-time candle (MS to S)
            const realTimeCandle = {
                // KuCoin timestamp (ts) is in milliseconds. lightweight-charts needs seconds.
                time: parseInt(kucoinCandle.candles[0]) / 1000, 
                open: parseFloat(kucoinCandle.candles[1]),
                close: parseFloat(kucoinCandle.candles[2]),
                high: parseFloat(kucoinCandle.candles[3]),
                low: parseFloat(kucoinCandle.candles[4]),
            };
            
            console.log('msg.topic:', msg.topic);
            console.log('realTimeCandle:', realTimeCandle);

            // Broadcast the formatted data to all frontend clients
            broadcast({ 
                topic: msg.topic, 
                data: realTimeCandle 
            });
        }
    });

    kucoinWs.on('close', (code, reason) => {
        console.warn(`🛑 KuCoin WS closed. Code: ${code}. Attempting reconnect in 5s...`);
        kucoinWs = null;
        setTimeout(connectToKuCoin, 5000); 
    });

    kucoinWs.on('error', (error) => {
        console.error('❌ KuCoin WS error:', error.message);
        kucoinWs.close();
    });
}

// Start the connection to the external KuCoin feed immediately
connectToKuCoin();

// --- Frontend Client WebSocket Handling ---

wss.on('connection', (clientWs) => {
    clients.add(clientWs);
    console.log(`Client connected. Total clients: ${clients.size}`);

    clientWs.on('message', async (message) => {
        const msg = JSON.parse(message);
        
        // Handle Request for Historical Data (via REST API)
        if (msg.topic === 'request_history') {
            const { symbol, interval } = msg;

            try {
                console.log(`Fetching historical data for ${symbol}:${interval}...`);
                
                // Fetch historical data from KuCoin REST API
                const response = await axios.get(KLINE_URL, {
                    params: {
                        symbol: symbol,
                        granularity: interval,
                    }
                });
                const kucoinData = response.data.data;
                
                // FIX: Check if KuCoin actually returned data before processing
                if (!Array.isArray(kucoinData) || kucoinData.length === 0) {
                     console.warn('KuCoin API returned no historical data.');
                     clientWs.send(JSON.stringify({ topic: 'history_data', data: [] }));
                     return;
                }
                
                // CRITICAL TRANSFORMATION: Format historical data (MS to S)
                const formattedCandles = kucoinData.map(d => ({
                    // KuCoin uses milliseconds (d[0]). lightweight-charts needs seconds.
                    time: parseInt(d[0]) / 1000, 
                    open: parseFloat(d[1]),
                    close: parseFloat(d[2]),
                    high: parseFloat(d[3]),
                    low: parseFloat(d[4]),
                }));

                // CRITICAL: KuCoin sends newest first, chart expects oldest first.
                const finalCandles = formattedCandles.reverse(); // THIS REVERSE IS NON-NEGOTIABLE

                // --- TEMPORARY DEBUG LOGS ---
                if (finalCandles.length > 0) {
                    console.log('--- Historical Data Order Check ---');
                    console.log(`First Candle Time: ${finalCandles[0].time}`); // Should be the oldest time
                    console.log(`Last Candle Time: ${finalCandles[finalCandles.length - 1].time}`); // Should be the newest time
                    console.log('-----------------------------------');
}
                clientWs.send(JSON.stringify({ 
                    topic: 'history_data', 
                    data: finalCandles
                }));
                
                console.log(`Sent ${formattedCandles.length} historical candles.`);

            } catch (error) {
                console.error('Error fetching historical data:', error.message);
                clientWs.send(JSON.stringify({ topic: 'error', message: 'Failed to fetch history.' }));
            }
        }
    });

    clientWs.on('close', () => {
        clients.delete(clientWs);
        console.log(`Client disconnected. Total clients: ${clients.size}`);
    });
});

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});