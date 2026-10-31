/* ============================================================
   منصة الأستاذ المستقلة — منطق المنصة (تعمل دون إنترنت)
   قرار المالك (2026-10-31): لوحة تتبّع الأستاذ خرجت من منصة
   التلاميذ نهائيًا إلى منصة قائمة بذاتها (teacher.html) بدخول
   خاص وقاعدة بيانات محلية خاصة:
   - الدخول: اسم مستخدم وكلمة سر تُحفظ بصمتها فقط (SHA-256 مع
     ملح عشوائي، بالصيغة نفسها التي تستعملها منصة التلاميذ:
     بصمة النص «salt::password»). كلمة السر الابتدائية مهيأة
     ببصمة جاهزة في هذا الملف، وتغييرها من الإعدادات يكتب بصمة
     جديدة في teacherPlatformAuth.v1 تتقدّم على الابتدائية.
   - البيانات: teacherPlatformDB.v1 — سجلات مستوردة من النسخ
     الاحتياطية التي يصدّرها التلاميذ من منصتهم (الصيغة نفسها
     والتحقق نفسه)، مدموجة بمفتاح التلميذ (بريده)، مع إضافة
     يدوية وتعديل وحذف بيد الأستاذ.
   - الدوال الصافية (إحصاءات/CSV/تحقق/دمج) معزولة في الأعلى
     وتُصدَّر عبر window.TeacherPlatform حتى تختبرها
     build/teacher-test.js في Node دون متصفح.
   ============================================================ */
"use strict";

/* ---------- ثوابت ---------- */
const T_DB_KEY = "teacherPlatformDB.v1";
const T_AUTH_KEY = "teacherPlatformAuth.v1";
const T_SESSION_KEY = "teacherPlatformSession.v1";
const T_USERNAME = "admin";
/* بيانات الدخول الابتدائية: ملح + بصمة SHA-256 فقط — لا نص صريح
   لكلمة السر في أي ملف. تغيير كلمة السر من الإعدادات يستبدلها
   ببصمة جديدة محفوظة في teacherPlatformAuth.v1 */
const T_DEFAULT_AUTH = {
  salt: "0cbf73ebcf13f758dee6d149e31f6132",
  hash: "438b29f98729844daf3c82e0ac6dd3aeed47429e9aca4afbace261598951ee24"
};
const T_SCHOOL_LEVELS = ["أولى إعدادي", "ثانية إعدادي", "ثالثة إعدادي"];
const T_BACKUP_FORMAT = "arduino-academy-backup";
const T_BACKUP_VERSION = 1;
/* لوحة المبيانات الموسّعة (أجازها المالك لتصوّر البيانات) */
const T_VIZ = ["#22C3E6", "#2FA84F", "#F2A93B", "#EF6461", "#7C6BD9", "#2AA198"];
const T_LEVEL_COLORS = ["#22C3E6", "#2FA84F", "#F2A93B", "#EF6461", "#7C6BD9"];
const T_SCHOOL_CATS = [
  { label: "أولى إعدادي", color: "#22C3E6" },
  { label: "ثانية إعدادي", color: "#2FA84F" },
  { label: "ثالثة إعدادي", color: "#F2A93B" },
  { label: "غير محدد", color: "#7C6BD9" }
];
const T_BUCKETS = [
  { label: "0٪", color: "#EF6461" },
  { label: "1–25٪", color: "#F2A93B" },
  { label: "26–50٪", color: "#22C3E6" },
  { label: "51–75٪", color: "#2AA198" },
  { label: "76–99٪", color: "#7C6BD9" },
  { label: "100٪", color: "#2FA84F" }
];

/* ---------- أدوات نصية ---------- */
function tEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function tPad2(n) { return String(n).padStart(2, "0"); }
function tFmtStamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.getFullYear() + "/" + tPad2(d.getMonth() + 1) + "/" + tPad2(d.getDate()) +
    " " + tPad2(d.getHours()) + ":" + tPad2(d.getMinutes());
}
function tNormalizeEmail(email) { return String(email == null ? "" : email).trim().toLowerCase(); }
function tSplitFullName(name) {
  const words = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: "", lastName: "" };
  return { firstName: words[0], lastName: words.slice(1).join(" ") };
}
function tDeriveFullName(firstName, lastName) {
  return (String(firstName == null ? "" : firstName).trim() + " " +
          String(lastName == null ? "" : lastName).trim()).trim();
}

/* ---------- SHA-256 خالصة (منقولة من منصة التلاميذ حرفيًا) ----------
   بصمة كلمة السر = SHA-256 للنص «salt::password» بصيغة hex —
   الصيغة نفسها في المنصتين حتى لا يختلف التحقق بين بيئتين */
