/* ============================================================
   أكاديمية الروبوتيك والذكاء الاصطناعي — منطق التطبيق (يعمل دون إنترنت)
   - الحسابات والتقدم: localStorage على هذا الحاسوب فقط
   - كلمات السر: لا تُحفظ أبدًا كما هي، بل بصمة SHA-256 مع ملح عشوائي
   - الجولة الثالثة (Hybrid & Completion): لوحة أستاذ #/teacher بتجميع
     ذاكري فقط، مفتاح أستاذ .academykey ببصمة محفوظة يحمي الاستعادة،
     تمرين «ملعب الكود» شرط إضافي لفتح الشهادة فوق إتمام الدروس،
     أسئلة تدريب quizExtra غير المُقيَّمة، روابط «راجع الفقرة» من حقل
     section، وإطار موجّه عام لكل التجارب. المزامنة السحابية طبقة
     منفصلة (sync.js + sync-config.js) تُحمَّل عند ضغط زرها فقط —
     هذا الملف لا يعرف الشبكة إطلاقًا.
   - الجولة الرابعة (هوية احترافية): التسجيل باستمارة مُتحقَّق منها
     (اسم كامل يُطبع على الشهادة، بريد إلكتروني فريد، كلمة سر قوية،
     سنّ، مستوى دراسي، مؤسسة)، والدخول بالبريد وكلمة السر بدل اسم
     المستخدم، وخيار الدخول/التسجيل عبر Google في وحدة كسولة منفصلة
     (auth-google.js) تُحمَّل عند ضغط زرها فقط — فيبقى هذا الملف
     بلا أي مرجع لعناوين Google وبلا أي نداء شبكي كما كان دائمًا.
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
/* ختم تغيّر البيانات: تكتبه كل عملية حفظ ناجحة، وتقارنه طبقة المزامنة
   الكسولة (sync.js) بختم آخر رفع ناجح لتعرف أن هناك جديدًا يستحق الرفع
   التلقائي — مجرد طابع زمني محلي في التخزين نفسه، لا شبكة إطلاقًا هنا */
const DATA_STAMP_KEY = "arduinoAcademyDataStamp.v1";
function saveDB(db) {
  /* «آخر نشاط» (الجولة الرابعة — المرحلة الثانية): كل حفظ يوقّع سجل
     صاحب الجلسة الحالية بطابع updatedAt حتى تعرض لوحة الأستاذ آخر نشاط
     لكل تلميذ. السجلات القديمة بلا هذا الحقل تبقى صالحة كما هي (تعرض
     اللوحة «—»)، ولا يُختم أي سجل آخر لأن الحفظ نشاط صاحبه وحده */
  try {
    const meKey = storageGet(SESSION_KEY);
    if (meKey && db && db.users && db.users[meKey] && typeof db.users[meKey] === "object")
      db.users[meKey].updatedAt = Date.now();
  } catch (e) { /* تجاهل: ختم النشاط تجميلي ولا يوقف الحفظ أبدًا */ }
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch (e) { return false; }
  storageSet(DATA_STAMP_KEY, String(Date.now()));
  /* إشعار عام «حُفظت البيانات» تلتقطه طبقة المزامنة إن كانت محمّلة ومتصلة
     (رفع فوري بعد إتمام درس/اجتياز اختبار) — غيابه لا يؤثر في شيء */
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function")
      window.dispatchEvent(new CustomEvent("academy:data-saved"));
  } catch (e) { /* بيئات بلا أحداث (اختبارات): تجاهل */ }
  return true;
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

/* ---------- حسابات التلاميذ: تحقق احترافي وهوية بالبريد (الجولة الرابعة) ----------
   مفتاح السجل في قاعدة البيانات: للحسابات الجديدة هو البريد الإلكتروني
   نفسه (بأحرف صغيرة)، وللحسابات القديمة يبقى مفتاحها التاريخي (اسم
   المستخدم) كما هو محفوظًا في حقل/مفتاح «legacy» — الدخول صار بالبريد
   وكلمة السر، والبحث بالبريد يتجاهل حالة الأحرف. حسابات Google تحمل
   provider: "google" ولا ملح/بصمة لها إطلاقًا (لا كلمة سر محلية). */
const SCHOOL_LEVELS = ["أولى إعدادي", "ثانية إعدادي", "ثالثة إعدادي"];
function normalizeEmail(email) { return String(email == null ? "" : email).trim().toLowerCase(); }
function nameFieldError(name) {
  const v = String(name == null ? "" : name).trim();
  if (!v) return "اكتب اسمك الكامل.";
  if (v.length < 3) return "الاسم الكامل قصير جدًا — يجب أن يكون 3 أحرف على الأقل، لأنه سيظهر على شهاداتك كما كتبته.";
  return null;
}
function emailFieldError(email) {
  const v = normalizeEmail(email);
  if (!v) return "اكتب بريدك الإلكتروني.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "صيغة البريد الإلكتروني غير صحيحة — مثال صحيح: name@example.com";
  return null;
}
const LETTER_RE = /[A-Za-z\u0621-\u064A\u066E-\u06D3]/;
const DIGIT_RE = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
function passwordFieldError(password) {
  const v = String(password == null ? "" : password);
  if (!v) return "اكتب كلمة السر.";
  if (v.length < 8) return "كلمة السر قصيرة — يجب أن تكون 8 أحرف على الأقل.";
  if (!LETTER_RE.test(v) || !DIGIT_RE.test(v)) return "كلمة السر يجب أن تحتوي على حرف واحد على الأقل ورقم واحد على الأقل.";
  return null;
}
/* مؤشر قوة إرشادي فقط (0..3): بوابة القبول هي passwordFieldError وحدها */
function passwordStrength(password) {
  const v = String(password == null ? "" : password);
  if (!v) return 0;
  let score = 0;
  if (v.length >= 8) score++;
  if (LETTER_RE.test(v) && DIGIT_RE.test(v)) score++;
  if (v.length >= 12 || /[^A-Za-z0-9\u0621-\u064A\u0660-\u0669\u06F0-\u06F9\s]/.test(v)) score++;
  return Math.min(score, 3);
}
function ageFieldError(age) {
  if (age === null || age === undefined || String(age).trim() === "") return "اكتب سنّك.";
  const n = Number(age);
  if (!Number.isInteger(n)) return "السنّ يجب أن يكون رقمًا صحيحًا (مثال: 12).";
  if (n < 8 || n > 25) return "السنّ المقبول في الأكاديمية بين 8 و25 سنة.";
  return null;
}
function levelFieldError(level) {
  if (!level) return "اختر مستواك الدراسي من القائمة.";
  if (SCHOOL_LEVELS.indexOf(level) < 0) return "اختر المستوى الدراسي من القائمة.";
  return null;
}
function schoolFieldError(school) {
  const v = String(school == null ? "" : school).trim();
  if (!v) return "اكتب اسم مؤسستك (مدرستك/إعداديتك).";
  if (v.length < 3) return "اسم المؤسسة قصير جدًا — اكتبه كاملًا (3 أحرف على الأقل).";
  return null;
}
/* تحقق الاستمارة الاحترافية كلها دفعة واحدة: يرجع خريطة {حقل: رسالة} */
function validateStudentFields(f) {
  const errs = {};
  const e1 = nameFieldError(f.name); if (e1) errs.name = e1;
  const e2 = emailFieldError(f.email); if (e2) errs.email = e2;
  const e3 = ageFieldError(f.age); if (e3) errs.age = e3;
  const e4 = levelFieldError(f.level); if (e4) errs.level = e4;
  const e5 = schoolFieldError(f.school); if (e5) errs.school = e5;
  return errs;
}
function accountProvider(rec) { return rec && rec.provider === "google" ? "google" : "password"; }
function findUserKeyByEmail(db, email) {
  const target = normalizeEmail(email);
  if (!target || !db || !db.users) return null;
  for (const k of Object.keys(db.users)) {
    const r = db.users[k];
    if (r && typeof r === "object" && typeof r.email === "string" && normalizeEmail(r.email) === target) return k;
  }
  return null;
}
/* حلّ معرّف إلى مفتاح حساب: مفتاح مخزّن كما هو أولًا (حسابات قديمة باسم
   مستخدم)، ثم البريد الإلكتروني — حتى تبقى الاستعادة ولوحة الأستاذ
   تعملان مع السجلات القديمة التي لا بريد لها دون أي انهيار */
function resolveAccountKey(db, identifier) {
  const raw = String(identifier == null ? "" : identifier).trim();
  if (!raw) return null;
  if (hasUser(db, raw)) return raw;
  const lower = raw.toLowerCase();
  if (hasUser(db, lower)) return lower;
  return findUserKeyByEmail(db, raw);
}
/* إنشاء حساب بكلمة سر: التحقق الشامل أولًا، ثم التشفير، ثم إعادة تحميل
   قاعدة البيانات وفحص فرادة البريد فورًا قبل الحفظ (نمط التزامن الآمن
   نفسه الذي كان في شاشة التسجيل منذ الجولة الأولى) */
async function createPasswordAccount(input) {
  const fields = {
    name: String(input.name == null ? "" : input.name).trim(),
    email: normalizeEmail(input.email),
    age: input.age,
    level: input.level,
    school: String(input.school == null ? "" : input.school).trim()
  };
  const errors = validateStudentFields(fields);
  const pwErr = passwordFieldError(input.password);
  if (pwErr) errors.password = pwErr;
  if (String(input.password == null ? "" : input.password) !== String(input.password2 == null ? "" : input.password2))
    errors.password2 = "كلمتا السر غير متطابقتين.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const pw = await makePasswordRecord(String(input.password));
  const db = loadDB();
  if (findUserKeyByEmail(db, fields.email)) {
    return { ok: false, errors: { email: "هذا البريد الإلكتروني مسجّل من قبل — سجّل الدخول بدلًا من إنشاء حساب جديد، أو استعمل بريدًا آخر." } };
  }
  db.users[fields.email] = {
    name: fields.name, email: fields.email, provider: "password",
    salt: pw.salt, hash: pw.hash, hashAlgo: pw.hashAlgo,
    age: Number(fields.age), level: fields.level, school: fields.school,
    createdAt: Date.now(), progress: {}
  };
  if (!saveDB(db)) return { ok: false, error: "تعذّر حفظ حسابك على هذا الحاسوب (التخزين ممتلئ أو محظور في المتصفح). أخبر الأستاذ وحاول من جديد." };
  return { ok: true, key: fields.email };
}
/* الدخول بالبريد وكلمة السر — حساب Google بالبريد نفسه يُوجَّه إلى زر
   Google برسالة صريحة، ولا يُدمج ولا يُربط أي حساب بصمت أبدًا */
async function loginWithPassword(email, password) {
  const db = loadDB();
  const key = findUserKeyByEmail(db, email);
  if (!key) return { ok: false, error: "لا يوجد حساب بهذا البريد الإلكتروني. أنشئ حسابًا جديدًا أولًا." };
  const rec = db.users[key];
  if (accountProvider(rec) === "google")
    return { ok: false, error: "هذا الحساب أُنشئ عبر Google ولا كلمة سر له — استعمل زر «تسجيل الدخول مع Google» في الأعلى." };
  const okPass = await verifyPassword(rec, String(password == null ? "" : password));
  if (!okPass) return { ok: false, error: "كلمة السر غير صحيحة. حاول من جديد." };
  /* ترحيل الحسابات القديمة عند أول دخول ناجح (بصمة fnv: أو بلا نسخة
     خوارزمية مسجلة) — السلوك نفسه منذ الجولة الأولى */
  if ((rec.hash && rec.hash.indexOf("fnv:") === 0) || rec.hashAlgo !== HASH_ALGO) {
    const pw = await makePasswordRecord(String(password));
    const fresh = loadDB();
    if (hasUser(fresh, key)) {
      fresh.users[key].salt = pw.salt;
      fresh.users[key].hash = pw.hash;
      fresh.users[key].hashAlgo = pw.hashAlgo;
      saveDB(fresh);
    }
  }
  return { ok: true, key };
}
/* حسابات Google: التحقق من ملف Google نفسه قبل أي شيء */
function googleProfileError(profile) {
  if (!profile || typeof profile !== "object") return "تعذّرت قراءة بيانات حساب Google.";
  if (emailFieldError(profile.email)) return "حساب Google هذا بلا بريد إلكتروني صالح — اختر حسابًا آخر.";
  if (nameFieldError(profile.name)) return "حساب Google هذا بلا اسم كامل صالح — اختر حسابًا آخر.";
  return null;
}
/* إتمام تسجيل Google: الاسم والبريد من ملف Google، والتلميذ يكمل
   السنّ والمستوى والمؤسسة في الاستمارة نفسها؛ لا حقول كلمة سر إطلاقًا */
