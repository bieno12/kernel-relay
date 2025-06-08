// kernelManager.js
require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// --- NEW ---
// Load and prepare the Python port forwarding code
const REMOTE_HOST = process.env.REMOTE_HOST || '127.0.0.1';
const REMOTE_PORT = process.env.REMOTE_PORT || '8000';

const forwarderCode = fs.readFileSync(path.join(__dirname, 'port_forwarder.py'), 'utf-8')
    .replace(/{{REMOTE_HOST}}/g, REMOTE_HOST)
    .replace(/{{REMOTE_PORT}}/g, REMOTE_PORT);

async function getKernelSpecs(proxyUrl) {
    const { data } = await axios.get(`${proxyUrl}/api/kernelspecs`);
    return data;
}

async function startNewKernel(proxyUrl, kernelSpecName) {
    const { data } = await axios.post(`${proxyUrl}/api/kernels`, { name: kernelSpecName });
    return data;
}

function connectToKernelWebSocket(proxyUrl, kernelId) {
    const wsUrl = proxyUrl.replace(/^http/, 'ws') +
        `/api/kernels/${kernelId}/channels?session_id=${uuidv4()}`;
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.on('open', () => resolve(ws));
        ws.on('error', reject);
    });
}

function executeCode(ws, code) {
    const msgId = uuidv4();
    const session = ws.url.split('session_id=')[1];
    const req = {
        header: { msg_id: msgId, username: "proxy_client", session, msg_type: "execute_request", version: "5.3" },
        parent_header: {},
        metadata: {},
        content: {
            code,
            silent: false, // We need to see the stdout
            store_history: false, // No need to store this code
            user_expressions: {},
            allow_stdin: false,
            stop_on_error: true
        },
        channel: "shell"
    };
    ws.send(JSON.stringify(req));
    return msgId;
}

// --- UPDATED FUNCTION ---
async function setupPortForwarderInKernel(ws) {
  console.log('Injecting Python port forwarding code into kernel...');
  executeCode(ws, forwarderCode);
  // Give the kernel a moment to process the definitions
  return new Promise(resolve => setTimeout(resolve, 500));
}

module.exports = {
    getKernelSpecs,
    startNewKernel,
    connectToKernelWebSocket,
    executeCode,
    setupPortForwarderInKernel // <-- Exporting the new setup function
};