function tUtf8Bytes(str) {
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
const T_SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
function tSha256Hex(text) {
  const bytes = tUtf8Bytes(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0);
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
      const temp1 = (h + S1 + ch + T_SHA256_K[t] + w[t]) >>> 0;
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
function tHashPassword(password, salt) { return tSha256Hex(salt + "::" + String(password == null ? "" : password)); }
function tRandomSalt() {
  const a = new Uint8Array(16);
  const c = (typeof window !== "undefined" && window.crypto) || (typeof crypto !== "undefined" ? crypto : null);
  if (c && c.getRandomValues) c.getRandomValues(a);
  else { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}
/* التحقق من بيانات دخول الأستاذ مقابل سجل بصمة {salt, hash} */
function tCheckCredentials(auth, username, password) {
  if (!auth || typeof auth.salt !== "string" || typeof auth.hash !== "string") return false;
  return String(username == null ? "" : username).trim() === T_USERNAME &&
    tHashPassword(password, auth.salt) === auth.hash;
}
/* قاعدة كلمة السر نفسها في منصة التلاميذ: 8+ أحرف بحرف ورقم */
const T_LETTER_RE = /[A-Za-z\u0621-\u064A\u066E-\u06D3]/;
const T_DIGIT_RE = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
function tPasswordError(password) {
  const v = String(password == null ? "" : password);
  if (!v) return "اكتب كلمة السر.";
  if (v.length < 8) return "كلمة السر قصيرة — يجب أن تكون 8 أحرف على الأقل.";
  if (!T_LETTER_RE.test(v) || !T_DIGIT_RE.test(v)) return "كلمة السر يجب أن تحتوي على حرف واحد على الأقل ورقم واحد على الأقل.";
  return null;
}

/* ---------- تطبيع سجلات التلاميذ (توافق مع صيغة منصة التلاميذ) ---------- */
function tNormalizeRecord(r) {
  if (!r || typeof r !== "object") return r;
  if (typeof r.name !== "string" && typeof r.fullName === "string") r.name = r.fullName;
  if (typeof r.firstName === "string" && r.firstName.trim() !== "") {
    if (typeof r.lastName !== "string") r.lastName = "";
    const full = tDeriveFullName(r.firstName, r.lastName);
    if (full) r.name = full;
  } else if (typeof r.name === "string" && r.name.trim() !== "") {
    const parts = tSplitFullName(r.name);
    r.firstName = parts.firstName;
    r.lastName = parts.lastName;
  }
  if (typeof r.name === "string") r.fullName = r.name;
  return r;
}
function tPasswordIsSet(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.passwordSet === false) return false;
  return typeof rec.salt === "string" && !!rec.salt && typeof rec.hash === "string" && !!rec.hash;
}
function tProviderOf(rec) { return rec && rec.provider === "google" ? "google" : (rec && rec.provider === "manual" ? "manual" : "password"); }
function tProviderLabel(rec) {
  const p = tProviderOf(rec);
  return p === "google" ? "Google" : (p === "manual" ? "إضافة يدوية" : "استمارة");
}
function tPhotoURL(rec) {
  if (rec && typeof rec.photoUpload === "string" && rec.photoUpload) return rec.photoUpload;
  if (rec && typeof rec.photo === "string" && rec.photo) return rec.photo;
  return "";
}
/* مفتاح التلميذ في قاعدة الأستاذ: بريده المطبّع متى وُجد، وإلا
   مفتاحه التاريخي كما جاء في النسخة (حسابات قديمة باسم مستخدم) */
function tStudentKey(fallbackKey, rec) {
  const em = rec && typeof rec.email === "string" ? tNormalizeEmail(rec.email) : "";
  return em || String(fallbackKey == null ? "" : fallbackKey);
}

/* ---------- منطق التقدّم (قواعد منصة التلاميذ نفسها) ---------- */
function tQuizPassScore(total) { return Math.min(3, total); }
function tIsPassed(p, lesson) {
  if (!p || p.quizPassed !== true) return false;
  const total = lesson && lesson.quiz ? lesson.quiz.length : 0;
  return total > 0 && p.quizTotal === total &&
    typeof p.quizBest === "number" && p.quizBest >= tQuizPassScore(total);
}
function tLevelStats(rec, DATA, levelN) {
  const ls = DATA.lessons.filter(l => l.level === levelN);
  const done = ls.filter(l => tIsPassed(rec.progress && rec.progress[l.id], l)).length;
  return { total: ls.length, done, pct: ls.length ? Math.round(done / ls.length * 100) : 0 };
}
function tLevelComplete(rec, DATA, n) {
  const st = tLevelStats(rec, DATA, n);
  return st.total > 0 && st.done === st.total;
}
function tCertificateUnlocked(rec, DATA, n) {
  return tLevelComplete(rec, DATA, n) && !!(rec && rec.playgroundPassed && rec.playgroundPassed[n]);
}

/* ---------- التحقق من النسخ الاحتياطية (منقول من منصة التلاميذ) ----------
   الصيغة والفحوص نفسها: ملف «arduino-academy-backup» يُقبل، وكل
   سجل يُطبَّع إلى الحقول الآمنة — سجل واحد فاسد يرفض الملف كله */
function tValidateBackup(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "الملف ليس نسخة احتياطية صالحة." };
  if (obj.format !== T_BACKUP_FORMAT) return { ok: false, error: "هذا الملف ليس نسخة احتياطية صادرة من منصة التلاميذ." };
  if (typeof obj.version !== "number" || obj.version < 1) return { ok: false, error: "نسخة الصيغة غير معروفة." };
  if (obj.version > T_BACKUP_VERSION) return { ok: false, error: "هذه النسخة أحدث من هذه المنصة — حدّث المنصة أولًا ثم أعد الاستيراد." };
  if (!obj.users || typeof obj.users !== "object" || Array.isArray(obj.users)) return { ok: false, error: "النسخة لا تحتوي قائمة حسابات صالحة." };
  const users = {};
  for (const name of Object.keys(obj.users)) {
    const r = obj.users[name];
    const isGoogle = !!(r && typeof r === "object" && !Array.isArray(r) && r.provider === "google");
    if (!r || typeof r !== "object" || Array.isArray(r) || typeof r.name !== "string" ||
        (!isGoogle && (typeof r.salt !== "string" || typeof r.hash !== "string"))) {
      return { ok: false, error: "سجل الحساب «" + name + "» في النسخة غير مكتمل (الاسم/الملح/البصمة) — أُلغي استيراد هذا الملف حفاظًا على البيانات." };
    }
    users[name] = tNormalizeRecord({
      name: r.name,
      firstName: typeof r.firstName === "string" ? r.firstName : undefined,
      lastName: typeof r.lastName === "string" ? r.lastName : undefined,
      fullName: typeof r.fullName === "string" ? r.fullName : undefined,
      email: typeof r.email === "string" ? tNormalizeEmail(r.email) : "",
      provider: isGoogle ? "google" : "password",
      passwordSet: typeof r.passwordSet === "boolean" ? r.passwordSet : undefined,
      googleLinked: r.googleLinked === true ? true : undefined,
      photo: typeof r.photo === "string" ? r.photo : "",
      photoUpload: typeof r.photoUpload === "string" ? r.photoUpload : undefined,
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
    });
  }
  return { ok: true, users };
}

/* ---------- صفوف التلاميذ والإحصاءات ---------- */
function tStudentRow(key, rec, DATA) {
  rec = rec || {};
  let currentLevel = null, doneCount = 0, earned = 0, possible = 0, certificates = 0;
  const perLevel = [];
  for (let n = 1; n <= 5; n++) {
    const st = tLevelStats(rec, DATA, n);
    doneCount += st.done;
    perLevel.push({ n, done: st.done, total: st.total, pct: st.pct });
    if (tCertificateUnlocked(rec, DATA, n)) certificates++;
    if (currentLevel === null && st.done < st.total) currentLevel = n;
  }
  DATA.lessons.forEach(l => {
    const p = rec.progress && rec.progress[l.id];
    if (p && typeof p.quizBest === "number" && p.quizTotal) { earned += p.quizBest; possible += p.quizTotal; }
  });
  const dates = {};
  for (let n = 1; n <= 5; n++) {
    const ts = rec.levelDates && rec.levelDates[n];
    if (ts) { const d = new Date(ts); dates[n] = d.getFullYear() + "/" + tPad2(d.getMonth() + 1) + "/" + tPad2(d.getDate()); }
  }
  const totalLessons = DATA.lessons.length;
  return {
    key, username: key,
    name: rec.name || key,
    firstName: typeof rec.firstName === "string" ? rec.firstName : "",
    email: typeof rec.email === "string" ? rec.email : "",
    age: (typeof rec.age === "number" && isFinite(rec.age)) ? rec.age : null,
    schoolLevel: typeof rec.level === "string" ? rec.level : "",
    school: typeof rec.school === "string" ? rec.school : "",
    provider: tProviderOf(rec),
    passwordSet: tPasswordIsSet(rec),
    source: typeof rec.source === "string" ? rec.source : "",
    photoURL: tPhotoURL(rec),
    currentLevel, allComplete: currentLevel === null,
    doneCount, totalLessons, earned, possible, dates, perLevel,
    overallPct: totalLessons ? Math.round(doneCount / totalLessons * 100) : 0,
    certificates,
    createdAt: typeof rec.createdAt === "number" ? rec.createdAt : null,
    updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : null
  };
}
function tBucketIndex(pct) {
  if (pct <= 0) return 0;
  if (pct <= 25) return 1;
  if (pct <= 50) return 2;
  if (pct <= 75) return 3;
  if (pct < 100) return 4;
  return 5;
}
function tComputeStats(users, DATA) {
  const rows = Object.keys(users || {}).sort().map(k => tStudentRow(k, users[k], DATA));
  const totalStudents = rows.length;
  const started = rows.filter(r => r.doneCount > 0).length;
  const totalDone = rows.reduce((s, r) => s + r.doneCount, 0);
  const totalCerts = rows.reduce((s, r) => s + r.certificates, 0);
  const meanPct = totalStudents ? Math.round(rows.reduce((s, r) => s + r.overallPct, 0) / totalStudents) : 0;
  const bySchoolLevel = T_SCHOOL_CATS.map(c => ({ label: c.label, color: c.color, count: 0 }));
  rows.forEach(r => {
    const i = T_SCHOOL_LEVELS.indexOf(r.schoolLevel);
    bySchoolLevel[i >= 0 ? i : 3].count++;
  });
  const lessonsPerLevel = [1, 2, 3, 4, 5].map(n =>
    rows.reduce((s, r) => s + r.perLevel[n - 1].done, 0));
  const buckets = T_BUCKETS.map(b => ({ label: b.label, color: b.color, count: 0 }));
  rows.forEach(r => { buckets[tBucketIndex(r.overallPct)].count++; });
  const completeInfo = rows.filter(r =>
    r.age !== null && r.schoolLevel !== "" && r.school !== "").length;
  const byProvider = { google: 0, password: 0, manual: 0 };
  rows.forEach(r => { byProvider[r.provider] = (byProvider[r.provider] || 0) + 1; });
  return {
    rows, totalStudents, started, totalDone, totalCerts, meanPct,
    bySchoolLevel, lessonsPerLevel, buckets,
    completeInfoPct: totalStudents ? Math.round(completeInfo / totalStudents * 100) : 0,
    byProvider
  };
}
function tRowsToCSV(rows) {
  const cell = v => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
  const head = ["الاسم الكامل", "البريد الإلكتروني", "العمر", "المستوى الدراسي", "المؤسسة",
    "تقدم المستوى 1 ٪", "تقدم المستوى 2 ٪", "تقدم المستوى 3 ٪", "تقدم المستوى 4 ٪", "تقدم المستوى 5 ٪",
    "التقدم العام ٪", "دروس منجزة", "شهادات مستحقة"];
  const lines = [head.map(cell).join(",")];
  rows.forEach(r => {
    lines.push([r.name, r.email || "", r.age === null ? "" : r.age, r.schoolLevel || "", r.school || "",
      r.perLevel[0].pct, r.perLevel[1].pct, r.perLevel[2].pct, r.perLevel[3].pct, r.perLevel[4].pct,
      r.overallPct, r.doneCount, r.certificates].map(cell).join(","));
  });
  return "\ufeff" + lines.join("\r\n"); /* BOM حتى يقرأ Excel العربية سليمة */
}

/* ---------- إجراءات الأستاذ على القاعدة (دوال صافية على خريطة السجلات) ---------- */
function tStudentFieldsError(f, withEmail) {
  const first = String(f && f.firstName == null ? "" : f.firstName).trim();
  const last = String(f && f.lastName == null ? "" : f.lastName).trim();
  if (!first) return "اكتب الاسم الشخصي للتلميذ.";
  if (first.length < 2) return "الاسم الشخصي قصير جدًا — حرفان على الأقل.";
  if (!last) return "اكتب الاسم العائلي (النسب) للتلميذ.";
  if (last.length < 2) return "الاسم العائلي قصير جدًا — حرفان على الأقل.";
  if (withEmail) {
    const em = tNormalizeEmail(f && f.email);
    if (!em) return "اكتب البريد الإلكتروني للتلميذ.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return "صيغة البريد الإلكتروني غير صحيحة.";
  }
  const ageRaw = f ? f.age : "";
  if (ageRaw !== null && ageRaw !== undefined && String(ageRaw).trim() !== "") {
    const n = Number(ageRaw);
    if (!Number.isInteger(n) || n < 8 || n > 25) return "السنّ يجب أن يكون رقمًا صحيحًا بين 8 و25، أو اتركه فارغًا.";
  }
  if (f && f.level && T_SCHOOL_LEVELS.indexOf(f.level) < 0) return "اختر المستوى الدراسي من القائمة.";
  const school = String(f && f.school == null ? "" : f.school).trim();
  if (school && school.length < 3) return "اسم المؤسسة قصير جدًا — اكتبه كاملًا أو اتركه فارغًا.";
  return null;
}
function tAgeValue(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  return Math.trunc(Number(raw));
}
/* إضافة يدوية: سجل بتقدّم فارغ ومصدر «manual» — يُحدَّث لاحقًا
   عند استيراد نسخة التلميذ الحقيقية لأنه يُدمج ببريده نفسه */
function tAddStudentRecord(users, f) {
  const err = tStudentFieldsError(f, true);
  if (err) return { ok: false, error: err };
  const key = tNormalizeEmail(f.email);
  if (Object.prototype.hasOwnProperty.call(users, key))
    return { ok: false, error: "يوجد سجل بهذا البريد في قاعدة البيانات — عدّله بدل إضافة نسخة ثانية." };
  const firstName = String(f.firstName).trim(), lastName = String(f.lastName).trim();
  const name = tDeriveFullName(firstName, lastName);
  users[key] = {
    name, fullName: name, firstName, lastName,
    email: key, provider: "manual", source: "manual", passwordSet: false,
    photo: "", age: tAgeValue(f.age),
    level: f.level || "", school: String(f.school == null ? "" : f.school).trim(),
    createdAt: Date.now(), updatedAt: Date.now(),
    progress: {}, levelDates: {}, playgroundPassed: {}
  };
  return { ok: true, key };
}
/* تعديل المعلومات الأساسية — البريد (هوية الدمج) لا يُلمس أبدًا */
function tUpdateStudentRecord(users, key, f) {
  if (!Object.prototype.hasOwnProperty.call(users, key))
    return { ok: false, error: "هذا السجل غير موجود في قاعدة البيانات." };
  const err = tStudentFieldsError(f, false);
  if (err) return { ok: false, error: err };
  const rec = users[key];
  const firstName = String(f.firstName).trim(), lastName = String(f.lastName).trim();
  rec.firstName = firstName; rec.lastName = lastName;
  rec.name = tDeriveFullName(firstName, lastName); rec.fullName = rec.name;
  rec.age = tAgeValue(f.age);
  rec.level = f.level || "";
  rec.school = String(f.school == null ? "" : f.school).trim();
  rec.updatedAt = Date.now();
  return { ok: true, key };
}
function tDeleteStudentRecord(users, key) {
  if (!Object.prototype.hasOwnProperty.call(users, key)) return false;
  delete users[key];
  return true;
}
/* دمج سجلات مستوردة (مفاتيح النسخة الأصلية) في القاعدة، بمفتاح
   التلميذ الموحّد: موجود يُحدَّث، وجديد يُضاف */
function tMergeImported(users, importedUsers) {
  let added = 0, updated = 0;
  for (const origKey of Object.keys(importedUsers || {})) {
    const rec = importedUsers[origKey];
    const key = tStudentKey(origKey, rec);
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(users, key)) updated++; else added++;
    users[key] = rec;
  }
  return { added, updated };
}

