#  Kernel HTTP Proxy

A lightweight HTTP proxy that routes local HTTP requests through a remote Jupyter kernel (e.g., on Kaggle) and forwards them to your backend server. This setup lets you leverage remote compute for custom request handling, debugging, or integration without exposing your local services directly to the internet.

## Features

* Runs an Express.js server locally to capture all HTTP methods (`GET`, `POST`, `PUT`, etc.)
* Forwards requests through the kernel to your remote HTTP server
* Streams response headers and body back to the client

## Project Structure

```
project/
├── .env                # Environment variables
├── proxy_code.py       # Python handler injected into the Jupyter kernel
├── kernelManager.js    # Manages kernel lifecycle and code injection
└── server.js           # Express server that proxies HTTP requests via the kernel
```

## Prerequisites

* Node.js (v22+)
* Python (v3.12+)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/kernel-relay.git
   cd kernel-relay
   ```

2. Install Node.js dependencies:

   ```bash
   npm install
   ```

3. Install Python dependencies:
    on the remote server, ensure the following is installed
   ```bash
   pip install requests
   ```

4. Create a `.env` file in the project root with the following:

   ```dotenv
   JUPYTER_PROXY_URL="URL_HERE"
   REMOTE_HTTP_SERVER="http://localhost:8000"
   PORT=3000
   ```

## Configuration

| Variable                   | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| `JUPYTER_PROXY_URL`        | Jupyter proxy URL (includes token)                      |
| `REMOTE_HTTP_SERVER`       | Local or remote backend server to forward proxied calls |
| `PORT`                     | Local port for the Express server (default: `3000`)     |

## Usage

1. Ensure your backend server (e.g., your API) is running at `REMOTE_HTTP_SERVER`.
2. Start the proxy:

   ```bash
   node server.js
   ```
3. Send HTTP requests to:

   ```text
   http://localhost:<PORT>/<your-path>
   ```

   All traffic will be forwarded through the kernel to your backend.

### Example

```bash
# GET request
curl http://localhost:3000/api/users

# POST request with JSON body
curl -X POST http://localhost:3000/api/items \
     -H "Content-Type: application/json" \
     -d '{"name":"sample", "value":42}'
```

## How It Works

1. **Kernel Setup**: `server.js` uses `kernelManager.js` to:

   * Fetch available kernelspecs
   * Start a new kernel
   * Connect via WebSocket
   * Inject `proxy_code.py` into the kernel

2. **Request Forwarding**:

   * Express server captures incoming HTTP requests
   * Builds a small Python snippet invoking `proxy_http_request(...)`
   * Sends that snippet to the kernel over WebSocket
   * Kernel runs the snippet, makes an HTTP call to your `REMOTE_HTTP_SERVER`
   * Prints a special marker (`HTTP_PROXY_RESPONSE:`) with JSON metadata
   * `server.js` listens to kernel messages and maps responses back to the correct client

## Troubleshooting

* **Invalid proxy URL**: Ensure `JUPYTER_PROXY_URL` is correct and the token hasn’t expired.
* **Kernel disconnection**: Re-run `npm run server` to create a fresh kernel session.

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to fork the repo and submit a pull request.

## License

[MIT](LICENSE)
