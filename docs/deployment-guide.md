# BytePlus VM 雲端部署 0→1 教程

把 `byteplus-ai-gen-platform` 從本地開發搬到 BytePlus VM 跑生產環境，配合自有網域 + HTTPS。

> ⚠️ **2026-05-14 架構變更通知 — 跳過以下章節**
>
> Export / import 任務檔案已改為**純瀏覽器端**（瀏覽器 zip 下載到使用者本機、folder/zip 拖入匯入），server 不再讀寫 `exports/` 目錄，`EXPORTS_DIR` 環境變數沒有 code path 會用到。下列章節描述的是已淘汰的架構，**新部署請直接略過、現有部署可從 systemd unit 移除 `EXPORTS_DIR=` 並刪除 data disk 上的 `exports/` 內容**：
>
> - §2.8 掛 data disk 給 exports/
> - §4.4 讓 exports/ 落到 data disk
> - §7.2 exports/ 備份
> - 附錄 A 中的 `EXPORTS_DIR` 一列
> - §1 Phase 1 規格內「20 GB data disk for exports/」相關建議

---

## 為什麼要一份教程？專案的部署架構

這個 repo 是 Vite + React 前端 + 獨立的 Express 後端（`server/` 目錄）。

- `npm run build` 用 `tsc -b && vite build` 產出純前端 `dist/`
- `npm run server:start` 透過 `tsx` 跑 `server/index.ts`；同一個 Node process 同時：
  - 服務 `dist/` 與 SPA fallback（任何未命中的 GET 回 `dist/index.html`）
  - 處理 `/local-api/*`（TOS 簽章、ARK Asset 簽章、無狀態 SSRF-allowlist `download-asset` proxy）
  - proxy `/api/*` 到 ARK Open API

所以 production VM 上跑的是這個 Node process，前面掛 Nginx 做 HTTPS 反向代理。**不要**把 `dist/` 單獨丟到 CDN / 物件儲存 — 後端 API 跟前端必須在同一個 origin 才能共用 cookie / 走 Nginx proxy 認證。

---

## Phase 0 — 部署前必須先決定的事

### 0.1 BYO 憑證架構（已完成）

所有憑證（TOS AKSK、ARK AKSK、ModelArk API Key、Endpoint ID）都採 **方案 B：使用者輸入 → 後端臨時簽**。UI 輸入 AKSK，每次 API call 隨請求帶到後端（HTTPS over TLS），後端拿來簽完即丟、**不持久化**。AK/SK 不會被存上 disk。Server 端不再讀取 `.env` 中的 AKSK 做 runtime fallback。

`localStorage` 存 AK/SK 跟 ModelArk API Key 一樣有被 XSS 偷的風險，但容易撤銷（重新進站不存就沒），也不依賴 BytePlus CORS 政策。

### 0.2 網域準備

- 把網域買好（任一 registrar）
- 在 BytePlus DNS 或 registrar 後台先把網域指向「之後要建立的 VM 公網 IP」的 A record（可先留空，VM 起來後再補）

---

## Phase 1 — VM provisioning（BytePlus console 側）

你說 VPC / VM / Security Group 你熟，這段只列規格與安全建議：

**規格建議（最小可行）**

- 2 vCPU / 4 GB RAM 起跳；Node + Nginx + 少量並發夠用
- 系統盤 40 GB；另掛 **20 GB 以上 data disk** 給 `exports/`（SSD 雲盤），方便獨立備份 / resize
- OS：Ubuntu 22.04 LTS（本教程示範以此為準）
- Region：建議與你的 TOS bucket、ARK endpoint 同 region（降低延遲與跨區流量費）

**Security Group 規則**

| 方向 | 協定 | Port | Source | 說明 |
|---|---|---|---|---|
| Inbound | TCP | 22 | 你個人 IP（或 VPN 出口）| SSH，**不要對 0.0.0.0/0 開放** |
| Inbound | TCP | 80 | 0.0.0.0/0 | HTTP（給 Let's Encrypt 驗證、之後跳轉 HTTPS）|
| Inbound | TCP | 443 | 0.0.0.0/0 | HTTPS |
| Outbound | All | All | 0.0.0.0/0 | VM 要能對外打 BytePlus API |

**Public IP**：分配 EIP / 彈性 IP，記下來填進 DNS。

**DNS A record**：`yourdomain.com` 與 `www.yourdomain.com` 都指向 EIP。等 TTL 生效（通常幾分鐘到幾十分鐘）後 `dig yourdomain.com +short` 驗證。

