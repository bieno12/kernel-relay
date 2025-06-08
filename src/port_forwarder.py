import socket
import threading
import json
import base64
import sys
import time

# These will be replaced by kernelManager.js before execution
REMOTE_HOST = "{{REMOTE_HOST}}"
REMOTE_PORT = int("{{REMOTE_PORT}}")

# A thread-safe dictionary to hold connections
connections = {}
lock = threading.Lock()

def _log(message):
    """Helper for stderr logging to not interfere with stdout data channel."""
    print(message, file=sys.stderr, flush=True)

def _send_to_node(message):
    """
    Safely prints a message to stdout for Node.js to capture.
    The prefix is crucial for distinguishing our messages.
    """
    print(f"FORWARDER_MSG:{json.dumps(message)}", flush=True)


def _listen_for_remote_data(conn_id, sock):
    """
    This function runs in a dedicated thread for each connection.
    It reads data from the remote service and forwards it to Node.js.
    """
    _log(f"Listener thread started for conn_id: {conn_id}")
    try:
        while True:
            # Reading in chunks
            data = sock.recv(4096)
            if not data:
                # The remote server closed the connection
                _log(f"Remote connection closed for conn_id: {conn_id}")
                break

            # Base64 encode to safely transmit binary data via JSON
            b64_data = base64.b64encode(data).decode('utf-8')
            
            response = {
                "type": "data",
                "conn_id": conn_id,
                "data": b64_data
            }
            _send_to_node(response)

    except Exception as e:
        _log(f"Error in listener for {conn_id}: {e}")
    finally:
        # Notify Node.js that this connection is now closed from the remote side
        _send_to_node({"type": "close", "conn_id": conn_id})
        close_connection(conn_id)


def start_connection(conn_id):
    """
    Called by Node.js to initiate a new TCP connection to the remote target.
    """
    _log(f"Attempting to start connection {conn_id} to {REMOTE_HOST}:{REMOTE_PORT}")
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect((REMOTE_HOST, REMOTE_PORT))
        
        with lock:
            connections[conn_id] = sock

        # Start a listener thread to read from this new socket
        thread = threading.Thread(target=_listen_for_remote_data, args=(conn_id, sock))
        thread.daemon = True # Allows main program to exit even if threads are running
        thread.start()
        
        _log(f"Successfully connected and started listener for {conn_id}")
        _send_to_node({"type": "connect_success", "conn_id": conn_id})

    except Exception as e:
        _log(f"Failed to connect for {conn_id}: {e}")
        _send_to_node({"type": "connect_error", "conn_id": conn_id, "error": str(e)})


def forward_data(conn_id, b64_data):
    """
    Called by Node.js to forward data from the local client to the remote service.
    """
    with lock:
        sock = connections.get(conn_id)
    
    if sock:
        try:
            # Decode the data and send it
            data = base64.b64decode(b64_data)
            sock.sendall(data)
        except Exception as e:
            _log(f"Error forwarding data for {conn_id}: {e}")
            # This connection is likely broken, so clean it up
            close_connection(conn_id)
    else:
        _log(f"Could not forward data: No active socket for conn_id {conn_id}")


def close_connection(conn_id):
    """
    Called by Node.js (or internally) to close a specific connection.
    """
    with lock:
        sock = connections.pop(conn_id, None)

    if sock:
        try:
            _log(f"Closing connection for {conn_id}")
            sock.close()
        except Exception as e:
            _log(f"Error closing socket for {conn_id}: {e}")

_log("Python port forwarder functions defined and ready.")
