
// Fallback admin guard if not defined
function isAdmin(req, res, next) {
  try {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  } catch (e) {}
  return res.status(403).send('Admins only');
}

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const helmet = require('helmet');
const methodOverride = require('method-override');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite3');
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

const db = new Database(DB_PATH);

// ---- DB setup ----
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  template_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(program_id) REFERENCES programs(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS plan_weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  week_number INTEGER NOT NULL,
  week_json TEXT NOT NULL,
  UNIQUE(assignment_id, week_number),
  FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  section TEXT NOT NULL CHECK (section IN ('workout','mobility','throwing')),
  completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date, section)
);
CREATE TABLE IF NOT EXISTS daily_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  UNIQUE(user_id, date)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// default settings
const hasLockSetting = db.prepare("SELECT COUNT(*) c FROM settings WHERE key='lock_future_weeks'").get().c;
if (!hasLockSetting) db.prepare("INSERT INTO settings (key,value) VALUES ('lock_future_weeks','1')").run();

// Seed base program if none
const countPrograms = db.prepare('SELECT COUNT(*) c FROM programs').get().c;
if (countPrograms === 0) {
  const baseWeek = {
    week: {
      Mon: { workout: "Lower body strength + core circuit\\nSquat 3x10 (light-mod)\\nCore: plank 3x45s", mobility: "Hip flow 15m", throwing: "Flat-ground 30 throws @ 60–90 ft" },
      Tue: { workout: "Upper push/pull + scap\\nRows 3x12, Push-ups 3x15", mobility: "T-spine + shoulders 15m", throwing: "Long toss to 90 ft (mechanics)" },
      Wed: { workout: "Movement day: sprints + plyos", mobility: "Ankles + hips 12m", throwing: "Recovery: plyo wall 10m" },
      Thu: { workout: "Lower + med ball", mobility: "Post-workout stretch 10m", throwing: "Bullpen: 20–30 pitches @ 70–80%" },
      Fri: { workout: "Upper + cuff", mobility: "Band series 12m", throwing: "Catch 60–90 ft" },
      Sat: { workout: "Full-body circuit + core", mobility: "Yoga recovery 20m", throwing: "Optional light plyos" },
      Sun: { workout: "OFF", mobility: "Breathing + light mobility 10m", throwing: "OFF" }
    },
    notes: "Week 1 base. Admin → Generate 6-Week per assignment."
  };
  db.prepare('INSERT INTO programs (name, description, template_json) VALUES (?,?,?)')
    .run('Pitchers – Base Week', 'Starter week used to generate multi-week plans.', JSON.stringify(baseWeek));
}

// ---- Helpers ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: { "script-src": ["'self'"], "img-src": ["'self'", "data:"], "style-src": ["'self'", "'unsafe-inline'"] }
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000*60*60*24*7 }
}));

function ensureAuth(req, res, next){ if (req.session.user) return next(); res.redirect('/login'); }
function ensureAdmin(req, res, next){ if (req.session.user && req.session.user.is_admin) return next(); res.status(403).send('Forbidden'); }

function getSetting(key, def=''){ const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? row.value : def; }
function setSetting(key, value){ db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }

function getWeekNumber(start_date){
  const start = new Date(start_date+'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.floor((today - start)/(1000*60*60*24));
  return Math.max(1, Math.floor(diff/7)+1);
}
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function weekDatesFor(start_date, weekNumber){
  const start = new Date(start_date+'T00:00:00');
  const monday = new Date(start); monday.setDate(monday.getDate() + (weekNumber-1)*7);
  const out = [];
  for (let i=0;i<7;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); out.push(d.toISOString().slice(0,10)); }
  return out;
}

// ---- Routes ----
app.get('/', (req,res)=>{ if(req.session.user) return res.redirect('/dashboard'); res.redirect('/login'); });
app.get('/login', (req,res)=> res.render('login', { error:null }));
app.post('/login', (req,res)=>{
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).render('login', { error:'Invalid email or password' });
  req.session.user = { id:user.id, name:user.name, email:user.email, is_admin:!!user.is_admin };
  res.redirect('/dashboard');
});
app.post('/logout', (req,res)=> req.session.destroy(()=>res.redirect('/login')));