function registerGoogleAccount(db, profile, extras) {
  const pErr = googleProfileError(profile);
  if (pErr) return { ok: false, error: pErr };
  const fields = {
    name: String(profile.name).trim(),
    email: normalizeEmail(profile.email),
    age: extras ? extras.age : "",
    level: extras ? extras.level : "",
    school: extras ? String(extras.school == null ? "" : extras.school).trim() : ""
  };
  const errors = validateStudentFields(fields);
  if (Object.keys(errors).length) return { ok: false, errors };
  const existing = findUserKeyByEmail(db, fields.email);
  if (existing) {
    return accountProvider(db.users[existing]) === "google"
      ? { ok: false, errors: { email: "هذا الحساب موجود أصلًا عبر Google — اذهب إلى صفحة الدخول واضغط «تسجيل الدخول مع Google»." } }
      : { ok: false, errors: { email: "هذا البريد مسجّل بحساب وكلمة سر — سجّل الدخول بكلمة السر بدلًا من إنشاء حساب جديد." } };
  }
  db.users[fields.email] = {
    name: fields.name, email: fields.email, provider: "google",
    age: Number(fields.age), level: fields.level, school: fields.school,
    createdAt: Date.now(), progress: {}
  };
  if (!saveDB(db)) return { ok: false, error: "تعذّر حفظ حسابك على هذا الحاسوب (التخزين ممتلئ أو محظور في المتصفح). أخبر الأستاذ وحاول من جديد." };
  return { ok: true, key: fields.email };
}
/* حالة بريد أمام دخول Google: حساب Google جاهز / حساب كلمة سر (رسالة
   صريحة) / لا حساب — لا دمج ولا ربط صامت بين النوعين أبدًا */