---

## Phase 2 — 系統初始化（VM 內，第一次登入後）

以下都用 `root` 第一次登入後執行。後面建立非 root 使用者後就改用該帳號 + `sudo`。

### 2.1 建立工作帳號、設好 SSH key

```bash
# 建使用者
adduser deploy
usermod -aG sudo deploy

# 從本機把 SSH public key 灌進去
mkdir -p /home/deploy/.ssh
# 把你本機 ~/.ssh/id_ed25519.pub 內容貼進來：
nano /home/deploy/.ssh/authorized_keys
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
```

驗證：另開一個 terminal `ssh deploy@your.vm.ip` 能進得去再做下一步（避免把自己鎖在外面）。

### 2.2 SSH 強化

編輯 `/etc/ssh/sshd_config`：

```text
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
```

```bash
systemctl restart ssh
```

### 2.3 防火牆（雙保險，與 BytePlus Security Group 同層）

```bash
apt update
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

### 2.4 fail2ban

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
```

預設規則就會擋 SSH 暴力破解。

### 2.5 時區與時間同步（**重要：簽章靠 NTP**）

TOS / ARK 的 HMAC v4 簽章對時間極敏感（標準是 ±5 分鐘漂移就 403）。

```bash
timedatectl set-timezone Asia/Taipei   # 或你想用的時區
apt install -y chrony
systemctl enable --now chrony
chronyc tracking   # 看 Last offset 應該是毫秒級
```

### 2.6 swap（小 VM 建議開）

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 2.7 自動安全更新

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # 選 Yes
```

### 2.8 掛 data disk 給 exports/（如果你建了第二顆雲盤）— ⚠️ 已廢棄（見頂部變更通知）

```bash
lsblk            # 確認 data disk 的 device，例如 /dev/vdb
mkfs.ext4 /dev/vdb
mkdir -p /var/lib/byteplus-ai-gen-platform
mount /dev/vdb /var/lib/byteplus-ai-gen-platform
echo '/dev/vdb /var/lib/byteplus-ai-gen-platform ext4 defaults,nofail 0 2' >> /etc/fstab
chown deploy:deploy /var/lib/byteplus-ai-gen-platform
```

之後 app 的 `exports/` 會 symlink 或 bind-mount 到這裡。

---

## Phase 3 — Runtime stack 安裝

接下來都用 `deploy` 帳號操作。

### 3.1 Node 22 LTS（透過 nvm）

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
node -v && npm -v
```

> 為什麼 nvm？專案 `package.json` 要求 Node 20.19+ 或 22.12+，nvm 讓你可以未來輕鬆換版本不影響系統。

### 3.2 Nginx + certbot

```bash
sudo apt install -y nginx
sudo systemctl enable --now nginx

# certbot 用 snap 安裝是 EFF 官方推薦
sudo apt install -y snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

驗證 Nginx：瀏覽器打 `http://your.vm.ip` 看到預設歡迎頁。

---

## Phase 4 — 部署應用

### 4.1 取得程式碼

兩種方式：

**方式 A：直接 git clone**（如果是 public repo 或已設好 deploy key）

```bash
sudo mkdir -p /var/www
sudo chown deploy:deploy /var/www
cd /var/www
git clone <your-repo-url> byteplus-ai-gen-platform
cd byteplus-ai-gen-platform
```

**方式 B：本機 build 完 rsync**（不想 VM 上 build）

```bash
# 本機跑
npm run build
rsync -avz --exclude node_modules --exclude exports ./ deploy@your.vm.ip:/var/www/byteplus-ai-gen-platform/
```

> 建議先用方式 A，VM 上每次 `git pull && npm ci && npm run build` 比較好維運。

### 4.2 安裝相依與 build

```bash
cd /var/www/byteplus-ai-gen-platform
npm ci
npm run build       # 產生 dist/
```

### 4.3 production .env

```bash
cp .env.example .env
nano .env
```

填寫重點（TOS / ARK AKSK 不需要填 — 全部從 UI 輸入，server 不再讀取 `.env` 中的 AKSK）：

```ini
# AKSK 不用填 — 使用者從 UI 輸入，server 端不讀 .env 中的 AKSK

# 如果需要用 npm run tos:bootstrap 手動設定 CORS（通常不需要，UI 驗證時會自動處理），
# 才需要填以下變數：
# TOS_ACCESS_KEY=...
# TOS_SECRET_KEY=...
# TOS_REGION=ap-southeast-1
# TOS_ENDPOINT=tos-ap-southeast-1.bytepluses.com
# TOS_BUCKET=...
# TOS_CORS_ORIGINS=https://yourdomain.com
```

