# asciiFace

A dependency-free browser app that turns a live camera feed into ASCII art and
overlays the generated text on top of the video.

## Run locally

Serve the files from a local web server, then open the local URL in a browser:

```sh
python3 -m http.server 8080
```

Camera APIs require a secure context. Browsers allow `localhost` during
development; deployed versions should be served over HTTPS.