// Dashboard (player)
app.get('/dashboard', ensureAuth, (req,res)=>{
  const user = req.session.user;
  const assignment = db.prepare(`SELECT a.*, p.name program_name FROM assignments a JOIN programs p ON p.id=a.program_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT 1`).get(user.id);
  let weekNumber=null, week=null, weekDays=[];
  if (assignment){
    weekNumber = getWeekNumber(assignment.start_date);
    const lock = getSetting('lock_future_weeks','1') === '1';
    if (!lock || weekNumber >= 1){
      const row = db.prepare('SELECT * FROM plan_weeks WHERE assignment_id=? AND week_number=?').get(assignment.id, weekNumber);
      if (row) week = JSON.parse(row.week_json);
      if (week){
        const start = new Date(assignment.start_date+'T00:00:00');
        const monday = new Date(start); monday.setDate(monday.getDate() + (weekNumber-1)*7);
        for (let i=0;i<7;i++){
          const d = new Date(monday); d.setDate(monday.getDate()+i);
          const iso = d.toISOString().slice(0,10);
          const label = DAYS[i];
          const entry = week[label] || {workout:'', mobility:'', throwing:''};
          const comp = {};
          for (const sec of ['workout','mobility','throwing']){
            const c = db.prepare('SELECT completed FROM completions WHERE user_id=? AND date=? AND section=?').get(user.id, iso, sec);
            comp[sec] = c ? !!c.completed : false;
          }
          const noteRow = db.prepare('SELECT note FROM daily_notes WHERE user_id=? AND date=?').get(user.id, iso);
          weekDays.push({ date: iso, label, entry, complete: comp, note: noteRow ? noteRow.note : '' });
        }
      }
    }
  }
  res.render('dashboard', { user, assignment, weekNumber, weekDays });
});

// Player APIs
app.post('/api/complete', ensureAuth, (req,res)=>{
  const { date, section, value } = req.body;
  if (!['workout','mobility','throwing'].includes(section)) return res.status(400).json({ok:false});
  try {
    db.prepare('INSERT INTO completions (user_id,date,section,completed) VALUES (?,?,?,?) ON CONFLICT(user_id,date,section) DO UPDATE SET completed=excluded.completed')
      .run(req.session.user.id, date, section, value ? 1 : 0);
    res.json({ok:true});
  } catch (e) { res.status(500).json({ok:false}); }
});
app.post('/api/note', ensureAuth, (req,res)=>{
  const { date, note } = req.body;
  try {
    db.prepare('INSERT INTO daily_notes (user_id,date,note) VALUES (?,?,?) ON CONFLICT(user_id,date) DO UPDATE SET note=excluded.note')
      .run(req.session.user.id, date, note || '');
    res.json({ok:true});
  } catch (e) { res.status(500).json({ok:false}); }
});

// Admin core
app.get('/admin', ensureAdmin, (req,res)=>{
  const users = db.prepare('SELECT id,name,email,is_admin FROM users ORDER BY id').all();
  const programs = db.prepare('SELECT id,name,updated_at FROM programs ORDER BY id').all();
  const assignments = db.prepare(`
    SELECT a.id, u.id as user_id, u.name user_name, p.name program_name, a.start_date
    FROM assignments a JOIN users u ON u.id=a.user_id JOIN programs p ON p.id=a.program_id
    ORDER BY a.id DESC
  `).all();
  const lock = getSetting('lock_future_weeks','1');
  res.render('admin', { user:req.session.user, users, programs, assignments, lock });
});

app.post('/admin/settings', ensureAdmin, (req,res)=>{
  const { lock_future_weeks } = req.body;
  setSetting('lock_future_weeks', lock_future_weeks === '1' ? '1' : '0');
  res.redirect('/admin');
});

