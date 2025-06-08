// port-forwarder.js
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const {
  getKernelSpecs,
  startNewKernel,
  connectToKernelWebSocket,
  executeCode,
  setupPortForwarderInKernel, // <-- Using the new setup function
} = require('./kernelManager');

const JUPYTER_PROXY_URL = process.env.JUPYTER_PROXY_URL || '';
const LOCAL_PORT = process.env.LOCAL_PORT || 9000;

// This will map a connection ID to the local TCP socket
const clientSockets = new Map();

(async () => {
  try {
    // 1. Connect to the Jupyter Kernel
    console.log('Connecting to Jupyter Kernel...');
    const specs = await getKernelSpecs(JUPYTER_PROXY_URL);
    const kernel = await startNewKernel(JUPYTER_PROXY_URL, specs.default);
    const ws = await connectToKernelWebSocket(JUPYTER_PROXY_URL, kernel.id);
    console.log(`Connected to Kernel ID: ${kernel.id}`);

    // 2. Inject the Python port forwarding logic into the kernel
    await setupPortForwarderInKernel(ws);

    // 3. Listen for messages coming BACK from the kernel
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());

      // Log any errors from the kernel
      if (msg.msg_type === 'error') {
        console.error('--- KERNEL ERROR ---');
        console.error('Name:', msg.content.ename);
        console.error('Value:', msg.content.evalue);
        console.error('Traceback:\n' + msg.content.traceback.join('\n'));
        console.error('--------------------');
        return; // Don't process further
      }
      
      // Log any stderr output from the Python script for debugging
      if (msg.msg_type === 'stream' && msg.content.name === 'stderr') {
        console.log(`[KERNEL STDERR]: ${msg.content.text.trim()}`);
        return;
      }
      
      // This is our main data channel from Python
      if (msg.msg_type === 'stream' && msg.content.text.startsWith('FORWARDER_MSG:')) {
        const payload = JSON.parse(msg.content.text.slice('FORWARDER_MSG:'.length));
        const { type, conn_id, data, error } = payload;
        const localSocket = clientSockets.get(conn_id);

        if (!localSocket) {
            // This can happen if the local socket was already closed
            return; 
        }

        switch (type) {
          case 'data':
            // Data came from the remote service, write it to the local client
            const buffer = Buffer.from(data, 'base64');
            localSocket.write(buffer);
            break;
          case 'close':
            // The remote service closed the connection, so close our local one.
            console.log(`Connection ${conn_id} closed by remote. Closing local socket.`);
            localSocket.end();
            clientSockets.delete(conn_id);
            break;
          case 'connect_error':
            // The Python script failed to connect to the target service
            console.error(`Kernel failed to connect for ${conn_id}: ${error}`);
            localSocket.end(); // Close the client connection
            clientSockets.delete(conn_id);
            break;
        }
      }
    });

    // 4. Create the local TCP server
    const server = net.createServer(localSocket => {
      const conn_id = uuidv4();
      console.log(`New local client connected. Assigning ID: ${conn_id}`);
      clientSockets.set(conn_id, localSocket);

      // Tell the kernel to open a corresponding connection to the remote service
      executeCode(ws, `start_connection("${conn_id}")`);

      // Handle data coming FROM the local client
      localSocket.on('data', chunk => {
        // Base64 encode the data and tell the kernel to forward it
        const b64_data = chunk.toString('base64');
        const code = `forward_data("${conn_id}", "${b64_data}")`;
        executeCode(ws, code);
      });

      // Handle the local client disconnecting
      localSocket.on('close', () => {
        console.log(`Local client ${conn_id} disconnected.`);
        clientSockets.delete(conn_id);
        // Tell the kernel to close its side of the connection
        executeCode(ws, `close_connection("${conn_id}")`);
      });

      localSocket.on('error', (err) => {
        console.error(`Error on local socket ${conn_id}:`, err);
        clientSockets.delete(conn_id);
        executeCode(ws, `close_connection("${conn_id}")`);
      });
    });

    server.listen(LOCAL_PORT, () => {
      console.log(`TCP Port Forwarder running.`);
      console.log(`Forwarding connections from localhost:${LOCAL_PORT} -> (via kernel) -> ${process.env.REMOTE_HOST}:${process.env.REMOTE_PORT}`);
    });

  } catch (e) {
    console.error("Fatal initialization error:", e);
    process.exit(1);
  }
})();
