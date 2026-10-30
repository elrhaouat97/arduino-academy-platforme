/* ============================================================
   أكاديمية الأردوينو والروبوتات — منطق التطبيق (يعمل دون إنترنت)
   - الحسابات والتقدم: localStorage على هذا الحاسوب فقط
   - كلمات السر: لا تُحفظ أبدًا كما هي، بل بصمة SHA-256 مع ملح عشوائي
   - الجولة الثالثة (Hybrid & Completion): لوحة أستاذ #/teacher بتجميع
     ذاكري فقط، مفتاح أستاذ .academykey ببصمة محفوظة يحمي الاستعادة،
     تمرين «ملعب الكود» شرط إضافي لفتح الشهادة فوق إتمام الدروس،
     أسئلة تدريب quizExtra غير المُقيَّمة، روابط «راجع الفقرة» من حقل
     section، وإطار موجّه عام لكل التجارب. المزامنة السحابية طبقة
     منفصلة (sync.js + sync-config.js) تُحمَّل عند ضغط زرها فقط —
     هذا الملف لا يعرف الشبكة إطلاقًا.
   ============================================================ */
"use strict";

const DB_KEY = "arduinoAcademyDB.v1";
const SESSION_KEY = "arduinoAcademySession.v1";
const DATA = window.ACADEMY_DATA;
const TOTAL_LESSONS = DATA.lessons.length;

/* ---------- أدوات صغيرة ---------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const app = () => $("#app");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pad2(n) { return String(n).padStart(2, "0"); }
function videoPath(lesson) { return "videos/L" + lesson.level + "-" + pad2(lesson.num) + ".mp4"; }
function captionPath(lesson) { return "captions/L" + lesson.level + "-" + pad2(lesson.num) + ".vtt"; }
function lessonKey(lesson) { return "L" + lesson.level + "-" + pad2(lesson.num); }
/* معرّف فيديو يوتيوب للدرس إن نُشر على قناة النادي (الخريطة في youtube-data.js) */
function ytId(lesson) {
  const m = window.ACADEMY_YT || {};
  const id = m[lessonKey(lesson)];
  return (typeof id === "string" && /^[A-Za-z0-9_-]{6,}$/.test(id)) ? id : null;
}
function localVideoHTML(l) {
  return '<video class="lesson-video" controls preload="metadata" src="' + videoPath(l) + '">' +
    '<track kind="captions" src="' + captionPath(l) + '" srclang="ar" label="العربية" default></video>';
}
/* الدرس التالي/السابق عابرًا لحدود المستويات: نهاية مستوى تصل ببداية الموالي */
function nextLessonAfter(l) {
  const same = DATA.lessons.filter(x => x.level === l.level && x.num === l.num + 1)[0];
  if (same) return same;
  return DATA.lessons.filter(x => x.level === l.level + 1 && x.num === 1)[0] || null;
}
function prevLessonBefore(l) {
  const same = DATA.lessons.filter(x => x.level === l.level && x.num === l.num - 1)[0];
  if (same) return same;
  const prevLevel = DATA.lessons.filter(x => x.level === l.level - 1).sort((a, b) => a.num - b.num);
  return prevLevel.length ? prevLevel[prevLevel.length - 1] : null;
}
function lessonById(id) { return DATA.lessons.find(l => l.id === id); }
function levelByN(n) { return DATA.levels.find(l => l.n === Number(n)); }
function levelIconPath(n) { return "assets/level-" + n + ".png"; }
function levelComplete(rec, n) { const st = levelStats(rec, n); return st.total > 0 && st.done === st.total; }

/* ---------- قاعدة البيانات المحلية ---------- */
let dbDamaged = false; /* وُجدت بيانات محفوظة على هذا الحاسوب لكنها تالفة لا تُقرأ */

function storageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
function storageRemove(key) { try { localStorage.removeItem(key); } catch (e) { /* تجاهل */ } }

function loadDB() {
  const raw = storageGet(DB_KEY);
  if (raw == null) return { users: {} };
  let db = null;
  try { db = JSON.parse(raw); } catch (e) { db = null; }
  if (db && typeof db === "object" && db.users && typeof db.users === "object" && !Array.isArray(db.users)) {
    /* تنقية خفيفة: أي قيمة ليست كائنًا لا يمكن أن تكون سجل حساب صالحًا —
       تُستبعد من النسخة المقروءة حتى لا تعطّل بقية الحسابات */
    const clean = {};
    for (const k of Object.keys(db.users)) {
      const r = db.users[k];
      if (r && typeof r === "object" && !Array.isArray(r)) clean[k] = r;
    }
    db.users = clean;
    return db;
  }
  /* بيانات موجودة لكن تالفة: لا نستبدلها بصمت — نحتفظ بنسخة احتياطية منها ونُعلِم الواجهة */
  dbDamaged = true;
  try { if (!localStorage.getItem(DB_KEY + ".bak")) localStorage.setItem(DB_KEY + ".bak", raw); } catch (e) { /* تجاهل */ }
  return { users: {} };
}
function saveDB(db) {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
  catch (e) { return false; }
}
/* بحث آمن عن حساب: hasOwnProperty حتى لا تُحتسب خصائص موروثة مثل constructor حسابًا */
function hasUser(db, username) {
  return !!db && !!db.users && Object.prototype.hasOwnProperty.call(db.users, username) &&
    !!db.users[username] && typeof db.users[username] === "object";
}
function currentUsername() { return storageGet(SESSION_KEY) || null; }
function currentUser() {
  const u = currentUsername();
  if (!u) return null;
  const db = loadDB();
  return hasUser(db, u) ? { key: u, rec: db.users[u] } : null;
}
function getProgress(rec, lessonId) {
  if (!rec.progress) rec.progress = {};
  if (!rec.progress[lessonId]) rec.progress[lessonId] = { done: false, quizBest: null, quizTotal: null, quizScore: null, quizPassed: false };
  return rec.progress[lessonId];
}
/* (لا توجد دالة تعديل عامة للتقدم: الكتابة الوحيدة على progress تتم
   عبر recordQuizAttempt أدناه، حتى لا يُضبط done إلا باجتياز اختبار) */
function levelStats(rec, levelN) {
  const ls = DATA.lessons.filter(l => l.level === levelN);
  const done = ls.filter(l => isPassed(rec.progress && rec.progress[l.id], l)).length;
  return { total: ls.length, done, pct: ls.length ? Math.round(done / ls.length * 100) : 0 };
}

/* ---------- قاعدة إتمام الدرس: اجتياز الاختبار فقط ----------
   لا يوجد أي تعليم يدوي: الدرس يُحتسب منجزًا (done) فقط عندما يجيب
   التلميذ عن جميع أسئلة اختبار الدرس ويحصل على QUIZ_PASS_MIN صحيحة
   على الأقل (3 من 4). إعادة المحاولة بلا حدود، والفشل بعد النجاح
   لا يلغي الإتمام أبدًا. */
const QUIZ_PASS_MIN = 3;
function quizPassScore(total) { return Math.min(QUIZ_PASS_MIN, total); }
/* الإتمام الحقيقي يُشتق من دليل الاجتياز المسجل، لا من علم الإتمام وحده:
   لا يُحتسب الدرس منجزًا إلا إذا وُجد اجتياز مسجل (quizPassed) وأفضل نتيجة
   بلغت حد الاجتياز في اختبار كامل الأسئلة. سجل قديم أو متلاعب به يحمل علم
   الإتمام بلا هذا الدليل لا يُحتسب منجزًا في أي مكان (تقدم، شهادات...). */
function isPassed(p, lesson) {
  if (!p || p.quizPassed !== true) return false;
  const total = lesson && lesson.quiz ? lesson.quiz.length : 0;
  return total > 0 && p.quizTotal === total &&
    typeof p.quizBest === "number" && p.quizBest >= quizPassScore(total);
}
function gradeQuiz(lesson, chosenValues) {
  let score = 0, answered = 0;
  const per = lesson.quiz.map((q, qi) => {
    const v = chosenValues[qi];
    if (v === null || v === undefined) return { answered: false, correct: false };
    answered++;
    const correct = Number(v) === q.answer;
    if (correct) score++;
    return { answered: true, correct };
  });
  const total = lesson.quiz.length;
  const complete = answered === total;
  return { per, score, answered, total, complete, passed: complete && score >= quizPassScore(total) };
}
/* ownerUsername: الحساب الذي فتح الدرس (تلتقطه صفحة الدرس عند العرض) حتى
   تُنسب النتيجة لصاحبها ولو تغيّرت جلسة الدخول في نافذة أخرى أثناء الحل */
function recordQuizAttempt(lesson, score, ownerUsername) {
  const db = loadDB();
  const u = ownerUsername || currentUsername();
  if (!u || !hasUser(db, u)) return null;
  const rec = db.users[u];
  const p = getProgress(rec, lesson.id);
  const total = lesson.quiz ? lesson.quiz.length : 0;
  const passed = total > 0 && score >= quizPassScore(total);
  p.quizScore = score;
  p.quizTotal = total;
  if (typeof p.quizBest !== "number" || score > p.quizBest) p.quizBest = score;
  if (passed) { p.quizPassed = true; p.done = true; }
  p.updatedAt = Date.now();
  /* أول مرة يكتمل فيها المستوى: اختم تاريخ إتمامه لتطبعه الشهادة */
  if (passed && levelComplete(rec, lesson.level)) {
    if (!rec.levelDates) rec.levelDates = {};
    if (!rec.levelDates[lesson.level]) rec.levelDates[lesson.level] = Date.now();
  }
  const saved = saveDB(db);
  return { score, total, passed, done: isPassed(p, lesson), quizBest: p.quizBest, saved };
}

/* ---------- تشفير كلمة السر (SHA-256 + ملح) ---------- */
function randomSalt() {
  const a = new Uint8Array(16);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
  else {
    /* ملاذ أخير عند غياب المولّد الآمن (لا يحدث في المتصفحات الحديثة):
       بذرة مخلوطة من الوقت ودقته لضمان اختلاف الملح من حساب لآخر */
    let seed = (Date.now() ^ ((window.performance && performance.now) ? Math.floor(performance.now() * 1000) : 0)) >>> 0;
    for (let i = 0; i < a.length; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345 + Math.floor(Math.random() * 256)) >>> 0;
      a[i] = (seed >>> 8) & 0xff;
    }
  }
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}

/* SHA-256 مكتوبة بـ JavaScript خالصة: تعمل دون إنترنت ودون SubtleCrypto
   (الذي قد يغيب في بعض سياقات فتح الملفات المحلية)، وتُنتج بصمة مطابقة
   تمامًا لبصمة التنفيذ الأصلي في المتصفح */
function utf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) { bytes.push(0xc0 | (c >> 6)); bytes.push(0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const cp = 0x10000 + ((c - 0xd800) << 10) + (str.charCodeAt(++i) - 0xdc00);
      bytes.push(0xf0 | (cp >> 18)); bytes.push(0x80 | ((cp >> 12) & 0x3f));
      bytes.push(0x80 | ((cp >> 6) & 0x3f)); bytes.push(0x80 | (cp & 0x3f));
    } else { bytes.push(0xe0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)); }
  }
  return bytes;
}
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function sha256Hex(text) {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0); /* النصف العالي من طول البتات (صفر لنصوصنا القصيرة) */
  bytes.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < bytes.length; block += 64) {
    for (let t = 0; t < 16; t++) {
      const i = block + t * 4;
      w[t] = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, "0")).join("");
}

async function hashPassword(password, salt) {
  const text = salt + "::" + password;
  if (window.crypto && crypto.subtle && crypto.subtle.digest) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  }
  /* نفس الخوارزمية دائمًا (SHA-256)، حتى لا يعتمد الدخول على بيئة المتصفح */
  return sha256Hex(text);
}
/* بصمة FNV القديمة: لا تُنشئ حسابات أبدًا؛ تُستعمل فقط للتحقق من حسابات
   قديمة تحمل بصمة fnv: قبل ترحيلها إلى SHA-256 عند أول دخول ناجح */
function fnvHash(password, salt) {
  const text = salt + "::" + password;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + text.charCodeAt(i), 0x811c9dc5) >>> 0;
  }
  return "fnv:" + h1.toString(16) + h2.toString(16) + text.length;
}
async function verifyPassword(rec, password) {
  if (rec.hash && rec.hash.indexOf("fnv:") === 0) return fnvHash(password, rec.salt) === rec.hash;
  return (await hashPassword(password, rec.salt)) === rec.hash;
}
/* نسخة خوارزمية البصمة الحالية: تُسجَّل مع كل حساب حتى تعرف المنصة مستقبلًا
   كيف تحقّق من بصمته ومتى ترحّله، بدل تخمين الخوارزمية من شكل البصمة */
const HASH_ALGO = "sha256-v1";
async function makePasswordRecord(password) {
  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  return { salt, hash, hashAlgo: HASH_ALGO };
}

/* ---------- النسخ الاحتياطي والاستعادة (تصدير/استيراد) ----------
   صيغة مُصدَّرة ذات نسخة واضحة؛ الاستيراد يتحقق من البنية أولًا، ويدمج
   الحسابات دمجًا: لا يحذف أي حساب موجود غير مذكور في النسخة أبدًا،
   والتعارض يُحسم باختيار صريح من المستخدم (استبدال أو تخطٍّ) */
