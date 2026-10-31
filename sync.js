/* ============================================================
   المزامنة السحابية الاختيارية — أكاديمية الروبوتيك والذكاء الاصطناعي
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
   - المزامنة التلقائية (طلب المالك 2026-10-31): بعد أي اتصال ناجح،
     تُرفع البيانات تلقائيًا كل دقيقتين إن تغيّرت منذ آخر رفع (ختم
     تغيّر يكتبه app.js عند كل حفظ)، وفورًا بعد كل حفظ جديد، ولحظة
     مغادرة التبويب. الحلقة تعمل والتبويب مرئي فقط: عند الإخفاء تُرفع
     آخر نسخة مرة واحدة، وإن طال الغياب أكثر من 3 دقائق تتوقف الحلقة
     كلها حتى العودة. رمز Google يعيش ~ساعة ولا يُجدَّد بصمت بهذا
     التدفق: عند انتهائه تتوقف التلقائية بحالة صريحة واحدة في الحوار
     («انتهت جلسة Google — أعد الاتصال»)، وإعادة الاتصال اليدوية من
     أزرار الحوار تستأنفها. مفتاح إيقاف/تفعيل محفوظ في localStorage.
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
        '<div class="sync-auto">' +
          '<p class="sync-auto-state" id="sync-auto-state" role="status" aria-live="polite"></p>' +
          '<label class="sync-auto-toggle"><input type="checkbox" id="sync-auto-toggle"> المزامنة التلقائية: ارفع تقدّمي تلقائيًا كل دقيقتين عندما يتغيّر، وأنا أعمل على المنصة</label>' +
        '</div>' +
        '<p class="muted small">تحتاج حساب Google واتصالًا بالإنترنت أثناء المزامنة فقط. لا تُرسَل بياناتك إلى أي جهة غير حساب Drive الخاص بك.</p>' +
      '</div>';
    document.body.appendChild(ov);
    el("sync-close").addEventListener("click", close);
    el("sync-upload").addEventListener("click", function () { beginAuth("upload"); });
    el("sync-download").addEventListener("click", function () { beginAuth("download"); });
    var autoTgl = el("sync-auto-toggle");
    if (autoTgl) {
      autoTgl.checked = autoEnabled();
      autoTgl.addEventListener("change", function () { setAutoEnabled(autoTgl.checked); });
    }
    status(initialMessage(), "warn");
    refreshAutoUI();
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
            if (resp && resp.access_token) {
              accessToken = resp.access_token;
              var act = pendingAction;
              runPending();
              /* اتصال ناجح = تفعيل المزامنة التلقائية. إن كان الإجراء جلبًا
                 ودمجًا، لا فحص فوري حتى لا يسبق رفعٌ الدمجَ ويطمس بيانات
                 سحابية لم تُدمج بعد — الحلقة تعمل من دورتها الموالية */
              startAuto(act === "download");
            }
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
  /* رفع حمولة جاهزة: تحديث الملف الموجود أو إنشاؤه — يستعمله الرفع
     اليدوي والمزامنة التلقائية معًا حتى لا تختلف الصيغة أبدًا */
  function uploadPayload(payload) {
    return findFile().then(function (file) {
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
    });
  }
  function doUpload() {
    status("جارٍ تجهيز نسختك الاحتياطية ورفعها إلى Drive…", "");
    var payload = JSON.stringify(window.buildBackup(window.loadDB()), null, 2);
    var stampAtStart = dataStamp();
    uploadPayload(payload).then(function () {
      markUploaded(stampAtStart);
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

  /* ============================================================
     المزامنة التلقائية — كل دقيقتين، وأنت على المنصة فقط
     - «متّسخة» (dirty): ختم تغيّر البيانات (يكتبه app.js عند كل حفظ
       ناجح) يختلف عن ختم آخر رفع ناجح. لا تغيّر = لا رفع إطلاقًا.
     - الحلقة تعمل والتبويب مرئي: عند إخفائه تُحاوَل مزامنة أخيرة
       فورية إن كان هناك جديد (أهم مزامنة: لحظة المغادرة)، وإن بقي
       مخفيًا أكثر من 3 دقائق تتوقف الحلقة كلها (paused) فلا رفع
       لجلسة مهجورة. العودة تستأنف: مزامنة لحاق فورية إن تغيّر شيء
     ثم الحلقة العادية. غياب قصير (< 3 دقائق) لا يقتل الحلقة أبدًا.
     - انتهاء رمز Google (~ساعة، لا تجديد صامت بهذا التدفق): أول
       رفض أثناء الرفع التلقائي يوقف الحلقة ويضع حالة صريحة واحدة
       «انتهت جلسة Google — أعد الاتصال» — بلا إغراق أخطاء متكرر.
       إعادة الاتصال من أزرار الحوار تستأنف التلقائية من جديد.
     ============================================================ */
  var AUTO_PREF_KEY = "arduinoAcademyAutoSync.v1";
  var SYNC_STAMP_KEY = "arduinoAcademySyncStamp.v1";
  var DATA_STAMP_KEY = "arduinoAcademyDataStamp.v1"; /* المفتاح نفسه في app.js */
  var AUTO_INTERVAL_MS = 120000;
  var AWAY_PAUSE_MS = 180000;
  var autoTimer = null, awayTimer = null, dataSavedTimer = null;
  var autoBusy = false;
  var autoState = "off"; /* off | on | paused | expired */
  var lastSyncAt = 0;

  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* تجاهل */ } }
  function autoEnabled() { return storeGet(AUTO_PREF_KEY) !== "off"; }
  function dataStamp() { return storeGet(DATA_STAMP_KEY) || ""; }
  function isDirty() { var s = dataStamp(); return !!s && s !== (storeGet(SYNC_STAMP_KEY) || ""); }
  function pageHidden() {
    return typeof document !== "undefined" &&
      (document.visibilityState === "hidden" || document.hidden === true);
  }
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function timeStr(ts) { var d = new Date(ts); return two(d.getHours()) + ":" + two(d.getMinutes()); }
  function markUploaded(stamp) {
    storeSet(SYNC_STAMP_KEY, stamp || dataStamp());
    lastSyncAt = Date.now();
    refreshAutoUI();
  }
  function refreshAutoUI() {
    var tgl = el("sync-auto-toggle");
    if (tgl) tgl.checked = autoEnabled();
    var s = el("sync-auto-state");
    if (!s) return;
    if (autoState === "expired") {
      s.textContent = "المزامنة التلقائية: متوقفة — انتهت جلسة Google، أعد الاتصال من أزرار المزامنة.";
    } else if (!autoEnabled()) {
      s.textContent = "المزامنة التلقائية: معطّلة باختيارك.";
    } else if (autoState === "on") {
      s.textContent = "المزامنة التلقائية: مفعّلة" + (lastSyncAt ? " · آخر مزامنة: " + timeStr(lastSyncAt) : " · لم تُرفع نسخة بعد في هذه الجلسة");
    } else if (autoState === "paused") {
      s.textContent = "المزامنة التلقائية: متوقفة مؤقتًا بعد غياب طويل — تُستأنف عند عودتك إلى التبويب.";
    } else {
      s.textContent = "المزامنة التلقائية: تُفعَّل بعد أول اتصال ناجح بـ Google من أزرار المزامنة.";
    }
  }
  function setAutoEnabled(on) {
    storeSet(AUTO_PREF_KEY, on ? "on" : "off");
    if (!on) {
      stopAutoTimers();
      if (autoState !== "expired") autoState = "off";
    } else if (accessToken) {
      autoState = "on";
      startAutoTimer();
      autoTick();
    }
    refreshAutoUI();
  }
  function startAutoTimer() {
    if (autoTimer || !accessToken || !autoEnabled()) return;
    autoTimer = setInterval(autoTick, AUTO_INTERVAL_MS);
  }
  function stopAutoTimers() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
    if (dataSavedTimer) { clearTimeout(dataSavedTimer); dataSavedTimer = null; }
  }
  /* تُستدعى بعد كل اتصال ناجح. skipImmediateTick عند إجراء «جلب ودمج»
     حتى لا يسبق رفعٌ اكتمالَ الدمج (انظر نداءها في beginAuth) */
  function startAuto(skipImmediateTick) {
    if (!accessToken || !autoEnabled()) { refreshAutoUI(); return; }
    autoState = "on";
    startAutoTimer();
    refreshAutoUI();
    if (!skipImmediateTick) autoTick();
  }
  function autoTick() {
    if (!accessToken || !autoEnabled()) return;
    if (autoState !== "on") return;
    if (pageHidden()) return; /* للمغادرة مسارها الخاص أسفله */
    if (!isDirty()) return;
    autoUpload();
  }
  function autoUpload() {
    if (autoBusy || !accessToken || !autoEnabled()) return;
    if (!isDirty()) return;
    autoBusy = true;
    var stampAtStart = dataStamp();
    var payload;
    try { payload = JSON.stringify(window.buildBackup(window.loadDB()), null, 2); }
    catch (e) { autoBusy = false; return; }
    uploadPayload(payload).then(function () {
      autoBusy = false;
      markUploaded(stampAtStart);
      status("✓ مزامنة تلقائية: حُفظ تقدّمك في Google Drive (آخر مزامنة " + timeStr(lastSyncAt) + ").", "ok");
    }).catch(function (err) {
      autoBusy = false;
      autoSyncFailed(err);
    });
  }
  /* فشل الرفع التلقائي: إيقاف فوري وحالة واحدة صريحة — أبدًا إغراق
     متكرر. 401/403 تعني جلسة منتهية/مرفوضة؛ غيرها (انقطاع شبكة) يوقف
     أيضًا بانتظار إعادة اتصال يدوية صريحة من أزرار الحوار */
  function autoSyncFailed(err) {
    var msg = err && err.message ? String(err.message) : "";
    stopAutoTimers();
    accessToken = null;
    if (msg.indexOf("401") >= 0 || msg.indexOf("403") >= 0) {
      autoState = "expired";
      status("انتهت جلسة Google — توقّفت المزامنة التلقائية. أعد الاتصال من زر «رفع تقدّمي إلى Drive» لتستأنفها.", "warn");
    } else {
      autoState = "off";
      status("تعذّرت المزامنة التلقائية — توقّفت حتى لا تتكرر المحاولات بصمت. تحقق من الاتصال ثم أعد الاتصال من أزرار المزامنة.", "warn");
    }
    refreshAutoUI();
  }
  function onPageHidden() {
    /* أهم مزامنة: لحظة المغادرة — آخر تقدّم يُرفع فورًا إن تغيّر */
    if (accessToken && autoEnabled() && autoState === "on" && isDirty()) autoUpload();
    /* غياب أطول من 3 دقائق: إيقاف الحلقة كلها — جلسة مهجورة لا تُزامَن */
    if (awayTimer) clearTimeout(awayTimer);
    awayTimer = setTimeout(function () {
      awayTimer = null;
      if (pageHidden() && autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
        autoState = "paused";
        refreshAutoUI();
      }
    }, AWAY_PAUSE_MS);
  }
  function onPageVisible() {
    if (awayTimer) { clearTimeout(awayTimer); awayTimer = null; }
    if (!accessToken || !autoEnabled() || autoState === "expired") return;
    if (autoState === "paused") {
      autoState = "on";
      startAutoTimer();
      refreshAutoUI();
    }
    /* عودة بعد غياب قصير أو طويل: لحاق فوري إن تغيّر شيء أثناء الغياب */
    if (autoState === "on" && isDirty()) autoUpload();
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("visibilitychange", function () {
      if (pageHidden()) onPageHidden(); else onPageVisible();
    });
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("beforeunload", function () {
      /* محاولة أخيرة عند إغلاق الصفحة نهائيًا إن كان هناك جديد */
      if (accessToken && autoEnabled() && autoState === "on" && isDirty()) autoUpload();
    });
    window.addEventListener("academy:data-saved", function () {
      /* حفظ جديد (إتمام درس/اجتياز اختبار هو المسار الطبيعي): رفع فوري
         بعد تهدئة قصيرة تجمع الحفظات المتتالية، بشرط الاتصال والتفعيل */
      if (!accessToken || !autoEnabled() || autoState !== "on" || pageHidden()) return;
      if (dataSavedTimer) clearTimeout(dataSavedTimer);
      dataSavedTimer = setTimeout(function () { dataSavedTimer = null; autoTick(); }, 1200);
    });
  }

  return {
    open: open,
    close: close,
    connect: beginAuth,
    /* واجهة المزامنة التلقائية: يستعملها الحوار، وتغطيها الاختبارات */
    auto: {
      enabled: autoEnabled,
      setEnabled: setAutoEnabled,
      state: function () { return autoState; },
      isDirty: isDirty,
      tick: autoTick,
      lastSyncAt: function () { return lastSyncAt; }
    }
  };
})();
