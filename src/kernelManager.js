require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Load the Python proxy handler once
const REMOTE_HTTP_SERVER = process.env.REMOTE_HTTP_SERVER || 'http://localhost:8000';
const proxyCode = fs.readFileSync(path.join(__dirname, 'proxy_code.py'), 'utf-8')
    .replace(/{{REMOTE_HTTP_SERVER}}/g, REMOTE_HTTP_SERVER);



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
    parent_header: {}, metadata: {}, content: { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true },
    channel: "shell"
  };
  ws.send(JSON.stringify(req));
  return msgId;
}

async function setupHttpProxyInKernel(ws) {
  executeCode(ws, proxyCode);
}

module.exports = {
  getKernelSpecs,
  startNewKernel,
  connectToKernelWebSocket,
  executeCode,
  setupHttpProxyInKernel
};
