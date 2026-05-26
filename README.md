# asciiFace

A browser-based camera terminal that renders a live white ASCII outline of the
user's upper body, focusing on the face and shoulders.

## Run locally

Serve the static files and open the local URL in a browser:

```sh
python3 -m http.server 8080
```

Camera access requires a secure context. Browsers allow `localhost` during
development; deployed versions should use HTTPS.
