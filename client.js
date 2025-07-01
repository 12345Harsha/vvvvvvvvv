const WebSocket = require('ws');
const fs = require('fs');

const AUDIO_FILE = 'test_audio.ulaw'; // Optional: Only if you want to send audio
const SERVER_URL = 'ws://localhost:8766';

function connect() {
  const ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('📤 Connected to WebSocket relay (Vapi)');

    // Optional: Send audio file if it exists
    if (fs.existsSync(AUDIO_FILE)) {
      try {
        const audioData = fs.readFileSync(AUDIO_FILE);
        console.log(`🎧 Sending test audio: ${AUDIO_FILE} (${audioData.length} bytes)`);
        ws.send(audioData);
      } catch (err) {
        console.error('❌ Error reading audio file:', err);
      }
    } else {
      ws.send('Hello from client!');
    }
  });

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      console.log('📥 Received binary data:', data.length, 'bytes');
    } else {
      console.log('📩 Received message:', data.toString());
    }
  });

  ws.on('close', () => {
    console.log('🔌 Disconnected from server');
    setTimeout(() => {
      console.log('🔄 Attempting to reconnect...');
      connect();
    }, 3000);
  });

  ws.on('error', (err) => {
    console.error('❗ WebSocket error:', err.message || err);
  });
}

connect();