const BACKUP_FORMAT = "arduino-academy-backup";
const BACKUP_VERSION = 1;
function buildBackup(db) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), users: db.users };
}
function validateBackup(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "الملف ليس نسخة احتياطية صالحة." };
  if (obj.format !== BACKUP_FORMAT) return { ok: false, error: "هذا الملف ليس نسخة احتياطية صادرة من منصة أكاديمية الأردوينو." };
  if (typeof obj.version !== "number" || obj.version < 1) return { ok: false, error: "نسخة الصيغة غير معروفة." };
  if (obj.version > BACKUP_VERSION) return { ok: false, error: "هذه النسخة أحدث من نسختك من المنصة — حدّث المنصة أولًا ثم أعد الاستيراد." };
  if (!obj.users || typeof obj.users !== "object" || Array.isArray(obj.users)) return { ok: false, error: "النسخة لا تحتوي قائمة حسابات صالحة." };
  const users = {};
  for (const name of Object.keys(obj.users)) {
    const r = obj.users[name];
    if (!r || typeof r !== "object" || Array.isArray(r) ||
        typeof r.name !== "string" || typeof r.salt !== "string" || typeof r.hash !== "string") {
      return { ok: false, error: "سجل الحساب «" + name + "» في النسخة غير مكتمل (الاسم/الملح/البصمة) — أُلغي الاستيراد كله حفاظًا على بياناتك." };
    }
    users[name] = {
      name: r.name, salt: r.salt, hash: r.hash,
      hashAlgo: typeof r.hashAlgo === "string" ? r.hashAlgo : undefined,
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
      progress: (r.progress && typeof r.progress === "object" && !Array.isArray(r.progress)) ? r.progress : {},
      levelDates: (r.levelDates && typeof r.levelDates === "object" && !Array.isArray(r.levelDates)) ? r.levelDates : undefined,
      playgroundPassed: (r.playgroundPassed && typeof r.playgroundPassed === "object" && !Array.isArray(r.playgroundPassed)) ? r.playgroundPassed : undefined,
      lastLessonId: typeof r.lastLessonId === "string" ? r.lastLessonId : undefined
    };
  }
  return { ok: true, users };
}
function mergeBackup(db, importedUsers, overwrite) {
  const res = { added: [], replaced: [], skipped: [] };
  for (const name of Object.keys(importedUsers)) {
    if (hasUser(db, name)) {
      if (overwrite) { db.users[name] = importedUsers[name]; res.replaced.push(name); }
      else res.skipped.push(name);
    } else { db.users[name] = importedUsers[name]; res.added.push(name); }
  }
  return res;
}
/* استعادة بمساعدة الأستاذ: إعادة تعيين كلمة سر حساب موجود مع الحفاظ على
   اسمه وتقدّمه كاملًا. لا توجد «كلمة سر أستاذ» سرية في منصة محلية — الضمان
   هو حضور الأستاذ فعليًا بجانب التلميذ في القسم، كما هو موضّح في الواجهة */
async function resetAccountPassword(username, newPassword) {
  const db = loadDB();
  if (!hasUser(db, username)) return false;
  const pw = await makePasswordRecord(newPassword);
  const rec = db.users[username];
  rec.salt = pw.salt; rec.hash = pw.hash; rec.hashAlgo = pw.hashAlgo;
  return saveDB(db);
}

/* ---------- أداة تنزيل ملف نصي (النسخة الاحتياطية/CSV/مفتاح الأستاذ) ---------- */
function downloadFile(name, text, type) {
  try {
    const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) { /* تجاهل */ } }, 4000);
    return true;
  } catch (e) { return false; }
}

/* ---------- مفتاح الأستاذ (USB) — الجولة الثالثة ----------
   يولّد الأستاذ من المنصة ملف مفتاح بامتداد .academykey يحمل سرًّا عشوائيًا؛
   تُحفظ بصمة SHA-256 لسرّه (مع ملح) في قاعدة بيانات جهاز القسم، وتتطلب
   الاستعادة رفع ملف يطابق سرُّه تلك البصمة. صراحة: هذا رادع محلي وفحص
   حيازة ملف على حاسوب القسم — ليس حماية بمستوى الخوادم، لأن كل التحقق
   يجري داخل متصفح الجهاز نفسه. عند غياب مفتاح مهيأ تبقى الاستعادة بنمط
   الحضور المشرف من الجولة الثانية. */
const TEACHER_KEY_FORMAT = "arduino-academy-teacher-key";
function teacherKeyConfigured(db) {
  return !!(db && db.teacherKey && typeof db.teacherKey.hash === "string" && db.teacherKey.hash &&
            typeof db.teacherKey.salt === "string" && db.teacherKey.salt);
}
async function createTeacherKey() {
  const secret = randomSalt() + randomSalt();
  const salt = randomSalt();
  const hash = await hashPassword(secret, salt);
  const db = loadDB();
  db.teacherKey = { salt, hash, hashAlgo: HASH_ALGO, createdAt: Date.now() };
  if (!saveDB(db)) return null;
  return { format: TEACHER_KEY_FORMAT, version: 1, secret, createdAt: new Date().toISOString() };
}
function parseTeacherKeyFile(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "الملف ليس ملف مفتاح صالحًا." };
  if (obj.format !== TEACHER_KEY_FORMAT) return { ok: false, error: "هذا الملف ليس ملف مفتاح أستاذ صادرًا من المنصة." };
  if (typeof obj.secret !== "string" || obj.secret.length < 16) return { ok: false, error: "ملف المفتاح ناقص أو تالف (لا سرّ صالح فيه)." };
  return { ok: true, secret: obj.secret };
}
async function verifyTeacherKeySecret(secret) {
  const db = loadDB();
  if (!teacherKeyConfigured(db) || typeof secret !== "string" || !secret) return false;
  const h = await hashPassword(secret, db.teacherKey.salt);
  return h === db.teacherKey.hash;
}

/* ---------- ملعب الكود: تمرين برمجي ختامي لكل مستوى — الجولة الثالثة ----------
   شرط الشهادة الجديد (بطلب الموجز): إتمام دروس المستوى باختباراتها + اجتياز
   تمرين كود قصير واحد لكل مستوى. الفاحص متسامح: يتجاهل المسافات وحالة
   الأحرف، ويقبل صيغًا صحيحة مكافئة مذكورة في البدائل. */
const PLAYGROUNDS = {
  1: { title: "تهيئة منفذ وإشعال صمام",
       prompt: "هيّئ المنفذ 13 مخرجًا، ثم أشعل الصمام المتصل به — اكتب السطرين بنفسك.",
       hint: "pinMode(13, OUTPUT);\ndigitalWrite(13, HIGH);",
       needs: ["pinmode(13,output)", "digitalwrite(13,high)"] },
  2: { title: "شرط قراءة زر",
       prompt: "اكتب سطر شرط يتحقق من أن الزر المتصل بالمنفذ 2 مضغوط (قراءته HIGH)، وافتح قوس كتلة الشرط.",
       hint: "if (digitalRead(2) == HIGH) {",
       needs: [["if(digitalread(2)==high)", "if(digitalread(2)==1)", "if(digitalread(2))"]] },
  3: { title: "قراءة تماثلية من حساس",
       prompt: "اكتب سطرًا يقرأ قيمة حساس الضوء من المنفذ التماثلي A0 ويخزّنها في متغير اسمه lightValue.",
       hint: "int lightValue = analogRead(A0);",
       needs: ["lightvalue=", "analogread(a0)"] },
  4: { title: "تحريك محرك إلى الأمام",
       prompt: "حرّك المحرك الأيسر إلى الأمام بأقصى سرعة: IN1 على المنفذ 7 (HIGH)، وIN2 على المنفذ 6 (LOW)، وسرعة ENA على المنفذ 9 بقيمة 255 — اكتب الأسطر الثلاثة.",
       hint: "digitalWrite(7, HIGH);\ndigitalWrite(6, LOW);\nanalogWrite(9, 255);",
       needs: ["digitalwrite(7,high)", "digitalwrite(6,low)", "analogwrite(9,255)"] },
  5: { title: "إشعال LED في ESP32",
       prompt: "أشعل الصمام الداخلي في لوحة ESP32 المتصل بالمنفذ GPIO 2.",
       hint: "digitalWrite(2, HIGH);",
       needs: ["digitalwrite(2,high)"] }
};
function playgroundSquish(text) { return String(text || "").toLowerCase().replace(/\s+/g, ""); }
function checkPlayground(level, text) {
  const pg = PLAYGROUNDS[level];
  if (!pg) return false;
  const code = playgroundSquish(text);
  if (!code) return false;
  return pg.needs.every(need =>
    Array.isArray(need) ? need.some(alt => code.includes(alt)) : code.includes(need));
}
function recordPlaygroundPass(level) {
  const u = currentUsername();
  if (!u) return null;
  const db = loadDB();
  if (!hasUser(db, u)) return null;
  const rec = db.users[u];
  if (!rec.playgroundPassed || typeof rec.playgroundPassed !== "object") rec.playgroundPassed = {};
  if (rec.playgroundPassed[level]) return { saved: true, already: true };
  rec.playgroundPassed[level] = Date.now();
  return { saved: saveDB(db), already: false };
}
/* فتح الشهادة = إتمام كل دروس المستوى (قاعدة الجولتين الأولى والثانية كما هي)
   + اجتياز تمرين ملعب الكود لهذا المستوى (شرط أضافه موجز الجولة الثالثة) */
function certificateUnlocked(rec, n) {
  return levelComplete(rec, n) && !!(rec && rec.playgroundPassed && rec.playgroundPassed[n]);
}

/* ---------- لوحة الأستاذ: تجميع نتائج القسم في الذاكرة فقط ----------
   الاستيراد إلى اللوحة لا يكتب في قاعدة بيانات هذا الحاسوب إطلاقًا:
   تُبنى الصفوف من خريطة حسابات في ذاكرة الصفحة وتُنسى بإعادة التحميل */
function buildTeacherRows(users) {
  return Object.keys(users || {}).sort().map(username => {
    const rec = users[username] || {};
    let currentLevel = null, doneCount = 0, earned = 0, possible = 0;
    for (let n = 1; n <= 5; n++) {
      const st = levelStats(rec, n);
      doneCount += st.done;
      if (currentLevel === null && st.done < st.total) currentLevel = n;
    }
    DATA.lessons.forEach(l => {
      const p = rec.progress && rec.progress[l.id];
      if (p && typeof p.quizBest === "number" && p.quizTotal) { earned += p.quizBest; possible += p.quizTotal; }
    });
    const dates = {};
    for (let n = 1; n <= 5; n++) {
      const ts = rec.levelDates && rec.levelDates[n];
      if (ts) { const d = new Date(ts); dates[n] = d.getFullYear() + "/" + pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()); }
    }
    return { username, name: rec.name || username, currentLevel, allComplete: currentLevel === null,
             doneCount, totalLessons: TOTAL_LESSONS, earned, possible, dates };
  });
}
function teacherRowsToCSV(rows) {
  const cell = v => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
  const head = ["الاسم الكامل", "اسم المستخدم", "المستوى الحالي", "دروس منجزة", "نقاط الاختبارات (مجموع أفضل النتائج)", "من أصل",
    "تاريخ إتمام المستوى 1", "تاريخ إتمام المستوى 2", "تاريخ إتمام المستوى 3", "تاريخ إتمام المستوى 4", "تاريخ إتمام المستوى 5"];
  const lines = [head.map(cell).join(",")];
  rows.forEach(r => {
    lines.push([r.name, r.username, r.allComplete ? "أكمل كل المستويات" : "المستوى " + r.currentLevel,
      r.doneCount + " / " + r.totalLessons, r.earned, r.possible,
      r.dates[1] || "", r.dates[2] || "", r.dates[3] || "", r.dates[4] || "", r.dates[5] || ""].map(cell).join(","));
  });
  return "\ufeff" + lines.join("\r\n"); /* BOM حتى يقرأ Excel العربية سليمة */
}

/* ---------- المزامنة السحابية الاختيارية (تُحمَّل عند الطلب فقط) ----------
   لا شيء هنا يلمس الشبكة: الزر يحقن sync-config.js ثم sync.js من مجلد المنصة
   نفسه لحظة الضغط فقط، والملفان منفصلان تمامًا عن ملفات المنصة الأساسية */
function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error("تعذّر تحميل " + src));
    document.head.appendChild(s);
  });
}
async function startCloudSync() {
  const msg = $("#sync-msg");
  const say = t => { if (msg) msg.textContent = t; };
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
    say("أنت غير متصل بالإنترنت الآن — المزامنة تحتاج اتصالًا. لا بأس: المنصة وتقدّمك يعملان كالمعتاد دون إنترنت، وعُد إلى هذا الزر عندما يتوفر الاتصال.");
    return;
  }
  try {
    if (!window.ACADEMY_SYNC_CONFIG) await loadScriptOnce("sync-config.js");
    await loadScriptOnce("sync.js");
    if (window.AcademySync && typeof window.AcademySync.open === "function") window.AcademySync.open();
    else say("تعذّرت بداية وحدة المزامنة في هذا المتصفح.");
  } catch (e) {
    say("تعذّر تحميل وحدة المزامنة — تأكد أن ملفي sync-config.js و sync.js موجودان بجانب ملفات المنصة في المجلد نفسه.");
  }
}

