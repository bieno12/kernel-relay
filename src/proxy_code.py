import requests
import json

REMOTE_HTTP_SERVER = "{{REMOTE_HTTP_SERVER}}"

def proxy_http_request(method, url, headers=None, data=None, params=None, request_id=None):
    full_url = f"{REMOTE_HTTP_SERVER}{url}"
    # normalize headers
    if isinstance(headers, str):
        try: headers = json.loads(headers)
        except: headers = {}
    # normalize body
    body_data = None
    if data:
        if isinstance(data, str):
            try: body_data = json.loads(data)
            except: body_data = data
        else:
            body_data = data

    response = requests.request(
        method=method,
        url=full_url,
        headers=headers,
        json=body_data if method.lower() in ['post','put','patch'] and isinstance(body_data, dict) else None,
        data=body_data if method.lower() in ['post','put','patch'] and not isinstance(body_data, dict) else None,
        params=params,
        stream=True
    )

    resp = {
        "request_id": request_id,
        "status_code": response.status_code,
        "headers": dict(response.headers),
        "body": response.content.decode('utf-8', errors='replace')
    }
    print("HTTP_PROXY_RESPONSE:" + json.dumps(resp))

print("HTTP Proxy handler initialized in kernel")