/* ---------- تصدير الدوال الصافية للاختبارات ---------- */
if (typeof window !== "undefined") {
  window.TeacherPlatform = {
    DB_KEY: T_DB_KEY, AUTH_KEY: T_AUTH_KEY, SESSION_KEY: T_SESSION_KEY,
    USERNAME: T_USERNAME, DEFAULT_AUTH: T_DEFAULT_AUTH,
    SCHOOL_LEVELS: T_SCHOOL_LEVELS, VIZ: T_VIZ,
    sha256Hex: tSha256Hex, hashPassword: tHashPassword,
    checkCredentials: tCheckCredentials, passwordError: tPasswordError,
    normalizeRecord: tNormalizeRecord, passwordIsSet: tPasswordIsSet,
    validateBackup: tValidateBackup, studentKey: tStudentKey,
    isPassed: tIsPassed, levelStats: tLevelStats,
    certificateUnlocked: tCertificateUnlocked,
    studentRow: tStudentRow, computeStats: tComputeStats, rowsToCSV: tRowsToCSV,
    addStudentRecord: tAddStudentRecord, updateStudentRecord: tUpdateStudentRecord,
    deleteStudentRecord: tDeleteStudentRecord, mergeImported: tMergeImported
  };
}

/* ============================================================
   طبقة المتصفح: التخزين، الدخول، العروض، المبيانات، الأحداث
   (لا تعمل إلا في المتصفح الحقيقي — حراسة DOM كاملة)
   ============================================================ */
const T_DATA = (typeof window !== "undefined" && window.ACADEMY_DATA) || null;

function tStorageGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function tStorageSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
function tSessionGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
function tSessionSet(key, value) { try { sessionStorage.setItem(key, value); } catch (e) { /* تجاهل */ } }
function tSessionRemove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* تجاهل */ } }

function tLoadDB() {
  const raw = tStorageGet(T_DB_KEY);
  if (raw == null) return { students: {} };
  try {
    const db = JSON.parse(raw);
    if (db && typeof db === "object" && db.students && typeof db.students === "object" && !Array.isArray(db.students)) {
      const clean = {};
      for (const k of Object.keys(db.students)) {
        const r = db.students[k];
        if (r && typeof r === "object" && !Array.isArray(r)) clean[k] = tNormalizeRecord(r);
      }
      return { students: clean };
    }
  } catch (e) { /* تالف: نبدأ فارغًا دون مسح الأصل حتى يقرر الأستاذ */ }
  return { students: {} };
}
function tSaveDB(db) { return tStorageSet(T_DB_KEY, JSON.stringify(db)); }
function tDBRawSizeKB() {
  const raw = tStorageGet(T_DB_KEY);
  if (!raw) return 0;
  const bytes = typeof Blob !== "undefined" ? new Blob([raw]).size : raw.length;
  return Math.round(bytes / 102.4) / 10;
}
function tEffectiveAuth() {
  try {
    const raw = tStorageGet(T_AUTH_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (a && typeof a.salt === "string" && a.salt && typeof a.hash === "string" && a.hash) return a;
    }
  } catch (e) { /* تجاهل */ }
  return T_DEFAULT_AUTH;
}
function tIsLoggedIn() { return tSessionGet(T_SESSION_KEY) === T_USERNAME; }

function tDownloadFile(name, text, type) {
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

/* ---------- الأيقونات (SVG خطية بنمط منصة التلاميذ) ---------- */
const T_ICONS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  route: '<circle cx="6" cy="19" r="2.6"/><circle cx="18" cy="5" r="2.6"/><path d="M8.6 19H15a3.5 3.5 0 0 0 0-7h-6a3.5 3.5 0 0 1 0-7h.4"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-13"/><path d="M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
  logout: '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M3.5 12h11M10.5 7.5 15 12l-4.5 4.5"/>',
  users: '<circle cx="9" cy="8.2" r="3.4"/><path d="M3.2 19.4a6 6 0 0 1 11.6 0"/><path d="M15.6 5.4a3.4 3.4 0 0 1 0 5.9M17.8 13.9a6 6 0 0 1 3 5.5"/>',
  play: '<polygon points="7 4.8 19 12 7 19.2 7 4.8"/>',
  book: '<path d="M12 6.2c-1.8-1.4-4.3-2-7-2A1.5 1.5 0 0 0 3.5 5.7v11.8c0 .8.7 1.5 1.5 1.5 2.7 0 5.2.6 7 2 1.8-1.4 4.3-2 7-2 .8 0 1.5-.7 1.5-1.5V5.7c0-.8-.7-1.5-1.5-1.5-2.7 0-5.2.6-7 2Z"/><path d="M12 6.2v14.8"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.8 14.1-1.3 7.4 4.5-2.4 4.5 2.4-1.3-7.4"/>',
  chart: '<path d="M4 4v15.5A.5.5 0 0 0 4.5 20H20"/><path d="M8 16v-5M12 16V8M16 16v-8.5M20 16V6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 15V4.5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M4 15.5v2.5A2 2 0 0 0 6 20h12a2 2 0 0 0 2-2v-2.5"/>',
  download: '<path d="M12 4.5V15"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 15.5v2.5A2 2 0 0 0 6 20h12a2 2 0 0 0 2-2v-2.5"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V6"/><path d="M6.5 6.5 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6A1.6 1.6 0 0 0 16.6 19l.9-12.5"/><path d="M10 10.5v6M14 10.5v6"/>',
  edit: '<path d="M15.8 4.5a2.1 2.1 0 0 1 3 3L8.3 18l-4.3 1 1-4.3L15.8 4.5Z"/><path d="m14 6.3 3 3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  back: '<path d="M4 12h15"/><path d="m13.5 6 5.5 6-5.5 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.2" r="1.4"/>',
  clock: '<circle cx="12" cy="12" r="8.8"/><path d="M12 7.5V12l3.2 2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  key: '<circle cx="8" cy="15" r="4.2"/><path d="m11 12 8.5-8.5"/><path d="m16 6.5 2.5 2.5M18.5 4 21 6.5"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2"/><circle cx="12" cy="16.8" r="0.6"/>',
  save: '<path d="M6.5 4h9.7L19 6.8V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5.5A1.5 1.5 0 0 1 6.5 4Z"/><path d="M8.5 4v5h7V4"/><rect x="8" y="13" width="8" height="7.5" rx="1"/>'
};
function tIcon(name, cls) {
  return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g>' + (T_ICONS[name] || "") + "</g></svg>";
}
function tAvatarHTML(rec, sizeCls) {
  const url = tPhotoURL(rec);
  if (url) return '<img class="avatar avatar-img ' + sizeCls + '" src="' + tEsc(url) + '" alt="">';
  const initial = ((rec && (rec.firstName || rec.name)) || "؟").trim().charAt(0) || "؟";
  return '<span class="avatar avatar-letter ' + sizeCls + '" aria-hidden="true">' + tEsc(initial) + "</span>";
}