/* ---------- شريط الأكاديمية ---------- */
function headerHTML() {
  const me = currentUser();
  const userBox = me
    ? '<div class="user-box"><span class="user-name">👋 ' + esc(me.rec.name) + '</span>' +
      '<button class="btn btn-ghost btn-small" id="btn-logout" type="button">تسجيل الخروج</button></div>'
    : "";
  return '' +
  '<header class="site-header"><div class="header-inner">' +
    '<a class="brand" href="#/">' +
      '<img class="brand-logo" src="assets/club-logo.jpg" alt="شعار نادي الذكاء الاصطناعي والروبوتيك">' +
      '<span class="brand-text"><span class="brand-name">أكاديمية الأردوينو والروبوتات</span>' +
      '<span class="brand-sub">IA &amp; Robotics Club — تعلّم، وصّل، برمج، ابنِ</span></span>' +
    '</a>' + userBox +
  '</div>' +
  '<div class="credit-bar">من إعداد الأستاذ محمد الغوات</div></header>';
}
function footerHTML() {
  return '<footer class="site-footer"><p>أكاديمية الأردوينو والروبوتات — تعمل بالكامل دون إنترنت. تقدّم كل تلميذ محفوظ على هذا الحاسوب فقط.</p>' +
    '<p><a href="#/teacher">📋 لوحة الأستاذ — تجميع نتائج القسم</a></p>' +
    '<p class="footer-credit">من إعداد الأستاذ محمد الغوات</p></footer>';
}
function shell(inner, pageTitle) {
  app().innerHTML = '<a class="skip-link" href="#main">تجاوز إلى المحتوى الرئيسي</a>' + headerHTML() + '<main class="page" id="main" tabindex="-1">' + inner + '</main>' + footerHTML();
  if (pageTitle) document.title = pageTitle + " — أكاديمية الأردوينو والروبوتات";
  /* رابط التجاوز: ينقل التركيز إلى المحتوى دون تغيير مسار الصفحة */
  const skip = document.querySelector(".skip-link");
  if (skip) skip.addEventListener("click", (e) => {
    e.preventDefault();
    const m = document.querySelector("#main");
    if (m && typeof m.focus === "function") m.focus();
  });
  const lo = $("#btn-logout");
  if (lo) lo.addEventListener("click", () => {
    storageRemove(SESSION_KEY);
    location.hash = "#/";
    render();
  });
  window.scrollTo(0, 0);
  /* انقل التركيز إلى عنوان الصفحة الجديدة حتى يتتبّع التنقّلَ قارئُ الشاشة ولوحةُ المفاتيح */
  const h1 = document.querySelector(".page h1");
  if (h1 && typeof h1.focus === "function") {
    h1.setAttribute("tabindex", "-1");
    try { h1.focus({ preventScroll: true }); } catch (e) { /* متصفحات قديمة: تجاهل */ }
  }
}

/* ---------- شاشة الدخول / إنشاء حساب ---------- */
function renderAuth(mode) {
  const isReg = mode === "register";
  shell(
    '<section class="auth-card">' +
      '<h1>' + (isReg ? "إنشاء حساب تلميذ جديد" : "مرحبًا بعودتك") + '</h1>' +
      '<p class="muted">الحساب محلي: يُحفظ على هذا الحاسوب فقط، ولكل تلميذ تقدّمه الخاص. لا حاجة لأي إنترنت.</p>' +
      '<p class="muted small">حدود الحساب المحلي بصراحة: كلمة السر تمنع زميلًا فضوليًا من فتح حسابك داخل القسم، لكنها ليست حماية بمستوى المواقع والخوادم — فكل شيء يعيش في متصفح هذا الحاسوب، ومسح بيانات المتصفح يمسح الحسابات والتقدم معها.</p>' +
      (dbDamaged ? '<p class="form-error" role="alert">تنبيه: بيانات الحسابات المحفوظة على هذا الحاسوب تالفة ولا يمكن قراءتها، وقد احتفظنا بنسخة احتياطية منها تلقائيًا بدل مسحها. أنشئ حسابًا جديدًا للمتابعة، وأخبر الأستاذ.</p>' : "") +
      '<form id="auth-form" autocomplete="off">' +
        (isReg ? '<label>الاسم الكامل<input id="auth-name" type="text" required maxlength="40" placeholder="مثال: يوسف العلوي"></label>' : "") +
        '<label>اسم المستخدم<input id="auth-user" type="text" required maxlength="30" placeholder="مثال: youssef01" dir="ltr"></label>' +
        '<label>كلمة السر<input id="auth-pass" type="password" required minlength="4" placeholder="4 أحرف على الأقل" dir="ltr"></label>' +
        (isReg ? '<label>تأكيد كلمة السر<input id="auth-pass2" type="password" required minlength="4" dir="ltr"></label>' : "") +
        '<p class="form-error" id="auth-error" role="alert" hidden></p>' +
        '<button class="btn btn-primary btn-wide" type="submit">' + (isReg ? "إنشاء الحساب والدخول" : "تسجيل الدخول") + '</button>' +
      '</form>' +
      '<p class="auth-switch">' + (isReg
        ? 'عندك حساب من قبل؟ <a href="#/login">سجّل الدخول</a>'
        : 'أول مرة هنا؟ <a href="#/register">أنشئ حسابك</a><br><a href="#/recover">نسيت كلمة السر؟ الاستعادة بمساعدة الأستاذ</a>') + '</p>' +
      '<p class="auth-switch"><a href="#/teacher">📋 لوحة الأستاذ — تجميع نتائج القسم من النسخ الاحتياطية</a></p>' +
    '</section>', isReg ? "إنشاء حساب جديد" : "تسجيل الدخول"
  );
  let authBusy = false; /* حارس ضد الإرسال المكرر أثناء التشفير غير المتزامن */
  $("#auth-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (authBusy) return;
    authBusy = true;
    const submitBtn = ev.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const err = $("#auth-error");
    const showErr = (m) => {
      err.textContent = m; err.hidden = false;
      authBusy = false;
      if (submitBtn) submitBtn.disabled = false;
    };
    const username = $("#auth-user").value.trim().toLowerCase();
    const password = $("#auth-pass").value;
    if (!username) return showErr("اكتب اسم المستخدم.");
    try {
      if (isReg) {
        const name = $("#auth-name").value.trim();
        if (!name) return showErr("اكتب اسمك الكامل.");
        if (password !== $("#auth-pass2").value) return showErr("كلمتا السر غير متطابقتين.");
        /* التشفير أولًا، ثم إعادة تحميل قاعدة البيانات والتحقق من توفر الاسم
           فورًا قبل الحفظ، حتى لا تُمحى تغييرات وقعت أثناء التشفير */
        const pw = await makePasswordRecord(password);
        const db = loadDB();
        if (hasUser(db, username)) return showErr("اسم المستخدم هذا مستعمل من قبل. جرّب اسمًا آخر.");
        db.users[username] = { name, salt: pw.salt, hash: pw.hash, hashAlgo: pw.hashAlgo, createdAt: Date.now(), progress: {} };
        if (!saveDB(db)) return showErr("تعذّر حفظ حسابك على هذا الحاسوب (التخزين ممتلئ أو محظور في المتصفح). أخبر الأستاذ وحاول من جديد.");
      } else {
        const db = loadDB();
        if (!hasUser(db, username)) return showErr("لا يوجد حساب بهذا الاسم. أنشئ حسابًا جديدًا أولًا.");
        const rec = db.users[username];
        const okPass = await verifyPassword(rec, password);
        if (!okPass) return showErr("كلمة السر غير صحيحة. حاول من جديد.");
        /* ترحيل الحسابات القديمة عند أول دخول ناجح: بصمة fnv: القديمة، أو
           حساب بلا نسخة خوارزمية مسجلة — يُعاد تشفيره بـ SHA-256 وملح جديد
           وتُختم نسخة الخوارزمية الحالية، حتى لا يفقد أي تلميذ دخوله */
        if ((rec.hash && rec.hash.indexOf("fnv:") === 0) || rec.hashAlgo !== HASH_ALGO) {
          const pw = await makePasswordRecord(password);
          const fresh = loadDB();
          if (hasUser(fresh, username)) {
            fresh.users[username].salt = pw.salt;
            fresh.users[username].hash = pw.hash;
            fresh.users[username].hashAlgo = pw.hashAlgo;
            saveDB(fresh);
          }
        }
      }
    } catch (e) {
      return showErr("حدث خطأ غير متوقع. حاول من جديد.");
    }
    if (!storageSet(SESSION_KEY, username)) {
      return showErr("تعذّر حفظ جلسة الدخول على هذا الحاسوب (التخزين محظور). فعّل حفظ بيانات المواقع في إعدادات المتصفح وحاول من جديد.");
    }
    location.hash = "#/";
    render();
  });
}

/* ---------- استعادة الحساب بمساعدة الأستاذ ---------- */
function renderRecover() {
  const keyOn = teacherKeyConfigured(loadDB());
  shell(
    '<section class="auth-card">' +
      '<h1>استعادة الحساب بمساعدة الأستاذ</h1>' +
      '<p class="muted">نسيت كلمة سرك؟ لا بأس، يحدث للجميع. في هذه المنصة المحلية يستطيع <strong>الأستاذ</strong> إعادة تعيين كلمة سرك وأنت واقف بجانبه — ويبقى تقدّمك ودروسك المنجزة كما هي تمامًا، لا يضيع منها شيء.</p>' +
      (keyOn
        ? '<p class="muted small">الاستعادة على هذا الحاسوب محمية بـ<strong>ملف مفتاح الأستاذ</strong> (امتداده .academykey) الذي يحتفظ به الأستاذ في ذاكرة USB الخاصة به: لا تتم إعادة التعيين دون رفع الملف الصحيح. حدوده بصراحة: تُحفظ بصمة سرّ المفتاح (SHA-256) في متصفح هذا الحاسوب والتحقق محلي بالكامل — رادع وفحص حيازة، لا حماية بمستوى الخوادم.</p>'
        : '<p class="quiz-result warn" role="alert">تنبيه: لم يُنشأ بعدُ «ملف مفتاح الأستاذ» على هذا الحاسوب، فتعمل الاستعادة مؤقتًا بنمط الحضور المشرف: حضور الأستاذ فعليًا بجانب التلميذ. أنشئ ملف المفتاح الآن لربط الاستعادة بحيازة ملف يحمله الأستاذ في USB:</p>' +
          '<div class="backup-actions"><button class="btn btn-ghost" id="btn-make-key" type="button">🔑 إنشاء ملف مفتاح الأستاذ</button></div>' +
          '<p class="muted small" id="key-msg" role="status" aria-live="polite"></p>' +
          '<p class="muted small">حدود هذه الطريقة بصراحة: لا يوجد خادم في منصة تعمل على حاسوب القسم نفسه؛ المفتاح رادع محلي وفحص حيازة — من يملك وصولًا كاملًا إلى ملفات الحاسوب ومتصفحه يستطيع تجاوز أي حماية محلية. احتفظ بملف المفتاح في USB الأستاذ فقط، ولا تتركه في مجلد المنصة.</p>') +
      '<form id="recover-form" autocomplete="off">' +
        '<label>اسم المستخدم<input id="rec-user" type="text" required maxlength="30" placeholder="اسم مستخدم الحساب المنسي" dir="ltr"></label>' +
        (keyOn ? '<label>ملف مفتاح الأستاذ (.academykey)<input id="rec-key" type="file" accept=".academykey,application/json,.json" required></label>' : '') +
        '<label>كلمة السر الجديدة<input id="rec-pass" type="password" required minlength="4" placeholder="4 أحرف على الأقل" dir="ltr"></label>' +
        '<label>تأكيد كلمة السر الجديدة<input id="rec-pass2" type="password" required minlength="4" dir="ltr"></label>' +
        '<label class="rec-check"><input id="rec-teacher" type="checkbox" required> أنا الأستاذ، وأؤكد أن صاحب الحساب حاضر بجانبي الآن ويطلب إعادة التعيين بنفسه</label>' +
        '<p class="form-error" id="rec-error" role="alert" hidden></p>' +
        '<p class="quiz-result ok" id="rec-ok" role="status" hidden></p>' +
        '<button class="btn btn-primary btn-wide" type="submit">إعادة تعيين كلمة السر</button>' +
      '</form>' +
      '<p class="auth-switch"><a href="#/login">عودة إلى تسجيل الدخول</a></p>' +
    '</section>', "استعادة الحساب"
  );
  const makeKeyBtn = $("#btn-make-key");
  if (makeKeyBtn) makeKeyBtn.addEventListener("click", async () => {
    makeKeyBtn.disabled = true;
    const km = $("#key-msg");
    const keyObj = await createTeacherKey();
    if (!keyObj) { if (km) km.textContent = "تعذّر حفظ بصمة المفتاح على هذا الحاسوب (التخزين ممتلئ أو محظور) — أخبر الأستاذ."; makeKeyBtn.disabled = false; return; }
    downloadFile("academy-teacher-key.academykey", JSON.stringify(keyObj, null, 2), "application/json");
    if (km) km.textContent = "أُنشئ ملف المفتاح ونُزّل: انقله إلى ذاكرة USB الخاصة بالأستاذ واحذفه من هذا الحاسوب. ستطلب الاستعادة رفعه من الآن فصاعدًا.";
    setTimeout(() => render(), 1600);
  });
  let recBusy = false;
  $("#recover-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (recBusy) return;
    const err = $("#rec-error"), ok = $("#rec-ok");
    const showErr = (m) => { err.textContent = m; err.hidden = false; ok.hidden = true; };
    const username = $("#rec-user").value.trim().toLowerCase();
    const password = $("#rec-pass").value;
    if (!username) return showErr("اكتب اسم المستخدم.");
    if (password !== $("#rec-pass2").value) return showErr("كلمتا السر الجديدتان غير متطابقتين.");
    if (!$("#rec-teacher").checked) return showErr("على الأستاذ تأكيد حضوره قبل إعادة التعيين.");
    recBusy = true;
    const btn = ev.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      /* بوابة مفتاح الأستاذ (الجولة الثالثة): إن كان مفتاح مهيأ على هذا
         الحاسوب، لا إعادة تعيين دون ملف مفتاح صحيح يطابق سرُّه البصمة المحفوظة */
      if (teacherKeyConfigured(loadDB())) {
        const keyInput = $("#rec-key");
        const keyFile = keyInput && keyInput.files && keyInput.files[0];
        if (!keyFile) { showErr("اختر ملف مفتاح الأستاذ (.academykey) من ذاكرة USB أولًا."); return; }
        if (typeof FileReader === "undefined") { showErr("هذا المتصفح لا يدعم قراءة الملفات."); return; }
        const keyText = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => resolve(null);
          r.readAsText(keyFile);
        });
        let keyObj = null;
        try { keyObj = keyText ? JSON.parse(keyText) : null; } catch (e) { keyObj = null; }
        const parsed = keyObj ? parseTeacherKeyFile(keyObj) : { ok: false, error: "تعذّرت قراءة ملف المفتاح." };
        if (!parsed.ok) { showErr(parsed.error); return; }
        const keyOk = await verifyTeacherKeySecret(parsed.secret);
        if (!keyOk) { showErr("ملف المفتاح هذا لا يطابق المفتاح المهيأ على هذا الحاسوب — أُوقفت إعادة التعيين."); return; }
      }
      const done = await resetAccountPassword(username, password);
      if (!done) {
        const db = loadDB();
        return showErr(hasUser(db, username)
          ? "تعذّر حفظ كلمة السر الجديدة على هذا الحاسوب (التخزين ممتلئ أو محظور). أخبر الأستاذ وحاول من جديد."
          : "لا يوجد حساب بهذا الاسم على هذا الحاسوب. تأكد من اسم المستخدم.");
      }
      err.hidden = true;
      ok.hidden = false;
      ok.textContent = "تمت إعادة تعيين كلمة سر حساب «" + username + "» بنجاح، وبقي تقدّمه محفوظًا. سجّل الدخول الآن بكلمة السر الجديدة.";
    } catch (e) {
      showErr("حدث خطأ غير متوقع. حاول من جديد.");
    } finally {
      recBusy = false;
      if (btn) btn.disabled = false;
    }
  });
}

