#  Kernel TCP port forwarding

A TCP port forwarding  that leverages the Jupyter kernel protocol to tunnel HTTP requests. By injecting a proxy handler into a remote Jupyter kernel (e.g., on Kaggle), it enables secure request routing between a local client and remote backend server. The kernel acts as an intermediary, executing HTTP requests within its environment and streaming responses back through WebSocket messages.


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

3. Create a `.env` file in the project root with the following:

   ```dotenv
   JUPYTER_PROXY_URL="URL_HERE"
   REMOTE_HOST="http://localhost"
   REMOTE_PORT=8000
   LOCAL_PORT=8000
   ```

## Configuration

| Variable                   | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| `JUPYTER_PROXY_URL`        | Jupyter proxy URL (includes token)                      |
| `REMOTE_HOST`              | Local or remote backend server to forward proxied calls |
| `REMOTE_PORT`              | port of remote backend server                           |
| `LOCAL_PORT`               | Local port for the Express server                       |

## Usage

1. Ensure your backend server (e.g., your API) is running at `REMOTE_HOST:REMOTE_PORT`.
    for example run the following in your kernel notebook
    ```bash
    !pip install vllm -q
    !python3 -m vllm.entrypoints.openai.api_server \
    --model facebook/opt-125m
    ```
    which will host an OpenAI Compatible http server on the remote machine.
2. Start the proxy:

   ```bash
   node run server
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

## Troubleshooting

* **Invalid proxy URL**: Ensure `JUPYTER_PROXY_URL` is correct and the token hasn’t expired.
* **Kernel disconnection**: Re-run `npm run server` to create a fresh kernel session.
