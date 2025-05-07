// Required libraries
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');

// Create readline interface for interactive input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Global variables to store connection state
let KAGGLE_JUPYTER_PROXY_URL = "https://kkb-production.jupyter-proxy.kaggle.net/k/238223890/eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2IiwidHlwIjoiSldUIn0..DSxhp6c-eSQR2C_t93jHhQ.fZqEU0QAHMGmonPButfjoqY8Zb-dBf4gbbOup7P1Q-bLT7nsuK8nizARVxMZ63xJUvQ0lUxf9raIRRhCCuKCHa8lNSp6SQIKGO53lr_Ck49FoUeo_Nj5xdd3dlz95QsxXWYoTOdQqS032UD3Ja3wUfre8zAIVIguI12eLsL5uruxxpSs8ZI8wl7C8OfB5n46Y3oKl3LfSf9m3lLPZTwaKZ7dzZEL1vkDbyiXGPDPyJuLptV3rlQ9q_TirC7H8Wbz.SgT9Md2sjRqY7tgVdy9ofw/proxy";
let activeWs = null;
let activeKernelId = null;

/**
 * Prompts the user for input with a given message
 * @param {string} message - Prompt message
 * @returns {Promise<string>} User's input
 */
function prompt(message) {
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      resolve(answer);
    });
  });
}

/**
 * Fetches the available kernel specifications from the Jupyter server.
 * @param {string} proxyUrl - The full Kaggle Jupyter proxy URL.
 * @returns {Promise<object>} A promise that resolves with the kernelspecs data.
 */