/* ---------- المبيانات (SVG مرسومة باليد) ---------- */
function tDonutSVG(parts, total) {
  if (!total) return '<p class="muted">لا بيانات بعد.</p>';
  const R = 78, C = 2 * Math.PI * R;
  let off = 0;
  const segs = parts.filter(p => p.count > 0).map(p => {
    const len = (p.count / total) * C;
    const el = '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + p.color +
      '" stroke-width="27" stroke-dasharray="' + Math.max(len - 2.5, 0.5).toFixed(1) + " " + C.toFixed(1) +
      '" stroke-dashoffset="' + (-off).toFixed(1) + '" class="anim-donut donut-spin"/>';
    off += len;
    return el;
  }).join("");
  return '<svg class="chart-svg" width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="مبيان دائري: التلاميذ حسب المستوى الدراسي">' +
    '<g transform="rotate(-90 100 100)">' + segs + "</g>" +
    '<text x="100" y="98" text-anchor="middle" class="donut-center" font-size="30">' + total + "</text>" +
    '<text x="100" y="122" text-anchor="middle" class="donut-center-sub">تلميذ</text></svg>';
}
function tColumnsSVG(values) {
  const W = 560, H = 252, base = 214, maxH = 168;
  const max = Math.max.apply(null, values.concat([1]));
  const bw = 62, gap = (W - 40 - bw * 5) / 4;
  let bars = "";
  values.forEach((v, i) => {
    const h = Math.round((v / max) * maxH);
    const x = W - 20 - bw - i * (bw + gap); /* المستوى 1 في أقصى اليمين (اتجاه القراءة) */
    bars += '<g class="anim-grow-y" style="animation-delay:' + (i * 90) + 'ms">' +
      '<rect x="' + x + '" y="' + (base - h) + '" width="' + bw + '" height="' + Math.max(h, 2) +
      '" rx="7" fill="' + T_LEVEL_COLORS[i] + '"/></g>' +
      '<text x="' + (x + bw / 2) + '" y="' + (base - h - 9) + '" text-anchor="middle" font-size="16" font-weight="800" fill="#0A2242">' + v + "</text>" +
      '<text x="' + (x + bw / 2) + '" y="' + (base + 24) + '" text-anchor="middle" font-size="13.5" fill="#4F6579">المستوى ' + (i + 1) + "</text>";
  });
  return '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="مبيان أعمدة: الدروس المنجزة في كل مستوى">' +
    '<line x1="14" y1="' + base + '" x2="' + (W - 14) + '" y2="' + base + '" stroke="#D7E3EE" stroke-width="2"/>' + bars + "</svg>";
}
function tHBarsSVG(buckets) {
  const W = 560, rowH = 47, H = buckets.length * rowH + 8, trackX = 8, trackW = W - 16;
  const max = Math.max.apply(null, buckets.map(b => b.count).concat([1]));
  let out = "";
  buckets.forEach((b, i) => {
    const y = i * rowH + 6;
    const w = Math.max((b.count / max) * trackW, b.count ? 10 : 0);
    out += '<text x="' + (W - 8) + '" y="' + (y + 13) + '" text-anchor="end" font-size="13.5" font-weight="700" fill="#0A2242">تقدّم ' + b.label + "</text>" +
      '<text x="8" y="' + (y + 13) + '" font-size="13.5" font-weight="800" fill="#4F6579">' + b.count + " تلميذ</text>" +
      '<rect x="' + trackX + '" y="' + (y + 20) + '" width="' + trackW + '" height="13" rx="6.5" fill="#EEF4F9"/>' +
      (b.count ? '<g class="anim-grow-x" style="animation-delay:' + (i * 80) + 'ms"><rect x="' + (trackX + trackW - w) +
        '" y="' + (y + 20) + '" width="' + w + '" height="13" rx="6.5" fill="' + b.color + '"/></g>' : "");
  });
  return '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="مبيان أشرطة: توزيع التلاميذ حسب نسبة التقدم العام">' + out + "</svg>";
}
function tRingSVG(pct) {
  const C = 2 * Math.PI * 40;
  return '<svg width="92" height="92" viewBox="0 0 92 92"><circle class="ring-bg" cx="46" cy="46" r="40" fill="none" stroke-width="9"/>' +
    '<circle class="ring-fg" cx="46" cy="46" r="40" fill="none" stroke-width="9" stroke-linecap="round" stroke-dasharray="' +
    C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg>';
}

/* ---------- حالة واجهة المنصة ---------- */
const tUI = {
  view: "dashboard",
  detailKey: null,
  dbQ: "", dbLevel: "", dbSort: "progress-desc",
  pathQ: "",
  importMessages: []
};
const T_VIEW_NAMES = {
  dashboard: "لوحة القيادة", preview: "المعاينة", paths: "تتبع المسارات",
  database: "قاعدة البيانات", detail: "ملف التلميذ", settings: "الإعدادات"
};
function t$(sel) { return document.querySelector(sel); }
function tStats() { return tComputeStats(tLoadDB().students, T_DATA); }

function tShowView(name) {
  tUI.view = name;
  ["dashboard", "preview", "paths", "database", "detail", "settings"].forEach(v => {
    const el = document.getElementById("view-" + v);
    if (el) el.hidden = v !== name;
  });
  document.querySelectorAll(".t-nav-item").forEach(b =>
    b.classList.toggle("active", b.getAttribute("data-nav") === name));
  const vn = document.getElementById("topbar-view-name");
  if (vn) vn.textContent = "— " + (T_VIEW_NAMES[name] || "");
  const sc = document.getElementById("side-student-count");
  if (sc) sc.textContent = "تلميذ في القاعدة: " + Object.keys(tLoadDB().students).length;
  if (name === "dashboard") tRenderDashboard();
  else if (name === "preview") tRenderPreview();
  else if (name === "paths") tRenderPaths();
  else if (name === "database") tRenderDatabase();
  else if (name === "settings") tRenderSettings();
  const content = document.getElementById("t-content");
  if (content) content.scrollTop = 0;
  window.scrollTo(0, 0);
}
function tEmptyNote(title, text, btnLabel) {
  return '<div class="empty-note"><strong>' + tEsc(title) + "</strong>" + tEsc(text) +
    (btnLabel ? '<div style="margin-top:0.9rem"><button class="btn btn-primary" type="button" data-goto-db="1">' + tEsc(btnLabel) + "</button></div>" : "") + "</div>";
}
function tWireGotoDb(root) {
  root.querySelectorAll("[data-goto-db]").forEach(b =>
    b.addEventListener("click", () => tShowView("database")));
}

