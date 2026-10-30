/* ============================================================
   المزامنة السحابية الاختيارية — أكاديمية الأردوينو والروبوتات
   طبقة منفصلة تمامًا عن المنصة الأساسية:
   - هذا الملف لا يُحمَّل أبدًا عند فتح المنصة؛ يحقنه app.js في الصفحة
     لحظة ضغط زر «مزامنة سحابية» فقط، وبعد تحميل sync-config.js.
   - مكتبة Google Identity Services تُحمَّل من Google لحظة الحاجة
     الفعلية فقط، وبعد التأكد من وجود اتصال ومعرّف عميل مهيأ.
   - بدون معرّف عميل (sync-config.js فارغ) تكتفي الوحدة برسالة واضحة:
     «المزامنة غير مفعّلة بعد» — ولا يتعطل أي شيء في المنصة.
   - التخزين: ملف واحد اسمه arduino-academy-progress.json داخل
     appDataFolder الخاص بحساب Google للمستعمل — مساحة مخفية مخصصة
     لهذا التطبيق وحده، لا تظهر في ملفات Drive العادية.
   - الصيغة هي صيغة النسخة الاحتياطية نفسها (buildBackup)، والدمج
     عند الجلب يمرّ عبر validateBackup وmergeBackup نفسيهما مع خيار
     التعارض الصريح — لا حذف صامت أبدًا.
   ============================================================ */