> **不要**設 `VITE_API_BASE_URL`。前端用相對路徑 `/api/...`，由 Nginx → Express proxy 轉到 ARK；如果這個變數有值，瀏覽器會直接打 ARK 不經 proxy（CORS 會死）。
>
> 可選的 server runtime 變數（`PORT` / `EXPORTS_DIR` / `DIST_DIR`）見 `.env.example` 第 4 區。建議在 4.6 的 systemd unit 用 `Environment=` 設定，比放 `.env` 更明確誰管哪一層。

`.env` 的權限建議 `chmod 600`，只 deploy 帳號讀得到。

### 4.4 讓 exports/ 落到 data disk — ⚠️ 已廢棄（見頂部變更通知）

如果 Phase 2.8 掛了第二顆雲盤在 `/var/lib/byteplus-ai-gen-platform`，**推薦用 `EXPORTS_DIR` 環境變數**讓 server 直接讀寫 data disk，不要動 repo 樹：

```ini
# 加進 4.6 的 systemd unit Environment 區塊
Environment=EXPORTS_DIR=/var/lib/byteplus-ai-gen-platform
```

`server/routes/localApi.ts` 與 `server/routes/exportsStatic.ts` 在 router-construction 時讀這個變數，沒設才落到 `process.cwd()/exports`。設了之後 `/local-api/export` 寫的 JSON、`/local-api/download-mp4` 抓的 mp4、`/exports/*` 服務的靜態檔，全都會在 data disk。

**舊的 symlink 寫法（仍可用，作為替代）：**

```bash
rm -rf /var/www/byteplus-ai-gen-platform/exports
ln -s /var/lib/byteplus-ai-gen-platform /var/www/byteplus-ai-gen-platform/exports
```

兩種擇一即可。`EXPORTS_DIR` 的好處是 `git pull` 不會把 symlink 蓋掉、也不需要每次 deploy 都檢查 symlink 還在不在。

### 4.5 TOS bucket CORS（通常自動處理）

使用者在 UI 填入 TOS 憑證並點擊驗證時，server 會自動把當前 origin（即 production 網域）加進 TOS bucket 的 CORS 白名單（idempotent merge）。**一般不需要手動操作。**

如果需要手動設定（例如預先為多個 origin 配 CORS），可以在 `.env` 填入 TOS AKSK 後執行：

```bash
cd /var/www/byteplus-ai-gen-platform
npm run tos:bootstrap        # 會用 TOS_CORS_ORIGINS 寫進 bucket
npm run tos:cors:show        # 確認規則生效
```

### 4.6 systemd service（讓 Node app 開機自啟、崩潰重啟）

`/etc/systemd/system/byteplus-ai-gen-platform.service`：

```ini
[Unit]
Description=BytePlus AI Gen Platform Node server
After=network.target

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/var/www/byteplus-ai-gen-platform
EnvironmentFile=/var/www/byteplus-ai-gen-platform/.env
# 後端進入點是 server/index.ts，用 tsx 直接跑（package.json 沒有 compile 到
# dist-server/ 的步驟，所以不要寫 node server/index.js）。tsx 是 devDep，
# `npm ci` 之後它會在 node_modules/.bin/。
ExecStart=/var/www/byteplus-ai-gen-platform/node_modules/.bin/tsx server/index.ts
Restart=on-failure
RestartSec=5
# 監聽 127.0.0.1:3000，由 Nginx 對外
Environment=PORT=3000
Environment=NODE_ENV=production
# 如果 4.4 選 EXPORTS_DIR 寫法（建議）：
Environment=EXPORTS_DIR=/var/lib/byteplus-ai-gen-platform

[Install]
WantedBy=multi-user.target
```

> 如果想透過 `npm run server:start` 啟動（內部會跑 tsx）而不是直接呼 tsx，把 `ExecStart` 改成 `/home/deploy/.nvm/versions/node/v22.0.0/bin/npm run server:start`，但會多一層 npm 程序，不必要。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now byteplus-ai-gen-platform
sudo systemctl status byteplus-ai-gen-platform
journalctl -u byteplus-ai-gen-platform -f      # 看即時 log
```

驗證：`curl http://127.0.0.1:3000` 應該回到應用首頁 HTML。

---

## Phase 5 — Nginx 反向代理 + Let's Encrypt