/* ---------- لوحة القيادة ---------- */
function tRenderDashboard() {
  const el = document.getElementById("view-dashboard");
  const s = tStats();
  const kpi = (ico, color, value, label) =>
    '<div class="kpi"><span class="kpi-ico" style="background:' + color + '">' + tIcon(ico) + "</span>" +
    '<span><span class="kpi-value">' + value + '</span><span class="kpi-label">' + label + "</span></span></div>";
  let html = '<h1 class="t-view-title">لوحة القيادة</h1>' +
    '<p class="t-view-sub">نظرة عامة حيّة على تلاميذك وتقدّمهم — تُبنى من قاعدة بيانات هذه المنصة لحظة فتحها.</p>' +
    '<div class="kpi-grid">' +
      kpi("users", "#10355F", s.totalStudents, "مجموع التلاميذ") +
      kpi("play", "#2FA84F", s.started, "تلاميذ بدأوا التعلم") +
      kpi("book", "#22C3E6", s.totalDone, "دروس منجزة إجمالًا") +
      kpi("award", "#F2A93B", s.totalCerts, "شهادات مستحقة") +
      kpi("chart", "#7C6BD9", s.meanPct + "٪", "معدل التقدم العام") +
    "</div>";
  if (!s.totalStudents) {
    html += tEmptyNote("لا تلاميذ في القاعدة بعد",
      "استورد أول نسخة احتياطية من صفحة «قاعدة البيانات» أو أضف تلميذًا يدويًا — وستحيا هذه اللوحة بالأرقام والمبيانات.",
      "الذهاب إلى قاعدة البيانات");
  } else {
    const legend = cats => cats.map(c =>
      '<li><span class="legend-dot" style="background:' + c.color + '"></span>' + tEsc(c.label) +
      '<span class="legend-val">' + c.count + " (" + (s.totalStudents ? Math.round(c.count / s.totalStudents * 100) : 0) + "٪)</span></li>").join("");
    html += '<div class="charts-grid">' +
      '<section class="t-card hoverable"><h2>' + tIcon("users", "icon-sm") + "<span>التلاميذ حسب المستوى الدراسي</span></h2>" +
        '<div class="chart-wrap">' + tDonutSVG(s.bySchoolLevel, s.totalStudents) +
        '<ul class="chart-legend">' + legend(s.bySchoolLevel) + "</ul></div></section>" +
      '<section class="t-card hoverable"><h2>' + tIcon("book", "icon-sm") + "<span>الدروس المنجزة في كل مستوى</span></h2>" +
        tColumnsSVG(s.lessonsPerLevel) +
        '<p class="muted small" style="margin:0.6rem 0 0">مجموع الدروس التي اجتازها كل التلاميذ في كل مستوى من مستويات الأكاديمية الخمسة.</p></section>' +
      '<section class="t-card hoverable"><h2>' + tIcon("chart", "icon-sm") + "<span>توزيع التلاميذ حسب التقدم العام</span></h2>" +
        tHBarsSVG(s.buckets) + "</section>" +
    "</div>";
  }
  el.innerHTML = html;
  tWireGotoDb(el);
}