/* ---------- الصفحة الرئيسية ---------- */
let homeNotice = ""; /* رسالة نتيجة عملية (استيراد…) تظهر مرة واحدة في الرئيسية */
function renderHome() {
  const me = currentUser();
  const rec = me.rec;
  const notice = homeNotice; homeNotice = "";
  const allDone = DATA.lessons.filter(l => isPassed(rec.progress && rec.progress[l.id], l)).length;
  const overallPct = Math.round(allDone / TOTAL_LESSONS * 100);
  let quizEarned = 0, quizPossible = 0;
  DATA.lessons.forEach(l => {
    const p = rec.progress && rec.progress[l.id];
    if (p && typeof p.quizBest === "number" && p.quizTotal) { quizEarned += p.quizBest; quizPossible += p.quizTotal; }
  });
  const cards = DATA.levels.map(lv => {
    const st = levelStats(rec, lv.n);
    return '<a class="level-card" href="#/level/' + lv.n + '">' +
      '<div class="level-card-top"><span class="level-head">' +
      '<img class="level-icon" src="' + levelIconPath(lv.n) + '" alt="">' +
      '<span class="level-num">المستوى ' + lv.n + '</span></span>' +
      '<span class="level-count">' + st.done + ' / ' + st.total + ' دروس</span></div>' +
      '<h2>' + esc(lv.title) + '</h2><p>' + esc(lv.goal) + '</p>' +
      '<div class="progress"><div class="progress-fill" style="width:' + st.pct + '%"></div></div>' +
      '<div class="progress-label">أنجزت ' + st.pct + '% من هذا المستوى</div>' +
      (levelComplete(rec, lv.n)
        ? (rec.playgroundPassed && rec.playgroundPassed[lv.n]
            ? '<div class="level-done-badge">🏆 أكملت هذا المستوى — شهادتك جاهزة في صفحة المستوى</div>'
            : '<div class="level-done-badge">🏆 أكملت دروس هذا المستوى — بقي التمرين البرمجي الأخير في صفحة المستوى لتفتح شهادتك</div>')
        : '') + '</a>';
  }).join("");
  const lastLesson = rec.lastLessonId ? lessonById(rec.lastLessonId) : null;
  shell(
    '<section class="hero"><img class="hero-img" src="assets/hero.png" alt="أكاديمية الأردوينو والروبوتات — تعلّم، وصّل، برمج، ابنِ"></section>' +
    '<section class="dash-strip">' +
      '<div class="dash-item"><span class="dash-value">' + allDone + ' / ' + TOTAL_LESSONS + '</span><span class="dash-label">درس منجز</span></div>' +
      '<div class="dash-item"><span class="dash-value">' + overallPct + '%</span><span class="dash-label">التقدم العام</span></div>' +
      '<div class="dash-item"><span class="dash-value">' + (quizPossible ? quizEarned + ' / ' + quizPossible : "—") + '</span><span class="dash-label">أفضل نتائج الاختبارات</span></div>' +
      '<div class="dash-item grow"><div class="progress"><div class="progress-fill" style="width:' + overallPct + '%"></div></div><span class="dash-label">واصل يا بطل — درسًا بعد درس تصنع روبوتك الأول</span></div>' +
    '</section>' +
    (lastLesson
      ? '<section class="card resume-card"><h2>📌 تابع من حيث توقفت</h2>' +
        '<p>آخر درس فتحته: <strong>' + esc(lastLesson.title) + '</strong> (المستوى ' + lastLesson.level + ' — الدرس ' + lastLesson.num + ').</p>' +
        '<a class="btn btn-primary" href="#/lesson/' + lastLesson.id + '">متابعة الدرس</a></section>'
      : '') +
    '<section class="card backup-card"><h2>💾 النسخة الاحتياطية — احفظ تقدّمك وانقله بأمان</h2>' +
      '<p class="muted">الحسابات والتقدّم يعيشان في متصفح هذا الحاسوب فقط، ونسخ مجلد المنصة إلى حاسوب آخر <strong>لا ينقلهما</strong>. للاحتفاظ بنسخة أو نقل التقدّم إلى حاسوب آخر: صدّر ملف النسخة الاحتياطية من هنا، ثم استورده من نفس البطاقة على الحاسوب الآخر. عند الاستيراد لن يُحذف أي حساب موجود غير مذكور في النسخة، وأي اسم متعارض يبقى كما هو إلا إذا اخترت استبداله بنفسك.</p>' +
      (notice ? '<p class="quiz-result ok" role="status">' + esc(notice) + '</p>' : '') +
      '<div class="backup-actions">' +
        '<button class="btn btn-primary" id="btn-export" type="button">تصدير نسخة احتياطية (JSON)</button>' +
        '<label class="btn btn-ghost">استيراد نسخة احتياطية<input id="import-file" type="file" accept="application/json,.json" hidden></label>' +
      '</div>' +
      '<p class="muted small" id="import-msg" role="status" aria-live="polite"></p>' +
      '<div class="backup-actions">' +
        '<button class="btn btn-ghost" id="btn-sync" type="button">☁️ مزامنة سحابية (اختيارية — تحتاج إنترنت)</button>' +
      '</div>' +
      '<p class="muted small" id="sync-msg" role="status" aria-live="polite"></p>' +
      '<p class="muted small">المزامنة طبقة اختيارية منفصلة تمامًا عن عمل المنصة دون إنترنت: تنقل نسختك الاحتياطية إلى ملف خاص في حساب Google Drive الخاص بك لاستعادتها من حاسوب آخر. لا تعمل إلا باتصال وتهيئة مسبقة من الأستاذ — شرح التهيئة خطوة بخطوة في ملف SYNC-SETUP.md داخل مجلد المنصة.</p>' +
    '</section>' +
    '<h1 class="page-title">المستويات — اختر مستواك وتابع من حيث توقفت</h1>' +
    '<section class="level-grid">' + cards + '</section>', "الرئيسية"
  );
  /* تفعيل التصدير/الاستيراد في بطاقة النسخة الاحتياطية */
  const expBtn = $("#btn-export");
  if (expBtn) expBtn.addEventListener("click", () => {
    const msg = $("#import-msg");
    if (downloadFile("arduino-academy-backup.json", JSON.stringify(buildBackup(loadDB()), null, 2), "application/json")) {
      if (msg) msg.textContent = "تم تصدير النسخة الاحتياطية — احتفظ بالملف في مكان آمن، ففيه حسابات القسم وتقدّمه كله.";
    } else {
      if (msg) msg.textContent = "تعذّر إنشاء ملف النسخة الاحتياطية في هذا المتصفح.";
    }
  });
  const syncBtn = $("#btn-sync");
  if (syncBtn) syncBtn.addEventListener("click", () => { startCloudSync(); });
  const impInput = $("#import-file");
  if (impInput) impInput.addEventListener("change", () => {
    const msg = $("#import-msg");
    const file = impInput.files && impInput.files[0];
    if (!file) return;
    if (typeof FileReader === "undefined") { if (msg) msg.textContent = "هذا المتصفح لا يدعم قراءة الملفات."; return; }
    const reader = new FileReader();
    reader.onload = () => {
      let obj = null;
      try { obj = JSON.parse(String(reader.result)); } catch (e) { obj = null; }
      if (!obj) { if (msg) msg.textContent = "تعذّرت قراءة هذا الملف — تأكد أنه ملف نسخة احتياطية صحيح صادر من المنصة."; return; }
      const v = validateBackup(obj);
      if (!v.ok) { if (msg) msg.textContent = "أُلغي الاستيراد: " + v.error; return; }
      const db = loadDB();
      const conflicts = Object.keys(v.users).filter(n => hasUser(db, n));
      let overwrite = false;
      if (conflicts.length) {
        overwrite = window.confirm(
          "توجد " + conflicts.length + " حسابات في النسخة بنفس أسماء حسابات موجودة على هذا الحاسوب: " + conflicts.join("، ") + ".\n\n" +
          "اضغط «موافق» لاستبدال الحسابات الموجودة بالنسخ المستوردة.\n" +
          "أو اضغط «إلغاء» للاحتفاظ بحساباتك الحالية كما هي واستيراد البقية فقط.\n\n" +
          "في الحالتين لن يُحذف أي حساب موجود غير مذكور في النسخة.");
        if (typeof overwrite !== "boolean") overwrite = false;
      }
      const res = mergeBackup(db, v.users, overwrite);
      if (!saveDB(db)) { if (msg) msg.textContent = "تعذّر حفظ البيانات المستوردة على هذا الحاسوب (التخزين ممتلئ أو محظور في المتصفح)."; return; }
      homeNotice = "تم الاستيراد بنجاح: أُضيف " + res.added.length + " حساب جديد" +
        (res.replaced.length ? "، واستُبدل " + res.replaced.length + " حساب موجود" : "") +
        (res.skipped.length ? "، وبقي " + res.skipped.length + " حساب موجود كما هو باختيارك" : "") + ".";
      render();
    };
    reader.onerror = () => { if (msg) msg.textContent = "تعذّرت قراءة هذا الملف."; };
    reader.readAsText(file);
  });
}

/* ---------- صفحة مستوى ---------- */
function typeBadge(t) {
  const cls = t === "برمجة" ? "badge-code" : (t === "مشروع" ? "badge-project" : "badge-practice");
  return '<span class="badge ' + cls + '">' + esc(t) + '</span>';
}
/* منطقة الشهادة/ملعب الكود أسفل صفحة المستوى (الجولة الثالثة):
   الدروس كاملة وحدها لا تكفي — الشهادة تنفتح بعد تمرين ملعب الكود أيضًا */