"use strict";
window.AcademySync = (function () {
  var DRIVE_FILE_NAME = "arduino-academy-progress.json";
  var GIS_SRC = "https://accounts.google.com/gsi/client";
  var SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var tokenClient = null, accessToken = null, pendingAction = null;

  function el(id) { return document.getElementById(id); }
  function clientId() {
    var c = window.ACADEMY_SYNC_CONFIG && window.ACADEMY_SYNC_CONFIG.googleClientId;
    return typeof c === "string" ? c.trim() : "";
  }
  function offline() { return typeof navigator !== "undefined" && navigator && navigator.onLine === false; }

  function open() {
    close();
    var ov = document.createElement("div");
    ov.id = "sync-overlay";
    ov.className = "sync-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "المزامنة السحابية");
    ov.innerHTML =
      '<div class="sync-panel">' +
        '<h2>☁️ المزامنة السحابية (Google Drive)</h2>' +
        '<p class="muted">تحفظ المزامنة نسخة من تقدّمك في ملف خاص مخفي داخل حساب Google Drive الخاص بك (مساحة appDataFolder المخصصة لهذا التطبيق وحده، ولا تظهر بين ملفاتك العادية)، وتجلبها إلى أي حاسوب آخر تسجّل فيه الدخول بنفس حساب Google. بيانات هذا الحاسوب تبقى هي الأصل هنا؛ الجلب يدمج ولا يمسح.</p>' +
        '<p class="quiz-result" id="sync-status" role="status" aria-live="polite"></p>' +
        '<div class="backup-actions">' +
          '<button class="btn btn-primary" id="sync-upload" type="button">رفع تقدّمي إلى Drive</button>' +
          '<button class="btn btn-ghost" id="sync-download" type="button">جلب التقدّم من Drive ودمجه هنا</button>' +
          '<button class="btn btn-ghost" id="sync-close" type="button">إغلاق</button>' +
        '</div>' +
        '<p class="muted small">تحتاج حساب Google واتصالًا بالإنترنت أثناء المزامنة فقط. لا تُرسَل بياناتك إلى أي جهة غير حساب Drive الخاص بك.</p>' +
      '</div>';
    document.body.appendChild(ov);
    el("sync-close").addEventListener("click", close);
    el("sync-upload").addEventListener("click", function () { beginAuth("upload"); });
    el("sync-download").addEventListener("click", function () { beginAuth("download"); });
    status(initialMessage(), "warn");
  }
  function close() { var ov = el("sync-overlay"); if (ov) ov.remove(); }
  function status(text, kind) {
    var s = el("sync-status");
    if (!s) return;
    s.hidden = false;
    s.textContent = text;
    s.className = "quiz-result" + (kind ? " " + kind : "");
  }
  function initialMessage() {
    if (!clientId()) return "المزامنة غير مفعّلة بعد في هذه النسخة: لم يضع الأستاذ معرّف عميل Google (Client ID) في ملف sync-config.js. خطوات التفعيل الكاملة بالعربية في ملف SYNC-SETUP.md داخل مجلد المنصة. إلى حين تفعيلها، كل شيء يعمل محليًا كالمعتاد.";
    if (offline()) return "لا اتصال بالإنترنت الآن — المزامنة تحتاج اتصالًا. حاول من جديد عند توفره؛ تقدّمك المحلي محفوظ كالمعتاد.";
    return "جاهز: «رفع» يحفظ تقدّم هذا الحاسوب في Drive، و«جلب» يدمج النسخة السحابية في هذا الحاسوب (مع سؤالك عن أي حساب متعارض قبل استبداله).";
  }

  function loadGis() {
    return new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve(true);
      var s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error("gis")); };
      document.head.appendChild(s);
    });
  }
  function beginAuth(action) {
    if (!clientId() || offline()) { status(initialMessage(), "warn"); return; }
    pendingAction = action;
    status("جارٍ الاتصال بخدمات Google… في النافذة التي ستظهر اختر حسابك ووافق على إذن الوصول إلى بيانات التطبيق في Drive.", "");
    loadGis().then(function () {
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId(),
          scope: SCOPE,
          callback: function (resp) {
            if (resp && resp.access_token) { accessToken = resp.access_token; runPending(); }
            else status("لم تكتمل الموافقة على الوصول — أعد المحاولة ووافق على الإذن المطلوب حتى تعمل المزامنة.", "warn");
          },
          error_callback: function () {
            status("تعذّر فتح نافذة تسجيل الدخول إلى Google — تحقق من الاتصال، ومن أن المتصفح يسمح بالنوافذ المنبثقة لهذا الموقع.", "warn");
          }
        });
      }
      tokenClient.requestAccessToken({ prompt: "" });
    }).catch(function () {
      status("تعذّر تحميل مكتبة تسجيل دخول Google — تحقق من اتصالك بالإنترنت ثم حاول من جديد.", "warn");
    });
  }
  function runPending() {
    var action = pendingAction;
    pendingAction = null;
    if (action === "upload") doUpload();
    else if (action === "download") doDownload();
  }
  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ Authorization: "Bearer " + accessToken }, options.headers || {});
    return fetch("https://www.googleapis.com" + path, options).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    });
  }
  function findFile() {
    var q = encodeURIComponent("name = '" + DRIVE_FILE_NAME + "'");
    return api("/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=" + q)
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j.files && j.files[0]) || null; });
  }
  function doUpload() {
    status("جارٍ تجهيز نسختك الاحتياطية ورفعها إلى Drive…", "");
    var payload = JSON.stringify(window.buildBackup(window.loadDB()), null, 2);
    findFile().then(function (file) {
      if (file) {
        return api("/upload/drive/v3/files/" + file.id + "?uploadType=media",
          { method: "PATCH", headers: { "Content-Type": "application/json" }, body: payload });
      }
      var boundary = "----academySync" + Date.now();
      var meta = JSON.stringify({ name: DRIVE_FILE_NAME, parents: ["appDataFolder"] });
      var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
        "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + payload +
        "\r\n--" + boundary + "--";
      return api("/upload/drive/v3/files?uploadType=multipart&fields=id",
        { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: body });
    }).then(function () {
      status("✓ رُفع تقدّمك إلى Google Drive بنجاح. افتح المنصة من حاسوب آخر بنفس حساب Google واضغط «جلب» لنقله إليه.", "ok");
    }).catch(function () {
      status("تعذّر الرفع — تحقق من الاتصال ومن بقاء تسجيل الدخول صالحًا، ثم حاول من جديد. لم يتغيّر أي شيء في بياناتك المحلية.", "warn");
    });
  }
  function doDownload() {
    status("جارٍ البحث عن نسختك في Drive…", "");
    findFile().then(function (file) {
      if (!file) {
        status("لا توجد نسخة سحابية بعد لهذا الحساب — ارفع تقدّمك أولًا من الحاسوب الذي توجد عليه بياناتك.", "warn");
        return;
      }
      return api("/drive/v3/files/" + file.id + "?alt=media")
        .then(function (r) { return r.json(); })
        .then(function (obj) {
          var v = window.validateBackup(obj);
          if (!v.ok) { status("النسخة السحابية غير صالحة، لم يُدمج شيء: " + v.error, "warn"); return; }
          var db = window.loadDB();
          var conflicts = Object.keys(v.users).filter(function (n) { return window.hasUser(db, n); });
          var overwrite = false;
          if (conflicts.length) {
            overwrite = window.confirm(
              "توجد " + conflicts.length + " حسابات في النسخة السحابية بنفس أسماء حسابات موجودة على هذا الحاسوب: " + conflicts.join("، ") + ".\n\n" +
              "اضغط «موافق» لاستبدال الحسابات الموجودة بالنسخ السحابية.\n" +
              "أو اضغط «إلغاء» للاحتفاظ بحسابات هذا الحاسوب كما هي ودمج البقية فقط.\n\n" +
              "في الحالتين لن يُحذف أي حساب موجود غير مذكور في النسخة.");
            if (typeof overwrite !== "boolean") overwrite = false;
          }
          var res = window.mergeBackup(db, v.users, overwrite);
          if (!window.saveDB(db)) { status("تعذّر حفظ البيانات المدموجة على هذا الحاسوب (التخزين ممتلئ أو محظور في المتصفح).", "warn"); return; }
          status("✓ تم الجلب والدمج: أُضيف " + res.added.length + " حساب جديد" +
            (res.replaced.length ? "، واستُبدل " + res.replaced.length + " حساب" : "") +
            (res.skipped.length ? "، وبقي " + res.skipped.length + " حساب كما هو باختيارك" : "") +
            ". تُحدَّث الصفحة الآن.", "ok");
          setTimeout(function () {
            close();
            if (typeof window.render === "function") window.render();
          }, 1200);
        });
    }).catch(function () {
      status("تعذّر الجلب — تحقق من الاتصال ومن بقاء تسجيل الدخول صالحًا، ثم حاول من جديد. لم يتغيّر أي شيء في بياناتك المحلية.", "warn");
    });
  }

  return { open: open, close: close };
})();