/* ---------- المعاينة ---------- */
function tRenderPreview() {
  const el = document.getElementById("view-preview");
  const s = tStats();
  let html = '<h1 class="t-view-title">المعاينة</h1>' +
    '<p class="t-view-sub">كل تلاميذك في نظرة واحدة — اضغط بطاقة أي تلميذ لفتح ملفه الكامل.</p>';
  if (!s.rows.length) {
    html += tEmptyNote("لا تلاميذ بعد", "ستظهر بطاقات التلاميذ هنا فور استيراد نسخهم أو إضافتهم من قاعدة البيانات.", "الذهاب إلى قاعدة البيانات");
  } else {
    html += '<div class="preview-grid">' + s.rows.map(r =>
      '<article class="student-card" data-open-student="' + tEsc(r.key) + '" tabindex="0" role="button" aria-label="فتح ملف ' + tEsc(r.name) + '">' +
        '<div class="ring-wrap">' + tRingSVG(r.overallPct) +
          '<span class="ring-label">' + r.overallPct + "٪</span></div>" +
        '<div class="sc-name">' + tEsc(r.name) + "</div>" +
        '<div class="sc-meta">' + tEsc(r.schoolLevel || "مستوى دراسي غير محدد") + (r.school ? " · " + tEsc(r.school) : "") + "</div>" +
        '<div class="sc-done">' + tIcon("book", "icon-sm") + " " + r.doneCount + " / " + r.totalLessons + " درسًا" +
          (r.certificates ? ' · <span style="color:#B97A12;font-weight:700">' + tIcon("award", "icon-sm") + " × " + r.certificates + "</span>" : "") + "</div>" +
      "</article>").join("") + "</div>";
  }
  el.innerHTML = html;
  tWireGotoDb(el);
  el.querySelectorAll("[data-open-student]").forEach(card => {
    const open = () => tShowDetail(card.getAttribute("data-open-student"));
    card.addEventListener("click", open);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

/* ---------- تتبع المسارات ---------- */
function tPathNodeState(row, n) {
  const st = row.perLevel[n - 1];
  if (st.total > 0 && st.done === st.total) return "done";
  if (st.done > 0) return "current";
  if (row.currentLevel === n) return "current";
  return "locked";
}
function tRenderPaths() {
  const el = document.getElementById("view-paths");
  const s = tStats();
  const q = tUI.pathQ.trim().toLowerCase();
  const rows = s.rows.filter(r => !q ||
    r.name.toLowerCase().indexOf(q) >= 0 || (r.email || "").toLowerCase().indexOf(q) >= 0);
  let html = '<h1 class="t-view-title">تتبع المسارات</h1>' +
    '<p class="t-view-sub">مسار كل تلميذ عبر مستويات الأكاديمية الخمسة: منجز ✓، جارٍ الآن، أو مقفل بانتظار ما قبله.</p>' +
    '<div class="t-controls"><label class="grow">' + tIcon("search", "icon-sm") + ' بحث بالاسم أو البريد' +
      '<input id="path-search" type="search" placeholder="مثال: يوسف أو @example" value="' + tEsc(tUI.pathQ) + '"></label></div>';
  if (!s.rows.length) {
    html += tEmptyNote("لا تلاميذ بعد", "ستظهر مسارات التلاميذ هنا فور وجود سجلات في القاعدة.", "الذهاب إلى قاعدة البيانات");
  } else if (!rows.length) {
    html += '<div class="empty-note"><strong>لا نتائج مطابقة</strong>جرّب كلمة بحث أخرى.</div>';
  } else {
    html += rows.map(r =>
      '<div class="path-row"><div class="path-head">' + tAvatarHTML(tLoadDB().students[r.key], "av-34") +
        '<span class="p-name">' + tEsc(r.name) + "</span>" +
        '<span class="p-meta">' + tEsc(r.schoolLevel || "غير محدد") + (r.school ? " · " + tEsc(r.school) : "") + "</span>" +
        '<span class="p-pct">التقدم العام ' + r.overallPct + "٪</span></div>" +
        '<div class="path-track">' + r.perLevel.map(p => {
          const state = tPathNodeState(r, p.n);
          return '<div class="path-node ' + state + '"><span class="path-dot">' +
            (state === "done" ? tIcon("check", "icon-sm") : (state === "locked" ? tIcon("lock", "icon-sm") : p.n)) + "</span>" +
            '<span class="pn-label">المستوى ' + p.n + "</span>" +
            '<span class="pn-count">' + p.done + " / " + p.total + " درسًا</span></div>";
        }).join("") + "</div></div>").join("");
  }
  el.innerHTML = html;
  tWireGotoDb(el);
  const inp = document.getElementById("path-search");
  if (inp) inp.addEventListener("input", () => {
    tUI.pathQ = inp.value;
    const pos = inp.selectionStart;
    tRenderPaths();
    const again = document.getElementById("path-search");
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* تجاهل */ } }
  });
}

/* ---------- قاعدة البيانات ---------- */
function tDbFilteredRows(rows) {
  const q = tUI.dbQ.trim().toLowerCase();
  let out = rows.filter(r => {
    if (q && r.name.toLowerCase().indexOf(q) < 0 && (r.email || "").toLowerCase().indexOf(q) < 0) return false;
    if (tUI.dbLevel && r.schoolLevel !== tUI.dbLevel) return false;
    return true;
  });
  if (tUI.dbSort === "progress-asc") out.sort((a, b) => a.overallPct - b.overallPct);
  else if (tUI.dbSort === "name") out.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
  else if (tUI.dbSort === "done") out.sort((a, b) => b.doneCount - a.doneCount);
  else if (tUI.dbSort === "updated") out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  else out.sort((a, b) => b.overallPct - a.overallPct);
  return out;
}
function tMiniBarsHTML(r) {
  return '<div class="mini-bars">' + r.perLevel.map((p, i) =>
    '<span class="mini-bar"><span>م' + p.n + '</span><span class="mb-track"><span class="mb-fill" style="width:' +
    p.pct + "%;background:" + T_LEVEL_COLORS[i] + '"></span></span><span>' + p.pct + "٪</span></span>").join("") + "</div>";
}
function tRenderDatabase() {
  const el = document.getElementById("view-database");
  const db = tLoadDB();
  const s = tComputeStats(db.students, T_DATA);
  const rows = tDbFilteredRows(s.rows);
  const sortMark = k => tUI.dbSort === k ? " ▾" : "";
  let html = '<h1 class="t-view-title">قاعدة البيانات</h1>' +
    '<p class="t-view-sub">كل سجلات التلاميذ كاملة — استيراد وتصدير وإضافة وتعديل وحذف، كلها بيدك وحدك.</p>' +
    '<div class="db-stats">' +
      '<div class="db-stat"><span class="v">' + s.totalStudents + '</span><span class="l">سجل في القاعدة</span></div>' +
      '<div class="db-stat"><span class="v">' + tDBRawSizeKB() + ' KB</span><span class="l">حجم القاعدة في هذا المتصفح</span></div>' +
      '<div class="db-stat"><span class="v">' + s.completeInfoPct + '٪</span><span class="l">سجلات بمعلومات تكميلية كاملة</span></div>' +
      '<div class="db-stat"><span class="v">' + s.byProvider.google + '</span><span class="l">حسابات Google</span></div>' +
      '<div class="db-stat"><span class="v">' + s.byProvider.password + '</span><span class="l">حسابات استمارة</span></div>' +
      '<div class="db-stat"><span class="v">' + s.byProvider.manual + '</span><span class="l">إضافات يدوية</span></div>' +
    "</div>" +
    '<section class="t-card"><h2>' + tIcon("upload", "icon-sm") + "<span>استيراد نسخ التلاميذ الاحتياطية</span></h2>" +
      '<p class="muted" style="margin:0">اسحب ملفات النسخ الاحتياطية (JSON) التي صدّرها تلاميذك من منصتهم وأفلتها هنا، أو اخترها بالزر — عدة ملفات دفعة واحدة مقبولة. كل ملف يمرّ بفحص الصيغة نفسه في منصة التلاميذ، والسجلات تُدمج ببريد التلميذ: الجديد يُضاف والموجود يُحدَّث.</p>' +
      '<div class="drop-zone" id="db-drop"><p>' + tIcon("upload") + " أفلت ملفات النسخ الاحتياطية هنا</p>" +
        '<label class="btn btn-primary">' + tIcon("upload", "icon-sm") + '<span>اختيار ملفات النسخ</span><input id="db-files" type="file" accept="application/json,.json" multiple hidden></label></div>' +
      '<div id="db-import-msgs">' + tUI.importMessages.map(m =>
        '<p class="' + (m.ok ? "msg-ok" : "msg-err") + '" role="status">' + tEsc(m.text) + "</p>").join("") + "</div>" +
    "</section>" +
    '<div class="actions-row">' +
      '<button class="btn btn-primary" id="btn-add-student" type="button">' + tIcon("plus", "icon-sm") + "<span>إضافة تلميذ يدويًا</span></button>" +
      '<button class="btn btn-ghost" id="btn-csv" type="button">' + tIcon("download", "icon-sm") + "<span>تصدير جدول التلاميذ CSV (يفتحه Excel)</span></button>" +
    "</div>";
  if (!s.rows.length) {
    html += tEmptyNote("القاعدة فارغة", "لا سجلات بعد — استورد أول نسخة احتياطية أو أضف تلميذًا يدويًا بالزر أعلاه.", "");
  } else {
    html += '<section class="t-card"><h2>' + tIcon("db", "icon-sm") + "<span>كل السجلات</span></h2>" +
      '<div class="t-controls">' +
        '<label class="grow">' + tIcon("search", "icon-sm") + ' بحث بالاسم أو البريد<input id="db-search" type="search" placeholder="مثال: يوسف أو @example" value="' + tEsc(tUI.dbQ) + '"></label>' +
        '<label>المستوى الدراسي<select id="db-filter-level"><option value="">كل المستويات</option>' +
          T_SCHOOL_LEVELS.map(lv => '<option value="' + tEsc(lv) + '"' + (tUI.dbLevel === lv ? " selected" : "") + ">" + tEsc(lv) + "</option>").join("") + "</select></label>" +
        '<label>الترتيب<select id="db-sort">' +
          '<option value="progress-desc"' + (tUI.dbSort === "progress-desc" ? " selected" : "") + ">التقدم: من الأعلى</option>" +
          '<option value="progress-asc"' + (tUI.dbSort === "progress-asc" ? " selected" : "") + ">التقدم: من الأدنى</option>" +
          '<option value="done"' + (tUI.dbSort === "done" ? " selected" : "") + ">الدروس المنجزة</option>" +
          '<option value="updated"' + (tUI.dbSort === "updated" ? " selected" : "") + ">آخر تحديث</option>" +
          '<option value="name"' + (tUI.dbSort === "name" ? " selected" : "") + ">الاسم</option>" +
        "</select></label></div>" +
      '<p class="muted small">يظهر ' + rows.length + " من أصل " + s.rows.length + " سجلًا — اضغط أي صف لفتح ملف التلميذ الكامل.</p>" +
      '<div class="table-wrap"><table class="t-table"><thead><tr>' +
        "<th>التلميذ</th><th>البريد</th><th>السنّ</th><th>المستوى الدراسي</th><th>المؤسسة</th><th>المزوّد</th><th>كلمة السر</th>" +
        '<th class="sortable" data-sort="progress-desc">التقدم حسب المستويات' + sortMark("progress-desc") + "</th>" +
        '<th class="sortable" data-sort="progress-desc">التقدم العام' + "</th>" +
        '<th class="sortable" data-sort="done">منجزة' + sortMark("done") + "</th><th>شهادات</th>" +
        '<th class="sortable" data-sort="updated">آخر تحديث' + sortMark("updated") + "</th><th>إجراءات</th>" +
      "</tr></thead><tbody>" +
      rows.map(r => {
        const rec = db.students[r.key];
        return '<tr class="clickable" data-open-student="' + tEsc(r.key) + '">' +
          "<td>" + tAvatarHTML(rec, "av-34") + " <strong>" + tEsc(r.name) + "</strong>" +
            (r.source === "manual" ? ' <span class="badge badge-manual">يدوي</span>' : "") + "</td>" +
          '<td dir="ltr" style="text-align:end">' + (r.email ? tEsc(r.email) : "—") + "</td>" +
          "<td>" + (r.age === null ? "—" : r.age) + "</td>" +
          "<td>" + tEsc(r.schoolLevel || "—") + "</td>" +
          "<td>" + tEsc(r.school || "—") + "</td>" +
          '<td><span class="badge ' + (r.provider === "google" ? "badge-google" : (r.provider === "manual" ? "badge-manual" : "badge-form")) + '">' + tProviderLabel(rec) + "</span></td>" +
          '<td>' + (r.passwordSet ? '<span class="badge badge-yes">معيّنة</span>' : '<span class="badge">غير معيّنة</span>') + "</td>" +
          "<td>" + tMiniBarsHTML(r) + "</td>" +
          "<td><strong>" + r.overallPct + "٪</strong></td>" +
          "<td>" + r.doneCount + " / " + r.totalLessons + "</td>" +
          "<td>" + (r.certificates ? tIcon("award", "icon-sm") + " × " + r.certificates : "—") + "</td>" +
          '<td><span dir="ltr">' + tFmtStamp(r.updatedAt) + "</span></td>" +
          '<td><button class="btn btn-ghost btn-small" type="button" data-edit-student="' + tEsc(r.key) + '">' + tIcon("edit", "icon-sm") + "<span>تعديل</span></button> " +
              '<button class="btn btn-danger btn-small" type="button" data-delete-student="' + tEsc(r.key) + '">' + tIcon("trash", "icon-sm") + "<span>حذف</span></button></td>" +
        "</tr>";
      }).join("") +
      "</tbody></table></div></section>" +
    '<section class="danger-zone"><h3>' + tIcon("alert", "icon-sm") + " منطقة الخطر</h3>" +
      "<p>مسح كل البيانات المستوردة والمدخلة يدويًا من هذه المنصة في هذا المتصفح. سجلات التلاميذ في منصاتهم لا تتأثر إطلاقًا — هذا المسح يخص قاعدة هذه المنصة وحدها.</p>" +
      '<button class="btn btn-danger" id="btn-clear-all" type="button">' + tIcon("trash", "icon-sm") + "<span>مسح كل بيانات القاعدة</span></button></section>";
  }
  el.innerHTML = html;
  tWireDatabase(el);
}
function tWireDatabase(el) {
  const absorbFiles = files => {
    const list = Array.from(files || []);
    if (!list.length) return;
    tUI.importMessages = [];
    let pending = list.length;
    const done = () => { pending--; if (pending === 0) tRenderDatabase(); };
    list.forEach(f => {
      if (typeof FileReader === "undefined") {
        tUI.importMessages.push({ ok: false, text: "✗ " + f.name + ": هذا المتصفح لا يدعم قراءة الملفات." });
        return done();
      }
      const reader = new FileReader();
      reader.onload = () => {
        let obj = null;
        try { obj = JSON.parse(String(reader.result)); } catch (e) { obj = null; }
        if (!obj) { tUI.importMessages.push({ ok: false, text: "✗ " + f.name + ": تعذّرت قراءة الملف — تأكد أنه ملف نسخة احتياطية JSON صادر من منصة التلاميذ." }); return done(); }
        const v = tValidateBackup(obj);
        if (!v.ok) { tUI.importMessages.push({ ok: false, text: "✗ " + f.name + ": " + v.error }); return done(); }
        const db = tLoadDB();
        const res = tMergeImported(db.students, v.users);
        if (!tSaveDB(db)) { tUI.importMessages.push({ ok: false, text: "✗ " + f.name + ": تعذّر حفظ البيانات في هذا المتصفح (التخزين ممتلئ أو محظور)." }); return done(); }
        tUI.importMessages.push({ ok: true, text: "✓ " + f.name + ": أُضيف " + res.added + " تلميذًا وحُدّث " + res.updated + " سجل موجود." });
        done();
      };
      reader.onerror = () => { tUI.importMessages.push({ ok: false, text: "✗ " + f.name + ": تعذّرت قراءة هذا الملف." }); done(); };
      reader.readAsText(f);
    });
  };
  const fi = document.getElementById("db-files");
  if (fi) fi.addEventListener("change", () => absorbFiles(fi.files));
  const dz = document.getElementById("db-drop");
  if (dz) {
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag-over"); absorbFiles(e.dataTransfer && e.dataTransfer.files); });
  }
  const addBtn = document.getElementById("btn-add-student");
  if (addBtn) addBtn.addEventListener("click", () => tOpenStudentModal(null));
  const csvBtn = document.getElementById("btn-csv");
  if (csvBtn) csvBtn.addEventListener("click", () => {
    const rows = tComputeStats(tLoadDB().students, T_DATA).rows;
    tDownloadFile("teacher-students.csv", tRowsToCSV(rows), "text/csv;charset=utf-8");
  });
  const search = document.getElementById("db-search");
  if (search) search.addEventListener("input", () => {
    tUI.dbQ = search.value;
    const pos = search.selectionStart;
    tRenderDatabase();
    const again = document.getElementById("db-search");
    if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* تجاهل */ } }
  });
  const lvl = document.getElementById("db-filter-level");
  if (lvl) lvl.addEventListener("change", () => { tUI.dbLevel = lvl.value; tRenderDatabase(); });
  const sort = document.getElementById("db-sort");
  if (sort) sort.addEventListener("change", () => { tUI.dbSort = sort.value; tRenderDatabase(); });
  el.querySelectorAll("th.sortable").forEach(th =>
    th.addEventListener("click", () => { tUI.dbSort = th.getAttribute("data-sort"); tRenderDatabase(); }));
  el.querySelectorAll("[data-open-student]").forEach(tr =>
    tr.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      tShowDetail(tr.getAttribute("data-open-student"));
    }));
  el.querySelectorAll("[data-edit-student]").forEach(b =>
    b.addEventListener("click", () => tOpenStudentModal(b.getAttribute("data-edit-student"))));
  el.querySelectorAll("[data-delete-student]").forEach(b =>
    b.addEventListener("click", () => tDeleteStudent(b.getAttribute("data-delete-student"))));
  const clearBtn = document.getElementById("btn-clear-all");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    const n = Object.keys(tLoadDB().students).length;
    if (!window.confirm("سيتم مسح كل سجلات القاعدة (" + n + " سجلًا) من هذه المنصة في هذا المتصفح نهائيًا. سجلات التلاميذ في منصاتهم لن تتأثر. متابعة؟")) return;
    if (!window.confirm("تأكيد أخير: مسح الكل؟ لا يمكن التراجع.")) return;
    tSaveDB({ students: {} });
    tUI.importMessages = [{ ok: true, text: "✓ مُسحت كل بيانات القاعدة." }];
    tRenderDatabase();
    const sc = document.getElementById("side-student-count");
    if (sc) sc.textContent = "تلميذ في القاعدة: 0";
  });
}
function tDeleteStudent(key) {
  const db = tLoadDB();
  const rec = db.students[key];
  if (!rec) return;
  if (!window.confirm("حذف سجل التلميذ «" + (rec.name || key) + "» من قاعدة هذه المنصة؟ حسابه في منصته لا يتأثر.")) return;
  tDeleteStudentRecord(db.students, key);
  tSaveDB(db);
  if (tUI.view === "detail") tShowView("database");
  else if (tUI.view === "database") tRenderDatabase();
  else tShowView(tUI.view);
}

