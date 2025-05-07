const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const {
  getKernelSpecs,
  startNewKernel,
  connectToKernelWebSocket,
  executeCode,
  setupHttpProxyInKernel
} = require('./kernelManager');

const JUPYTER_PROXY_URL = process.env.JUPYTER_PROXY_URL || '';
const LOCAL_PORT = process.env.PORT || 3000;
(async () => {
  try {
    // 1. Spin up a kernel
    const specs = await getKernelSpecs(JUPYTER_PROXY_URL);
    const kernel = await startNewKernel(JUPYTER_PROXY_URL, specs.default);
    const ws = await connectToKernelWebSocket(JUPYTER_PROXY_URL, kernel.id);

    // 2. Inject the Python proxy code
    await setupHttpProxyInKernel(ws);

    // 3. Start Express
    const app = express();
    const pending = new Map();

    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

    app.use((req, res, next) => {
      if (req.headers['content-type'] &&
          !req.headers['content-type'].includes('application/json') &&
          !req.headers['content-type'].includes('application/x-www-form-urlencoded')) {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', chunk => data += chunk);
        req.on('end', () => { req.rawBody = data; next(); });
      } else next();
    });

    app.all('/*splat', (req, res) => {
      const id = uuidv4();
      console.log(`Received request: ${req.method} ${req.originalUrl}`);

      pending.set(id, res);
     
      let dataCode = `json.loads('${JSON.stringify(req.rawBody || req.body)}')`
      if (!(req.rawBody || req.body) || JSON.stringify(req.rawBody || req.body) == '')
        dataCode = `''`;
      const code = `
method = json.loads('${JSON.stringify(req.method)}')
url =json.loads(' ${JSON.stringify(req.originalUrl)}')
headers = json.loads('${JSON.stringify(req.headers)}')
data = ${dataCode}
params = json.loads(' ${JSON.stringify(req.query)}')
request_id = "${id}"
proxy_http_request(method, url, headers, data, params, request_id)
`;
      executeCode(ws, code);
    });

    
    // Listen for kernel messages to complete HTTP responses
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      
    //   console.log("Message received:", msg['content']);
      if (msg.msg_type === 'error') {
        console.error('Kernel Error:', msg.content.ename, '-', msg.content.evalue);
        console.error('Traceback:');
        msg.content.traceback.forEach(line => console.error(line));
        // Send 500 error response for any kernel errors
        for (const [id, res] of pending) {
            res.status(500).send('Kernel error');
            pending.delete(id);
        }
      }
      if (msg.msg_type === 'stream' && msg.content.text.startsWith('HTTP_PROXY_RESPONSE:')) {
        const resp = JSON.parse(msg.content.text.slice('HTTP_PROXY_RESPONSE:'.length));
        const res = pending.get(resp.request_id);
        if (!res) return;
        Object.entries(resp.headers || {})
          .filter(([k]) => k.toLowerCase() !== 'content-encoding')
          .forEach(([k,v]) => res.setHeader(k, v));
        res.status(resp.status_code || 200).send(resp.body || '');
        pending.delete(resp.request_id);
      }
    });

    app.listen(LOCAL_PORT, () =>
      console.log(`Proxy running at http://localhost:${LOCAL_PORT}`));
  }
  catch (e) {
    console.error("Initialization error:", e);
  }
})();