async function getKernelSpecs(proxyUrl) {
  const apiUrl = `${proxyUrl}/api/kernelspecs`;
  console.log(`Fetching kernel specs from: ${apiUrl}`);
  try {
    const response = await axios.get(apiUrl);
    console.log("Successfully fetched kernel specs.");
    return response.data;
  } catch (error) {
    console.error("Error fetching kernel specs:");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

/**
 * Starts a new kernel.
 * @param {string} proxyUrl - The full Kaggle Jupyter proxy URL.
 * @param {string} kernelSpecName - The name of the kernel spec to start (e.g., 'python3').
 * @returns {Promise<object>} A promise that resolves with the new kernel model.
 */
async function startNewKernel(proxyUrl, kernelSpecName) {
  if (!proxyUrl) {
    console.error("Please configure the Kaggle Jupyter Server URL first.");
    throw new Error("Kaggle Jupyter Server URL not configured.");
  }
  
  const apiUrl = `${proxyUrl}/api/kernels`;
  console.log(`Starting new kernel '${kernelSpecName}' via: ${apiUrl}`);
  try {
    const response = await axios.post(apiUrl, { name: kernelSpecName });
    console.log("Successfully started new kernel:", response.data.id);
    return response.data; // This object contains the kernel id, name, etc.
  } catch (error) {
    console.error("Error starting new kernel:");
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Data: ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

/**
 * Connects to a running kernel's WebSocket channel.
 * @param {string} proxyUrl - The full Kaggle Jupyter proxy URL.
 * @param {string} kernelId - The ID of the kernel to connect to.
 * @returns {Promise<WebSocket>} A promise that resolves with the WebSocket connection.
 */
function connectToKernelWebSocket(proxyUrl, kernelId) {
  if (!proxyUrl) {
    console.error("Please configure the Kaggle Jupyter Server URL first.");
    return Promise.reject(new Error("Kaggle Jupyter Server URL not configured."));
  }

  // Construct the WebSocket URL
  const wsBaseUrl = proxyUrl.replace(/^http/, 'ws');
  const sessionId = uuidv4(); // Generate a unique session ID for this connection
  const wsUrl = `${wsBaseUrl}/api/kernels/${kernelId}/channels?session_id=${sessionId}`;

  console.log(`Connecting to WebSocket: ${wsUrl}`);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log(`WebSocket connection established for kernel ${kernelId} with session ${sessionId}`);
      resolve(ws);
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      
      // Handle different message types
      if (message.msg_type === 'status') {
        console.log(`Kernel status: ${message.content.execution_state}`);
      }
      else if (message.msg_type === 'stream') {
        // Print output with appropriate color based on stream type
        if (message.content.name === 'stdout') {
          process.stdout.write(`\x1b[32m${message.content.text}\x1b[0m`); // Green color for stdout
        } else if (message.content.name === 'stderr') {
          process.stdout.write(`\x1b[31m${message.content.text}\x1b[0m`); // Red color for stderr
        } else {
          process.stdout.write(message.content.text);
        }
      }
      else if (message.msg_type === 'execute_result') {
        console.log('\x1b[36m' + message.content.data['text/plain'] + '\x1b[0m'); // Cyan color for results
      }
      else if (message.msg_type === 'display_data') {
        if (message.content.data['text/plain']) {
          console.log('\x1b[36m' + message.content.data['text/plain'] + '\x1b[0m');
        }
        if (message.content.data['image/png']) {
          console.log('[Image data available but cannot be displayed in terminal]');
        }
      }
      else if (message.msg_type === 'error') {
        console.error('\x1b[31mError: ' + message.content.ename + ': ' + message.content.evalue + '\x1b[0m');
        console.error('\x1b[31m' + message.content.traceback.join('\n') + '\x1b[0m');
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      reject(error);
    });

    ws.on('close', (code, reason) => {
      console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}`);
    });
  });
}

/**
 * Sends an execute_request message to the kernel over WebSocket.
 * @param {WebSocket} ws - The active WebSocket connection.
 * @param {string} codeToExecute - The code string to execute.
 */
function executeCode(ws, codeToExecute) {
  const msgId = uuidv4();
  const executeRequest = {
    header: {
      msg_id: msgId,
      username: "interactive_shell",
      session: ws.url.split('session_id=')[1], // Extract session_id from ws.url
      msg_type: "execute_request",
      version: "5.3", // Jupyter messaging protocol version
    },
    parent_header: {},
    metadata: {},
    content: {
      code: codeToExecute,
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: false,
      stop_on_error: true,
    },
    channel: "shell", // Messages for execution are sent on the 'shell' channel
  };
  console.log(`\n> Executing: ${codeToExecute}`);
  ws.send(JSON.stringify(executeRequest));
}

/**
 * Shows help information
 */
function showHelp() {
  console.log("\n----- Kaggle Jupyter Interactive Shell Help -----");
  console.log("Available commands:");
  console.log("  /help                - Show this help message");
  console.log("  /url [URL]           - Set or show the Kaggle Jupyter proxy URL");
  console.log("  /connect             - Connect to Kaggle Jupyter server and start a kernel");
  console.log("  /kernels             - List available kernel specifications");
  console.log("  /start [kernel_name] - Start a specific kernel");
  console.log("  /status              - Show current connection status");
  console.log("  /clear               - Clear the screen");
  console.log("  /exit, /quit         - Exit the application");
  console.log("  [code]               - Execute Python code in the active kernel");
  console.log("---------------------------------------------\n");
}

/**
 * Process shell commands
 * @param {string} input - User input
 * @returns {boolean} - true if shell should continue, false if it should exit
 */
async function processCommand(input) {
  input = input.trim();
  
  // Handle special commands (starting with /)
  if (input.startsWith('/')) {
    const parts = input.split(' ');
    const command = parts[0].toLowerCase();
    
    switch (command) {
      case '/help':
        showHelp();
        return true;
        
      case '/url':
        if (parts.length > 1) {
          KAGGLE_JUPYTER_PROXY_URL = parts.slice(1).join(' ');
          console.log(`Kaggle Jupyter proxy URL set to: ${KAGGLE_JUPYTER_PROXY_URL}`);
        } else {
          console.log(`Current Kaggle Jupyter proxy URL: ${KAGGLE_JUPYTER_PROXY_URL || 'Not set'}`);
        }
        return true;
        
      case '/connect':
        try {
          // First get kernel specs
          const specs = await getKernelSpecs(KAGGLE_JUPYTER_PROXY_URL);
          console.log("Available kernel specs:", Object.keys(specs.kernelspecs).join(', '));
          
          // Use default kernel
          const defaultKernelName = specs.default;
          console.log(`Using default kernel spec: ${defaultKernelName}`);
          
          // Start kernel
          const kernelModel = await startNewKernel(KAGGLE_JUPYTER_PROXY_URL, defaultKernelName);
          activeKernelId = kernelModel.id;
          
          // Connect to WebSocket
          activeWs = await connectToKernelWebSocket(KAGGLE_JUPYTER_PROXY_URL, activeKernelId);
          console.log(`\nConnected! You can now run Python code. Type /help for commands.`);
        } catch (error) {
          console.error("Error connecting:", error.message);
        }
        return true;
        
      case '/kernels':
        try {
          const specs = await getKernelSpecs(KAGGLE_JUPYTER_PROXY_URL);
          console.log("\nAvailable kernel specifications:");
          for (const [name, spec] of Object.entries(specs.kernelspecs)) {
            console.log(`  ${name}${name === specs.default ? ' (default)' : ''}: ${spec.spec?.display_name || 'Unknown'}`);
          }
          console.log();
        } catch (error) {
          console.error("Error listing kernels:", error.message);
        }
        return true;
        
      case '/start':
        try {
          if (parts.length < 2) {
            console.error("Please specify a kernel name. Use /kernels to list available kernels.");
            return true;
          }
          
          const kernelName = parts[1];
          console.log(`Starting kernel: ${kernelName}`);
          
          // Start the kernel
          const kernelModel = await startNewKernel(KAGGLE_JUPYTER_PROXY_URL, kernelName);
          activeKernelId = kernelModel.id;
          
          // Connect to WebSocket
          activeWs = await connectToKernelWebSocket(KAGGLE_JUPYTER_PROXY_URL, activeKernelId);
          console.log(`\nKernel ${kernelName} started and connected! You can now run code.`);
        } catch (error) {
          console.error("Error starting kernel:", error.message);
        }
        return true;
        
      case '/status':
        console.log("\nConnection Status:");
        console.log(`Kaggle URL: ${KAGGLE_JUPYTER_PROXY_URL || 'Not set'}`);
        console.log(`Active Kernel ID: ${activeKernelId || 'None'}`);
        console.log(`WebSocket Connected: ${activeWs && activeWs.readyState === WebSocket.OPEN ? 'Yes' : 'No'}`);
        console.log();
        return true;
        
      case '/clear':
        console.clear();
        return true;
        
      case '/exit':
      case '/quit':
        console.log("Exiting Kaggle Jupyter Interactive Shell...");
        if (activeWs) {
          activeWs.close();
        }
        rl.close();
        return false;
        
      default:
        console.log(`Unknown command: ${command}. Type /help for available commands.`);
        return true;
    }
  } 
  // Execute code in the kernel
  else if (input.length > 0) {
    if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
      console.error("\nNo active kernel connection. Please connect first with /connect or /start.");
      return true;
    }
    
    executeCode(activeWs, input);
    return true;
  }
  
  return true;
}

/**
 * Main function to start the interactive shell
 */
async function startShell() {
  console.log("\n----- Kaggle Jupyter Interactive Shell -----");
  console.log("Type /help for available commands");
  
  // Check if URL is set from command line argument
  if (process.argv.length > 2) {
    KAGGLE_JUPYTER_PROXY_URL = process.argv[2];
    console.log(`Using Kaggle Jupyter URL from command line: ${KAGGLE_JUPYTER_PROXY_URL}`);
  } else {
    // Prompt for URL if not provided
    KAGGLE_JUPYTER_PROXY_URL = await prompt("Enter your Kaggle Jupyter proxy URL: ");
  }
  
  // Main command loop
  let continueShell = true;
  while (continueShell) {
    const input = await prompt("\nkaggle> ");
    continueShell = await processCommand(input);
  }
}

// Start the shell
startShell().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});