/* ---------- نافذة إضافة/تعديل تلميذ ---------- */
let tModalKey = null; /* null = إضافة، وغير ذلك = مفتاح السجل المعدَّل */
function tOpenStudentModal(key) {
  tModalKey = key;
  const modal = document.getElementById("student-modal");
  const title = document.getElementById("student-modal-title");
  const err = document.getElementById("sf-error");
  err.hidden = true;
  const emailInput = document.getElementById("sf-email");
  if (key) {
    const rec = tLoadDB().students[key];
    if (!rec) return;
    title.textContent = "تعديل بيانات التلميذ";
    document.getElementById("sf-firstname").value = rec.firstName || "";
    document.getElementById("sf-lastname").value = rec.lastName || "";
    emailInput.value = rec.email || key;
    emailInput.disabled = true;
    document.getElementById("sf-age").value = typeof rec.age === "number" ? rec.age : "";
    document.getElementById("sf-level").value = rec.level || "";
    document.getElementById("sf-school").value = rec.school || "";
    document.getElementById("sf-note").textContent = "البريد الإلكتروني هو هوية الدمج عند الاستيراد — لا يُعدَّل هنا حتى لا ينكسر الربط مع نسخ التلميذ.";
  } else {
    title.textContent = "إضافة تلميذ يدويًا";
    document.getElementById("student-form").reset();
    emailInput.disabled = false;
    document.getElementById("sf-note").textContent = "السجل اليدوي يُنشأ بتقدّم فارغ ويُعلَّم بمصدر «إضافة يدوية» — وعند استيراد نسخة التلميذ الاحتياطية لاحقًا يُحدَّث هذا السجل ببياناته الحقيقية.";
  }
  modal.hidden = false;
}
function tCloseStudentModal() { document.getElementById("student-modal").hidden = true; }
function tWireStudentForm() {
  const form = document.getElementById("student-form");
  form.addEventListener("submit", ev => {
    ev.preventDefault();
    const err = document.getElementById("sf-error");
    const fields = {
      firstName: document.getElementById("sf-firstname").value,
      lastName: document.getElementById("sf-lastname").value,
      email: document.getElementById("sf-email").value,
      age: document.getElementById("sf-age").value,
      level: document.getElementById("sf-level").value,
      school: document.getElementById("sf-school").value
    };
    const db = tLoadDB();
    const res = tModalKey
      ? tUpdateStudentRecord(db.students, tModalKey, fields)
      : tAddStudentRecord(db.students, fields);
    if (!res.ok) { err.textContent = res.error; err.hidden = false; return; }
    if (!tSaveDB(db)) { err.textContent = "تعذّر الحفظ في هذا المتصفح (التخزين ممتلئ أو محظور)."; err.hidden = false; return; }
    tCloseStudentModal();
    if (tUI.view === "detail" && tModalKey) tRenderDetail(tModalKey);
    else tShowView("database");
  });
  document.getElementById("sf-cancel").addEventListener("click", tCloseStudentModal);
  document.getElementById("student-modal").addEventListener("click", e => {
    if (e.target.id === "student-modal") tCloseStudentModal();
  });
}

