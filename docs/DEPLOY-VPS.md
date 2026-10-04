# Putting FeaturePlus on a VPS

This gets FeaturePlus running on a Linux server for other people to use, behind
HTTPS. The only thing left to add afterwards is the AI key.

## 1. Build and run

On the server, with Docker installed and the repository checked out:

```sh
cp backend/.env.example backend/.env      # then fill it in (step 3)
docker build -t featureplus .
docker run -d --name featureplus --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  --env-file backend/.env \
  -e FP_DB_PATH=/app/data/featureplus.db \
  -v /srv/featureplus/data:/app/data \
  featureplus
```

- The image builds the screens itself; nothing needs building on your laptop first.
- `-p 127.0.0.1:8080:8080` keeps the app off the public interface; the proxy in
  step 2 is the only way in.
- The database and uploads live in `/srv/featureplus/data` on the server, so
  rebuilding the image keeps them. Back that folder up.
- Secrets come from `--env-file` at run time. `.dockerignore` keeps `.env`
  files and `.pem` keys out of the image.

To start with your current data, copy `backend/test.db` to
`/srv/featureplus/data/featureplus.db` before the first run.

## 2. HTTPS in front

Any reverse proxy works. It must pass the original host and scheme, because the
sign-in cookie and the GitHub return address are built from them. With Caddy,
which also gets the certificate:

```
featureplus.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

With nginx, inside the `server` block that holds the certificate:

```
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Over HTTPS the sign-in cookie is marked Secure automatically.

## 3. Settings

Everything is in `backend/.env.example`, with what each one does. For a VPS:

| Setting | What to put |
|---|---|
| `ANTHROPIC_API_KEY` | The AI key. Without it the Playground's Ask AI uses a stand-in. |
| `FP_AI_MODEL` | Optional; defaults to `claude-opus-5-5`. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | From the GitHub App, if people will publish plans and releases to GitHub. |

`GITHUB_TOKEN` is no longer required to start.

## 4. GitHub App

On the app's settings page on GitHub, add this callback URL alongside the
localhost ones:

```
https://featureplus.example.com/api/v1/github/callback
```

The app is currently installable only on its owner's account. For other people
to connect their own repositories, set it to "Any account" under
*Install App* / *Advanced*.

## 5. Adding the AI key later

Put `ANTHROPIC_API_KEY=...` in `backend/.env` and restart the container:

```sh
docker restart featureplus
```

The Playground's Ask AI badge changes from "stand-in" to "Claude".

## Who sees what

- Each person's Playground draft is saved on the server under their account;
  nobody else sees it.
- Any signed-in person can open any project in the Playground and read its
  features, the same as everywhere else in the app. Writing back (Import)
  needs the project's owner or a manager.
- Import never deletes features or dependencies.
