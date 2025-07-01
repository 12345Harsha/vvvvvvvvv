require('dotenv').config();
const WebSocket = require('ws');
const { StreamAction } = require('piopiy');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

console.log('🚀 WebSocket relay server starting...');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SERVER_PORT = process.env.PORT || 8766;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error('❌ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env');
  process.exit(1);
}

let telecmiSocket = null;
let vapiSocket = null;

// ✅ Get WebSocket call URL from Vapi
async function getVapiWebSocketUrl() {
  try {
    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID, // ✅ FIXED: moved out of "assistant"
        transport: {
          provider: 'vapi.websocket',
          audioFormat: {
            format: 'pcm_s16le',
            container: 'raw',
            sampleRate: 16000
          }
        }
      })
    });

    const data = await response.json();

    if (!data?.transport?.websocketCallUrl) {
      console.error('❌ Failed to get websocketCallUrl from Vapi:', data);
      return null;
    }

    console.log('🔗 Received Vapi websocketCallUrl');
    return data.transport.websocketCallUrl;
  } catch (err) {
    console.error('❌ Error creating Vapi call:', err);
    return null;
  }
}

// ✅ Start WebSocket Server
const server = new WebSocket.Server({ port: SERVER_PORT });

server.on('connection', async (ws) => {
  console.log('✅ TeleCMI (or local client) connected');
  telecmiSocket = ws;

  // Get Vapi WebSocket URL dynamically
  const VAPI_WS_URL = await getVapiWebSocketUrl();
  if (!VAPI_WS_URL) {
    ws.send('❌ Could not get Vapi WebSocket URL');
    ws.close();
    return;
  }

  vapiSocket = new WebSocket(VAPI_WS_URL, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`
    }
  });

  // Echo and relay logic
  ws.on('message', (msg) => {
    if (typeof msg === 'string' || msg.toString().startsWith('Hello')) {
      ws.send(`Echo: ${msg.toString()}`);
      console.log('🔁 Echoing back:', msg.toString());
    } else if (vapiSocket && vapiSocket.readyState === WebSocket.OPEN) {
      vapiSocket.send(msg);
      console.log('📤 Audio sent to Vapi');
    } else {
      console.warn('⚠️ Vapi socket not available');
    }
  });

  // Vapi socket handlers
  vapiSocket.on('open', () => {
    console.log('🟢 Connected to Vapi');
  });

  vapiSocket.on('message', (msg) => {
    console.log('📥 Received audio from Vapi');
    // Relay audio from Vapi to TeleCMI
    if (telecmiSocket && telecmiSocket.readyState === WebSocket.OPEN) {
      telecmiSocket.send(msg);
      console.log('📤 Audio sent to TeleCMI');
    }
  });

  vapiSocket.on('close', () => {
    console.log('🔴 Vapi connection closed');
  });

  vapiSocket.on('error', (err) => {
    console.error('❌ Vapi socket error:', err.message || err);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${SERVER_PORT} already in use`);
  } else {
    console.error('❌ WebSocket server error:', err);
  }
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (telecmiSocket) telecmiSocket.close();
  if (vapiSocket) vapiSocket.close();
  server.close(() => {
    console.log('✅ Server closed');
  });
});

console.log(`🚀 WebSocket relay listening on ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ Vapi');
console.log('⏳ Waiting for connection...');