/* ---------- ملف التلميذ ---------- */
function tShowDetail(key) {
  tUI.detailKey = key;
  tShowView("detail");
  tRenderDetail(key);
}
function tRenderDetail(key) {
  const el = document.getElementById("view-detail");
  const db = tLoadDB();
  const rec = db.students[key];
  if (!rec) {
    el.innerHTML = '<p class="crumbs"><button type="button" id="detail-back">→ عودة إلى قاعدة البيانات</button></p>' +
      '<div class="empty-note"><strong>تلميذ غير موجود</strong>لا سجل بهذا المعرّف في قاعدة هذه المنصة.</div>';
    document.getElementById("detail-back").addEventListener("click", () => tShowView("database"));
    return;
  }
  const row = tStudentRow(key, rec, T_DATA);
  const dg = (l, v) => '<div><span class="dg-l">' + l + '</span><span class="dg-v">' + v + "</span></div>";
  const levelsHtml = T_DATA.levels.map(lv => {
    const lessons = T_DATA.lessons.filter(l => l.level === lv.n);
    const st = tLevelStats(rec, T_DATA, lv.n);
    const pg = !!(rec.playgroundPassed && rec.playgroundPassed[lv.n]);
    const cert = tCertificateUnlocked(rec, T_DATA, lv.n);
    const doneDate = rec.levelDates && rec.levelDates[lv.n] ? tFmtStamp(rec.levelDates[lv.n]) : null;
    return '<section class="t-card"><div class="level-block-head"><span class="lb-title">المستوى ' + lv.n + ": " + tEsc(lv.title) + "</span>" +
      '<span class="badge">' + st.done + " / " + st.total + " درسًا</span>" +
      '<span class="badge ' + (pg ? "badge-yes" : "") + '">ملعب الكود: ' + (pg ? "تم بنجاح" : "لم يُنجز") + "</span>" +
      '<span class="badge ' + (cert ? "badge-yes" : "") + '">الشهادة: ' + (cert ? "مستحقة" : "غير مستحقة بعد") + "</span>" +
      (doneDate ? '<span class="muted small">إتمام الدروس: <span dir="ltr">' + doneDate + "</span></span>" : "") + "</div>" +
      '<div class="progress" style="margin-bottom:0.8rem"><div class="progress-fill" style="width:' + st.pct + '%"></div></div>' +
      '<div class="lesson-grid">' + lessons.map(l => {
        const p = rec.progress && rec.progress[l.id];
        const passed = tIsPassed(p, l);
        const best = p && typeof p.quizBest === "number" && p.quizTotal ? p.quizBest + " / " + p.quizTotal : "—";
        return '<div class="lesson-chip' + (passed ? " passed" : "") + '"><span class="lc-ico">' + (passed ? "✓" : l.num) + "</span><span>" +
          tEsc(l.title) + '</span><span class="lc-best">أفضل نتيجة: ' + best + "</span></div>";
      }).join("") + "</div></section>";
  }).join("");
  el.innerHTML =
    '<p class="crumbs"><button type="button" id="detail-back">→ عودة إلى قاعدة البيانات</button></p>' +
    '<section class="t-card"><div class="detail-head">' + tAvatarHTML(rec, "av-72") +
      '<div><div class="d-name">' + tEsc(row.name) + "</div>" +
      '<div class="muted">' + tProviderLabel(rec) + (row.source === "manual" ? " · سجل يدوي" : "") +
      " · التقدم العام <strong>" + row.overallPct + "٪</strong> · " + row.doneCount + " / " + row.totalLessons + " درسًا · " + row.certificates + " شهادة مستحقة</div></div>" +
      '<div style="margin-inline-start:auto;display:flex;gap:0.6rem;flex-wrap:wrap">' +
        '<button class="btn btn-ghost" id="detail-edit" type="button">' + tIcon("edit", "icon-sm") + "<span>تعديل البيانات</span></button>" +
        '<button class="btn btn-danger" id="detail-delete" type="button">' + tIcon("trash", "icon-sm") + "<span>حذف السجل</span></button></div></div>" +
      '<div class="detail-grid">' +
        dg("البريد الإلكتروني", row.email ? '<span dir="ltr">' + tEsc(row.email) + "</span>" : "—") +
        dg("السنّ", row.age === null ? "—" : row.age) +
        dg("المستوى الدراسي", tEsc(row.schoolLevel || "—")) +
        dg("المؤسسة", tEsc(row.school || "—")) +
        dg("نوع الحساب", tProviderLabel(rec)) +
        dg("كلمة السر", row.passwordSet ? "معيّنة من التلميذ" : "غير معيّنة") +
        dg("أُنشئ في", '<span dir="ltr">' + tFmtStamp(row.createdAt) + "</span>") +
        dg("آخر تحديث / نشاط", '<span dir="ltr">' + tFmtStamp(row.updatedAt) + "</span>") +
        dg("نقاط الاختبارات", row.possible ? row.earned + " / " + row.possible : "—") +
        dg("المستوى الجاري", row.allComplete ? "أكمل كل المستويات" : "المستوى " + row.currentLevel) +
      "</div></section>" + levelsHtml;
  document.getElementById("detail-back").addEventListener("click", () => tShowView("database"));
  document.getElementById("detail-edit").addEventListener("click", () => tOpenStudentModal(key));
  document.getElementById("detail-delete").addEventListener("click", () => tDeleteStudent(key));
}

/* ---------- الإعدادات ---------- */
function tRenderSettings() {
  const el = document.getElementById("view-settings");
  const s = tStats();
  el.innerHTML = '<h1 class="t-view-title">الإعدادات</h1>' +
    '<p class="t-view-sub">دخولك إلى هذه المنصة وبياناتها في هذا المتصفح.</p>' +
    '<section class="t-card"><h2>' + tIcon("key", "icon-sm") + "<span>تغيير كلمة سر الدخول</span></h2>" +
      '<form class="t-form" id="pw-form" autocomplete="off">' +
        '<label>كلمة السر الحالية<input id="pw-current" type="password" required autocomplete="current-password" dir="ltr"></label>' +
        '<label>كلمة السر الجديدة<input id="pw-new" type="password" required autocomplete="new-password" dir="ltr"><span class="field-hint">القاعدة: 8 أحرف على الأقل، وفيها حرف ورقم على الأقل.</span></label>' +
        '<label>تأكيد كلمة السر الجديدة<input id="pw-new2" type="password" required autocomplete="new-password" dir="ltr"></label>' +
        '<p class="form-error" id="pw-error" role="alert" hidden></p>' +
        '<p class="msg-ok" id="pw-ok" role="status" hidden></p>' +
        '<button class="btn btn-primary" type="submit">' + tIcon("save", "icon-sm") + "<span>حفظ كلمة السر الجديدة</span></button>" +
      "</form>" +
      '<p class="muted small">تُحفظ بصمة كلمة السر الجديدة (SHA-256 مع ملح) في هذا المتصفح وتتقدّم على كلمة السر الابتدائية — لا يُحفظ النص الصريح أبدًا.</p></section>' +
    '<section class="t-card"><h2>' + tIcon("db", "icon-sm") + "<span>ملخص البيانات</span></h2>" +
      '<ul class="kv-list">' +
        "<li><span class=\"k\">تلاميذ في القاعدة</span><span class=\"v\">" + s.totalStudents + "</span></li>" +
        "<li><span class=\"k\">مفتاح قاعدة البيانات</span><span class=\"v\">" + T_DB_KEY + "</span></li>" +
        "<li><span class=\"k\">مفتاح بيانات الدخول</span><span class=\"v\">" + T_AUTH_KEY + "</span></li>" +
        "<li><span class=\"k\">حجم قاعدة البيانات</span><span class=\"v\">" + tDBRawSizeKB() + " KB</span></li>" +
        "<li><span class=\"k\">اسم مستخدم الدخول</span><span class=\"v\">" + T_USERNAME + "</span></li>" +
      "</ul>" +
      '<p class="muted">تنبيه: بيانات هذه المنصة تعيش في متصفح هذا الحاسوب فقط (localStorage) — مسح بيانات المتصفح يمسحها، والنسخ الاحتياطية الأصلية عند التلاميذ تبقى مصدر الحقيقة دائمًا.</p></section>';
  document.getElementById("pw-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const err = document.getElementById("pw-error"), ok = document.getElementById("pw-ok");
    err.hidden = true; ok.hidden = true;
    const cur = document.getElementById("pw-current").value;
    const nw = document.getElementById("pw-new").value;
    const nw2 = document.getElementById("pw-new2").value;
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (!tCheckCredentials(tEffectiveAuth(), T_USERNAME, cur)) return fail("كلمة السر الحالية غير صحيحة.");
    const pwErr = tPasswordError(nw);
    if (pwErr) return fail(pwErr);
    if (nw !== nw2) return fail("كلمتا السر الجديدتان غير متطابقتين.");
    const salt = tRandomSalt();
    if (!tStorageSet(T_AUTH_KEY, JSON.stringify({ salt, hash: tHashPassword(nw, salt) })))
      return fail("تعذّر حفظ كلمة السر الجديدة في هذا المتصفح (التخزين ممتلئ أو محظور).");
    ok.textContent = "حُفظت كلمة السر الجديدة — استعملها في دخولك القادم إلى منصة الأستاذ.";
    ok.hidden = false;
    ev.target.reset();
  });
}

/* ---------- الدخول والتهيئة ---------- */
function tShowApp() {
  document.getElementById("login-view").hidden = true;
  document.getElementById("teacher-app").hidden = false;
  tShowView("dashboard");
}
function tShowLogin() {
  document.getElementById("teacher-app").hidden = true;
  document.getElementById("login-view").hidden = false;
}
function tInitTeacher() {
  /* حقن أيقونات الشريط الجانبي وأزراره */
  document.querySelectorAll("[data-ico]").forEach(span => {
    span.innerHTML = tIcon(span.getAttribute("data-ico"));
  });
  document.querySelectorAll(".t-nav-item").forEach(b =>
    b.addEventListener("click", () => tShowView(b.getAttribute("data-nav"))));
  document.getElementById("btn-logout").addEventListener("click", () => {
    tSessionRemove(T_SESSION_KEY);
    tShowLogin();
  });
  document.getElementById("login-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const err = document.getElementById("login-error");
    const user = document.getElementById("login-user").value;
    const pass = document.getElementById("login-pass").value;
    if (tCheckCredentials(tEffectiveAuth(), user, pass)) {
      err.hidden = true;
      tSessionSet(T_SESSION_KEY, T_USERNAME);
      tShowApp();
    } else {
      err.textContent = "اسم المستخدم أو كلمة السر غير صحيحين — حاول من جديد.";
      err.hidden = false;
    }
  });
  /* مساعد «اسألني»: ويدجت مستقل (chatbot.js) يُركَّب في teacher.html */
  tWireStudentForm();
  if (!T_DATA) {
    document.getElementById("login-view").innerHTML =
      '<p class="form-error" style="margin:auto">تعذّر تحميل بيانات المنهاج (lessons-data.js) — تأكد أن ملفات المنصة كاملة في المجلد نفسه.</p>';
    document.getElementById("login-view").hidden = false;
    return;
  }
  if (tIsLoggedIn()) tShowApp(); else tShowLogin();
}
if (typeof document !== "undefined" && typeof document.addEventListener === "function" &&
    typeof document.getElementById === "function") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", tInitTeacher);
  else tInitTeacher();
}