function certAreaHTML(rec, n) {
  if (!levelComplete(rec, n)) return "";
  if (rec.playgroundPassed && rec.playgroundPassed[n]) {
    return '<section class="card cert-card"><h2>🏆 شهادة إتمام المستوى</h2>' +
      '<p>أكملت جميع دروس هذا المستوى واجتزت تمرينه البرمجي — أحسنت! احصل على شهادتك واطبعها وعلّقها بفخر.</p>' +
      '<a class="btn btn-primary" href="#/certificate/' + n + '">شهادة إتمام المستوى</a></section>';
  }
  const pg = PLAYGROUNDS[n];
  if (!pg) return "";
  return '<section class="card playground-card"><h2>💻 ملعب الكود — تمرين أخير قبل الشهادة</h2>' +
    '<p>أكملت جميع دروس هذا المستوى باختباراتها — لم يبقَ لفتح شهادتك إلا تمرين برمجي قصير واحد يثبت أنك تكتب الكود بنفسك:</p>' +
    '<p><strong>' + esc(pg.title) + ':</strong> ' + esc(pg.prompt) + '</p>' +
    '<label class="pg-label">اكتب الكود هنا<textarea id="pg-input" class="pg-input" dir="ltr" rows="4" spellcheck="false" placeholder="' + esc(pg.hint) + '"></textarea></label>' +
    '<div class="backup-actions"><button class="btn btn-primary" id="btn-pg-check" type="button">تحقق من الكود</button></div>' +
    '<p class="quiz-result" id="pg-msg" role="status" aria-live="polite" hidden></p>' +
    '<p class="muted small">الفاحص متسامح مع المسافات وحالة الأحرف ويقبل الصيغ الصحيحة المكافئة. إن أخطأت، راجع دروس المستوى وحاول من جديد — المحاولات بلا حدود، والتمرين لا يُلغي أي تقدم محفوظ.</p></section>';
}
function renderLevel(n) {
  const me = currentUser();
  const lv = levelByN(n);
  if (!lv) { location.hash = "#/"; return; }
  const st = levelStats(me.rec, lv.n);
  const rows = DATA.lessons.filter(l => l.level === lv.n).map(l => {
    const p = me.rec.progress && me.rec.progress[l.id];
    const done = isPassed(p, l);
    const quiz = p && typeof p.quizBest === "number" && p.quizTotal
      ? '<span class="lesson-quiz">🏆 أفضل نتيجة: ' + p.quizBest + '/' + p.quizTotal + '</span>' : "";
    return '<a class="lesson-row' + (done ? " is-done" : "") + '" href="#/lesson/' + l.id + '">' +
      '<span class="lesson-check">' + (done ? "✓" : l.num) + '</span>' +
      '<span class="lesson-main"><span class="lesson-title">' + esc(l.title) + '</span>' + quiz + '</span>' +
      (l.stub ? '<span class="badge badge-soon">قريبًا</span>' : "") +
      typeBadge(l.type) + '</a>';
  }).join("");
  shell(
    '<p class="crumbs"><a href="#/">الرئيسية</a> ← المستوى ' + lv.n + '</p>' +
    '<div class="level-title-row"><img class="level-icon-lg" src="' + levelIconPath(lv.n) + '" alt="">' +
    '<div><h1 class="page-title">المستوى ' + lv.n + ': ' + esc(lv.title) + '</h1>' +
    '<p class="muted">' + esc(lv.goal) + '</p></div></div>' +
    '<div class="progress big"><div class="progress-fill" style="width:' + st.pct + '%"></div></div>' +
    '<p class="progress-label">أنجزت ' + st.done + ' من ' + st.total + ' دروس (' + st.pct + '%)</p>' +
    certAreaHTML(me.rec, lv.n) +
    '<section class="lesson-list">' + rows + '</section>', "المستوى " + lv.n + ": " + lv.title
  );
  const pgBtn = $("#btn-pg-check");
  if (pgBtn) pgBtn.addEventListener("click", () => {
    const input = $("#pg-input");
    const msg = $("#pg-msg");
    if (!checkPlayground(lv.n, input ? input.value : "")) {
      if (msg) {
        msg.hidden = false;
        msg.className = "quiz-result bad";
        msg.textContent = "ليس بعد — راجع المطلوب سطرًا سطرًا: تأكد من أرقام المنافذ والكلمات المفتاحية كما في دروس هذا المستوى، ثم حاول من جديد.";
      }
      return;
    }
    const rec = recordPlaygroundPass(lv.n);
    if (msg) {
      msg.hidden = false;
      if (rec && rec.saved) {
        msg.className = "quiz-result ok";
        msg.textContent = "✓ كود صحيح — اجتزت التمرين البرمجي! تُفتح شهادتك الآن…";
        setTimeout(() => render(), 1200);
      } else {
        msg.className = "quiz-result warn";
        msg.textContent = "كودك صحيح ✓ لكن تعذّر حفظ النتيجة على هذا الحاسوب (التخزين ممتلئ أو محظور) — أخبر الأستاذ وحاول من جديد.";
      }
    }
  });
}

/* ---------- شهادة إتمام المستوى (قابلة للطباعة) ---------- */
function renderCertificate(n) {
  const me = currentUser();
  const lv = levelByN(n);
  if (!lv) { location.hash = "#/"; return; }
  if (!certificateUnlocked(me.rec, lv.n)) { location.hash = "#/level/" + lv.n; return; }
  /* تاريخ الشهادة هو تاريخ إتمام المستوى المحفوظ، لا تاريخ يوم الطباعة
     (عند غيابه في سجلات قديمة نعرض تاريخ اليوم) */
  const doneTs = me.rec.levelDates && me.rec.levelDates[lv.n];
  const dObj = doneTs ? new Date(doneTs) : new Date();
  const dateStr = dObj.getFullYear() + "/" + pad2(dObj.getMonth() + 1) + "/" + pad2(dObj.getDate());
  shell(
    '<p class="crumbs cert-actions"><a href="#/level/' + lv.n + '">→ عودة إلى المستوى ' + lv.n + ': ' + esc(lv.title) + '</a></p>' +
    '<section class="certificate-sheet">' +
      '<img class="certificate-bg" src="assets/certificate.png" alt="">' +
      '<div class="certificate-body">' +
        '<p class="cert-academy">أكاديمية الأردوينو — نادي الذكاء الاصطناعي والروبوتيك</p>' +
        '<h1 class="cert-title">شهادة إتمام المستوى</h1>' +
        '<p class="cert-line">يُشهد بأن التلميذ(ة)</p>' +
        '<p class="cert-name">' + esc(me.rec.name || me.key) + '</p>' +
        '<p class="cert-line">قد أكمل(ت) بنجاح جميع دروس</p>' +
        '<p class="cert-level">المستوى ' + lv.n + ': ' + esc(lv.title) + '</p>' +
        '<p class="cert-date">بتاريخ: <span dir="ltr">' + dateStr + '</span></p>' +
        '<p class="cert-credit">من إعداد الأستاذ محمد الغوات</p>' +
      '</div>' +
    '</section>' +
    '<div class="cert-actions cert-print-row">' +
      '<button class="btn btn-primary" id="btn-print-cert" type="button">🖨️ طباعة الشهادة</button>' +
      '<a class="btn btn-ghost" href="#/level/' + lv.n + '">عودة إلى المستوى</a></div>', "شهادة إتمام المستوى " + lv.n
  );
  $("#btn-print-cert").addEventListener("click", () => window.print());
}

/* ---------- لوحة الأستاذ #/teacher — الجولة الثالثة ----------
   تجميع عرضي بحت: ملفات النسخ تُقرأ إلى ذاكرة الصفحة (teacherData) وتُبنى
   منها صفوف الجدول؛ لا كتابة إطلاقًا في قاعدة بيانات هذا الحاسوب، فلا
   يتأثر حساب أي تلميذ محلي باستيراد اللوحة. تُنسى البيانات بإعادة التحميل */
let teacherData = { users: {}, messages: [] };
function renderTeacher() {
  const rows = buildTeacherRows(teacherData.users);
  const keyOn = teacherKeyConfigured(loadDB());
  shell(
    '<p class="crumbs"><a href="#/">الرئيسية</a> ← لوحة الأستاذ</p>' +
    '<h1 class="page-title">📋 لوحة الأستاذ — تجميع نتائج القسم</h1>' +
    '<section class="card"><h2>استيراد نسخ التلاميذ الاحتياطية</h2>' +
      '<p class="muted">اسحب ملفات النسخ الاحتياطية (JSON) التي صدّرها تلاميذك من منصاتهم وأفلتها في منطقة الإفلات، أو اخترها بالزر — يقبل عدة ملفات دفعة واحدة. كل ملف يُفحص بمدقّق النسخ نفسه، والملف غير الصالح يُرفض برسالة خاصّة به دون أن يوقف البقية.</p>' +
      '<p class="muted"><strong>تنبيه مهم:</strong> التجميع هنا للعرض والتصدير فقط — لا يغيّر حسابات هذا الحاسوب ولا تقدّم أي تلميذ فيه إطلاقًا. الدمج الفعلي في حسابات هذا الحاسوب يكون من بطاقة النسخة الاحتياطية في الصفحة الرئيسية وباختيارك الصريح هناك.</p>' +
      '<p class="muted small">«النقاط» في الجدول هي مجموع أفضل نتائج الاختبارات (quizBest) كما هي مخزّنة فعلًا في نسخ التلاميذ — لا نظام نقاط آخر في المنصة. والمستوى الحالي هو أول مستوى لم يُكمله التلميذ.</p>' +
      '<div class="drop-zone" id="teacher-drop">' +
        '<p class="drop-zone-text">📥 أفلت ملفات النسخ الاحتياطية هنا</p>' +
        '<label class="btn btn-primary">اختيار ملفات النسخ الاحتياطية<input id="teacher-files" type="file" accept="application/json,.json" multiple hidden></label>' +
      '</div>' +
      '<div id="teacher-msgs">' + teacherData.messages.map(m =>
        '<p class="quiz-result ' + (m.ok ? "ok" : "warn") + '" role="status">' + esc(m.text) + '</p>').join("") + '</div>' +
    '</section>' +
    (rows.length
      ? '<section class="card"><h2>جدول القسم — ' + rows.length + ' تلميذًا</h2>' +
        '<div class="table-wrap"><table class="class-table"><thead><tr>' +
        '<th>التلميذ</th><th>المستوى الحالي</th><th>دروس منجزة</th><th>نقاط الاختبارات</th><th>تواريخ إتمام المستويات</th>' +
        '</tr></thead><tbody>' +
        rows.map(r => '<tr>' +
          '<td><strong>' + esc(r.name) + '</strong><br><span class="muted small" dir="ltr">' + esc(r.username) + '</span></td>' +
          '<td>' + (r.allComplete ? "🏆 أكمل كل المستويات" : "المستوى " + r.currentLevel) + '</td>' +
          '<td>' + r.doneCount + ' / ' + r.totalLessons + '</td>' +
          '<td>' + r.earned + (r.possible ? ' / ' + r.possible : '') + '</td>' +
          '<td class="small">' + [1, 2, 3, 4, 5].map(n => r.dates[n] ? 'م' + n + ': <span dir="ltr">' + r.dates[n] + '</span>' : '').filter(Boolean).join(' · ') + '</td>' +
        '</tr>').join("") +
        '</tbody></table></div>' +
        '<div class="backup-actions"><button class="btn btn-primary" id="btn-teacher-csv" type="button">تصدير الجدول CSV (يفتحه Excel)</button></div>' +
      '</section>'
      : '<section class="card"><p class="muted">لا تلاميذ في الجدول بعد — استورد أول نسخة احتياطية لتلميذ لتظهر نتيجته هنا.</p></section>') +
    '<section class="card"><h2>🔑 مفتاح الأستاذ لاستعادة الحسابات</h2>' +
      (keyOn
        ? '<p class="muted">يوجد مفتاح أستاذ مهيأ على هذا الحاسوب: صفحة الاستعادة (#/recover) تطلب رفع ملف المفتاح (.academykey) قبل أي إعادة تعيين. إن ضاع الملف من USB، أنشئ مفتاحًا جديدًا من هنا — وسيبطل القديم فورًا.</p>'
        : '<p class="muted">لا يوجد مفتاح أستاذ مهيأ بعد على هذا الحاسوب: الاستعادة في #/recover تعمل بنمط الحضور المشرف فقط. أنشئ ملف المفتاح واحتفظ به في ذاكرة USB الخاصة بك وحدك.</p>') +
      '<div class="backup-actions"><button class="btn btn-ghost" id="btn-make-key2" type="button">' + (keyOn ? "إنشاء مفتاح جديد (يبطل القديم)" : "إنشاء ملف مفتاح الأستاذ") + '</button></div>' +
      '<p class="muted small" id="key-msg2" role="status" aria-live="polite"></p>' +
      '<p class="muted small">صراحة تقنية: تُحفظ بصمة SHA-256 لسرّ المفتاح في متصفح هذا الحاسوب والتحقق محلي بالكامل — رادع وفحص حيازة ملف، لا حماية بمستوى الخوادم.</p>' +
    '</section>', "لوحة الأستاذ"
  );
  const absorbFiles = (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    teacherData.messages = [];
    let pending = list.length;
    const done = () => { pending--; if (pending === 0) renderTeacher(); };
    list.forEach(f => {
      if (typeof FileReader === "undefined") {
        teacherData.messages.push({ ok: false, text: "✗ " + f.name + ": هذا المتصفح لا يدعم قراءة الملفات." });
        return done();
      }
      const reader = new FileReader();
      reader.onload = () => {
        let obj = null;
        try { obj = JSON.parse(String(reader.result)); } catch (e) { obj = null; }
        if (!obj) { teacherData.messages.push({ ok: false, text: "✗ " + f.name + ": تعذّرت قراءة الملف — تأكد أنه ملف نسخة احتياطية JSON صادر من المنصة." }); return done(); }
        const v = validateBackup(obj);
        if (!v.ok) { teacherData.messages.push({ ok: false, text: "✗ " + f.name + ": " + v.error }); return done(); }
        let n = 0;
        for (const name of Object.keys(v.users)) { teacherData.users[name] = v.users[name]; n++; }
        teacherData.messages.push({ ok: true, text: "✓ " + f.name + ": أُضيف/حُدّث " + n + " تلميذًا في جدول اللوحة — دون لمس حسابات هذا الحاسوب." });
        done();
      };
      reader.onerror = () => { teacherData.messages.push({ ok: false, text: "✗ " + f.name + ": تعذّرت قراءة هذا الملف." }); done(); };
      reader.readAsText(f);
    });
  };
  const fi = $("#teacher-files");
  if (fi) fi.addEventListener("change", () => absorbFiles(fi.files));
  const dz = $("#teacher-drop");
  if (dz) {
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("drag-over");
      absorbFiles(e.dataTransfer && e.dataTransfer.files);
    });
  }
  const csvBtn = $("#btn-teacher-csv");
  if (csvBtn) csvBtn.addEventListener("click", () => {
    downloadFile("class-results.csv", teacherRowsToCSV(buildTeacherRows(teacherData.users)), "text/csv;charset=utf-8");
  });
  const keyBtn2 = $("#btn-make-key2");
  if (keyBtn2) keyBtn2.addEventListener("click", async () => {
    keyBtn2.disabled = true;
    const km = $("#key-msg2");
    const keyObj = await createTeacherKey();
    if (!keyObj) { if (km) km.textContent = "تعذّر حفظ بصمة المفتاح على هذا الحاسوب (التخزين ممتلئ أو محظور)."; keyBtn2.disabled = false; return; }
    downloadFile("academy-teacher-key.academykey", JSON.stringify(keyObj, null, 2), "application/json");
    if (km) km.textContent = "أُنشئ ملف المفتاح ونُزّل: انقله إلى ذاكرة USB الخاصة بك واحذفه من هذا الحاسوب. الاستعادة ستطلبه من الآن فصاعدًا.";
    setTimeout(() => renderTeacher(), 1600);
  });
}

