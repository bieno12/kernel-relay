const net = require('net');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');
const {
  getKernelSpecs,
  startNewKernel,
  connectToKernelWebSocket,
  executeCode,
  setupPortForwarderInKernel,
  shutdownKernel,
} = require('./kernelManager');
require('dotenv').config();
// --- Helper function for command-line prompts ---
function promptForVar(question, defaultValue) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(`${question} [${defaultValue}]: `, answer => {
      rl.close();
      resolve(answer || defaultValue);
    });
  });
}

// --- Declare key variables in a higher scope for access in the shutdown handler ---
let ws = null;
let kernel = null;
let server = null;
let JUPYTER_PROXY_URL = process.env.JUPYTER_PROXY_URL;
const clientSockets = new Map();


(async () => {
  try {
    // --- 1. Prompt for missing configuration ---
    console.log('--- Port Forwarder Configuration ---');
    if (!JUPYTER_PROXY_URL) {
      JUPYTER_PROXY_URL = await promptForVar('Enter Jupyter Proxy URL', 'http://127.0.0.1:8888');
    }
    console.log(process.env.LOCAL_PORT)
    const LOCAL_PORT = process.env.LOCAL_PORT || await promptForVar('Enter Local Port to listen on', '9000');
    const REMOTE_HOST = process.env.REMOTE_HOST || await promptForVar('Enter Remote Host to connect to (from the kernel)', '127.0.0.1');
    const REMOTE_PORT = process.env.REMOTE_PORT || await promptForVar('Enter Remote Port to connect to', '8000');
    console.log('------------------------------------');


    // --- 2. Connect to the Jupyter Kernel ---
    console.log('Connecting to Jupyter Kernel...');
    const specs = await getKernelSpecs(JUPYTER_PROXY_URL);
    kernel = await startNewKernel(JUPYTER_PROXY_URL, specs.default);
    ws = await connectToKernelWebSocket(JUPYTER_PROXY_URL, kernel.id);
    console.log(`Connected to Kernel ID: ${kernel.id}`);


    // --- 3. Inject the Python port forwarding logic into the kernel ---
    await setupPortForwarderInKernel(ws, REMOTE_HOST, REMOTE_PORT);


    // --- 4. Listen for messages coming BACK from the kernel ---
    ws.on('message', raw => {
      const outer = JSON.parse(raw.toString());

      // Handle our port-forwarder prints (may contain several JSON objects concatenated)
      if (
        outer.msg_type === 'stream' &&
        outer.content?.name === 'stdout' &&
        outer.content.text.includes('FORWARDER_MSG:')
      ) {
        const segments = outer.content.text
          .split('\n')                       // each Python `print` ends with \n
          .filter(Boolean)                   // drop empty lines
          .filter(l => l.startsWith('FORWARDER_MSG:'));

        for (const line of segments) {
          try {
            const payload = JSON.parse(
              line.slice('FORWARDER_MSG:'.length)  // strip prefix
            );
            handleForwarder(payload);
          } catch (e) {
            console.error('Bad JSON from kernel:', e, line);
          }
        }
        return;                               // nothing more to do for this outer msg
      }

      if (outer.msg_type === 'error') {
        console.error('--- KERNEL ERROR ---');
        console.error('Name:', outer.content.ename);
        console.error('Value:', outer.content.evalue);
        console.error('Traceback:\n' + outer.content.traceback.join('\n'));
        console.error('--------------------');
        return;
      }

      if (outer.msg_type === 'stream' && outer.content.name === 'stderr') {
        console.log(`[KERNEL STDERR]: ${outer.content.text.trim()}`);
        return;
      }
    });
    // --- Helper to process each decoded port-forwarder payload ---
    function handleForwarder({ type, conn_id, data, error }) {
      const localSocket = clientSockets.get(conn_id);
      if (!localSocket) return;

      switch (type) {
        case 'data':
          localSocket.write(Buffer.from(data, 'base64'));
          break;
        case 'close':
          console.log(`Connection ${conn_id} closed by remote. Closing local socket.`);
          localSocket.end();
          clientSockets.delete(conn_id);
          break;
        case 'connect_error':
          console.error(`Kernel failed to connect for ${conn_id}: ${error}`);
          localSocket.end();
          clientSockets.delete(conn_id);
          break;
      }
    }


    // --- 5. Create the local TCP server ---
    server = net.createServer(localSocket => {
      // ... (This section is unchanged)
      const conn_id = uuidv4();
      console.log(`New local client connected. Assigning ID: ${conn_id}`);
      clientSockets.set(conn_id, localSocket);
      executeCode(ws, `start_connection("${conn_id}")`);
      localSocket.on('data', chunk => {
        const b64_data = chunk.toString('base64');
        const code = `forward_data("${conn_id}", "${b64_data}")`;
        executeCode(ws, code);
      });
      localSocket.on('close', () => {
        console.log(`Local client ${conn_id} disconnected.`);
        if (clientSockets.has(conn_id)) {
          clientSockets.delete(conn_id);
          executeCode(ws, `close_connection("${conn_id}")`);
        }
      });
      localSocket.on('error', (err) => {
        console.error(`Error on local socket ${conn_id}:`, err);
        if (clientSockets.has(conn_id)) {
          clientSockets.delete(conn_id);
          executeCode(ws, `close_connection("${conn_id}")`);
        }
      });
    });

    server.listen(LOCAL_PORT, () => {
      console.log(`\n✅ TCP Port Forwarder is running.`);
      console.log(`   Forwarding connections from localhost:${LOCAL_PORT} -> (via kernel) -> ${REMOTE_HOST}:${REMOTE_PORT}`);
      console.log(`   Press CTRL+C to shut down gracefully.\n`);
    });

  } catch (e) {
    console.error("\n❌ Fatal initialization error:", e.message);
    // If the error happened after the kernel was created, try to clean it up.
    if (kernel) {
      await shutdownKernel(JUPYTER_PROXY_URL, kernel.id);
    }
    process.exit(1);
  }
})();

// --- 6. Handle graceful shutdown on CTRL+C ---
process.on('SIGINT', async () => {
  console.log('\n\nCaught interrupt signal. Shutting down gracefully...');

  // 1. Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log('Local server closed.');
    });
  }

  // 2. Close all active connections on the kernel side
  if (ws && clientSockets.size > 0) {
    console.log(`Closing ${clientSockets.size} active connection(s) in kernel...`);
    for (const conn_id of clientSockets.keys()) {
      executeCode(ws, `close_connection("${conn_id}")`);
    }
  }

  // 3. Destroy all local sockets
  for (const socket of clientSockets.values()) {
    socket.destroy();
  }
  clientSockets.clear();

  // 4. Shut down the remote kernel itself
  if (kernel) {
    await shutdownKernel(JUPYTER_PROXY_URL, kernel.id);
  }

  // Give a moment for cleanup messages to be processed
  setTimeout(() => {
    console.log('Cleanup complete. Exiting.');
    process.exit(0);
  }, 1000);
});
