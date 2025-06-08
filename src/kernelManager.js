// kernelManager.js
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const forwarderCode = fs.readFileSync(path.join(__dirname, 'port_forwarder.py'), 'utf-8');

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
        content: { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: true },
        channel: "shell"
    };
    ws.send(JSON.stringify(req));
    return msgId;
}

async function setupPortForwarderInKernel(ws, remoteHost, remotePort) {
    console.log('Injecting Python port forwarding code into kernel...');
    const configuredCode = forwarderCode
        .replace(/{{REMOTE_HOST}}/g, remoteHost)
        .replace(/{{REMOTE_PORT}}/g, remotePort);
    executeCode(ws, configuredCode);
    return new Promise(resolve => setTimeout(resolve, 500));
}

// --- NEW FUNCTION ---
async function shutdownKernel(proxyUrl, kernelId) {
    if (!proxyUrl || !kernelId) return;
    try {
        console.log(`Requesting shutdown of kernel ${kernelId}...`);
        await axios.delete(`${proxyUrl}/api/kernels/${kernelId}`);
        console.log('Kernel shutdown request sent.');
    } catch (err) {
        console.error(`Error shutting down kernel ${kernelId}:`, err.message);
    }
}

module.exports = {
    getKernelSpecs,
    startNewKernel,
    connectToKernelWebSocket,
    executeCode,
    setupPortForwarderInKernel,
    shutdownKernel
};