/* ---------- تجربة الوميض التفاعلية (الدرس المرجعي) ---------- */
let experimentTimer = null;
function stopExperiment() {
  if (experimentTimer) { clearInterval(experimentTimer); experimentTimer = null; }
  /* مؤقّتات التجارب المسجّلة في lessons-data.js (expTimer/expTimeout) */
  if (window.ACADEMY_EXP_TIMERS) {
    window.ACADEMY_EXP_TIMERS.forEach(t => { clearInterval(t); clearTimeout(t); });
    window.ACADEMY_EXP_TIMERS = [];
  }
}
function mountBlinkExperiment(slot) {
  /* احترام تفضيل «تقليل الحركة»: نبدأ والوميض متوقف والصمام ثابت */
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  slot.innerHTML =
    '<div class="exp-box">' +
      '<div class="exp-led-wrap"><div class="exp-led" id="exp-led"></div><div class="exp-led-label">LED — المنفذ 13 — الحالة: <strong id="exp-state">مطفأ</strong></div></div>' +
      '<div class="exp-controls">' +
        '<p><strong>١ — توقّع:</strong> زمن الانتظار الآن <strong>1000</strong> ميلي ثانية. توقّع قبل أن تلمس شيئًا: إذا صغّرنا زمن الانتظار إلى <strong>200</strong>، ماذا سيحدث لوميض الصمام؟</p>' +
        '<div class="exp-predict" role="group" aria-label="اختر توقّعك">' +
          '<button class="btn btn-ghost btn-small" type="button" data-pred="fast">يومض أسرع</button>' +
          '<button class="btn btn-ghost btn-small" type="button" data-pred="slow">يومض أبطأ</button>' +
          '<button class="btn btn-ghost btn-small" type="button" data-pred="same">لا يتغيّر</button>' +
        '</div>' +
        '<label><strong>٢ — غيّر:</strong> زمن الانتظار delay: <strong id="exp-val">1000</strong> ميلي ثانية' +
        '<input type="range" id="exp-slider" min="100" max="2000" step="50" value="1000"></label>' +
        '<p class="muted"><strong>٣ — لاحظ:</strong> راقب الصمام وحالته المكتوبة أثناء تحريكك المنزلق. هذا بالضبط ما يفعله برنامج Blink: يشعل الصمام، ينتظر، يطفئه، ينتظر… وكل رقم في delay يغيّر الإيقاع، تمامًا كما لو غيّرت الرقم في الكود ورفعته إلى لوحتك.</p>' +
        '<p class="exp-explain" id="exp-explain" hidden></p>' +
        (reduceMotion ? '<p class="muted small">أوقفنا الوميض التلقائي احترامًا لإعداد «تقليل الحركة» في جهازك — الصمام ثابت الآن، واضغط «تشغيل الوميض» إذا أردت رؤيته يتحرك.</p>' : '') +
        '<button class="btn btn-primary" id="exp-toggle" type="button">' + (reduceMotion ? "تشغيل الوميض" : "إيقاف الوميض") + '</button>' +
      '</div></div>';
  const led = $("#exp-led", slot), slider = $("#exp-slider", slot), val = $("#exp-val", slot), btn = $("#exp-toggle", slot);
  const state = $("#exp-state", slot);
  const explain = $("#exp-explain", slot);
  let on = false, running = !reduceMotion, prediction = null, changed = false;
  /* حالة الصمام تُعرض بلونها وبنصّ مكتوب معًا (مشتعل/مطفأ) */
  const showState = () => { led.classList.toggle("on", on); if (state) state.textContent = on ? "مشتعل" : "مطفأ"; };
  const tick = () => { on = !on; showState(); };
  /* البدء دائمًا من حالة «مشتعل» كما في برنامج Blink الحقيقي: إشعال ثم انتظار */
  const restart = () => { stopExperiment(); on = true; showState(); if (running) experimentTimer = setInterval(tick, Number(slider.value)); };
  /* الخطوة ٤ — فسّر: تظهر بعد أن يتوقّع التلميذ ويغيّر القيمة فعلًا */
  const maybeExplain = () => {
    if (!explain || !prediction || !changed) return;
    explain.hidden = false;
    explain.innerHTML = (prediction === "fast"
      ? "<strong>٤ — فسّر:</strong> توقّعك صحيح، أحسنت! 👏 "
      : "<strong>٤ — فسّر:</strong> لاحظتَ النتيجة بنفسك؟ التوقّع الأدق هو «يومض أسرع». ") +
      "في الكود، delay(200) تجعل اللوحة تنتظر 200 ميلي ثانية فقط بين الإشعال والإطفاء بدل 1000، فيتكرر الوميض مرات أكثر في الثانية. احفظ القاعدة: كلما صغُر رقم delay، أسرعَ الوميض — وجرّب الآن قيمة كبيرة مثل 2000 لتتأكد.";
  };
  slot.querySelectorAll("[data-pred]").forEach(b => b.addEventListener("click", () => {
    prediction = b.getAttribute("data-pred");
    slot.querySelectorAll("[data-pred]").forEach(x => x.classList.toggle("pred-chosen", x === b));
    maybeExplain();
  }));
  slider.addEventListener("input", () => { val.textContent = slider.value; changed = true; if (running) restart(); maybeExplain(); });
  btn.addEventListener("click", () => {
    running = !running;
    btn.textContent = running ? "إيقاف الوميض" : "تشغيل الوميض";
    if (running) restart(); else { stopExperiment(); on = false; showState(); }
  });
  if (running) restart(); else { on = true; showState(); }
}

/* بذرة حتمية من نص (FNV-1a) — تُستعمل هنا فقط لخلط ترتيب الخيارات، لا لأي غرض أمني */
function strSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/* ترتيب عرض خيارات كل سؤال: يُشتق بثبات من (التلميذ + الدرس + السؤال)،
   فلا يحفظ التلميذ «مواضع» الإجابات الصحيحة بل يقرأ الخيارات نفسها،
   ويرى تلميذ آخر ترتيبًا مختلفًا. القيم المعروضة تبقى فهارس الخيارات
   الأصلية، فيبقى التصحيح والنتائج المخزنة صحيحة دون أي تغيير في البيانات */