// Programs & assignments
app.get('/admin/programs/:id/edit', ensureAdmin, (req,res)=>{
  const p = db.prepare('SELECT * FROM programs WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).send('Not found');
  res.render('program_edit', { program:p, error:null });
});
app.post('/admin/programs/:id', ensureAdmin, (req,res)=>{
  const { name, description, template_json } = req.body;
  try{ JSON.parse(template_json); }catch{
    const p = db.prepare('SELECT * FROM programs WHERE id=?').get(req.params.id);
    p.name=name; p.description=description; p.template_json=template_json;
    return res.status(400).render('program_edit', { program:p, error:'Template must be valid JSON.' });
  }
  db.prepare('UPDATE programs SET name=?, description=?, template_json=?, updated_at=datetime(\"now\") WHERE id=?')
    .run(name, description, template_json, req.params.id);
  res.redirect('/admin');
});
app.get('/admin/programs/new', ensureAdmin, (req,res)=>{
  const blank = { week: { Mon:{}, Tue:{}, Wed:{}, Thu:{}, Fri:{}, Sat:{}, Sun:{} }, notes:"" };
  res.render('program_edit', { program:{ id:null, name:'', description:'', template_json: JSON.stringify(blank,null,2) }, error:null });
});
app.post('/admin/programs', ensureAdmin, (req,res)=>{
  const { name, description, template_json } = req.body;
  try{ JSON.parse(template_json); }catch{
    return res.status(400).render('program_edit', { program:{ id:null, name, description, template_json }, error:'Template must be valid JSON.' });
  }
  db.prepare('INSERT INTO programs (name, description, template_json) VALUES (?,?,?)').run(name, description, template_json);
  res.redirect('/admin');
});
app.post('/admin/assignments', ensureAdmin, (req,res)=>{
  const { user_id, program_id, start_date } = req.body;
  db.prepare('INSERT INTO assignments (user_id, program_id, start_date) VALUES (?,?,?)').run(user_id, program_id, start_date);
  res.redirect('/admin');
});

// Generate 6-week plan
function generateSixWeekFromBase(baseWeek){
  const weeks = [];
  for (let w=1; w<=6; w++){
    const week = {};
    for (const day of Object.keys(baseWeek.week)){
      const src = baseWeek.week[day] || {workout:'', mobility:'', throwing:''};
      let workout = src.workout, mobility = src.mobility, throwing = src.throwing;
      if (w<=2){ /* base */ }
      else if (w<=4){
        workout = (workout||'') + "\\nProgression: +5–10% load / +1 set where appropriate.";
      } else if (w===5){
        workout = (workout||'') + "\\nPower focus: lower reps, higher intent.";
      } else if (w===6){
        workout = (workout||'') + "\\nDELOAD: reduce load ~20% and volume.";
      }
      week[day] = { workout, mobility: mobility || 'Mobility 10–15m', throwing: src.throwing || '' };
    }
    weeks.push(week);
  }
  const override = [
    "3 days @ 60–90 ft, 30 throws/day, mechanics focus",
    "3–4 days @ 90–120 ft, 35–40 throws/day, introduce pulldowns",
    "4 days @ 90–120 ft, 40 throws/day, light pulldowns",
    "4 days @ 90–120 ft, 40–45 throws/day, maintain mechanics",
    "4 days @ 120–150 ft, 45 throws/day + 10 easy mound pitches",
    "3 days @ 90 ft, 25 throws/day (recovery)"
  ];
  for (let w=0; w<6; w++){ for (const d of Object.keys(weeks[w])){ weeks[w][d].throwing = override[w]; } }
  return weeks;
}

app.post('/admin/generate', ensureAdmin, (req,res)=>{
  const { assignment_id } = req.body;
  const asn = db.prepare(`SELECT a.*, p.template_json FROM assignments a JOIN programs p ON p.id=a.program_id WHERE a.id=?`).get(assignment_id);
  if (!asn) return res.status(404).send('Assignment not found');
  const base = JSON.parse(asn.template_json);
  const weeks = generateSixWeekFromBase(base);
  const insert = db.prepare('INSERT OR REPLACE INTO plan_weeks (assignment_id, week_number, week_json) VALUES (?,?,?)');
  const tx = db.transaction((arr)=>{ for (let i=0;i<arr.length;i++){ insert.run(assignment_id, i+1, JSON.stringify(arr[i])); } });
  tx(weeks);
  res.redirect('/admin');
});

// Reports list
app.get('/admin/reports', ensureAdmin, (req,res)=>{
  const rows = db.prepare(`
    SELECT a.id as assignment_id, a.user_id, a.start_date, u.name user_name, u.email email
    FROM assignments a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC
  `).all();
  const reports = [];
  for (const r of rows){
    const currentWeek = getWeekNumber(r.start_date);
    const plan = db.prepare('SELECT week_json FROM plan_weeks WHERE assignment_id=? AND week_number=?').get(r.assignment_id, currentWeek);
    let pct = 0, done=0, total=0;
    if (plan){
      const dates = weekDatesFor(r.start_date, currentWeek);
      for (const dt of dates){
        for (const sec of ['workout','mobility','throwing']){
          total++;
          const c = db.prepare('SELECT completed FROM completions WHERE user_id=? AND date=? AND section=?').get(r.user_id, dt, sec);
          if (c && c.completed) done++;
        }
      }
      pct = total ? Math.round((done/total)*100) : 0;
    }
    reports.push({ user_id:r.user_id, user_name:r.user_name, email:r.email, start_date:r.start_date, current_week: currentWeek, completion_pct:pct, done, total });
  }

  const recentNotes = db.prepare(`
    SELECT dn.date, u.name user_name, u.email, dn.note, u.id as user_id
    FROM daily_notes dn JOIN users u ON u.id=dn.user_id
    ORDER BY dn.date DESC LIMIT 200
  `).all();

  res.render('admin_reports', { reports, recentNotes });
});

// CSV exports
function csvEscape(v){ if (v==null) return ''; v=String(v); return (v.includes('"')||v.includes(',')||v.includes('\n')) ? '"'+v.replace(/"/g,'""')+'"' : v; }

app.get('/admin/export/completions.csv', ensureAdmin, (req,res)=>{
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="completions.csv"');
  const rows = db.prepare(`
    SELECT u.name user_name, u.email, c.date, c.section, c.completed
    FROM completions c JOIN users u ON u.id=c.user_id
    ORDER BY c.date DESC, u.name
  `).all();
  const header = 'user_name,email,date,section,completed\n';
  const body = rows.map(r=>[r.user_name,r.email,r.date,r.section,r.completed].map(csvEscape).join(',')).join('\n');
  res.send(header+body);
});

app.get('/admin/export/notes.csv', ensureAdmin, (req,res)=>{
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="notes.csv"');
  const rows = db.prepare(`
    SELECT u.name user_name, u.email, dn.date, dn.note
    FROM daily_notes dn JOIN users u ON u.id=dn.user_id
    ORDER BY dn.date DESC, u.name
  `).all();
  const header = 'user_name,email,date,note\n';
  const body = rows.map(r=>[r.user_name,r.email,r.date,r.note].map(csvEscape).join(',')).join('\n');
  res.send(header+body);
});

// ---- Player detail view + printable
app.get('/admin/player/:id', ensureAdmin, (req,res)=>{
  const id = parseInt(req.params.id,10);
  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).send('Player not found');
  const assignment = db.prepare('SELECT * FROM assignments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(id);
  let currentWeek = null, start_date = null, weekDates = [], daily=[], notes=[];
  if (assignment){
    start_date = assignment.start_date;
    currentWeek = getWeekNumber(start_date);
    weekDates = weekDatesFor(start_date, currentWeek);
    // build last 28 days series
    const today = new Date(); today.setHours(0,0,0,0);
    const series = [];
    for (let i=27;i>=0;i--){
      const d = new Date(today); d.setDate(today.getDate()-i);
      const iso = d.toISOString().slice(0,10);
      const comps = ['workout','mobility','throwing'].map(sec => {
        const c = db.prepare('SELECT completed FROM completions WHERE user_id=? AND date=? AND section=?').get(id, iso, sec);
        return c ? (c.completed?1:0) : 0;
      });
      const sum = comps[0]+comps[1]+comps[2]; // 0..3
      series.push({ date: iso, value: sum });
    }
    daily = series;
    notes = db.prepare('SELECT date, note FROM daily_notes WHERE user_id=? ORDER BY date DESC LIMIT 100').all(id);
  }
  res.render('admin_player', { user, assignment, start_date, currentWeek, weekDates, daily: JSON.stringify(daily), notes });
});

app.get('/admin/player/:id/print', ensureAdmin, (req,res)=>{
  const id = parseInt(req.params.id,10);
  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).send('Player not found');
  const assignment = db.prepare('SELECT * FROM assignments WHERE user_id=? ORDER BY id DESC LIMIT 1').get(id);
  let currentWeek = null, start_date = null, weekDates = [], noteRows=[];
  if (assignment){
    start_date = assignment.start_date;
    currentWeek = getWeekNumber(start_date);
    weekDates = weekDatesFor(start_date, currentWeek);
    noteRows = db.prepare('SELECT date, note FROM daily_notes WHERE user_id=? ORDER BY date DESC LIMIT 200').all(id);
  }
  res.render('admin_player_print', { user, assignment, start_date, currentWeek, weekDates, notes: noteRows });
});

// Admin misc
app.post('/admin/users/:id/reset', ensureAdmin, (req,res)=>{
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id);
  res.redirect('/admin');
});

// Init admin
if (process.argv.includes('--init-admin')){
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';
  const name = process.env.ADMIN_NAME || 'Admin';
  const hash = bcrypt.hashSync(pass, 10);
  try { db.prepare('INSERT INTO users (name,email,password_hash,is_admin) VALUES (?,?,?,1)').run(name, email, hash); console.log('Admin created:', email, 'password:', pass); }
  catch (e){ console.log('Admin may already exist:', e.message); }
  process.exit(0);
}

app.listen(PORT, ()=> console.log(`PitchPlan v4 running on http://localhost:${PORT}`));


// --- Admin Backup & Restore ---
app.get('/admin/tools', isAdmin, (req, res) => {
  res.render('admin_backup', { user: (req.session && req.session.user) || null });
});

app.get('/admin/backup', isAdmin, (req, res) => {
  const dbFile = process.env.DB_PATH || './data.sqlite3';
  try {
    return res.download(path.resolve(dbFile), 'pitchplan_backup.sqlite3');
  } catch (e) {
    return res.status(500).send('Backup failed: ' + e.message);
  }
});

app.post('/admin/restore', isAdmin, upload.single('dbfile'), (req, res) => {
  try {
    const dbFile = process.env.DB_PATH || './data.sqlite3';
    if (!req.file) return res.status(400).send('No file uploaded');
    const tempPath = req.file.path;
    const content = fs.readFileSync(tempPath);
    // Quick validation: SQLite file header
    const header = content.slice(0, 15).toString();
    if (!header.startsWith('SQLite format 3')) {
      fs.unlinkSync(tempPath);
      return res.status(400).send('Invalid SQLite database');
    }
    const backupPath = dbFile + '.pre-restore.bak';
    try {
      if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, backupPath);
    } catch {}
    fs.copyFileSync(tempPath, dbFile);
    fs.unlinkSync(tempPath);
    return res.redirect('/admin/tools?restored=1');
  } catch (e) {
    return res.status(500).send('Restore failed: ' + e.message);
  }
});
// --- end Backup & Restore ---
