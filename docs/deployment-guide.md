# DGen Platform Deployment Guide

This guide describes a neutral self-hosted deployment for DGen Platform on a Linux VM with Nginx, HTTPS, and systemd. It assumes the app keeps credentials in the browser session and does not persist API keys on the server.

## 0. Architecture

- Frontend: Vite production build served by the Express app.
- Backend: Express local API server for provider proxy helpers, signing, and download proxying.
- Credentials: entered by the user in the UI, passed per request, and not stored server-side.
- Process manager: systemd.
- Reverse proxy: Nginx.
- HTTPS: Let's Encrypt or an equivalent certificate provider.

Default ports:

- App server: `127.0.0.1:3000`
- Public site: `443`

## 1. Provision The VM

Recommended baseline:

- Ubuntu 22.04 or newer
- 2 vCPU
- 4 GB RAM
- 40 GB disk
- A non-root deploy user with sudo access

Open only the required inbound ports:

| Purpose | Port |
| --- | --- |
| SSH | 22 |
| HTTP | 80 |
| HTTPS | 443 |

Keep provider API access outbound-enabled.

## 2. Prepare The Host

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx
```

Install Node.js 22 using your standard runtime manager or a pinned tarball. Confirm:

```bash
node -v
npm -v
```

## 3. Deploy The App

```bash
sudo mkdir -p /var/www/dgen-platform
sudo chown -R deploy:deploy /var/www/dgen-platform

git clone <your-repo-url> /var/www/dgen-platform
cd /var/www/dgen-platform
npm ci
npm run build
```

Create an environment file:

```bash
cat > /var/www/dgen-platform/.env <<'EOF'
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
PLATFORM_ORIGIN=https://your.domain.example
EOF
```

Do not place user API keys, access keys, or secret keys in this file for normal runtime use.

## 4. Configure systemd

Create `/etc/systemd/system/dgen-platform.service`:

```ini
[Unit]
Description=DGen Platform Node server
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/var/www/dgen-platform
EnvironmentFile=/var/www/dgen-platform/.env
ExecStart=/var/www/dgen-platform/node_modules/.bin/tsx server/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dgen-platform
sudo systemctl status dgen-platform
```

Tail logs:

```bash
journalctl -u dgen-platform -f
```

## 5. Configure Nginx

Create `/etc/nginx/sites-available/dgen-platform`:

```nginx
server {
  listen 80;
  server_name your.domain.example;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/dgen-platform /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Issue HTTPS:

```bash
sudo certbot --nginx -d your.domain.example
```

After HTTPS is active, update `PLATFORM_ORIGIN` in `/var/www/dgen-platform/.env` if needed and restart:

```bash
sudo systemctl restart dgen-platform
```

## 6. Verify

1. Open `https://your.domain.example`.
2. Open the credential drawer.
3. Enter only the credentials needed for the workflow being tested.
4. Confirm the relevant credential status turns valid.
5. Run a small text, image, or video request.
6. Confirm refresh behavior: credentials persist only in the same browser tab session.
7. Restart the service and confirm the app still loads:

```bash
sudo systemctl restart dgen-platform
```

## 7. Update

```bash
cd /var/www/dgen-platform
git pull --ff-only
npm ci
npm run build
sudo systemctl restart dgen-platform
```

Check logs after restarting:

```bash
journalctl -u dgen-platform -n 100 --no-pager
```

## 8. Rollback

If a release fails, return to the previous commit:

```bash
cd /var/www/dgen-platform
git log --oneline -5
git checkout <previous-good-commit>
npm ci
npm run build
sudo systemctl restart dgen-platform
```

## 9. Operations Checklist

- Monitor disk usage for generated browser exports and server logs.
- Monitor service health with `systemctl status dgen-platform`.
- Keep the VM patched.
- Rotate provider credentials through the provider console.
- Use provider-side quota and budget alerts where available.
- Keep access keys scoped to the minimum required service permissions.

## 10. Troubleshooting

| Symptom | Likely Cause | Check |
| --- | --- | --- |
| `502 Bad Gateway` | App server is down or bound to the wrong host | `systemctl status dgen-platform` |
| Page loads but API calls fail | `PLATFORM_ORIGIN` mismatch | Browser console and app logs |
| Credential verification fails | Wrong key, wrong endpoint, or insufficient provider permission | Provider console and app response body |
| Large downloads fail | Reverse proxy timeout or provider URL expiry | Nginx logs and task history |
| Service restarts repeatedly | Missing dependency or invalid environment | `journalctl -u dgen-platform -n 100` |

## 11. Security Notes

- Keep `BIND_HOST=127.0.0.1` unless the service is intentionally exposed behind another trusted proxy.
- Do not store user credentials in `.env`, logs, screenshots, or exported bundles.
- Do not relax the origin guard for production deployments.
- Prefer short-lived signed URLs for media references.
- Review logs before sharing them externally.