### 5.1 先用 HTTP-only 確認連得到

`/etc/nginx/sites-available/byteplus-ai-gen-platform`：

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # 上傳大檔（reference 影片可能上百 MB；視需求調整）
    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;     # 留給長一點的 ARK 推論輪詢
        proxy_send_timeout 600s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/byteplus-ai-gen-platform /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

瀏覽器打 `http://yourdomain.com` 應該看到你的 app。

### 5.2 申請 TLS 憑證

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

certbot 會自動：

1. 用 HTTP-01 challenge 驗證網域擁有權（這就是為什麼要先確定 80 port 通）
2. 改寫 Nginx config 把 80 跳轉到 443
3. 加入 SSL 區塊
4. 設好自動續期 timer（`systemctl list-timers | grep certbot` 可以看到）

### 5.3 補強 HTTPS 設定（手動編 `/etc/nginx/sites-available/byteplus-ai-gen-platform`）

certbot 改完後，建議在 443 server block 加上：

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# gzip（前端 bundle 壓縮率高）
gzip on;
gzip_types text/plain text/css application/json application/javascript application/octet-stream;
gzip_min_length 1024;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

驗證：到 [https://www.ssllabs.com/ssltest/](https://www.ssllabs.com/ssltest/) 跑你的網域，應該拿到 A 或 A+。

---

## Phase 6 — 上線後 sanity check checklist

跑過以下每一項才算真的上線：

- [ ] `dig yourdomain.com +short` 回到 VM EIP
- [ ] `curl -s http://127.0.0.1:3000/health` 回 `{"ok":true}`（最快驗 Express server 起得來）
- [ ] `curl -I https://yourdomain.com` 回 200，header 有 `strict-transport-security`
- [ ] `curl -I http://yourdomain.com` 回 301 → HTTPS
- [ ] 在瀏覽器打開首頁、左側面板輸入 ModelArk API Key + Endpoint ID（依你的 BYO refactor 程度，可能也要輸入 ARK AKSK / TOS AKSK），按提交沒報錯
- [ ] 上傳一張參考圖片 → 看 Network tab 應該有 `PUT https://<bucket>.tos-...bytepluses.com/...?...` 直連 TOS 成功（不是經過你的 server）
- [ ] 觸發一次 Seedance 推論 → 任務跑完 → mp4 下載到 `/var/lib/byteplus-ai-gen-platform/mp4/...`
- [ ] 重開 systemd service `sudo systemctl restart byteplus-ai-gen-platform` 後一切正常
- [ ] `sudo reboot` 後一切正常（驗 systemd 開機自啟）
- [ ] 簽章 sanity check：`chronyc tracking` Last offset < 1 秒
- [ ] 嘗試從 SSH 用密碼登入應該失敗（驗 2.2 的 SSH 設定）

---

## Phase 7 — 維運（上線後一直在做的）

### 7.1 Log 與輪替

- App log：`journalctl -u byteplus-ai-gen-platform -f`
- Nginx access：`/var/log/nginx/access.log`
- Nginx error：`/var/log/nginx/error.log`

logrotate 在 Ubuntu 預設已經會輪替 nginx 跟 systemd journal，不用額外設。如果你的 Node app 自己寫檔，那就要寫 `/etc/logrotate.d/byteplus-ai-gen-platform`。

### 7.2 exports/ 備份 — ⚠️ 已廢棄（見頂部變更通知）

你說重要但不需即時。最簡單就是用 cron 每天打包 + 推到 TOS：

`/home/deploy/backup-exports.sh`：

```bash
#!/bin/bash
set -euo pipefail
DATE=$(date +%Y%m%d)
TARBALL="/tmp/exports-$DATE.tar.gz"
tar -czf "$TARBALL" -C /var/lib/byteplus-ai-gen-platform .
# 用 BytePlus tosutil 或 aws-cli (S3 相容) 把 tarball 丟到一個 backup bucket
tosutil cp "$TARBALL" tos://your-backup-bucket/exports/
rm -f "$TARBALL"
```

```bash
chmod +x /home/deploy/backup-exports.sh
crontab -e
# 加一行：每天 03:00 跑
0 3 * * * /home/deploy/backup-exports.sh >> /home/deploy/backup.log 2>&1
```

### 7.3 部署腳本

`/home/deploy/deploy.sh`：

```bash
#!/bin/bash
set -euo pipefail
cd /var/www/byteplus-ai-gen-platform
git pull --ff-only
npm ci --no-audit --no-fund
npm run build
sudo systemctl restart byteplus-ai-gen-platform
echo "Deployed at $(date)"
```

每次推新版本就 `bash ~/deploy.sh`。等熟練了再考慮加 GitHub Actions 自動拉。

### 7.4 監控 / 警示（最低限度）

- 磁碟：`df -h /var/lib/byteplus-ai-gen-platform` 每週看一下，mp4 累積快的話考慮排程刪 30 天前的
- 記憶體：`free -h`
- BytePlus console 通常有 VM 監控可以設定門檻警示
- HTTPS 憑證：certbot 會自動續期，但建議用 [https://www.uptimerobot.com](https://www.uptimerobot.com) 設一個 free monitor 監你的網域，連帶能抓到憑證過期 / 服務掛掉

### 7.5 安全更新

- `unattended-upgrades` 會自動裝安全 patch
- 每月手動跑一次 `sudo apt update && sudo apt upgrade -y && sudo reboot`
- Node / npm dependency 弱點：定期 `npm audit`

---

## 附錄 A — 環境變數 cheat sheet（部署版）

| 變數 | 開發 | 生產 | 說明 |
|---|---|---|---|
| `TOS_ACCESS_KEY` / `TOS_SECRET_KEY` | 不設 | 不設 | 使用者從 UI 輸入；僅 `tos:bootstrap` CLI 需要 |
| `TOS_REGION` / `TOS_ENDPOINT` / `TOS_BUCKET` | 不設 | 不設 | 同上，使用者從 UI 輸入 |
| `TOS_CORS_ORIGINS` | `http://localhost:5173` | `https://yourdomain.com` | 僅 `tos:bootstrap` CLI 使用；UI verify 會自動加當前 origin |
| `BYTEPLUS_AK` / `BYTEPLUS_SK` / `BYTEPLUS_PROJECT_NAME` | 不設 | 不設 | 使用者從 UI 輸入 |
| `PORT` | (n/a，預設 3000) | `3000`（systemd 設） | Express listen port |
| `NODE_ENV` | `development` | `production` | |
| ~~`EXPORTS_DIR`~~ | — | — | ⚠️ 已廢棄（2026-05-14 起）— server 不再讀寫 `exports/`，export/import 純瀏覽器端 |
| `DIST_DIR` | (n/a，預設 `./dist`) | (n/a，預設即可) | production SPA 資產路徑 |
| `VITE_API_BASE_URL` | (n/a，前端用相對路徑) | **不要設**（會繞過 Express proxy） | |

---

## 附錄 B — 故障排查速查

| 症狀 | 可能原因 | 確認 |
|---|---|---|
| 瀏覽器直傳 TOS 報 CORS 錯 | 當前 origin 未加進 bucket CORS 白名單 | 在 UI 重新驗證 TOS 憑證（會自動 merge 當前 origin 到 CORS），或手動 `npm run tos:bootstrap` |
| ARK / TOS API 回 403 SignatureDoesNotMatch | VM 時間漂移、AKSK 錯、region/endpoint 不一致 | `chronyc tracking`、檢查 UI 中填入的憑證、IAM key 是否還有效 |
| Let's Encrypt 申請失敗 | 80 port 沒開 / DNS 還沒生效 / 域名沒指對 IP | `dig`、`curl -I http://yourdomain.com`、檢查 SG |
| systemctl status byteplus-ai-gen-platform 顯示 failed | Node entry path 錯、env 沒讀到、port 衝突 | `journalctl -u byteplus-ai-gen-platform -n 100` |
| 上傳大檔 413 Request Entity Too Large | Nginx `client_max_body_size` 不夠 | 提高到 500m / 1g 視需求 |
| 推論長時間輪詢 504 Gateway Timeout | Nginx `proxy_read_timeout` 太短 | 提到 600s 以上 |
| `npm ci` 在 VM 失敗（記憶體不足）| 2 GB RAM 機器 build TS 容易 OOM | 開 swap、或本機 build 完 rsync |

---

## 之後可以再做的事（不在本次教程 scope）

- CI/CD：GitHub Actions on push → SSH 進 VM 跑 deploy.sh
- 應用層 auth：Cloudflare Access / Nginx Basic Auth / Auth0，限制誰能用
- exports/ 完全寫 TOS：拿掉本地 disk 依賴、VM 換機無痛
- 多副本 / CLB：當使用者變多再考慮
- ARK / TOS 用量配額警示（在 BytePlus console 設 budget alert）