function googleLoginState(db, email) {
  const key = findUserKeyByEmail(db, email);
  if (!key) return { status: "none" };
  return accountProvider(db.users[key]) === "google" ? { status: "ok", key } : { status: "password" };
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
  if (obj.format !== BACKUP_FORMAT) return { ok: false, error: "هذا الملف ليس نسخة احتياطية صادرة من هذه المنصة." };
  if (typeof obj.version !== "number" || obj.version < 1) return { ok: false, error: "نسخة الصيغة غير معروفة." };
  if (obj.version > BACKUP_VERSION) return { ok: false, error: "هذه النسخة أحدث من نسختك من المنصة — حدّث المنصة أولًا ثم أعد الاستيراد." };
  if (!obj.users || typeof obj.users !== "object" || Array.isArray(obj.users)) return { ok: false, error: "النسخة لا تحتوي قائمة حسابات صالحة." };
  const users = {};
  for (const name of Object.keys(obj.users)) {
    const r = obj.users[name];
    /* حسابات Google (provider: "google") لا ملح/بصمة لها بحكم التصميم —
       تُطلب البصمة من حسابات كلمة السر فقط. النسخ القديمة (بعهد اسم
       المستخدم، بلا بريد ولا حقول جديدة) تُقبل كما هي وتأخذ الحقول
       الناقصة قيمًا فارغة آمنة، فلا ينهار لا الدخول ولا الاستعادة ولا اللوحة */
    const isGoogle = !!(r && typeof r === "object" && !Array.isArray(r) && r.provider === "google");
    if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.name !== "string" ||
        (!isGoogle && (typeof r.salt !== "string" || typeof r.hash !== "string"))) {
      return { ok: false, error: "سجل الحساب «" + name + "» في النسخة غير مكتمل (الاسم/الملح/البصمة) — أُلغي الاستيراد كله حفاظًا على بياناتك." };
    }
    users[name] = {
      name: r.name,
      email: typeof r.email === "string" ? normalizeEmail(r.email) : "",
      provider: isGoogle ? "google" : "password",
      username: typeof r.username === "string" ? r.username : undefined,
      salt: typeof r.salt === "string" ? r.salt : "",
      hash: typeof r.hash === "string" ? r.hash : "",
      hashAlgo: typeof r.hashAlgo === "string" ? r.hashAlgo : undefined,
      age: (typeof r.age === "number" && isFinite(r.age)) ? Math.trunc(r.age) : null,
      level: typeof r.level === "string" ? r.level : "",
      school: typeof r.school === "string" ? r.school : "",
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : undefined,
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
async function resetAccountPassword(key, newPassword) {
  const db = loadDB();
  if (!hasUser(db, key)) return false;
  /* حساب Google لا كلمة سر محلية له — إعادة التعيين ترفضه صراحة حتى
     لا يتحول بصمت إلى حساب كلمة سر (الدخول إليه بزر Google فقط) */
  if (accountProvider(db.users[key]) === "google") return false;
  const pw = await makePasswordRecord(newPassword);
  const rec = db.users[key];
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
    let currentLevel = null, doneCount = 0, earned = 0, possible = 0, certificates = 0;
    const perLevel = [];
    for (let n = 1; n <= 5; n++) {
      const st = levelStats(rec, n);
      doneCount += st.done;
      perLevel.push({ n, done: st.done, total: st.total });
      if (certificateUnlocked(rec, n)) certificates++;
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
    return { username, name: rec.name || username,
             email: typeof rec.email === "string" ? rec.email : "",
             age: (typeof rec.age === "number" && isFinite(rec.age)) ? rec.age : null,
             schoolLevel: typeof rec.level === "string" ? rec.level : "",
             school: typeof rec.school === "string" ? rec.school : "",
             provider: accountProvider(rec),
             currentLevel, allComplete: currentLevel === null,
             doneCount, totalLessons: TOTAL_LESSONS, earned, possible, dates,
             /* المرحلة الثانية: تقدّم مصغّر لكل مستوى، نسبة عامة، عدد
                الشهادات المفتوحة فعلًا (دروس + تمرين الملعب)، وآخر نشاط */
             perLevel,
             overallPct: TOTAL_LESSONS ? Math.round(doneCount / TOTAL_LESSONS * 100) : 0,
             certificates,
             createdAt: typeof rec.createdAt === "number" ? rec.createdAt : null,
             updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : null };
  });
}
function teacherRowsToCSV(rows) {
  const cell = v => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
  const head = ["الاسم الكامل", "اسم المستخدم", "البريد الإلكتروني", "السن", "المستوى الدراسي", "المؤسسة", "المستوى الحالي", "دروس منجزة", "نقاط الاختبارات (مجموع أفضل النتائج)", "من أصل",
    "تاريخ إتمام المستوى 1", "تاريخ إتمام المستوى 2", "تاريخ إتمام المستوى 3", "تاريخ إتمام المستوى 4", "تاريخ إتمام المستوى 5"];
  const lines = [head.map(cell).join(",")];
  rows.forEach(r => {
    lines.push([r.name, r.username, r.email || "", r.age === null || r.age === undefined ? "" : r.age, r.schoolLevel || "", r.school || "",
      r.allComplete ? "أكمل كل المستويات" : "المستوى " + r.currentLevel,
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

/* ---------- مجموعة الأيقونات الموحّدة (SVG inline symbols — viewBox 0 0 24 24) ---------- */
const ICON_SPRITE_MARKUP =
  '<symbol id="ico-video" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="3"/><polygon points="10 9 15.5 12 10 15 10 9"/></symbol>' +
  '<symbol id="ico-flask" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6"/><path d="M10 3v5.4L4.8 17.2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.2-3.8L14 8.4V3"/><path d="M6.8 15h10.4"/></symbol>' +
  '<symbol id="ico-check-circle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/></symbol>' +
  '<symbol id="ico-cpu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/></symbol>' +
  '<symbol id="ico-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/></symbol>' +
  '<symbol id="ico-cap" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 9.5 12 4.5l9.5 5-9.5 5-9.5-5Z"/><path d="M6.5 12v4.5c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3V12"/><path d="M21.5 9.5V15"/></symbol>' +
  '<symbol id="ico-award" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="m8.8 14.1-1.3 7.4 4.5-2.4 4.5 2.4-1.3-7.4"/></symbol>' +
  '<symbol id="ico-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.8"/><path d="M4.8 19.5a7.5 7.5 0 0 1 14.4 0"/></symbol>' +
  '<symbol id="ico-board" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4.5"/></symbol>' +
  '<symbol id="ico-youtube" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="4"/><polygon points="10 9.2 15.2 12 10 14.8 10 9.2"/></symbol>' +
  '<symbol id="ico-layers" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 3 8l9 4.5L21 8l-9-4.5Z"/><path d="m3 12.5 9 4.5 9-4.5"/><path d="m3 16.8 9 4.5 9-4.5"/></symbol>' +
  '<symbol id="ico-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.2c-1.8-1.4-4.3-2-7-2A1.5 1.5 0 0 0 3.5 5.7v11.8c0 .8.7 1.5 1.5 1.5 2.7 0 5.2.6 7 2 1.8-1.4 4.3-2 7-2 .8 0 1.5-.7 1.5-1.5V5.7c0-.8-.7-1.5-1.5-1.5-2.7 0-5.2.6-7 2Z"/><path d="M12 6.2v14.8"/></symbol>' +
  '<symbol id="ico-code" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m8.5 8.5-4 3.5 4 3.5"/><path d="m15.5 8.5 4 3.5-4 3.5"/><path d="m13.5 5.5-3 13"/></symbol>' +
  '<symbol id="ico-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6.2v5.3c0 5 3.2 8.3 7.5 9.8 4.3-1.5 7.5-4.8 7.5-9.8V6.2L12 3Z"/><path d="m9 12 2 2 4-4"/></symbol>' +
  '<symbol id="ico-arrow-down" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m6.5 13.5 5.5 5.5 5.5-5.5"/></symbol>' +
  '<symbol id="ico-key" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4.2"/><path d="m11 12 8.5-8.5"/><path d="m16 6.5 2.5 2.5M18.5 4 21 6.5"/></symbol>' +
  '<symbol id="ico-cloud" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6.8 18.5h10.7a4 4 0 0 0 .5-7.96A5.5 5.5 0 0 0 7.3 9.2 4.5 4.5 0 0 0 6.8 18.5Z"/></symbol>' +
  '<symbol id="ico-save" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4h9.7L19 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5.5A1.5 1.5 0 0 1 6.5 4Z"/><path d="M8.5 4v5h7V4"/><rect x="8" y="13" width="8" height="7.5" rx="1"/></symbol>' +
  '<symbol id="ico-bookmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4h11A1.5 1.5 0 0 1 19 5.5v15l-7-4.2-7 4.2v-15A1.5 1.5 0 0 1 6.5 4Z"/></symbol>' +
  '<symbol id="ico-printer" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="8.5" rx="2"/><rect x="7" y="14" width="10" height="6" rx="1"/></symbol>' +
  '<symbol id="ico-upload" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4.5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M4 15.5v2.5A2 2 0 0 0 6 20h12a2 2 0 0 0 2-2v-2.5"/></symbol>' +
  '<symbol id="ico-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h4.2l2 2.2h6.8a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z"/></symbol>' +
  '<symbol id="ico-target" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2"/></symbol>' +
  '<symbol id="ico-tools" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.2 4.2 0 0 0-5.4 5.4l-5.3 5.3a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a4.2 4.2 0 0 0 5.4-5.4l-2.4 2.4-2.3-2.3 2.4-2.4Z"/></symbol>' +
  '<symbol id="ico-quiz" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="m8 9.2 1.4 1.4 2.6-2.6"/><path d="M14 9.5h2.5"/><path d="m8 14.7 1.4 1.4 2.6-2.6"/><path d="M14 15h2.5"/></symbol>' +
  '<symbol id="ico-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M15.8 4.5a2.1 2.1 0 0 1 3 3L8.3 18l-4.3 1 1-4.3L15.8 4.5Z"/><path d="m14 6.3 3 3"/></symbol>' +
  '<symbol id="ico-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.4 6.1L20.5 12l-6.1 2.4L12 20.5l-2.4-6.1L3.5 12l6.1-2.9L12 3Z"/></symbol>' +
  '<symbol id="ico-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.8"/><path d="M12 7.5V12l3.2 2"/></symbol>';

function ensureIconSprite() {
  if (typeof document === "undefined" || !document.body) return;
  if (typeof document.getElementById === "function" && document.getElementById("academy-icon-sprite")) return;
  if (typeof document.createElement !== "function") return;
  const wrap = document.createElement("div");
  wrap.innerHTML = '<svg id="academy-icon-sprite" class="svg-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' + ICON_SPRITE_MARKUP + '</svg>';
  if (wrap.firstChild) document.body.insertBefore(wrap.firstChild, document.body.firstChild);
}
function icon(name, cls) {
  return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#ico-' + name + '"></use></svg>';
}

/* ---------- ترويسة وتذييل الأكاديمية ---------- */
function headerHTML() {
  const me = currentUser();
  /* زائر غير مسجّل: الشريط العلوي الأبيض النظيف يعرض رابط مركز الأستاذ وزري الدخول/التسجيل دائمًا */
  const userBox = me
    ? '<div class="user-box">' +
        '<a class="header-nav-link" href="#/teacher">' + icon("board", "icon-sm") + '<span>مركز الأستاذ</span></a>' +
        '<span class="user-name">' + icon("user", "icon-sm") + '<span>' + esc(me.rec.name) + '</span></span>' +
        '<button class="btn btn-ghost btn-small" id="btn-logout" type="button">تسجيل الخروج</button>' +
      '</div>'
    : '<div class="user-box">' +
        '<a class="header-nav-link" href="#/teacher">' + icon("board", "icon-sm") + '<span>مركز الأستاذ</span></a>' +
        '<span class="header-sep" aria-hidden="true"></span>' +
        '<a class="btn-textlink" href="#/login">تسجيل الدخول</a>' +
        '<a class="btn btn-primary btn-small btn-signup" href="#/register">سجّل مجانًا</a>' +
      '</div>';
  return '' +
  '<header class="site-header"><div class="header-inner">' +
    '<a class="brand" href="#/">' +
      '<img class="brand-logo" src="assets/club-logo.jpg" alt="شعار نادي الروبوتيك والذكاء الاصطناعي">' +
      '<span class="brand-text"><span class="brand-name">أكاديمية الروبوتيك والذكاء الاصطناعي</span>' +
      '<span class="brand-sub">Robotics &amp; AI Academy — تعلّم، وصّل، برمج، ابنِ</span></span>' +
    '</a>' + userBox +
  '</div></header>';
}
function footerHTML() {
  return '' +
  '<footer class="site-footer">' +
    '<div class="footer-inner">' +
      '<div class="footer-grid">' +
        '<div class="footer-col footer-about">' +
          '<div class="footer-brand-title">' + icon("cpu", "icon-md") + '<span>أكاديمية الروبوتيك والذكاء الاصطناعي</span></div>' +
          '<p class="footer-desc">منصة تعليمية عربية مجانية لتعلّم الإلكترونيات والبرمجة والروبوتيك — تعمل بالإنترنت ودون إنترنت، وتقدّم كل تلميذ محفوظ على هذا الحاسوب فقط.</p>' +
          '<p class="footer-credit">' + icon("cap", "icon-sm") + '<span>من إعداد الأستاذ محمد الغوات — نادي الروبوتيك والذكاء الاصطناعي</span></p>' +
        '</div>' +
        '<nav class="footer-col footer-links" aria-label="روابط المنصة">' +
          '<h3 class="footer-heading">روابط المنصة</h3>' +
          '<ul class="footer-link-list">' +
            '<li><a href="#/">الرئيسية</a></li>' +
            '<li><a href="#/login">تسجيل الدخول</a></li>' +
            '<li><a href="#/register">إنشاء حساب</a></li>' +
            '<li><a href="#/teacher">' + icon("board", "icon-sm") + '<span>مركز الأستاذ</span></a></li>' +
            '<li><a href="privacy.html">' + icon("shield", "icon-sm") + '<span>سياسة الخصوصية</span></a></li>' +
          '</ul>' +
        '</nav>' +
        '<div class="footer-col footer-channel">' +
          '<h3 class="footer-heading">قناة النادي التعليمية</h3>' +
          '<p class="footer-channel-note">تابع شروحات الدروس المصوّرة والتطبيقات العملية على قناتنا الرسمية على يوتيوب:</p>' +
          '<a class="footer-yt-btn" href="https://www.youtube.com/@AiRoboticsClub-o3x" target="_blank" rel="noopener">' +
            icon("youtube", "icon-md") +
            '<span>قناة اليوتيوب: Ai &amp; Robotics Club</span>' +
          '</a>' +
        '</div>' +
      '</div>' +
      '<div class="footer-bottom">' +
        '<span>أكاديمية الروبوتيك والذكاء الاصطناعي — مجانية بالكامل وبلا إعلانات</span>' +
        '<span class="footer-bottom-credit">من إعداد الأستاذ محمد الغوات — نادي الروبوتيك والذكاء الاصطناعي</span>' +
      '</div>' +
    '</div>' +
  '</footer>';
}
function shell(inner, pageTitle) {
  ensureIconSprite();
  app().innerHTML = '<a class="skip-link" href="#main">تجاوز إلى المحتوى الرئيسي</a>' + headerHTML() + '<main class="page" id="main" tabindex="-1">' + inner + '</main>' + footerHTML();
  if (pageTitle) document.title = pageTitle + " — أكاديمية الروبوتيك والذكاء الاصطناعي";
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

/* ---------- صفحة الاستقبال العامة (الجولة الرابعة — المرحلة الثانية) ----------
   أول ما يراه أي زائر غير مسجّل: تقديم احترافي للمنصة ودوراتها ثم
   الاختيار بين الدخول وإنشاء حساب. بطاقات المستويات تُبنى من بيانات
   المنصة نفسها (lessons-data) — العناوين وعدد الدروس الحقيقي لكل مستوى
   — فلا رقم مكتوبًا باليد يمكن أن يكذب مع تطوّر المنهاج */
const LEVEL_THEMES = {
  1: "أول خطواتك: الدوائر الكهربائية البسيطة، الصمام LED، وبرنامجك الأول.",
  2: "تتحكم وتقرر: الأزرار، الشاشة التسلسلية، الشروط والدوال.",
  3: "تقرأ العالم حولك: الحساسات والمشغلات — مسافة، حرارة، حركة وصوت.",
  4: "تبني روبوتات كاملة: سيارة ذكية ومشروع تخرج من اختيارك.",
  5: "المستوى المتقدم: ESP32 وإنترنت الأشياء والتحكم عبر البلوتوث."
};
function renderLanding() {
  /* أرقام شريط الإحصاءات تُشتقّ من البيانات لحظة العرض — لا رقم مكتوب باليد */
  const totalLessons = DATA.lessons.length;
  const totalLevels = DATA.levels.length;
  const levelCards = DATA.levels.map(lv => {
    const lvLessons = DATA.lessons.filter(l => l.level === lv.n).sort((a, b) => a.num - b.num);
    const syllabus = lvLessons.map(l => '<li>' + esc(l.title) + '</li>').join("");
    return '<article class="landing-level-card" data-level="' + lv.n + '" tabindex="0" role="link" aria-label="سجّل وابدأ: المستوى ' + lv.n + ' — ' + esc(lv.title) + '">' +
      '<div class="landing-cover-wrap"><img class="landing-cover" src="' + levelIconPath(lv.n) + '" alt=""></div>' +
      '<div class="landing-card-body">' +
        '<h3>المستوى ' + lv.n + ': ' + esc(lv.title) + '</h3>' +
        '<p class="landing-desc">' + esc(LEVEL_THEMES[lv.n] || lv.title) + '</p>' +
        '<p class="landing-meta">' +
          '<span class="landing-count">' + icon("book", "icon-sm") + '<span>' + lvLessons.length + ' درسًا</span></span>' +
          '<span class="landing-cert">' + icon("cap", "icon-sm") + '<span>شهادة إتمام المستوى</span></span>' +
        '</p>' +
        '<details class="landing-syllabus"><summary>محتوى المستوى</summary>' +
          '<ol>' + syllabus + '</ol></details>' +
        '<p class="landing-provider">من إعداد الأستاذ محمد الغوات — نادي الروبوتيك والذكاء الاصطناعي</p>' +
      '</div>' +
    '</article>';
  }).join("");
  const feature = (icoName, label) =>
    '<div class="landing-feature"><span class="landing-feature-icon" aria-hidden="true">' + icon(icoName, "icon-lg") + '</span>' +
    '<span class="landing-feature-label">' + label + '</span></div>';
  /* بطاقات «مسارات الأكاديمية»: مسار الأردوينو وحده حيّ — أعداده مشتقة
     من البيانات (totalLevels/totalLessons أعلاه) لا أرقام مكتوبة باليد —
     والمسارات القادمة بطاقات ساكنة بلا روابط ولا أعداد ولا محتوى مُخترع */
  const arduinoTrackCard =
    '<article class="landing-track-card is-live" data-track="arduino" data-scroll="landing-levels" tabindex="0" role="link" aria-label="مسار الأردوينو والروبوتيك — متاح الآن، انتقل إلى مستوياته">' +
      '<div class="track-card-top"><span class="track-icon-box">' + icon("cpu", "icon-md") + '</span><span class="track-badge track-badge-live">متاح الآن</span></div>' +
      '<h3>الأردوينو والروبوتيك</h3>' +
      '<p class="landing-track-desc">مسار الأكاديمية الأول والمتاح بكامله: إلكترونيات وبرمجة وروبوتات، من أول دائرة كهربائية إلى مشاريع متقدمة.</p>' +
      '<p class="landing-track-meta"><span data-track-stat="levels">' + totalLevels + '</span> مستويات · <span data-track-stat="lessons">' + totalLessons + '</span> درسًا</p>' +
      '<span class="landing-track-action"><span>عرض المستويات</span>' + icon("arrow-down", "icon-sm") + '</span>' +
    '</article>';
  const soonTrackCard = (key, icoName, title, line) =>
    '<article class="landing-track-card is-soon" data-track="' + key + '">' +
      '<div class="track-card-top"><span class="track-icon-box">' + icon(icoName, "icon-md") + '</span><span class="track-badge track-badge-soon">قريبًا</span></div>' +
      '<h3>' + title + '</h3>' +
      '<p class="landing-track-desc">' + line + '</p>' +
    '</article>';
  const trackCards = arduinoTrackCard +
    soonTrackCard("python", "code", "لغة Python", "أساسيات البرمجة والتفكير المنطقي بلغة سهلة وواسعة الاستعمال.") +
    soonTrackCard("web", "globe", "صناعة المواقع", "بناء صفحات ومواقع الويب من الأساس، خطوة بخطوة.") +
    soonTrackCard("more", "layers", "مسارات برمجة أخرى", "لغات ومواضيع برمجة جديدة تُضاف تدريجيًا حسب جاهزيتها.");
  shell(
    '<section class="landing-hero">' +
      '<svg class="hero-circuit-ornament" viewBox="0 0 600 260" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        '<path d="M12 40h110l32 32h140M40 120h85l28-28h96M18 205h130l36-36h115M588 55H468l-34 34H320M565 175H450l-30 30H310" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle cx="294" cy="72" r="4.5" fill="currentColor"/><circle cx="249" cy="92" r="4.5" fill="currentColor"/><circle cx="299" cy="169" r="4.5" fill="currentColor"/>' +
        '<circle cx="320" cy="89" r="4.5" fill="currentColor"/><circle cx="310" cy="205" r="4.5" fill="currentColor"/>' +
        '<circle cx="12" cy="40" r="3.5" stroke="currentColor" stroke-width="1.5"/><circle cx="588" cy="55" r="3.5" stroke="currentColor" stroke-width="1.5"/>' +
      '</svg>' +
      '<div class="landing-hero-grid">' +
        '<div class="landing-hero-copy">' +
          '<div class="landing-logo-wrap"><img class="landing-logo" src="assets/club-logo.jpg" alt="شعار نادي الروبوتيك والذكاء الاصطناعي"></div>' +
          '<h1>تعلّم البرمجة والروبوتيك خطوة بخطوة — من أول دائرة كهربائية إلى روبوتات ذكية</h1>' +
          '<p class="landing-promise">أكاديمية عربية مجانية بتوجيه أستاذك، لتلاميذ الإعدادي وأولياء أمورهم. مسارنا الأول المتاح الآن: <strong>الأردوينو والروبوتيك</strong> — دروس فيديو قصيرة، توصيل موجّه خطوة بخطوة، واختبار في نهاية كل درس، حتى يبني التلميذ مشاريعه الحقيقية بنفسه.</p>' +
          '<div class="landing-ctas">' +
            '<a class="btn btn-primary btn-lg" href="#/register">أنشئ حسابك مجانًا</a>' +
            '<a class="btn btn-ghost btn-lg" href="#/login">تسجيل الدخول</a>' +
          '</div>' +
          '<p class="landing-browse-row"><button class="landing-browse" type="button" data-scroll="landing-levels"><span>تصفح المستويات</span>' + icon("arrow-down", "icon-sm") + '</button></p>' +
          '<p class="landing-free">' + icon("check-circle", "icon-sm") + '<span>الأكاديمية مجانية بالكامل — أنشئ حسابك وابدأ أول درس في دقائق.</span></p>' +
        '</div>' +
        '<div class="landing-hero-visual" aria-hidden="true">' +
          '<div class="landing-hero-frame"><img class="landing-hero-art" src="assets/hero.png" alt=""></div>' +
        '</div>' +
      '</div>' +
      '<div class="landing-stats">' +
        '<div class="landing-stat"><span class="landing-stat-icon">' + icon("book", "icon-md") + '</span><span class="landing-stat-num" data-stat="lessons">' + totalLessons + '</span><span class="landing-stat-label">درسًا</span></div>' +
        '<div class="landing-stat"><span class="landing-stat-icon">' + icon("layers", "icon-md") + '</span><span class="landing-stat-num" data-stat="levels">' + totalLevels + '</span><span class="landing-stat-label">مستويات متدرجة</span></div>' +
        '<div class="landing-stat"><span class="landing-stat-icon">' + icon("award", "icon-md") + '</span><span class="landing-stat-num">شهادة</span><span class="landing-stat-label">لكل مستوى</span></div>' +
        '<div class="landing-stat"><span class="landing-stat-icon">' + icon("shield", "icon-md") + '</span><span class="landing-stat-num">مجاني</span><span class="landing-stat-label">بالكامل</span></div>' +
      '</div>' +
    '</section>' +
    '<section class="landing-section card landing-about"><h2>' + icon("book", "icon-md") + '<span>عن الأكاديمية</span></h2>' +
      '<p>«أكاديمية الروبوتيك والذكاء الاصطناعي» منصة تعليمية موجّهة إلى <strong>تلاميذ المرحلة الإعدادية</strong> لتعلّم الإلكترونيات والبرمجة والروبوتيك بالعربية، درسًا بعد درس ومشروعًا بعد مشروع. بدأت بمسار <strong>الأردوينو والروبوتيك</strong> — أول مساراتها — وستنضم إليه لاحقًا مسارات أخرى في البرمجة مثل بايثون وبناء المواقع، تُعلن هنا فور جاهزيتها.</p>' +
      '<p>طريقتنا: <strong>دروس فيديو</strong> قصيرة وواضحة، <strong>توصيل موجّه</strong> للأسلاك والمكونات خطوة بخطوة، <strong>تجارب تفاعلية</strong> داخل المنصة تتدرب عليها قبل لمس المكونات الحقيقية، <strong>اختبار قصير</strong> في نهاية كل درس، و<strong>مشاريع تطبيقية</strong> تجمع ما تعلمته.</p>' +
      '<p>تعمل الأكاديمية <strong>على الإنترنت</strong> من أي متصفح، وتتوفر أيضًا في <strong>نسخة دون اتصال</strong> تعمل كاملة على حاسوب القسم — وتقدّمك محفوظ ومحمي بحسابك الخاص.</p>' +
      '<p class="about-parents-callout"><strong>لأولياء الأمور والمشرفين:</strong> الأكاديمية مجانية بالكامل وبلا إعلانات؛ يتقدّم كل تلميذ بوتيرته مع اختبارات موثّقة وشهادة عند إتمام كل مستوى، ويرافق أستاذ النادي التلاميذ ويتابع تقدّمهم.</p>' +
    '</section>' +
    '<section class="landing-section landing-why"><div class="section-head"><h2 class="page-title">لماذا أكاديميتنا؟</h2></div>' +
      '<div class="landing-features">' +
        feature("video", "دروس فيديو بالعربية المبسطة") +
        feature("flask", "تجارب تفاعلية داخل الدرس") +
        feature("check-circle", "اختبارات فورية بتصحيح تلقائي") +
        feature("cpu", "مشاريع عملية خطوة بخطوة") +
        feature("globe", "تعمل بالإنترنت وبدونها") +
      '</div>' +
    '</section>' +
    '<section class="landing-section landing-tracks" id="landing-tracks"><div class="section-head"><h2 class="page-title">مسارات الأكاديمية</h2>' +
      '<p class="landing-tracks-intro">الأكاديمية أوسع من مسار واحد: بدأت بالأردوينو والروبوتيك، وستضم تدريجيًا مسارات أخرى في البرمجة — يظهر كل مسار هنا فور جاهزيته.</p></div>' +
      '<div class="landing-track-grid">' + trackCards + '</div>' +
    '</section>' +
    '<section class="landing-section landing-levels" id="landing-levels"><div class="section-head"><h2 class="page-title">المستويات والدورات</h2>' +
      '<p class="landing-track-note">مسار <strong>الأردوينو والروبوتيك</strong> بالتفصيل: مستوياته المتدرجة من الصفر إلى المشاريع المتقدمة. اضغط أي بطاقة للتسجيل والبدء بها، وافتح «محتوى المستوى» لمعاينة دروسه قبل أن تبدأ.</p></div>' +
      '<div class="landing-level-grid">' + levelCards + '</div>' +
    '</section>' +
    '<section class="landing-section card landing-steps"><h2>' + icon("layers", "icon-md") + '<span>كيف يعمل؟</span></h2>' +
      '<ol class="steps-list">' +
        '<li><strong>أنشئ حسابك</strong> — بالاستمارة الاحترافية أو بحساب Google، في دقيقة واحدة.</li>' +
        '<li><strong>تعلّم درسًا بعد درس</strong> — شاهد الفيديو، نفّذ التوصيل الموجّه، وجرّب بنفسك.</li>' +
        '<li><strong>اجتز اختبار كل درس</strong> — الدرس يُحسب منجزًا عندما تنجح في اختباره (3 من 4 على الأقل).</li>' +
        '<li><strong>احصل على شهادة المستوى</strong> — أكمل دروس المستوى وتمرينه البرمجي لتصبح شهادتك جاهزة باسمك.</li>' +
      '</ol>' +
    '</section>' +
    '<section class="landing-section card landing-certs">' +
      '<div class="landing-cert-stage"><img class="landing-cert-img" src="assets/certificate.png" alt="نموذج من شهادة إتمام مستوى في الأكاديمية"></div>' +
      '<div class="landing-cert-text"><h2>' + icon("award", "icon-md") + '<span>شهادات إتمام المستويات</span></h2>' +
      '<p>حين يتمّ التلميذ جميع دروس مستوى ما، ويجتاز اختبار كل درس فيها (<strong>3 من 4</strong> على الأقل)، ويُنجز تمرين المستوى البرمجي، تصبح <strong>شهادة إتمام المستوى</strong> جاهزة للطباعة — وتُطبع <strong>باسم التلميذ الكامل كما سجّله</strong> في حسابه. شهادة لكل مستوى، من المستوى الأول حتى الخامس.</p></div>' +
    '</section>' +
    '<section class="landing-section landing-outro">' +
      '<p class="landing-outro-title">جاهز لبناء أول دائرة لك؟</p>' +
      '<div class="landing-ctas"><a class="btn btn-primary btn-lg" href="#/register">أنشئ حسابك مجانًا</a></div>' +
    '</section>', "مرحبًا بك"
  );
  /* عناصر «مرّر إلى المستويات»: زر «تصفح المستويات» وبطاقة مسار الأردوينو
     الحيّة — تمرير ناعم إلى فهرس المستويات دون لمس الموجّه. بطاقات
     «قريبًا» بلا data-scroll ولا أي معالج: ساكنة عمدًا، لا تؤدي إلى شيء */
  document.querySelectorAll("[data-scroll]").forEach(el => {
    const scrollToTarget = () => {
      const target = document.getElementById(el.getAttribute("data-scroll"));
      if (!target) return;
      try { target.scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch (e) { try { target.scrollIntoView(); } catch (e2) { /* بيئة بلا تمرير: تجاهل */ } }
    };
    el.addEventListener("click", scrollToTarget);
    if (el.tagName !== "BUTTON") el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      scrollToTarget();
    });
  });
  /* بطاقة المستوى كاملةً رابط تسجيل للزائر — ما عدا فتح «محتوى المستوى» نفسه */
  document.querySelectorAll(".landing-level-card").forEach(card => {
    const go = () => { location.hash = "#/register"; };
    card.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest("details, a, button")) return;
      go();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target && e.target.closest && e.target.closest("details, a, button")) return;
      e.preventDefault();
      go();
    });
  });
}

/* ---------- شاشة الدخول / إنشاء حساب ---------- */
/* ملف Google مؤقت أثناء إتمام تسجيل «مع Google»: يصل من وحدة الدخول
   الكسولة بعد موافقة التلميذ، فيُكمل التلميذ السنّ/المستوى/المؤسسة في
   الاستمارة نفسها. يعيش في ذاكرة الصفحة فقط، ويُلغى بترك شاشة التسجيل */
let googlePending = null;
function fieldErrSpan(id) { return '<span class="field-error" id="' + id + '" role="alert" hidden></span>'; }
function finishAuthLogin(key, showErr) {
  if (!storageSet(SESSION_KEY, key)) {
    showErr("تعذّر حفظ جلسة الدخول على هذا الحاسوب (التخزين محظور). فعّل حفظ بيانات المواقع في إعدادات المتصفح وحاول من جديد.");
    return;
  }
  location.hash = "#/";
  render();
}
/* بداية الدخول عبر Google: تُحمَّل sync-config.js ثم وحدة auth-google.js
   عند الضغط فقط (النمط الكسول نفسه كالمزامنة). دون إنترنت أو عند فشل
   التحميل تظهر رسالة صريحة، وتبقى الاستمارة العادية عاملة دائمًا —
   فلا زر ميت ولا انهيار في أي بيئة (ومنها فتح الملفات محليًا) */
async function startGoogleAuth(googleMode) {
  const msg = $("#auth-google-msg");
  const say = (t) => { if (msg) msg.textContent = t; };
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) {
    say("الدخول عبر Google يحتاج اتصالًا بالإنترنت — أنت غير متصل الآن. الاستمارة العادية في هذه الصفحة تعمل دون إنترنت كالمعتاد.");
    return;
  }
  say("جارٍ الاتصال بـ Google…");
  try {
    if (!window.ACADEMY_SYNC_CONFIG) await loadScriptOnce("sync-config.js");
    const cid = window.ACADEMY_SYNC_CONFIG && window.ACADEMY_SYNC_CONFIG.googleClientId;
    if (!cid) { say("الدخول عبر Google غير مفعّل بعد في هذه النسخة: لم يضع الأستاذ معرّف عميل Google في ملف sync-config.js. استعمل الاستمارة العادية."); return; }
    await loadScriptOnce("auth-google.js");
    if (!window.AcademyGoogle || typeof window.AcademyGoogle.signIn !== "function") {
      say("تعذّرت بداية وحدة الدخول عبر Google في هذا المتصفح. استعمل الاستمارة العادية.");
      return;
    }
    window.AcademyGoogle.signIn(googleMode, {
      onProfile: (profile) => handleGoogleProfile(googleMode, profile),
      onError: (m) => say(m)
    });
  } catch (e) {
    say("تعذّر تحميل وحدة الدخول عبر Google — تحقق من اتصالك بالإنترنت ثم حاول من جديد. الاستمارة العادية تعمل دائمًا.");
  }
}
function handleGoogleProfile(googleMode, profile) {
  const msg = $("#auth-google-msg");
  const say = (t) => { if (msg) msg.textContent = t; };
  if (googleMode === "register") {
    const pErr = googleProfileError(profile);
    if (pErr) { say(pErr); return; }
    const st = googleLoginState(loadDB(), profile.email);
    if (st.status === "ok") { say("هذا الحساب موجود أصلًا عبر Google على هذا الحاسوب — اذهب إلى صفحة الدخول واضغط «تسجيل الدخول مع Google»."); return; }
    if (st.status === "password") { say("هذا البريد مسجّل بحساب وكلمة سر — سجّل الدخول بكلمة السر بدلًا من إنشاء حساب جديد."); return; }
    googlePending = { name: String(profile.name).trim(), email: normalizeEmail(profile.email) };
    renderAuth("register");
    return;
  }
  const st = googleLoginState(loadDB(), profile && profile.email);
  if (st.status === "ok") {
    if (!storageSet(SESSION_KEY, st.key)) { say("تعذّر حفظ جلسة الدخول على هذا الحاسوب (التخزين محظور)."); return; }
    location.hash = "#/";
    render();
    return;
  }
  if (st.status === "password") { say("هذا البريد مسجّل بحساب وكلمة سر — سجّل الدخول بكلمة السر في الاستمارة أسفله، لا بزر Google."); return; }
  say("لا يوجد حساب بهذا البريد على هذا الحاسوب — أنشئ حسابًا جديدًا أولًا (يمكنك إنشاؤه بزر «المتابعة مع Google» في صفحة التسجيل).");
}
function renderAuth(mode) {
  const isReg = mode === "register";
  if (!isReg) googlePending = null; /* ملف Google المؤقت يخصّ التسجيل وحده */
  const gp = isReg ? googlePending : null;
  const levelOptions = '<option value="">اختر المستوى</option>' +
    SCHOOL_LEVELS.map(lv => '<option value="' + esc(lv) + '">' + esc(lv) + '</option>').join("");
  const googleBlock =
    '<div class="google-box">' +
      '<button class="btn btn-google" id="auth-google-btn" type="button"><span class="g-mark" aria-hidden="true">G</span>' +
        (isReg ? "المتابعة مع Google" : "تسجيل الدخول مع Google") + '</button>' +
      '<p class="muted small" id="auth-google-msg" role="status" aria-live="polite"></p>' +
    '</div>' +
    '<div class="auth-divider" aria-hidden="true"><span>' + (isReg ? "أو بالاستمارة" : "أو بالبريد الإلكتروني وكلمة السر") + '</span></div>';
  shell(
    '<section class="auth-card">' +
      '<h1>' + (isReg ? "إنشاء حساب تلميذ جديد" : "مرحبًا بعودتك") + '</h1>' +
      '<p class="muted">' + (isReg
        ? "أنشئ حسابك بالاستمارة الاحترافية أسفله، أو تابع مع Google وسيُملأ اسمك وبريدك تلقائيًا. الاسم الكامل الذي تكتبه هنا هو الذي سيظهر على شهادات إتمام المستويات."
        : "سجّل الدخول ببريدك الإلكتروني وكلمة السر، أو بزر «تسجيل الدخول مع Google» إن كنت أنشأت حسابك عبره.") + '</p>' +
      '<p class="muted small">الحساب محلي: يُحفظ على هذا الحاسوب فقط، ولكل تلميذ تقدّمه الخاص. حدوده بصراحة: كلمة السر تمنع زميلًا فضوليًا من فتح حسابك داخل القسم، لكنها ليست حماية بمستوى المواقع والخوادم — فكل شيء يعيش في متصفح هذا الحاسوب، ومسح بيانات المتصفح يمسح الحسابات والتقدم معها.</p>' +
      (dbDamaged ? '<p class="form-error" role="alert">تنبيه: بيانات الحسابات المحفوظة على هذا الحاسوب تالفة ولا يمكن قراءتها، وقد احتفظنا بنسخة احتياطية منها تلقائيًا بدل مسحها. أنشئ حسابًا جديدًا للمتابعة، وأخبر الأستاذ.</p>' : "") +
      (gp ? "" : googleBlock) +
      (gp ? '<div class="google-note" role="status"><strong>التسجيل عبر Google:</strong> الاسم والبريد جاهزان من حسابك في Google. أكمل السنّ والمستوى الدراسي واسم المؤسسة فقط — حساب Google لا كلمة سر محلية له، ودخولك لاحقًا يكون بزر «تسجيل الدخول مع Google».' +
            '<br><button class="btn btn-ghost btn-small" id="auth-google-cancel" type="button">إلغاء واستعمال الاستمارة العادية</button></div>' : "") +
      '<form id="auth-form" autocomplete="off" novalidate>' +
        (isReg ? '<label>الاسم الكامل<input id="auth-name" type="text" required maxlength="60" autocomplete="name" placeholder="مثال: يوسف بن علي العلوي"' + (gp ? ' value="' + esc(gp.name) + '"' : "") + '><span class="field-hint">اكتبه كما تريده أن يظهر في الشهادة — 3 أحرف على الأقل، وسيظهر على شهاداتك كما تكتبه هنا.</span>' + fieldErrSpan("err-name") + '</label>' : "") +
        '<label>البريد الإلكتروني<input id="auth-email" type="email" required maxlength="80" autocomplete="email" placeholder="name@example.com" dir="ltr"' + (gp ? ' value="' + esc(gp.email) + '" readonly' : "") + '>' + fieldErrSpan("err-email") + '</label>' +
        (gp ? "" :
          '<label>كلمة السر<input id="auth-pass" type="password" required ' + (isReg ? 'minlength="8" autocomplete="new-password"' : 'autocomplete="current-password"') + ' placeholder="' + (isReg ? "8 أحرف على الأقل، بحرف ورقم" : "كلمة سر حسابك") + '" dir="ltr">' +
          (isReg ? '<span class="field-hint">القاعدة: 8 أحرف على الأقل، وفيها حرف واحد على الأقل ورقم واحد على الأقل.</span>' +
                   '<span class="pw-meter" aria-hidden="true"><span class="pw-meter-bar" id="pw-bar"></span></span>' +
                   '<span class="pw-label" id="pw-label" role="status"></span>' : "") +
          fieldErrSpan("err-pass") + '</label>') +
        (isReg && !gp ? '<label>تأكيد كلمة السر<input id="auth-pass2" type="password" required minlength="8" autocomplete="new-password" dir="ltr">' + fieldErrSpan("err-pass2") + '</label>' : "") +
        (isReg ? '<label>السنّ<input id="auth-age" type="number" required min="8" max="25" step="1" inputmode="numeric" placeholder="مثال: 12" dir="ltr"><span class="field-hint">بين 8 و25 سنة.</span>' + fieldErrSpan("err-age") + '</label>' +
                 '<label>المستوى الدراسي<select id="auth-level" required>' + levelOptions + '</select>' + fieldErrSpan("err-level") + '</label>' +
                 '<label>اسم المؤسسة<input id="auth-school" type="text" required maxlength="80" placeholder="مثال: إعدادية الأمل">' + fieldErrSpan("err-school") + '</label>' : "") +
        '<p class="form-error" id="auth-error" role="alert" hidden></p>' +
        '<button class="btn btn-primary btn-wide" type="submit">' + (isReg ? (gp ? "إتمام إنشاء الحساب مع Google والدخول" : "إنشاء الحساب والدخول") : "تسجيل الدخول") + '</button>' +
      '</form>' +
      '<p class="auth-switch">' + (isReg
        ? 'عندك حساب من قبل؟ <a href="#/login">سجّل الدخول</a>'
        : 'أول مرة هنا؟ <a href="#/register">أنشئ حسابك</a><br><a href="#/recover">نسيت كلمة السر؟ الاستعادة بمساعدة الأستاذ</a>') + '</p>' +
      '<p class="auth-switch"><a class="inline-icon-link" href="#/teacher">' + icon("board", "icon-sm") + '<span>لوحة الأستاذ — تجميع نتائج القسم من النسخ الاحتياطية</span></a></p>' +
    '</section>', isReg ? "إنشاء حساب جديد" : "تسجيل الدخول"
  );
  /* أخطاء الحقول: تُعرض تحت كل حقل بعينه، والقيم تبقى كما كتبها التلميذ */
  const ERR_SPANS = { name: "err-name", email: "err-email", password: "err-pass", password2: "err-pass2", age: "err-age", level: "err-level", school: "err-school" };
  const ERR_INPUTS = { name: "auth-name", email: "auth-email", password: "auth-pass", password2: "auth-pass2", age: "auth-age", level: "auth-level", school: "auth-school" };
  const showFieldErrors = (errors) => {
    for (const k of Object.keys(ERR_SPANS)) {
      const span = document.getElementById(ERR_SPANS[k]);
      if (!span) continue;
      if (errors && errors[k]) { span.textContent = errors[k]; span.hidden = false; }
      else span.hidden = true;
    }
  };
  for (const k of Object.keys(ERR_SPANS)) {
    const inp = document.getElementById(ERR_INPUTS[k]);
    const span = document.getElementById(ERR_SPANS[k]);
    if (inp && span) inp.addEventListener("input", () => { span.hidden = true; });
  }
  /* مؤشر قوة كلمة السر الحي أثناء الكتابة (إرشادي؛ القاعدة فوق الحقل) */
  const passInput = $("#auth-pass");
  if (passInput && isReg && !gp) {
    const bar = $("#pw-bar"), lab = $("#pw-label");
    const upd = () => {
      const s = passwordStrength(passInput.value);
      if (bar) { bar.style.width = (passInput.value ? (s + 1) * 25 : 0) + "%"; bar.className = "pw-meter-bar s" + s; }
      if (lab) lab.textContent = passInput.value ? "قوة كلمة السر: " + ["ضعيفة", "مقبولة", "جيدة", "قوية"][s] : "";
    };
    passInput.addEventListener("input", upd);
    upd();
  }
  const gBtn = $("#auth-google-btn");
  if (gBtn) gBtn.addEventListener("click", () => { startGoogleAuth(isReg ? "register" : "login"); });
  const gCancel = $("#auth-google-cancel");
  if (gCancel) gCancel.addEventListener("click", () => { googlePending = null; renderAuth("register"); });

  let authBusy = false; /* حارس ضد الإرسال المكرر أثناء التشفير غير المتزامن */
  $("#auth-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (authBusy) return;
    const submitBtn = ev.target.querySelector('button[type="submit"]');
    const err = $("#auth-error");
    const showErr = (m) => { err.textContent = m; err.hidden = false; };
    const setBusy = (b) => { authBusy = b; if (submitBtn) submitBtn.disabled = b; };
    err.hidden = true;
    showFieldErrors(null);
    try {
      if (isReg && gp) {
        /* إتمام تسجيل Google: لا كلمة سر — الاسم قد يكون عدّله التلميذ
           في الحقل، والبريد مقفل كما جاء من Google */
        const res = registerGoogleAccount(loadDB(),
          { name: $("#auth-name").value, email: gp.email },
          { age: $("#auth-age").value, level: $("#auth-level").value, school: $("#auth-school").value });
        if (!res.ok) {
          if (res.errors) { showFieldErrors(res.errors); return; }
          return showErr(res.error || "تعذّر إنشاء الحساب.");
        }
        googlePending = null;
        return finishAuthLogin(res.key, showErr);
      }
      if (isReg) {
        setBusy(true);
        const res = await createPasswordAccount({
          name: $("#auth-name").value, email: $("#auth-email").value,
          password: $("#auth-pass").value, password2: $("#auth-pass2").value,
          age: $("#auth-age").value, level: $("#auth-level").value, school: $("#auth-school").value
        });
        setBusy(false);
        if (!res.ok) {
          if (res.errors) { showFieldErrors(res.errors); return; }
          return showErr(res.error || "تعذّر إنشاء الحساب.");
        }
        return finishAuthLogin(res.key, showErr);
      }
      /* الدخول بالبريد وكلمة السر */
      const email = $("#auth-email").value;
      const password = $("#auth-pass").value;
      const errs = {};
      const eErr = emailFieldError(email); if (eErr) errs.email = eErr;
      if (!password) errs.password = "اكتب كلمة السر.";
      if (Object.keys(errs).length) { showFieldErrors(errs); return; }
      setBusy(true);
      const res = await loginWithPassword(email, password);
      setBusy(false);
      if (!res.ok) return showErr(res.error);
      return finishAuthLogin(res.key, showErr);
    } catch (e) {
      setBusy(false);
      return showErr("حدث خطأ غير متوقع. حاول من جديد.");
    }
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
          '<div class="backup-actions"><button class="btn btn-ghost" id="btn-make-key" type="button">' + icon("key", "icon-sm") + '<span>إنشاء ملف مفتاح الأستاذ</span></button></div>' +
          '<p class="muted small" id="key-msg" role="status" aria-live="polite"></p>' +
          '<p class="muted small">حدود هذه الطريقة بصراحة: لا يوجد خادم في منصة تعمل على حاسوب القسم نفسه؛ المفتاح رادع محلي وفحص حيازة — من يملك وصولًا كاملًا إلى ملفات الحاسوب ومتصفحه يستطيع تجاوز أي حماية محلية. احتفظ بملف المفتاح في USB الأستاذ فقط، ولا تتركه في مجلد المنصة.</p>') +
      '<form id="recover-form" autocomplete="off">' +
        '<label>البريد الإلكتروني للحساب المنسي<input id="rec-user" type="text" required maxlength="80" placeholder="بريد التلميذ الإلكتروني" dir="ltr"><span class="field-hint">للحسابات القديمة جدًا (قبل عهد البريد): اكتب اسم المستخدم كما هو محفوظ.</span></label>' +
        (keyOn ? '<label>ملف مفتاح الأستاذ (.academykey)<input id="rec-key" type="file" accept=".academykey,application/json,.json" required></label>' : '') +
        '<label>كلمة السر الجديدة<input id="rec-pass" type="password" required minlength="8" placeholder="8 أحرف على الأقل، بحرف ورقم" dir="ltr"><span class="field-hint">القاعدة نفسها: 8 أحرف على الأقل، وفيها حرف ورقم على الأقل.</span></label>' +
        '<label>تأكيد كلمة السر الجديدة<input id="rec-pass2" type="password" required minlength="8" dir="ltr"></label>' +
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
    const identifier = $("#rec-user").value.trim();
    const password = $("#rec-pass").value;
    if (!identifier) return showErr("اكتب البريد الإلكتروني للحساب المنسي.");
    const newPwErr = passwordFieldError(password);
    if (newPwErr) return showErr(newPwErr);
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
      /* حلّ المعرّف إلى مفتاح الحساب: بالبريد للحسابات الحالية، وبالمفتاح
         المحفوظ نفسه للحسابات القديمة التي لا بريد لها */
      const dbNow = loadDB();
      const key = resolveAccountKey(dbNow, identifier);
      if (!key) return showErr("لا يوجد حساب بهذا البريد على هذا الحاسوب. تأكد من البريد الإلكتروني (أو من اسم المستخدم للحسابات القديمة).");
      if (accountProvider(dbNow.users[key]) === "google")
        return showErr("هذا الحساب مسجّل عبر Google ولا كلمة سر محلية له — دخوله يكون بزر «تسجيل الدخول مع Google» في صفحة الدخول، فلا حاجة إلى إعادة تعيين.");
      const done = await resetAccountPassword(key, password);
      if (!done) return showErr("تعذّر حفظ كلمة السر الجديدة على هذا الحاسوب (التخزين ممتلئ أو محظور). أخبر الأستاذ وحاول من جديد.");
      err.hidden = true;
      ok.hidden = false;
      ok.textContent = "تمت إعادة تعيين كلمة سر حساب «" + (dbNow.users[key].name || key) + "» بنجاح، وبقي تقدّمه محفوظًا. سجّل الدخول الآن بالبريد وكلمة السر الجديدة.";
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
            ? '<div class="level-done-badge">' + icon("award", "icon-sm") + '<span>أكملت هذا المستوى — شهادتك جاهزة في صفحة المستوى</span></div>'
            : '<div class="level-done-badge">' + icon("award", "icon-sm") + '<span>أكملت دروس هذا المستوى — بقي التمرين البرمجي الأخير في صفحة المستوى لتفتح شهادتك</span></div>')
        : '') + '</a>';
  }).join("");
  const lastLesson = rec.lastLessonId ? lessonById(rec.lastLessonId) : null;
  shell(
    '<section class="hero"><img class="hero-img" src="assets/hero.png" alt="أكاديمية الروبوتيك والذكاء الاصطناعي — تعلّم، وصّل، برمج، ابنِ"></section>' +
    '<section class="dash-strip">' +
      '<div class="dash-item"><span class="dash-value">' + allDone + ' / ' + TOTAL_LESSONS + '</span><span class="dash-label">درس منجز</span></div>' +
      '<div class="dash-item"><span class="dash-value">' + overallPct + '%</span><span class="dash-label">التقدم العام</span></div>' +
      '<div class="dash-item"><span class="dash-value">' + (quizPossible ? quizEarned + ' / ' + quizPossible : "—") + '</span><span class="dash-label">أفضل نتائج الاختبارات</span></div>' +
      '<div class="dash-item grow"><div class="progress"><div class="progress-fill" style="width:' + overallPct + '%"></div></div><span class="dash-label">واصل يا بطل — درسًا بعد درس تصنع روبوتك الأول</span></div>' +
    '</section>' +
    (lastLesson
      ? '<section class="card resume-card"><h2>' + icon("bookmark", "icon-md") + '<span>تابع من حيث توقفت</span></h2>' +
        '<p>آخر درس فتحته: <strong>' + esc(lastLesson.title) + '</strong> (المستوى ' + lastLesson.level + ' — الدرس ' + lastLesson.num + ').</p>' +
        '<a class="btn btn-primary" href="#/lesson/' + lastLesson.id + '">متابعة الدرس</a></section>'
      : '') +
    '<section class="card backup-card"><h2>' + icon("save", "icon-md") + '<span>النسخة الاحتياطية — احفظ تقدّمك وانقله بأمان</span></h2>' +
      '<p class="muted">الحسابات والتقدّم يعيشان في متصفح هذا الحاسوب فقط، ونسخ مجلد المنصة إلى حاسوب آخر <strong>لا ينقلهما</strong>. للاحتفاظ بنسخة أو نقل التقدّم إلى حاسوب آخر: صدّر ملف النسخة الاحتياطية من هنا، ثم استورده من نفس البطاقة على الحاسوب الآخر. عند الاستيراد لن يُحذف أي حساب موجود غير مذكور في النسخة، وأي اسم متعارض يبقى كما هو إلا إذا اخترت استبداله بنفسك.</p>' +
      (notice ? '<p class="quiz-result ok" role="status">' + esc(notice) + '</p>' : '') +
      '<div class="backup-actions">' +
        '<button class="btn btn-primary" id="btn-export" type="button">تصدير نسخة احتياطية (JSON)</button>' +
        '<label class="btn btn-ghost">استيراد نسخة احتياطية<input id="import-file" type="file" accept="application/json,.json" hidden></label>' +
      '</div>' +
      '<p class="muted small" id="import-msg" role="status" aria-live="polite"></p>' +
      '<div class="backup-actions">' +
        '<button class="btn btn-ghost" id="btn-sync" type="button">' + icon("cloud", "icon-sm") + '<span>مزامنة سحابية (اختيارية — تحتاج إنترنت)</span></button>' +
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
    return '<section class="card cert-card"><h2>' + icon("award", "icon-md") + '<span>شهادة إتمام المستوى</span></h2>' +
      '<p>أكملت جميع دروس هذا المستوى واجتزت تمرينه البرمجي — أحسنت! احصل على شهادتك واطبعها وعلّقها بفخر.</p>' +
      '<a class="btn btn-primary" href="#/certificate/' + n + '">شهادة إتمام المستوى</a></section>';
  }
  const pg = PLAYGROUNDS[n];
  if (!pg) return "";
  return '<section class="card playground-card"><h2>' + icon("code", "icon-md") + '<span>ملعب الكود — تمرين أخير قبل الشهادة</span></h2>' +
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
      ? '<span class="lesson-quiz">' + icon("award", "icon-sm") + '<span>أفضل نتيجة: ' + p.quizBest + '/' + p.quizTotal + '</span></span>' : "";
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
        '<p class="cert-academy">أكاديمية الروبوتيك والذكاء الاصطناعي — نادي الروبوتيك والذكاء الاصطناعي</p>' +
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
      '<button class="btn btn-primary" id="btn-print-cert" type="button">' + icon("printer", "icon-sm") + '<span>طباعة الشهادة</span></button>' +
      '<a class="btn btn-ghost" href="#/level/' + lv.n + '">عودة إلى المستوى</a></div>', "شهادة إتمام المستوى " + lv.n
  );
  $("#btn-print-cert").addEventListener("click", () => window.print());
}

