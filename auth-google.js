/* ============================================================
   الدخول والتسجيل عبر Google — أكاديمية الروبوتيك والذكاء الاصطناعي
   طبقة كسولة منفصلة تمامًا عن المنصة الأساسية، مثل sync.js:
   - هذا الملف لا يُحمَّل أبدًا عند فتح المنصة؛ يحقنه app.js في الصفحة
     لحظة ضغط زر «المتابعة مع Google» / «تسجيل الدخول مع Google» فقط،
     وبعد تحميل sync-config.js (المصدر الوحيد لمعرّف العميل).
   - مكتبة Google Identity Services تُحمَّل من Google لحظة الحاجة
     الفعلية فقط. النطاقات المطلوبة: openid + email + profile لقراءة
     الاسم والبريد من نقطة userinfo, وdrive.appdata حتى تكفي الموافقة
     نفسها لاحقًا لمزامنة التقدّم دون طلب إذن ثانٍ.
   - المنطق الحسابي (إنشاء الحساب/الدخول/الرسائل) كله في app.js؛
     هذه الوحدة تنقل ملف Google فقط (الاسم والبريد وصورة الحساب)
     عبر hooks: onProfile / onError.
   - دون إنترنت أو دون معرّف عميل: رسالة عربية واضحة عبر onError،
     ولا يتعطل أي شيء في المنصة — الاستمارة العادية تعمل دائمًا.
   ============================================================ */
"use strict";
window.AcademyGoogle = (function () {
  var GIS_SRC = "https://accounts.google.com/gsi/client";
  var USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
  var SCOPE = "openid email profile https://www.googleapis.com/auth/drive.appdata";
  var tokenClient = null, pending = null;

  function clientId() {
    var c = window.ACADEMY_SYNC_CONFIG && window.ACADEMY_SYNC_CONFIG.googleClientId;
    return typeof c === "string" ? c.trim() : "";
  }
  function offline() { return typeof navigator !== "undefined" && navigator && navigator.onLine === false; }
  function fail(message) {
    var p = pending;
    pending = null;
    if (p && typeof p.onError === "function") p.onError(message);
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
  function fetchProfile(accessToken) {
    fetch(USERINFO_URL, { headers: { Authorization: "Bearer " + accessToken } })
      .then(function (r) {
        if (!r.ok) throw new Error("userinfo " + r.status);
        return r.json();
      })
      .then(function (j) {
        var p = pending;
        pending = null;
        if (p && typeof p.onProfile === "function") {
          p.onProfile({ name: (j && j.name) || "", email: (j && j.email) || "", picture: (j && j.picture) || "" });
        }
      })
      .catch(function () {
        fail("تعذّرت قراءة بيانات حساب Google بعد تسجيل الدخول — تحقق من الاتصال وحاول من جديد.");
      });
  }
  /* mode: "register" | "login" — hooks: { onProfile(profile), onError(message) } */
  function signIn(mode, hooks) {
    pending = { mode: mode, onProfile: hooks && hooks.onProfile, onError: hooks && hooks.onError };
    if (!clientId()) { fail("الدخول عبر Google غير مفعّل بعد في هذه النسخة: لم يضع الأستاذ معرّف عميل Google. استعمل الاستمارة العادية."); return; }
    if (offline()) { fail("أنت غير متصل بالإنترنت — الدخول عبر Google يحتاج اتصالًا. الاستمارة العادية تعمل دون إنترنت."); return; }
    loadGis().then(function () {
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId(),
          scope: SCOPE,
          callback: function (resp) {
            if (resp && resp.access_token) fetchProfile(resp.access_token);
            else fail("لم تكتمل موافقة Google — أعد المحاولة ووافق على تسجيل الدخول حتى نعرف اسمك وبريدك.");
          },
          error_callback: function () {
            fail("تعذّر فتح نافذة تسجيل الدخول إلى Google — تحقق من الاتصال، ومن أن المتصفح يسمح بالنوافذ المنبثقة لهذا الموقع.");
          }
        });
      }
      tokenClient.requestAccessToken({ prompt: "select_account" });
    }).catch(function () {
      fail("تعذّر تحميل مكتبة تسجيل دخول Google — تحقق من اتصالك بالإنترنت ثم حاول من جديد.");
    });
  }

  return { signIn: signIn };
})();
