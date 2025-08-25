# PitchPlan v4.1 — Deploy Edition (Clean)

Per-player weekly pitching plans with checkboxes, notes, auto 6-week progression, coach reports, charts, and printable reports.

---

## 🚀 One‑Click Deploy

> **Step 0**: Upload this folder to a new GitHub repo first.  
> **Step 1**: Click a button below and follow the prompts.

### Render
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/YOUR_USERNAME/YOUR_REPO)

### Railway
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/YOUR_USERNAME/YOUR_REPO)

---

## 🔑 Environment Variables
Fill these in when deploying:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

Optional:
- `ADMIN_NAME`
- `DB_PATH`


---

### Backup & Restore (v4.2)
- Admin Tools page: `/admin/tools`
- **Download**: `/admin/backup`
- **Restore**: POST `/admin/restore` (via the form on `/admin/tools`)
- Requires admin login.