function optionOrder(username, lessonId, qi, count) {
  let seed = strSeed(String(username || "") + "|" + lessonId + "|" + qi);
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const arr = Array.from({ length: count }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/* ---------- بطاقة إتمام الدرس (تُبنى من حالة التقدم الحالية) ---------- */
function doneCardHTML(l, p) {
  let inner;
  if (isPassed(p, l)) {
    inner = '<p class="done-status ok" id="done-status">✓ هذا الدرس منجز: لقد اجتزت اختباره بنجاح' +
      (typeof p.quizBest === "number" && p.quizTotal ? ' (أفضل نتيجة لك: ' + p.quizBest + '/' + p.quizTotal + ')' : '') +
      '. يمكنك إعادة الاختبار للتدريب متى شئت — إعادة المحاولة لا تُلغي إتمامك أبدًا.</p>';
  } else if (l.stub) {
    inner = '<p class="done-status" id="done-status">هذا الدرس قيد الإعداد. عند نشره سيُحتسب منجزًا بعد اجتياز اختباره القصير، مثل بقية الدروس.</p>';
  } else {
    inner = '<p class="done-status" id="done-status">لا يُحتسب الدرس منجزًا إلا باجتياز اختباره القصير 📝: أجب عن جميع الأسئلة واحصل على ' +
      QUIZ_PASS_MIN + ' إجابات صحيحة على الأقل من ' + (l.quiz ? l.quiz.length : 4) +
      '. لا يوجد زر تعليم يدوي — النجاح في الاختبار هو وحده ما يُتمّ الدرس، ويمكنك إعادة المحاولة بلا حدود.' +
      (p && typeof p.quizScore === "number" && p.quizTotal
        ? '<br>آخر نتيجة لك في الاختبار: ' + p.quizScore + '/' + p.quizTotal + ' — لم تصل بعد إلى الحد المطلوب، حاول من جديد.</p>'
        : '</p>');
  }
  return '<section class="card done-card"><h2>✅ إتمام الدرس</h2>' + inner + '</section>';
}

/* ---------- صفحة درس ---------- */
function renderLesson(id) {
  stopExperiment();
  const me = currentUser();
  const lessonOwner = me ? me.key : null; /* الحساب الذي فتح الدرس: تُنسب إليه نتيجة الاختبار */
  const l = lessonById(id);
  if (!l) { location.hash = "#/"; return; }
  const lv = levelByN(l.level);
  /* سجّل آخر درس مفتوح ليعمل زر «تابع من حيث توقفت»؛ فشل هذا الحفظ لا يعطّل الدرس أبدًا */
  try {
    const dbL = loadDB();
    if (lessonOwner && hasUser(dbL, lessonOwner) && dbL.users[lessonOwner].lastLessonId !== l.id) {
      dbL.users[lessonOwner].lastLessonId = l.id;
      saveDB(dbL);
    }
  } catch (e) { /* تجاهل */ }
  const saved = (me.rec.progress && me.rec.progress[l.id]) || { done: false, quizBest: null, quizTotal: null };
  const prev = prevLessonBefore(l);
  const next = nextLessonAfter(l);

  let body = "";
  body += '<p class="crumbs"><a href="#/">الرئيسية</a> ← <a href="#/level/' + lv.n + '">المستوى ' + lv.n + ': ' + esc(lv.title) + '</a> ← الدرس ' + l.num + '</p>';
  body += '<div class="lesson-head"><h1 class="page-title">' + esc(l.title) + '</h1>' + typeBadge(l.type) + '</div>';
  if (l.goal) body += '<p class="lesson-goal">🎯 هدف الدرس: ' + esc(l.goal) + '</p>';

  /* مشغّل ذكي: إن نُشر الدرس على يوتيوب وكان الاتصال متاحًا، تظهر واجهة
     خفيفة (صورة مصغّرة + زر تشغيل) لا تُحمّل مشغّل يوتيوب إلا عند الضغط،
     وتبقى النسخة المحلية خيارًا دائمًا — وعند انقطاع الاتصال أو للدروس
     غير المنشورة يعمل الملف المحلي مباشرة كما في نسخة الأوفلاين */
  const yid = ytId(l);
  const isOnline = (typeof navigator === "undefined") || navigator.onLine !== false;
  if (yid && isOnline) {
    body += '<section class="card"><h2>🎬 فيديو الدرس</h2>' +
      '<div class="yt-facade" id="yt-facade" data-yt="' + yid + '" role="button" tabindex="0" aria-label="تشغيل فيديو الدرس على يوتيوب" style="background-image:url(\'https://i.ytimg.com/vi/' + yid + '/hqdefault.jpg\')">' +
      '<span class="yt-badge">YouTube</span><span class="yt-play" aria-hidden="true"></span>' +
      '<span class="yt-facade-label">شاهد الدرس على يوتيوب — قناة Ai &amp; Robotics Club</span></div>' +
      '<div id="yt-slot"></div>' +
      '<p class="muted small" id="video-note">يُشغَّل هذا الدرس عبر يوتيوب مع الترجمة العربية. إن تعذّر التشغيل على شبكتك، جرّب <a href="#" id="yt-use-local">النسخة المحلية من الفيديو</a>.</p></section>';
  } else {
    body += '<section class="card"><h2>🎬 فيديو الدرس</h2>' + localVideoHTML(l) +
      '<p class="muted small" id="video-note">ملف الفيديو المحلي: <span dir="ltr">' + videoPath(l) + '</span>' + (l.stub ? ' — سيُضاف عند إنتاجه.' : ' — وتظهر الترجمة العربية تلقائيًا أثناء التشغيل إذا وُجد ملف ترجمته بجانب المنصة.') + '</p></section>';
  }

  if (l.stub) {
    body += '<section class="card soon-card"><h2>🚧 هذا الدرس قيد الإعداد</h2><p>العنوان والنوع جاهزان في الخريطة المعتمدة، وسيُضاف الشرح والكود والفيديو والاختبار تباعًا. تابع الدروس الجاهزة الآن، وعد إلى هنا قريبًا.</p></section>';
  } else {
    if (l.explanation) {
      body += '<section class="card"><h2>📖 الشرح</h2>' +
        l.explanation.map((t, pi) => '<p id="exp-para-' + pi + '">' + esc(t) + '</p>').join("") + '</section>';
    }
    if (l.components) {
      body += '<section class="card"><h2>🧰 العناصر المستعملة</h2><ul class="nice-list">' +
        l.components.map(c => '<li>' + esc(c) + '</li>').join("") + '</ul></section>';
    }
    if (l.code) {
      body += '<section class="card"><h2>💻 الكود — ' + esc(l.code.title) + '</h2>' +
        '<div class="code-head"><button class="btn btn-small btn-primary" id="btn-copy" type="button">نسخ الكود</button><span class="muted small">الصقه في Arduino IDE</span></div>' +
        '<pre class="code-block" dir="ltr"><code id="lesson-code">' + esc(l.code.text) + '</code></pre></section>';
    }
    if (l.experiment) {
      body += '<section class="card"><h2>🧪 جرّب بنفسك — تجربة تفاعلية</h2>' +
        '<p class="exp-steps">خطوات كل تجربة: <strong>١ توقّع</strong> ماذا سيحدث ← <strong>٢ غيّر</strong> قيمة أو إعدادًا ← <strong>٣ لاحظ</strong> النتيجة بعينيك ← <strong>٤ فسّر</strong> لماذا حدثت</p>' +
        (l.experiment.type !== "blink"
          ? '<div class="exp-guide" id="exp-guide">' +
            '<p><strong>١ — توقّع:</strong> قبل أن تلمس التجربة، فكّر: ستغيّر بعد قليل قيمة أو إعدادًا فيها. ماذا تتوقّع أن يحدث لنتيجتها؟ اختر توقّعك:</p>' +
            '<div class="exp-predict" role="group" aria-label="اختر توقّعك">' +
              '<button class="btn btn-ghost btn-small" type="button" data-gpred="change">ستتغيّر النتيجة بوضوح</button>' +
              '<button class="btn btn-ghost btn-small" type="button" data-gpred="same">ستبقى كما هي تقريبًا</button>' +
              '<button class="btn btn-ghost btn-small" type="button" data-gpred="unsure">لست متأكدًا — سأجرّب وأرى</button>' +
            '</div>' +
            '<p><strong>٢ — غيّر:</strong> الآن العب بالتجربة أسفله: حرّك منزلقًا، أو غيّر قيمة، أو اضغط أزرارها — تغييرًا واحدًا واضحًا على الأقل.</p>' +
            '<p id="exp-guide-observe" hidden><strong>٣ — لاحظ:</strong> ماذا حدث فعلًا عندما غيّرت؟ ' +
              '<button class="btn btn-ghost btn-small" type="button" data-gobs="match">حدث ما توقّعته</button> ' +
              '<button class="btn btn-ghost btn-small" type="button" data-gobs="diff">حدث شيء مختلف عن توقّعي</button> ' +
              '<button class="btn btn-ghost btn-small" type="button" data-gobs="none">لم يتغيّر شيء يُذكر</button></p>' +
            '<p class="exp-explain" id="exp-guide-explain" hidden></p>' +
          '</div>'
          : '') +
        '<div id="experiment-slot"></div></section>';
    }
    if (l.quiz) {
      body += '<section class="card"><h2>📝 اختبار سريع QCM</h2>' +
        '<p class="muted">أجب عن جميع الأسئلة ثم اضغط «تصحيح الاختبار». إذا حصلت على ' + QUIZ_PASS_MIN + ' إجابات صحيحة على الأقل يُحتسب الدرس منجزًا ✅ — وإن لم تنجح هذه المرة، راجع الشرح وأعد المحاولة بلا حدود.</p><div id="quiz-box">' +
        l.quiz.map((q, qi) =>
          '<fieldset class="quiz-q"><legend>' + (qi + 1) + '. ' + esc(q.q) + '</legend>' +
          optionOrder(lessonOwner, l.id, qi, q.options.length).map(oi =>
            '<label class="quiz-opt"><input type="radio" name="q' + qi + '" value="' + oi + '"> ' + esc(q.options[oi]) + '</label>').join("") +
          '<p class="quiz-feedback" id="fb-' + qi + '" hidden></p></fieldset>').join("") +
        '<button class="btn btn-primary" id="btn-quiz" type="button">تصحيح الاختبار</button>' +
        '<p class="quiz-result" id="quiz-result" role="status" aria-live="polite" hidden></p>' +
        '<p class="quiz-stale-note" id="quiz-stale-note" hidden>غيّرت إجابة بعد التصحيح — التصحيح المعروض يخص إجابتك السابقة. اضغط «تصحيح الاختبار» من جديد لترى تصحيح إجاباتك الحالية.</p>' +
        '<button class="btn btn-primary" id="btn-save-retry" type="button" hidden>إعادة محاولة حفظ النتيجة</button>' +
        (typeof saved.quizBest === "number" && saved.quizTotal
          ? '<p class="muted">🏆 أفضل نتيجة سابقة لك في هذا الاختبار: ' + saved.quizBest + '/' + saved.quizTotal + '</p>' : "") +
        '</div></section>';
    }
    if (Array.isArray(l.quizExtra) && l.quizExtra.length) {
      /* «تحدَّ نفسك»: أسئلة تدريب إضافية (توقّع/تطبيق/ملاحظة) غير مُقيَّمة —
         لا تُسجَّل ولا تدخل في إتمام الدرس إطلاقًا (قاعدة الاحتساب دون تغيير) */
      body += '<section class="card pool-card"><h2>🌟 تحدَّ نفسك — أسئلة تدريب إضافية</h2>' +
        '<p class="muted">أسئلة توقّع وتطبيق وملاحظة من محتوى هذا الدرس نفسه، للتدريب والمتعة فقط: <strong>لا تؤثر في نتيجتك ولا في إتمام الدرس</strong> — الإتمام يبقى باجتياز الاختبار المُقيَّم أعلاه وحده. اختر إجاباتك ثم اضغط «تحقق من إجابات التدريب» لترى التصحيح فورًا.</p><div id="pool-box">' +
        l.quizExtra.map((q, qi) =>
          '<fieldset class="quiz-q"><legend><span class="pool-kind">' + esc(q.kind) + '</span> ' + (qi + 1) + '. ' + esc(q.q) + '</legend>' +
          optionOrder(lessonOwner, l.id + "-extra", qi, q.options.length).map(oi =>
            '<label class="quiz-opt"><input type="radio" name="pool' + qi + '" value="' + oi + '"> ' + esc(q.options[oi]) + '</label>').join("") +
          '<p class="quiz-feedback" id="pfb-' + qi + '" hidden></p></fieldset>').join("") +
        '<button class="btn btn-ghost" id="btn-pool" type="button">تحقق من إجابات التدريب</button>' +
        '<p class="quiz-result" id="pool-result" role="status" aria-live="polite" hidden></p>' +
        '</div></section>';
    }
    if (l.exercises) {
      body += '<section class="card"><h2>✏️ تمارين تطبيقية</h2><ol class="nice-list">' +
        l.exercises.map(e => '<li>' + esc(e) + '</li>').join("") + '</ol></section>';
    }
  }

  body += '<div id="done-card-slot">' + doneCardHTML(l, saved) + '</div>';

  body += '<nav class="lesson-nav">' +
    (prev ? '<a class="btn btn-ghost" href="#/lesson/' + prev.id + '">→ الدرس السابق</a>' : '<span></span>') +
    '<a class="btn btn-ghost" href="#/level/' + lv.n + '">كل دروس المستوى</a>' +
    (next ? '<a class="btn btn-ghost" href="#/lesson/' + next.id + '">الدرس التالي ←</a>' : '<span></span>') + '</nav>';

  shell(body, l.title);

  /* تفعيل العناصر التفاعلية */
  if (!l.stub) {
    const vnote = $("#video-note");
    const wireLocalError = (vid) => {
      if (vid && vnote) vid.addEventListener("error", () => {
        vnote.textContent = "تعذّر تحميل فيديو الدرس على هذا الحاسوب — تأكد أن ملف الفيديو (" + videoPath(l) + ") موجود داخل مجلد videos بجانب المنصة، وتابع الدرس من الشرح والكود والاختبار في هذه الصفحة.";
      });
    };
    const facade = $("#yt-facade");
    if (facade) {
      /* واجهة يوتيوب: الضغط يُركّب المشغّل الفعلي (youtube-nocookie)،
         ورابط «النسخة المحلية» يبقى متاحًا قبل التشغيل وبعده */
      const mountLocal = () => {
        const slot = $("#yt-slot");
        if (slot) { slot.dataset.on = ""; slot.innerHTML = localVideoHTML(l); }
        facade.hidden = true;
        wireLocalError(document.querySelector(".lesson-video"));
        if (vnote) vnote.textContent = "تشغّل الآن النسخة المحلية من الفيديو — وتظهر الترجمة العربية تلقائيًا أثناء التشغيل إذا وُجد ملف ترجمته بجانب المنصة.";
      };
      const playYT = () => {
        const slot = $("#yt-slot");
        if (!slot || slot.dataset.on) return;
        slot.dataset.on = "1";
        facade.hidden = true;
        slot.innerHTML = '<div class="yt-frame-wrap"><iframe class="yt-frame" src="https://www.youtube-nocookie.com/embed/' + facade.dataset.yt + '?autoplay=1&rel=0&modestbranding=1&playsinline=1&cc_lang_pref=ar" title="فيديو الدرس على يوتيوب" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
        if (vnote) {
          vnote.innerHTML = 'تشاهد الآن الدرس عبر يوتيوب. يمكنك أيضًا تجربة <a href="#" id="yt-use-local2">النسخة المحلية من الفيديو</a>.';
          const sw2 = $("#yt-use-local2");
          if (sw2) sw2.addEventListener("click", (e) => { e.preventDefault(); mountLocal(); });
        }
      };
      facade.addEventListener("click", playYT);
      facade.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playYT(); } });
      const sw = $("#yt-use-local");
      if (sw) sw.addEventListener("click", (e) => { e.preventDefault(); mountLocal(); });
    } else {
      wireLocalError(document.querySelector(".lesson-video"));
    }
  }
  if (!l.stub && l.experiment) {
    const slot = $("#experiment-slot");
    if (slot) {
      if (l.experiment.type === "blink") mountBlinkExperiment(slot);
      else if (window.ACADEMY_EXPERIMENTS && typeof window.ACADEMY_EXPERIMENTS[l.experiment.type] === "function") {
        window.ACADEMY_EXPERIMENTS[l.experiment.type](slot, l.experiment);
      } else {
        /* لا تنفيذ مسجلًا لهذه التجربة: حالة واضحة بدل فراغ صامت */
        slot.innerHTML = '<p class="muted">تجربة هذا الدرس غير متوفرة في هذه النسخة من المنصة — لا بأس: تابع الشرح والكود والتمارين في هذه الصفحة، وستصلك التجربة في تحديث قادم.</p>';
      }
    }
  }
  /* الإطار الموجّه العام لبقية التجارب (الجولة الثالثة): توقّع قبل اللمس،
     وكشف خطوة «لاحظ» بعد التوقّع والتفاعل معًا، ثم كشف «فسّر» عند الإجابة.
     محتواه عام مرتبط بعنوان الدرس — لا يخترع علمًا خاصًّا بأي درس */
  const guide = $("#exp-guide");
  if (guide && l.experiment && l.experiment.type !== "blink") {
    const expSlot = $("#experiment-slot");
    let gPredicted = false, gInteracted = false;
    const obs = $("#exp-guide-observe", guide);
    const exEl = $("#exp-guide-explain", guide);
    const maybeObserve = () => { if (obs && gPredicted && gInteracted) obs.hidden = false; };
    guide.querySelectorAll("[data-gpred]").forEach(b => b.addEventListener("click", () => {
      gPredicted = true;
      guide.querySelectorAll("[data-gpred]").forEach(x => x.classList.toggle("pred-chosen", x === b));
      maybeObserve();
    }));
    if (expSlot) ["input", "change", "click"].forEach(evName =>
      expSlot.addEventListener(evName, () => { gInteracted = true; maybeObserve(); }));
    guide.querySelectorAll("[data-gobs]").forEach(b => b.addEventListener("click", () => {
      guide.querySelectorAll("[data-gobs]").forEach(x => x.classList.toggle("pred-chosen", x === b));
      if (!exEl) return;
      const o = b.getAttribute("data-gobs");
      exEl.hidden = false;
      exEl.innerHTML = "<strong>٤ — فسّر:</strong> " +
        (o === "match" ? "طابقت ملاحظتك توقّعك — هكذا يُبنى الحدس العلمي: توقّع مبني على فهم، ثم تحقّق بالعين. " :
         o === "diff" ? "اختلفت النتيجة عن توقّعك — وهذه أثمن لحظة في التعلّم: قارن ما حدث بما توقّعته واسأل نفسك أين كان الفرق بالضبط. " :
                        "لم يتغيّر شيء يُذكر — أحيانًا يكون «لا تغيير» نفسه نتيجة مهمة، وأحيانًا يحتاج التغيير مقدارًا أكبر لتلاحظه. ") +
        "الآن اربط ما رأيته بشرح هذا الدرس في الصفحة نفسها («" + esc(l.title) + "»)، وارجع إلى التجربة من جديد بتوقّع أدقّ — فكل جولة توقّع وتجربة تقوّي فهمك.";
    }));
  }
  /* تصحيح أسئلة التدريب «تحدَّ نفسك»: فوري، محلي، ولا يُسجَّل في أي مكان */
  const poolBtn = $("#btn-pool");
  if (poolBtn && Array.isArray(l.quizExtra)) poolBtn.addEventListener("click", () => {
    let answered = 0, right = 0;
    l.quizExtra.forEach((q, qi) => {
      const chosen = document.querySelector('input[name="pool' + qi + '"]:checked');
      const fb = $("#pfb-" + qi);
      if (!fb) return;
      fb.hidden = false;
      if (!chosen) {
        fb.textContent = "لم تُجب عن هذا السؤال بعد — جرّب، فالتدريب بلا مخاطرة.";
        fb.className = "quiz-feedback stale";
        return;
      }
      answered++;
      if (Number(chosen.value) === q.answer) {
        right++;
        fb.textContent = "✓ صحيحة! " + (q.explain || "");
        fb.className = "quiz-feedback ok";
      } else {
        fb.textContent = "✗ ليست الصحيحة. الإجابة الصحيحة: " + q.options[q.answer] + (q.explain ? " — " + q.explain : "");
        fb.className = "quiz-feedback bad";
      }
    });
    const pr = $("#pool-result");
    if (pr) {
      pr.hidden = false;
      pr.className = "quiz-result " + (answered === l.quizExtra.length && right === answered ? "ok" : "warn");
      pr.textContent = answered === 0
        ? "اختر إجابة واحدة على الأقل ثم أعد التحقق."
        : "نتيجة تدريبك: " + right + " صحيحة من " + answered + " أجبت عنها" +
          (answered < l.quizExtra.length ? " (بقي " + (l.quizExtra.length - answered) + " بلا إجابة)" : "") +
          " — تذكّر: هذا تدريب فقط ولا يدخل في إتمام الدرس.";
    }
  });
  const copyBtn = $("#btn-copy");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    const text = l.code.text;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
      ta.remove();
    }
    copyBtn.textContent = ok ? "✓ تم النسخ" : "تعذّر النسخ — حدّد الكود يدويًا";
    setTimeout(() => { copyBtn.textContent = "نسخ الكود"; }, 2000);
  });
  const quizBtn = $("#btn-quiz");
  let quizBusy = false;   /* حارس ضد تصحيحين متزامنين بنقر مكرر */
  let quizGraded = false; /* هل عُرض تصحيح لهذه الجولة من الإجابات؟ */
  if (quizBtn) {
  quizBtn.addEventListener("click", () => {
    if (quizBusy) return;
    quizBusy = true;
    quizBtn.disabled = true;
    const releaseQuiz = () => { quizBusy = false; quizBtn.disabled = false; };
    const res = $("#quiz-result");
    const retryBtn = $("#btn-save-retry");
    const staleNote = $("#quiz-stale-note");
    if (staleNote) staleNote.hidden = true;
    const chosenValues = l.quiz.map((q, qi) => {
      const chosen = document.querySelector('input[name="q' + qi + '"]:checked');
      return chosen ? Number(chosen.value) : null;
    });
    const g = gradeQuiz(l, chosenValues);
    if (!g.complete) {
      /* لم يُجب عن جميع الأسئلة: لا تصحيح ولا تسجيل — أكمل أولًا */
      res.hidden = false;
      res.className = "quiz-result warn";
      res.textContent = "أجب عن جميع الأسئلة أولًا: أجبت عن " + g.answered + " من " + g.total + ". أكمل الباقي ثم اضغط «تصحيح الاختبار».";
      /* انقل التركيز إلى أول سؤال بلا إجابة */
      const miss = g.per.findIndex(x => !x.answered);
      if (miss >= 0) {
        const inp = document.querySelector('input[name="q' + miss + '"]');
        if (inp && typeof inp.focus === "function") inp.focus();
      }
      releaseQuiz();
      return;
    }
    l.quiz.forEach((q, qi) => {
      const fb = $("#fb-" + qi);
      fb.hidden = false;
      if (g.per[qi].correct) {
        fb.textContent = "✓ إجابة صحيحة. أحسنت!" + (q.explain ? " " + q.explain : ""); fb.className = "quiz-feedback ok";
      } else {
        /* إجابة خاطئة: إن عرفنا فقرة الشرح التي يختبرها السؤال (حقل section)
           نربط التصحيح بها مباشرة وينتقل التلميذ إليها بضغطة واحدة */
        fb.innerHTML = "✗ ليست الإجابة الصحيحة. الإجابة الصحيحة: " + esc(q.options[q.answer]) + (q.explain ? " — " + esc(q.explain) : "") +
          (typeof q.section === "number"
            ? ' <button class="btn btn-ghost btn-small fb-section-link" type="button" data-section="' + q.section + '">راجع الفقرة ' + (q.section + 1) + ' في الشرح</button>'
            : " راجع فقرة الشرح في هذه الصفحة، أو أعد اللعب بالتجربة التفاعلية ولاحظ الفرق بنفسك.");
        fb.className = "quiz-feedback bad";
        const fbLink = fb.querySelector(".fb-section-link");
        if (fbLink) fbLink.addEventListener("click", () => {
          const target = document.getElementById("exp-para-" + q.section);
          if (target) {
            if (typeof target.scrollIntoView === "function") target.scrollIntoView({ behavior: "smooth", block: "start" });
            target.classList.add("para-flash");
            setTimeout(() => target.classList.remove("para-flash"), 2400);
          }
        });
      }
    });
    quizGraded = true;
    const rec = recordQuizAttempt(l, g.score, lessonOwner);
    res.hidden = false;
    const refreshDoneCard = () => {
      const slot = $("#done-card-slot");
      if (slot) {
        const meNow = currentUser();
        const pNow = (meNow && meNow.rec.progress && meNow.rec.progress[l.id]) || {};
        slot.innerHTML = doneCardHTML(l, pNow);
      }
    };
    if (!rec || rec.saved === false) {
      /* النتيجة معروضة لكنها لم تُحفظ على هذا الحاسوب: ميّز بين «اجتزت» و«حُفظ» واعرض إعادة الحفظ دون إعادة الإجابة */
      res.className = "quiz-result warn";
      res.textContent = g.passed
        ? "نتيجتك: " + g.score + " من " + g.total + " — اجتزت الاختبار ✓ لكن تعذّر حفظ تقدّمك على هذا الحاسوب. لا تغلق الصفحة، واضغط «إعادة محاولة حفظ النتيجة»."
        : "نتيجتك: " + g.score + " من " + g.total + " — تعذّر حفظ نتيجتك على هذا الحاسوب. اضغط «إعادة محاولة حفظ النتيجة» لحفظها دون إعادة الإجابة.";
      if (retryBtn) {
        retryBtn.hidden = false;
        retryBtn.onclick = () => {
          if (retryBtn.disabled) return;
          retryBtn.disabled = true;
          const rec2 = recordQuizAttempt(l, g.score, lessonOwner);
          retryBtn.disabled = false;
          if (rec2 && rec2.saved !== false) {
            retryBtn.hidden = true;
            if (g.passed) {
              res.className = "quiz-result ok";
              res.textContent = "نتيجتك: " + g.score + " من " + g.total + " — تم حفظها الآن ✓ الدرس منجز. أحسنت! 🎉";
            } else {
              res.className = "quiz-result bad";
              res.textContent = "تم حفظ نتيجتك الآن (" + g.score + " من " + g.total + "). راجع الشرح وحاول من جديد — يمكنك إعادة المحاولة متى شئت.";
            }
            refreshDoneCard();
          } else {
            res.textContent = "ما زال الحفظ متعذرًا على هذا الحاسوب — أخبر الأستاذ (قد يكون تخزين المتصفح ممتلئًا أو محظورًا). إجاباتك ونتيجتك ما زالتا معروضتين في هذه الصفحة.";
          }
        };
      }
      releaseQuiz();
      return;
    }
    if (retryBtn) retryBtn.hidden = true;
    if (g.passed) {
      /* خطوة تالية واضحة بعد النجاح — تعبر حدود المستوى أيضًا */
      res.className = "quiz-result ok";
      const meNow = currentUser();
      let step = "";
      if (meNow && levelComplete(meNow.rec, l.level)) {
        step = certificateUnlocked(meNow.rec, l.level)
          ? "<br>🏆 أكملت المستوى " + l.level + " كله! <a href=\"#/certificate/" + l.level + "\">افتح شهادة إتمام المستوى واطبعها</a>" +
            (next ? " — وخطوتك التالية بعدها: أول درس في المستوى الموالي «" + esc(next.title) + "» (أزرار التنقل أسفل الصفحة)." : " — بل أكملت جميع مستويات الأكاديمية كلها، فخورون بك! 🎓")
          : "<br>🏆 أكملت دروس المستوى " + l.level + " كلها! بقي خطوة أخيرة قبل الشهادة: تمرين «ملعب الكود» البرمجي القصير في <a href=\"#/level/" + l.level + "\">صفحة المستوى</a> — اجتزه لتُفتح شهادتك.";
      } else if (next) {
        step = "<br>خطوتك التالية: الدرس التالي «" + esc(next.title) + "»" +
          (next.level !== l.level ? " — وهو أول درس في المستوى الموالي" : "") + "، تجده في أزرار التنقل أسفل الصفحة.";
      }
      res.innerHTML = "نتيجتك: " + g.score + " من " + g.total + " — أحسنت! أكملت الدرس ✓" + (g.score === g.total ? " إتقان كامل! 🎉" : " 🎉") + step;
    } else if (rec.done) {
      /* محاولة تدريب لم تنجح، لكن الدرس منجز أصلًا بدليل اجتياز سابق محفوظ */
      res.className = "quiz-result warn";
      res.textContent = "نتيجتك هذه المرة: " + g.score + " من " + g.total + " — لم تبلغ حد الاجتياز في هذه المحاولة، لكن لا قلق: الدرس منجز عندك من قبل ✓ وأفضل نتيجتك محفوظة (" + rec.quizBest + "/" + rec.total + "). هذه المحاولة للتدريب فقط ولا تُلغي إتمامك.";
    } else {
      res.className = "quiz-result bad";
      res.textContent = "نتيجتك: " + g.score + " من " + g.total + " — لم تجتز الاختبار بعد: تحتاج " + quizPassScore(g.total) +
        " إجابات صحيحة على الأقل ليُحتسب الدرس منجزًا. راجع الشرح وحاول من جديد — يمكنك إعادة المحاولة متى شئت.";
    }
    /* تحديث بطاقة الإتمام في مكانها وفق الحالة الجديدة */
    refreshDoneCard();
    releaseQuiz();
  });
  /* تغيير إجابة بعد التصحيح: التصحيح القديم لم يعد يخصّها — وضّح ذلك فورًا
     بدل تركه معروضًا كأنه تصحيح للإجابة الجديدة */
  if (l.quiz) l.quiz.forEach((q, qi) => {
    document.querySelectorAll('input[name="q' + qi + '"]').forEach(inp => {
      inp.addEventListener("change", () => {
        if (!quizGraded) return;
        const fb = $("#fb-" + qi);
        if (fb && !fb.hidden) {
          fb.textContent = "غيّرت إجابتك — التصحيح السابق كان لإجابتك القديمة ولم يعد يخصّ الجديدة. أعد الضغط على «تصحيح الاختبار».";
          fb.className = "quiz-feedback stale";
        }
        const sn = $("#quiz-stale-note");
        if (sn) sn.hidden = false;
      });
    });
  });
  }
  /* لا يوجد زر «أنجزت الدرس»: الإتمام يأتي من اجتياز الاختبار فقط (recordQuizAttempt) */
}

/* ---------- الموجّه ---------- */
function render() {
  stopExperiment();
  const hash = location.hash || "#/";
  const parts = hash.replace(/^#\//, "").split("/");
  if (!currentUser()) {
    if (parts[0] === "register") return renderAuth("register");
    if (parts[0] === "recover") return renderRecover();
    if (parts[0] === "teacher") return renderTeacher();
    return renderAuth("login");
  }
  if (parts[0] === "teacher") return renderTeacher();
  if (parts[0] === "level" && parts[1]) return renderLevel(Number(parts[1]));
  if (parts[0] === "certificate" && parts[1]) return renderCertificate(Number(parts[1]));
  if (parts[0] === "lesson" && parts[1]) return renderLesson(parts[1]);
  return renderHome();
}
window.addEventListener("hashchange", render);
/* تغيّرت الجلسة أو البيانات في نافذة أخرى؟ حدّث العرض حتى لا يعمل التلميذ
   على حساب غير حسابه ولا تُنسب نتيجة لغير صاحبها */
window.addEventListener("storage", (e) => { if (!e || e.key === SESSION_KEY || e.key === DB_KEY) render(); });
document.addEventListener("DOMContentLoaded", render);