/* ---------- لوحة الأستاذ #/teacher — الجولة الثالثة ----------
   تجميع عرضي بحت: ملفات النسخ تُقرأ إلى ذاكرة الصفحة (teacherData) وتُبنى
   منها صفوف الجدول؛ لا كتابة إطلاقًا في قاعدة بيانات هذا الحاسوب، فلا
   يتأثر حساب أي تلميذ محلي باستيراد اللوحة. تُنسى البيانات بإعادة التحميل */
let teacherData = { users: {}, messages: [] };
/* حالة عرض اللوحة (بحث/مرشّحات/فرز) — تعيش في ذاكرة الصفحة فقط */
let teacherView = { q: "", level: "", school: "", sort: "progress-desc" };
/* مصدر اللوحة الموحّد (المرحلة الثانية): حسابات قاعدة بيانات هذا
   الحاسوب نفسه + ما استورده الأستاذ من نسخ التلاميذ في هذه الجلسة.
   عند تعارض مفتاح، تتقدّم نسخة التلميذ المستوردة لأنها لقطة أحدث من
   جهازه. العرض للقراءة فقط — اللوحة لا تكتب في قاعدة البيانات أبدًا */
function teacherAllUsers() {
  const merged = {};
  const local = loadDB().users || {};
  for (const k of Object.keys(local)) merged[k] = local[k];
  for (const k of Object.keys(teacherData.users)) merged[k] = teacherData.users[k];
  return merged;
}
function fmtStamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.getFullYear() + "/" + pad2(d.getMonth() + 1) + "/" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function teacherFilteredRows(rows) {
  const q = teacherView.q.trim().toLowerCase();
  let out = rows.filter(r => {
    if (q && (r.name || "").toLowerCase().indexOf(q) < 0 && (r.email || "").toLowerCase().indexOf(q) < 0) return false;
    if (teacherView.level && r.schoolLevel !== teacherView.level) return false;
    if (teacherView.school && r.school !== teacherView.school) return false;
    return true;
  });
  if (teacherView.sort === "progress-asc") out.sort((a, b) => a.overallPct - b.overallPct);
  else if (teacherView.sort === "name") out.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
  else out.sort((a, b) => b.overallPct - a.overallPct);
  return out;
}
function renderTeacher() {
  const allRows = buildTeacherRows(teacherAllUsers());
  const keyOn = teacherKeyConfigured(loadDB());
  const meanPct = allRows.length ? Math.round(allRows.reduce((s, r) => s + r.overallPct, 0) / allRows.length) : 0;
  const totalCerts = allRows.reduce((s, r) => s + r.certificates, 0);
  const schools = Array.from(new Set(allRows.map(r => r.school).filter(Boolean))).sort();
  shell(
    '<p class="crumbs"><a href="#/">الرئيسية</a> ← لوحة الأستاذ</p>' +
    '<h1 class="page-title">' + icon("board", "icon-lg") + '<span>مركز الأستاذ — لوحة التتبع</span></h1>' +
    '<section class="dash-strip teacher-stats">' +
      '<div class="dash-item"><span class="dash-value" id="teacher-stat-students">' + allRows.length + '</span><span class="dash-label">تلميذ مسجّل</span></div>' +
      '<div class="dash-item"><span class="dash-value" id="teacher-stat-mean">' + meanPct + '%</span><span class="dash-label">متوسط التقدّم العام</span></div>' +
      '<div class="dash-item"><span class="dash-value" id="teacher-stat-certs">' + totalCerts + '</span><span class="dash-label">شهادة مستوى محقّقة</span></div>' +
      '<div class="dash-item grow"><span class="dash-label">المصدر: حسابات هذا الحاسوب + النسخ الاحتياطية المستوردة في هذه الجلسة. اضغط «عرض قاعدة بيانات التلميذ» أمام أي تلميذ لرؤية سجلّه الكامل درسًا بدرس.</span></div>' +
    '</section>' +
    '<section class="card"><h2>' + icon("upload", "icon-md") + '<span>استيراد نسخ التلاميذ الاحتياطية</span></h2>' +
      '<p class="muted">اسحب ملفات النسخ الاحتياطية (JSON) التي صدّرها تلاميذك من منصاتهم وأفلتها في منطقة الإفلات، أو اخترها بالزر — يقبل عدة ملفات دفعة واحدة. كل ملف يُفحص بمدقّق النسخ نفسه، والملف غير الصالح يُرفض برسالة خاصّة به دون أن يوقف البقية.</p>' +
      '<p class="muted"><strong>تنبيه مهم:</strong> الاستيراد هنا للعرض والتتبّع فقط — لا يغيّر حسابات هذا الحاسوب ولا تقدّم أي تلميذ فيه إطلاقًا. الدمج الفعلي في حسابات هذا الحاسوب يكون من بطاقة النسخة الاحتياطية في الصفحة الرئيسية وباختيارك الصريح هناك.</p>' +
      '<p class="muted small">«النقاط» هي مجموع أفضل نتائج الاختبارات (quizBest) كما هي مخزّنة فعلًا في سجلات التلاميذ. الدرس يُحسب منجزًا باجتياز اختباره فقط (قاعدة المنصة)، والشهادة تُحتسب عند إتمام دروس المستوى وتمرين ملعب الكود معًا.</p>' +
      '<div class="drop-zone" id="teacher-drop">' +
        '<p class="drop-zone-text">' + icon("upload", "icon-lg") + '<span>أفلت ملفات النسخ الاحتياطية هنا</span></p>' +
        '<label class="btn btn-primary">اختيار ملفات النسخ الاحتياطية<input id="teacher-files" type="file" accept="application/json,.json" multiple hidden></label>' +
      '</div>' +
      '<div id="teacher-msgs">' + teacherData.messages.map(m =>
        '<p class="quiz-result ' + (m.ok ? "ok" : "warn") + '" role="status">' + esc(m.text) + '</p>').join("") + '</div>' +
    '</section>' +
    '<section class="card"><h2>تلاميذ المنصة — بحث وترتيب</h2>' +
      '<div class="teacher-controls">' +
        '<label>بحث بالاسم أو البريد<input id="teacher-search" type="search" placeholder="مثال: يوسف أو @example" value="' + esc(teacherView.q) + '"></label>' +
        '<label>المستوى الدراسي<select id="teacher-filter-level">' +
          '<option value="">كل المستويات</option>' +
          SCHOOL_LEVELS.map(lv => '<option value="' + esc(lv) + '"' + (teacherView.level === lv ? " selected" : "") + '>' + esc(lv) + '</option>').join("") +
        '</select></label>' +
        '<label>المؤسسة<select id="teacher-filter-school">' +
          '<option value="">كل المؤسسات</option>' +
          schools.map(s => '<option value="' + esc(s) + '"' + (teacherView.school === s ? " selected" : "") + '>' + esc(s) + '</option>').join("") +
        '</select></label>' +
        '<label>الترتيب<select id="teacher-sort">' +
          '<option value="progress-desc"' + (teacherView.sort === "progress-desc" ? " selected" : "") + '>التقدّم: من الأعلى</option>' +
          '<option value="progress-asc"' + (teacherView.sort === "progress-asc" ? " selected" : "") + '>التقدّم: من الأدنى</option>' +
          '<option value="name"' + (teacherView.sort === "name" ? " selected" : "") + '>الاسم</option>' +
        '</select></label>' +
      '</div>' +
      '<div id="teacher-table-zone"></div>' +
      '<div class="backup-actions"><button class="btn btn-primary" id="btn-teacher-csv" type="button">تصدير جدول القسم كاملًا CSV (يفتحه Excel)</button></div>' +
    '</section>' +
    '<section class="card"><h2>' + icon("key", "icon-md") + '<span>مفتاح الأستاذ لاستعادة الحسابات</span></h2>' +
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
  renderTeacherTable();
  const searchInp = $("#teacher-search");
  if (searchInp) searchInp.addEventListener("input", () => { teacherView.q = searchInp.value; renderTeacherTable(); });
  const lvlSel = $("#teacher-filter-level");
  if (lvlSel) lvlSel.addEventListener("change", () => { teacherView.level = lvlSel.value; renderTeacherTable(); });
  const schSel = $("#teacher-filter-school");
  if (schSel) schSel.addEventListener("change", () => { teacherView.school = schSel.value; renderTeacherTable(); });
  const sortSel = $("#teacher-sort");
  if (sortSel) sortSel.addEventListener("change", () => { teacherView.sort = sortSel.value; renderTeacherTable(); });
  const csvBtn = $("#btn-teacher-csv");
  if (csvBtn) csvBtn.addEventListener("click", () => {
    downloadFile("class-results.csv", teacherRowsToCSV(buildTeacherRows(teacherAllUsers())), "text/csv;charset=utf-8");
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

/* جدول اللوحة وحده يُعاد رسمه عند كل بحث/ترشيح/فرز — بقية الصفحة ثابتة */
function renderTeacherTable() {
  if (typeof document.getElementById !== "function") return;
  const zone = document.getElementById("teacher-table-zone");
  if (!zone) return;
  const all = buildTeacherRows(teacherAllUsers());
  const rows = teacherFilteredRows(all);
  if (!all.length) {
    zone.innerHTML = '<p class="muted">لا تلاميذ بعد — لا حسابات على هذا الحاسوب ولا نسخ مستوردة. استورد أول نسخة احتياطية لتلميذ أو دعه ينشئ حسابه على هذا الحاسوب.</p>';
    return;
  }
  if (!rows.length) {
    zone.innerHTML = '<p class="muted">لا نتائج مطابقة لبحثك ومرشّحاتك الحالية — جرّب كلمة أخرى أو أعد ضبط المرشّحات.</p>';
    return;
  }
  zone.innerHTML =
    '<p class="muted small">يظهر ' + rows.length + ' من أصل ' + all.length + ' تلميذًا حسب البحث والمرشّحات.</p>' +
    '<div class="table-wrap"><table class="class-table"><thead><tr>' +
    '<th>التلميذ</th><th>الحساب</th><th>التقدّم</th><th>حسب المستويات</th><th>الشهادات</th><th>آخر نشاط</th><th></th>' +
    '</tr></thead><tbody>' +
    rows.map(r => '<tr>' +
      '<td><strong>' + esc(r.name) + '</strong>' +
        (r.email ? '<br><span class="muted small" dir="ltr">' + esc(r.email) + '</span>'
                 : '<br><span class="muted small" dir="ltr">' + esc(r.username) + '</span>') +
        ((r.age !== null && r.age !== undefined) || r.schoolLevel || r.school
          ? '<br><span class="muted small">' +
            [(r.age !== null && r.age !== undefined) ? "السن: " + r.age : "", r.schoolLevel || "", r.school || ""]
              .filter(Boolean).map(esc).join(" · ") + '</span>' : '') +
      '</td>' +
      '<td><span class="provider-badge">' + (r.provider === "google" ? "Google" : "استمارة") + '</span><br>' +
        '<span class="muted small">' + (r.allComplete ? icon("award", "icon-sm") + " أكمل كل المستويات" : "المستوى الحالي " + r.currentLevel) + '</span></td>' +
      '<td><strong>' + r.doneCount + ' / ' + r.totalLessons + '</strong> درسًا<br>' +
        '<span class="muted small">التقدّم العام ' + r.overallPct + '% · النقاط ' + r.earned + (r.possible ? ' / ' + r.possible : '') + '</span></td>' +
      '<td class="small">' + r.perLevel.map(p => 'م' + p.n + ': ' + p.done + '/' + p.total).join(' · ') + '</td>' +
      '<td>' + (r.certificates ? '<span class="inline-icon-badge">' + icon("award", "icon-sm") + '<span>× ' + r.certificates + '</span></span>' : '—') + '</td>' +
      '<td class="small"><span dir="ltr">' + fmtStamp(r.updatedAt) + '</span></td>' +
      '<td><a class="btn btn-ghost btn-small" href="#/teacher/student/' + encodeURIComponent(r.username) + '">عرض قاعدة بيانات التلميذ</a></td>' +
    '</tr>').join("") +
    '</tbody></table></div>';
}
/* صفحة تلميذ بعينه: «قاعدة البيانات الخاصة بكل تلميذ» مقروءة كاملة —
   بياناته وتقدّمه درسًا بدرس مع أفضل نتيجة لكل اختبار وحالة الملعب
   والشهادة لكل مستوى. قراءة فقط، من المصدر الموحّد نفسه */
function renderTeacherStudent(key) {
  const users = teacherAllUsers();
  const rec = Object.prototype.hasOwnProperty.call(users, key) ? users[key] : null;
  if (!rec) {
    shell('<p class="crumbs"><a href="#/teacher">→ عودة إلى لوحة الأستاذ</a></p>' +
      '<section class="card"><h1 class="page-title">تلميذ غير موجود</h1>' +
      '<p class="muted">لا يوجد سجل بهذا المعرّف في حسابات هذا الحاسوب ولا في النسخ المستوردة في هذه الجلسة.</p></section>', "لوحة الأستاذ");
    return;
  }
  const rows = buildTeacherRows(users);
  const row = rows.find(r => r.username === key) || {};
  const levelsHtml = DATA.levels.map(lv => {
    const lessons = DATA.lessons.filter(l => l.level === lv.n);
    const st = levelStats(rec, lv.n);
    const pg = !!(rec.playgroundPassed && rec.playgroundPassed[lv.n]);
    const cert = certificateUnlocked(rec, lv.n);
    const doneDate = rec.levelDates && rec.levelDates[lv.n] ? fmtStamp(rec.levelDates[lv.n]) : null;
    return '<section class="card student-level"><h2>المستوى ' + lv.n + ': ' + esc(lv.title) + '</h2>' +
      '<p class="muted">دروس منجزة: <strong>' + st.done + ' / ' + st.total + '</strong> · ' +
      'تمرين ملعب الكود: <strong>' + (pg ? "تم بنجاح ✓" : "لم يُنجز بعد") + '</strong> · ' +
      'الشهادة: <strong>' + (cert ? icon("award", "icon-sm") + " محقّقة" : "مقفلة") + '</strong>' +
      (doneDate ? ' · تاريخ إتمام الدروس: <span dir="ltr">' + doneDate + '</span>' : '') + '</p>' +
      '<div class="table-wrap"><table class="class-table"><thead><tr><th>الدرس</th><th>الحالة</th><th>أفضل نتيجة في الاختبار</th></tr></thead><tbody>' +
      lessons.map(l => {
        const p = rec.progress && rec.progress[l.id];
        const passed = isPassed(p, l);
        const best = p && typeof p.quizBest === "number" && p.quizTotal ? p.quizBest + ' / ' + p.quizTotal : '—';
        return '<tr class="lesson-status-row"><td>' + l.num + '. ' + esc(l.title) + '</td>' +
          '<td>' + (passed ? '<span class="status-ok">' + icon("check-circle", "icon-sm") + '<span>منجز (اجتاز الاختبار)</span></span>' : "لم يُنجز بعد") + '</td>' +
          '<td>' + best + '</td></tr>';
      }).join("") +
      '</tbody></table></div></section>';
  }).join("");
  shell(
    '<p class="crumbs"><a href="#/teacher">→ عودة إلى لوحة الأستاذ</a></p>' +
    '<h1 class="page-title">' + icon("folder", "icon-lg") + '<span>قاعدة بيانات التلميذ: ' + esc(rec.name || key) + '</span></h1>' +
    '<section class="card student-info"><h2>بيانات الحساب</h2>' +
      '<div class="table-wrap"><table class="class-table"><tbody>' +
      '<tr><th>الاسم الكامل</th><td>' + esc(rec.name || key) + '</td></tr>' +
      '<tr><th>البريد الإلكتروني</th><td>' + (rec.email ? '<span dir="ltr">' + esc(rec.email) + '</span>' : '— (حساب قديم بلا بريد)') + '</td></tr>' +
      '<tr><th>السنّ</th><td>' + ((typeof rec.age === "number") ? rec.age : '—') + '</td></tr>' +
      '<tr><th>المستوى الدراسي</th><td>' + esc(rec.level || '—') + '</td></tr>' +
      '<tr><th>المؤسسة</th><td>' + esc(rec.school || '—') + '</td></tr>' +
      '<tr><th>نوع الحساب</th><td>' + (accountProvider(rec) === "google" ? "حساب Google" : "حساب بالاستمارة وكلمة سر") + '</td></tr>' +
      '<tr><th>أُنشئ في</th><td><span dir="ltr">' + fmtStamp(row.createdAt) + '</span></td></tr>' +
      '<tr><th>آخر نشاط</th><td><span dir="ltr">' + fmtStamp(row.updatedAt) + '</span></td></tr>' +
      '<tr><th>التقدّم العام</th><td><strong>' + (row.doneCount || 0) + ' / ' + TOTAL_LESSONS + ' درسًا (' + (row.overallPct || 0) + '%)</strong> · الشهادات المحقّقة: ' + (row.certificates || 0) + '</td></tr>' +
      '</tbody></table></div>' +
    '</section>' + levelsHtml, "قاعدة بيانات التلميذ"
  );
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
    inner = '<p class="done-status" id="done-status">لا يُحتسب الدرس منجزًا إلا باجتياز اختباره القصير: أجب عن جميع الأسئلة واحصل على ' +
      QUIZ_PASS_MIN + ' إجابات صحيحة على الأقل من ' + (l.quiz ? l.quiz.length : 4) +
      '. لا يوجد زر تعليم يدوي — النجاح في الاختبار هو وحده ما يُتمّ الدرس، ويمكنك إعادة المحاولة بلا حدود.' +
      (p && typeof p.quizScore === "number" && p.quizTotal
        ? '<br>آخر نتيجة لك في الاختبار: ' + p.quizScore + '/' + p.quizTotal + ' — لم تصل بعد إلى الحد المطلوب، حاول من جديد.</p>'
        : '</p>');
  }
  return '<section class="card done-card"><h2>' + icon("check-circle", "icon-md") + '<span>إتمام الدرس</span></h2>' + inner + '</section>';
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
  if (l.goal) body += '<p class="lesson-goal">' + icon("target", "icon-md") + '<span>هدف الدرس: ' + esc(l.goal) + '</span></p>';

  /* مشغّل ذكي: إن نُشر الدرس على يوتيوب وكان الاتصال متاحًا، تظهر واجهة
     خفيفة (صورة مصغّرة + زر تشغيل) لا تُحمّل مشغّل يوتيوب إلا عند الضغط،
     وتبقى النسخة المحلية خيارًا دائمًا — وعند انقطاع الاتصال أو للدروس
     غير المنشورة يعمل الملف المحلي مباشرة كما في نسخة الأوفلاين */
  const yid = ytId(l);
  const isOnline = (typeof navigator === "undefined") || navigator.onLine !== false;
  if (yid && isOnline) {
    body += '<section class="card"><h2>' + icon("video", "icon-md") + '<span>فيديو الدرس</span></h2>' +
      '<div class="yt-facade" id="yt-facade" data-yt="' + yid + '" role="button" tabindex="0" aria-label="تشغيل فيديو الدرس على يوتيوب" style="background-image:url(\'https://i.ytimg.com/vi/' + yid + '/hqdefault.jpg\')">' +
      '<span class="yt-badge">YouTube</span><span class="yt-play" aria-hidden="true"></span>' +
      '<span class="yt-facade-label">شاهد الدرس على يوتيوب — قناة Ai &amp; Robotics Club</span></div>' +
      '<div id="yt-slot"></div>' +
      '<p class="muted small" id="video-note">يُشغَّل هذا الدرس عبر يوتيوب مع الترجمة العربية. إن تعذّر التشغيل على شبكتك، جرّب <a href="#" id="yt-use-local">النسخة المحلية من الفيديو</a>.</p></section>';
  } else {
    body += '<section class="card"><h2>' + icon("video", "icon-md") + '<span>فيديو الدرس</span></h2>' + localVideoHTML(l) +
      '<p class="muted small" id="video-note">ملف الفيديو المحلي: <span dir="ltr">' + videoPath(l) + '</span>' + (l.stub ? ' — سيُضاف عند إنتاجه.' : ' — وتظهر الترجمة العربية تلقائيًا أثناء التشغيل إذا وُجد ملف ترجمته بجانب المنصة.') + '</p></section>';
  }
  /* لا شريط قناة تحت الفيديو: دعوة الاشتراك تعيش داخل فيديوهات يوتيوب نفسها
     عبر شاشات النهاية (قرار الأستاذ 2026-10-30 بعد تجربة زر الاشتراك الرسمي:
     الزر كان يفتح صفحة يوتيوب عند الضغط، والشريط كلّه زائد بلا فائدة). */

  if (l.stub) {
    body += '<section class="card soon-card"><h2>' + icon("clock", "icon-md") + '<span>هذا الدرس قيد الإعداد</span></h2><p>العنوان والنوع جاهزان في الخريطة المعتمدة، وسيُضاف الشرح والكود والفيديو والاختبار تباعًا. تابع الدروس الجاهزة الآن، وعد إلى هنا قريبًا.</p></section>';
  } else {
    if (l.explanation) {
      body += '<section class="card"><h2>' + icon("book", "icon-md") + '<span>الشرح</span></h2>' +
        l.explanation.map((t, pi) => '<p id="exp-para-' + pi + '">' + esc(t) + '</p>').join("") + '</section>';
    }
    if (l.components) {
      body += '<section class="card"><h2>' + icon("tools", "icon-md") + '<span>العناصر المستعملة</span></h2><ul class="nice-list">' +
        l.components.map(c => '<li>' + esc(c) + '</li>').join("") + '</ul></section>';
    }
    if (l.code) {
      body += '<section class="card"><h2>' + icon("code", "icon-md") + '<span>الكود — ' + esc(l.code.title) + '</span></h2>' +
        '<div class="code-head"><button class="btn btn-small btn-primary" id="btn-copy" type="button">نسخ الكود</button><span class="muted small">الصقه في Arduino IDE</span></div>' +
        '<pre class="code-block" dir="ltr"><code id="lesson-code">' + esc(l.code.text) + '</code></pre></section>';
    }
    if (l.experiment) {
      body += '<section class="card"><h2>' + icon("flask", "icon-md") + '<span>جرّب بنفسك — تجربة تفاعلية</span></h2>' +
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
      body += '<section class="card"><h2>' + icon("quiz", "icon-md") + '<span>اختبار سريع QCM</span></h2>' +
        '<p class="muted">أجب عن جميع الأسئلة ثم اضغط «تصحيح الاختبار». إذا حصلت على ' + QUIZ_PASS_MIN + ' إجابات صحيحة على الأقل يُحتسب الدرس منجزًا — وإن لم تنجح هذه المرة، راجع الشرح وأعد المحاولة بلا حدود.</p><div id="quiz-box">' +
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
          ? '<p class="muted inline-icon-row">' + icon("award", "icon-sm") + '<span>أفضل نتيجة سابقة لك في هذا الاختبار: ' + saved.quizBest + '/' + saved.quizTotal + '</span></p>' : "") +
        '</div></section>';
    }
    if (Array.isArray(l.quizExtra) && l.quizExtra.length) {
      /* «تحدَّ نفسك»: أسئلة تدريب إضافية (توقّع/تطبيق/ملاحظة) غير مُقيَّمة —
         لا تُسجَّل ولا تدخل في إتمام الدرس إطلاقًا (قاعدة الاحتساب دون تغيير) */
      body += '<section class="card pool-card"><h2>' + icon("spark", "icon-md") + '<span>تحدَّ نفسك — أسئلة تدريب إضافية</span></h2>' +
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
      body += '<section class="card"><h2>' + icon("edit", "icon-md") + '<span>تمارين تطبيقية</span></h2><ol class="nice-list">' +
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
      /* صورة الواجهة: نبدأ بصورة hqdefault فورًا، ثم نرقّي إلى maxresdefault
         (الغلاف المخصّص كامل الجودة) متى توفّرت — فتظهر أغلفة الدروس في المنصة */
      const hiImg = new Image();
      hiImg.onload = () => { facade.style.backgroundImage = "url('https://i.ytimg.com/vi/" + facade.dataset.yt + "/maxresdefault.jpg')"; };
      hiImg.src = "https://i.ytimg.com/vi/" + facade.dataset.yt + "/maxresdefault.jpg";
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
  /* لوحة الأستاذ متاحة للمسجّل والزائر معًا (حاسوب القسم)، ولها صفحة
     فرعية لسجلّ كل تلميذ */
  const teacherRoute = () => {
    if (parts[1] === "student" && parts[2]) {
      try { return renderTeacherStudent(decodeURIComponent(parts.slice(2).join("/"))); }
      catch (e) { return renderTeacherStudent(parts.slice(2).join("/")); }
    }
    return renderTeacher();
  };
  if (!currentUser()) {
    if (parts[0] === "login") return renderAuth("login");
    if (parts[0] === "register") return renderAuth("register");
    if (parts[0] === "recover") return renderRecover();
    if (parts[0] === "teacher") return teacherRoute();
    /* الجذر وأي مسار آخر لزائر غير مسجّل: صفحة الاستقبال الاحترافية،
       لا قفز مباشر إلى استمارة الدخول (طلب المالك 2026-10-31) */
    return renderLanding();
  }
  if (parts[0] === "teacher") return teacherRoute();
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
