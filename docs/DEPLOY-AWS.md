# Deploying ROAMR on AWS (Lightsail, Sydney)

```
browser ──► Lightsail instance roamr-api (ap-southeast-2, static IP)
              Caddy :443 (HTTPS certificate, gzip)
                └─► Node server :3001 ── web app (web/dist) and /api/*
                                         SQLite at /opt/roamr/data/roamr.db
```

The web app and the API run as **one deployment** on one instance: the Docker image builds `web/` and the server serves it next to `/api`, so there is no Vercel, no CORS and the `sid` cookie (HttpOnly, SameSite=Lax, Secure) is first-party on the site's own domain. This replaces the Vercel + Fly.io setup in [DEPLOY.md](DEPLOY.md); its Google, Resend and Midtrans steps still apply, with secrets going in `/opt/roamr/.env` on the instance instead of `fly secrets set`, and `https://<SITE_HOST>` as the site address.

**Why Lightsail and not EC2, ECS or Lambda.** The server keeps SQLite and the live-chat hub in one process, so it needs exactly one always-on machine with a disk. Lightsail is EC2 with a fixed monthly price that already includes the disk, a static IP and 1 TB of traffic. Serverless options would lose the database and break live chat.

| Item | Cost |
|---|---|
| Lightsail Linux, 1 GB RAM, 2 vCPU, 40 GB SSD, 1 TB transfer (`micro_3_2`) | about $7 / month |
| Static IP (attached) | free |
| Automatic daily snapshots (7 kept) | storage at about $0.05 / GB-month |

The project can only create resources in its selected Region, **ap-southeast-2 (Sydney)**. Jakarta round trips are roughly 90–100 ms more than Singapore; fine for the alpha.

## 1. Create the instance (once)

With the AWS CLI signed in to the `roamr` profile:

```bash
export AWS_PROFILE=roamr AWS_REGION=ap-southeast-2

aws lightsail create-instances --instance-names roamr-api \
  --availability-zone ap-southeast-2a --blueprint-id ubuntu_24_04 --bundle-id micro_3_2 \
  --user-data 'curl -fsSL https://raw.githubusercontent.com/fadilaisy/testingagent/main/deploy/aws/setup-instance.sh | bash'

aws lightsail allocate-static-ip --static-ip-name roamr-api-ip
aws lightsail attach-static-ip --static-ip-name roamr-api-ip --instance-name roamr-api

# Web traffic only; SSH stays limited to Lightsail's browser console and your key.
aws lightsail put-instance-public-ports --instance-name roamr-api --port-infos \
  fromPort=22,toPort=22,protocol=tcp fromPort=80,toPort=80,protocol=tcp fromPort=443,toPort=443,protocol=tcp

# Daily snapshot at 01:00 WIB (18:00 UTC).
aws lightsail enable-add-on --resource-name roamr-api \
  --add-on-request 'addOnType=AutoSnapshot,autoSnapshotAddOnRequest={snapshotTimeOfDay=18:00}'
```

`deploy/aws/setup-instance.sh` runs on first boot: it adds swap, installs Docker, clones the repo to `/opt/roamr/app` and writes `/opt/roamr/.env` with `SITE_HOST=<ip-with-dashes>.sslip.io`, a free hostname that resolves to the IP so Caddy can get an HTTPS certificate before you have a domain. First boot happens before the static IP is attached, so run `sudo /opt/roamr/app/deploy/aws/setup-instance.sh` once more after attaching it; that switches the sslip.io name to the static IP.

## 2. Settings and first start

Connect with **Lightsail console → roamr-api → Connect using SSH**, then:

```bash
sudo /opt/roamr/app/deploy/aws/setup-instance.sh   # picks up the static IP
sudo nano /opt/roamr/.env        # ADMIN_EMAILS, SIGNUP_CODE, optional keys
cd /opt/roamr/app/deploy/aws && sudo docker compose up -d --build
curl https://$(sudo grep ^SITE_HOST= /opt/roamr/.env | cut -d= -f2)/api/health    # {"ok":true}
```

Open `https://<SITE_HOST>`, register with your admin email and the invite code, and check that `/admin` loads.

`NODE_ENV`, `PORT`, `DATABASE_FILE=/data/roamr.db` and `TRUST_PROXY=1` (Caddy is the only proxy) are fixed in `deploy/aws/compose.yml`. Every other setting from `.env.example` goes in `/opt/roamr/.env`, which only root can read.

## Moving data from Fly (optional)

Only if the Fly app already has real users. Stop writes first, then:

```bash
fly ssh sftp get /data/jalur.db ./roamr.db       # from your computer
# upload roamr.db with the Lightsail SSH window's upload button, then on the instance:
sudo docker compose -f /opt/roamr/app/deploy/aws/compose.yml stop app
sudo mv ~/roamr.db /opt/roamr/data/roamr.db
sudo docker compose -f /opt/roamr/app/deploy/aws/compose.yml start app
```

Keep the Fly volume until the AWS site has run for a while, then delete the Fly app and the Vercel project to stop their billing.

## Day to day

- **Deploy:** `sudo /opt/roamr/app/deploy/aws/update.sh` pulls `main` and rebuilds. A few seconds of downtime; live chat reconnects by itself.
- **Logs** (including password-reset links while email is off): `sudo docker compose -f /opt/roamr/app/deploy/aws/compose.yml logs -f app`
- **Backups:** Lightsail keeps 7 daily snapshots. Take a manual one before risky changes: `aws lightsail create-instance-snapshot --instance-name roamr-api --instance-snapshot-name before-<change>`.
- **One instance only.** Don't add a load balancer or a second instance: SQLite and live chat are in-process.
- **Domain:** add an `A` record for the domain → the static IP, set `SITE_HOST` and `PUBLIC_URL` to it in `/opt/roamr/.env`, then `sudo docker compose up -d` in `deploy/aws`. Update the Google callback and Midtrans notification URLs to the new domain.
- **Free plan:** the AWS project's free plan ends 2027-04-22. Upgrade to the paid plan in AWS Settings before then, or the project and this instance stop.

## Later: PostgreSQL

The PRD's target is PostgreSQL + PostGIS; SQLite stays for now. When the server moves to Postgres, this setup keeps working: add a Lightsail managed database (or Amazon RDS) in the same Region, put its connection string in `/opt/roamr/.env`, and copy the data across once. Live chat still needs a single app instance until it moves off the in-process hub.
