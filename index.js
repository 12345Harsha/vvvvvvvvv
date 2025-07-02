require('dotenv').config();
const WebSocket = require('ws');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { spawn, execSync } = require('child_process');

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SERVER_PORT = process.env.PORT || 8766;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error('❌ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env');
  process.exit(1);
}

// 🔍 Check if SoX is installed
try {
  execSync('sox --version', { stdio: 'ignore' });
} catch {
  console.error('❌ SoX is not installed. Please install SoX to enable downsampling.');
  process.exit(1);
}

let telecmiSocket = null;
let vapiSocket = null;

async function getVapiWebSocketUrl() {
  try {
    const response = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId: VAPI_ASSISTANT_ID,
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

    console.log('✅ Vapi websocketCallUrl received');
    return data.transport.websocketCallUrl;
  } catch (err) {
    console.error('❌ Error creating Vapi call:', err);
    return null;
  }
}

const server = new WebSocket.Server({ port: SERVER_PORT });

server.on('connection', async (ws) => {
  console.log('✅ TeleCMI connected');
  telecmiSocket = ws;

  const VAPI_WS_URL = await getVapiWebSocketUrl();
  if (!VAPI_WS_URL) return;

  vapiSocket = new WebSocket(VAPI_WS_URL, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`
    }
  });

  vapiSocket.on('open', () => {
    console.log('🟢 Connected to Vapi');
  });

  vapiSocket.on('message', (msg) => {
    if (!Buffer.isBuffer(msg)) return;

    // 🔽 Downsample using SoX from 16000 to 8000 Hz
    const sox = spawn('sox', [
      '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', '16000', '-', // input from stdin
      '-t', 'raw', '-b', '16', '-e', 'signed-integer', '-c', '1', '-r', '8000', '-'   // output to stdout
    ]);

    let downsampledChunks = [];

    sox.stdout.on('data', (chunk) => downsampledChunks.push(chunk));

    sox.on('close', () => {
      const finalAudio = Buffer.concat(downsampledChunks);
      if (telecmiSocket?.readyState === WebSocket.OPEN) {
        telecmiSocket.send(finalAudio);
        console.log('📥 Received from Vapi → 📤 Sent to TeleCMI (8kHz)');
      }
    });

    sox.stdin.write(msg);
    sox.stdin.end();
  });

  ws.on('message', (msg) => {
    if (vapiSocket?.readyState === WebSocket.OPEN) {
      vapiSocket.send(msg);
      console.log('📤 Audio sent to Vapi');
    }
  });

  ws.on('close', () => {
    console.log('🔌 TeleCMI disconnected');
    if (vapiSocket?.readyState === WebSocket.OPEN) vapiSocket.close();
  });

  vapiSocket.on('close', () => {
    console.log('🔴 Vapi connection closed');
  });

  vapiSocket.on('error', (err) => {
    console.error('❌ Vapi error:', err.message);
  });

  ws.on('error', (err) => {
    console.error('❌ TeleCMI socket error:', err.message);
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${SERVER_PORT} already in use`);
  } else {
    console.error('❌ Server error:', err.message);
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

console.log(`🚀 Relay running at ws://0.0.0.0:${SERVER_PORT}`);
console.log('🔗 Bridging TeleCMI ↔ Vapi');
console.log('⏳ Waiting for connection...');
